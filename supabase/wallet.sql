-- Apply after experience.sql. Call reserve_wallet only when accepting a published quote.
begin;
create table public.wallet_lots (
 credit_id uuid primary key references public.wallet_ledger(id), customer_id uuid not null references public.profiles(id),
 remaining numeric(12,2) not null check(remaining>=0), expires_at timestamptz
);
alter table public.wallet_lots enable row level security;
create function public.track_wallet_credit() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.amount>0 then insert into wallet_lots values(new.id,new.customer_id,new.amount,new.expires_at); end if;
 return new;
end $$;
create trigger wallet_credit_lot after insert on public.wallet_ledger for each row execute function public.track_wallet_credit();
create function public.adjust_reversed_credit() returns trigger language plpgsql security definer set search_path=public as $$
declare credit wallet_ledger; expired numeric;
begin
 if new.kind='reversal' then
  select * into credit from wallet_ledger where booking_id=new.booking_id and customer_id=new.customer_id and kind='referral';
  if found then
   select coalesce(sum(amount),0) into expired from wallet_ledger where event_key='expiry:'||credit.id;
   new.amount:=-greatest(credit.amount+expired,0);
   update wallet_lots set remaining=0 where credit_id=credit.id;
  end if;
 end if; return new;
end $$;
create trigger adjust_reversal before insert on public.wallet_ledger for each row execute function public.adjust_reversed_credit();
create function public.expire_wallet(p_customer uuid) returns void language plpgsql security definer set search_path=public as $$
declare lot wallet_lots;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_customer::text,0));
 for lot in select * from wallet_lots where customer_id=p_customer and expires_at<=now() and remaining>0 for update loop
  insert into wallet_ledger(customer_id,amount,kind,event_key) values(p_customer,-lot.remaining,'expired','expiry:'||lot.credit_id) on conflict do nothing;
  update wallet_lots set remaining=0 where credit_id=lot.credit_id;
 end loop;
end $$;
create function public.wallet_balance() returns numeric language plpgsql security definer set search_path=public as $$
declare result numeric;
begin
 if auth.uid() is null then raise exception 'Sign in to view wallet'; end if;
 perform expire_wallet(auth.uid());
 select coalesce(sum(amount),0) into result from wallet_ledger where customer_id=auth.uid(); return result;
end $$;
create function public.reserve_wallet(p_booking uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare b service_requests; balance numeric; applied numeric; left_to_use numeric; lot wallet_lots; take numeric; percent integer;
begin
 if auth.uid() is null then raise exception 'Sign in to use wallet'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into b from service_requests where id=p_booking and customer_id=auth.uid() for update;
 if b.id is null or b.quoted_total is null or b.status='cancelled' or b.payment_status<>'unpaid' then raise exception 'A confirmed unpaid quote is required'; end if;
 if exists(select 1 from wallet_ledger where event_key='checkout:'||b.id) then return jsonb_build_object('wallet_used',b.wallet_used,'remaining',b.quoted_total-b.wallet_used); end if;
 balance:=greatest(wallet_balance(),0);
 select redemption_percent into percent from referral_config;
 applied:=least(balance,round(b.quoted_total*percent/100,2));
 if applied<=0 then return jsonb_build_object('wallet_used',0,'remaining',b.quoted_total); end if;
 left_to_use:=applied;
 for lot in select * from wallet_lots where customer_id=auth.uid() and remaining>0 order by expires_at nulls last,credit_id for update loop
  take:=least(lot.remaining,left_to_use);
  update wallet_lots set remaining=remaining-take where credit_id=lot.credit_id;
  left_to_use:=left_to_use-take; exit when left_to_use=0;
 end loop;
 insert into wallet_ledger(customer_id,amount,kind,event_key,booking_id) values(auth.uid(),-applied,'checkout','checkout:'||b.id,b.id);
 update service_requests set wallet_used=applied where id=b.id;
 return jsonb_build_object('wallet_used',applied,'remaining',b.quoted_total-applied);
end $$;
-- Cancellation/refund returns reserved credit once; a refund uses current reward expiry settings.
create function public.return_booking_wallet() returns trigger language plpgsql security definer set search_path=public as $$
declare days integer;
begin
 if (new.status='cancelled' or new.payment_status='refunded') and new.wallet_used>0 then
  perform pg_advisory_xact_lock(hashtextextended(new.customer_id::text,0));
  select expiry_days into days from referral_config;
  insert into wallet_ledger(customer_id,amount,kind,event_key,booking_id,expires_at)
  values(new.customer_id,new.wallet_used,'refund','refund:'||new.id,new.id,case when days is null then null else now()+make_interval(days=>days) end) on conflict do nothing;
 end if; return new;
end $$;
create trigger return_wallet after update of status,payment_status on public.service_requests for each row execute function public.return_booking_wallet();
revoke all on function public.expire_wallet(uuid),public.wallet_balance(),public.reserve_wallet(uuid) from public,anon;
grant execute on function public.wallet_balance(),public.reserve_wallet(uuid) to authenticated;
commit;
