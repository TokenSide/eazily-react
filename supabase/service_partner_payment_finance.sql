-- Service Partner finance bridge. Apply after seller_gateway.sql and
-- seller_finance_extensions.sql. This does not enable checkout or payouts.
begin;

alter table public.customer_payments
  add column if not exists partner_order_id uuid references public.partner_orders(id),
  add column if not exists seller_payment_request_id uuid unique references eazily_private.payment_requests(id),
  add column if not exists refunded_paise bigint not null default 0 check(refunded_paise >= 0 and refunded_paise <= amount_paise);

create or replace function eazily_private.sync_service_partner_payment() returns trigger
language plpgsql security definer set search_path=public,eazily_private,pg_temp as $$
declare payment_order public.partner_orders; payment_quote eazily_private.quotes; total_refunded bigint;
begin
 select q.* into payment_quote from eazily_private.payment_requests r
 join eazily_private.quotes q on q.id=r.quote_id where r.id=new.request_id;
 select * into payment_order from public.partner_orders where id=payment_quote.order_id;
 if payment_order.role is distinct from 'professional' then return new; end if;
 if new.kind='paid' then
  insert into public.customer_payments(customer_id,partner_order_id,seller_payment_request_id,provider,provider_reference,amount_paise,currency,status,paid_at)
  values(payment_order.customer_id,payment_order.id,new.request_id,'Cashfree',new.provider_event,new.amount_paise,'INR','paid',new.created_at)
  on conflict(seller_payment_request_id) do nothing;
 elsif new.kind='refund' then
  select coalesce(sum(amount_paise),0) into total_refunded from eazily_private.payment_events
   where request_id=new.request_id and kind='refund';
  update public.customer_payments set refunded_paise=total_refunded,
   status=case when total_refunded=amount_paise then 'fully_refunded' else 'partially_refunded' end
   where seller_payment_request_id=new.request_id and total_refunded<=amount_paise;
  if not found then raise exception 'Verified Service Partner payment is missing or refund exceeds capture'; end if;
  update public.partner_payouts set status='held',hold_reason='Verified refund requires payout reconciliation'
   where order_id=payment_order.id and status in('scheduled','processing','failed','uncertain');
 end if;
 return new;
end $$;
revoke all on function eazily_private.sync_service_partner_payment() from public,anon,authenticated;
create trigger sync_service_partner_payment after insert on eazily_private.payment_events
for each row execute function eazily_private.sync_service_partner_payment();

-- Reconcile historical verified gateway events; leave unrelated payments alone.
insert into public.customer_payments(customer_id,partner_order_id,seller_payment_request_id,provider,provider_reference,amount_paise,currency,status,paid_at)
select o.customer_id,o.id,r.id,'Cashfree',paid.provider_event,paid.amount_paise,'INR','paid',paid.created_at
from eazily_private.payment_requests r
join eazily_private.quotes q on q.id=r.quote_id
join public.partner_orders o on o.id=q.order_id and o.role='professional'
join eazily_private.payment_events paid on paid.request_id=r.id and paid.kind='paid'
on conflict(seller_payment_request_id) do nothing;
update public.customer_payments payment set refunded_paise=refunds.total,
 status=case when refunds.total=payment.amount_paise then 'fully_refunded' else 'partially_refunded' end
from (select request_id,sum(amount_paise)::bigint as total from eazily_private.payment_events where kind='refund' group by request_id) refunds
where payment.seller_payment_request_id=refunds.request_id and refunds.total<=payment.amount_paise;
update public.partner_payouts payout set status='held',hold_reason='Verified refund requires payout reconciliation'
where payout.status in('scheduled','processing','failed','uncertain') and exists(
 select 1 from public.customer_payments payment where payment.partner_order_id=payout.order_id and payment.refunded_paise>0
);

create policy "Finance staff read Service Partner earnings" on public.partner_earnings for select
using(role='professional' and has_staff_permission('finance.view'));
create policy "Finance staff read Service Partner payouts" on public.partner_payouts for select
using(has_staff_permission('finance.view') and exists(select 1 from public.partner_applications app where app.id=partner_id and app.role='professional'));

create function public.admin_service_partner_finance_summary() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare captured bigint; refunded bigint; earned bigint; reversed bigint; paid_out bigint; scheduled bigint;
begin
 if not (is_admin() or has_staff_permission('finance.view') or has_staff_permission('payout.view')) then raise exception 'Finance access required'; end if;
 select coalesce(sum(amount_paise),0)::bigint,coalesce(sum(refunded_paise),0)::bigint
 into captured,refunded from public.customer_payments payment
 join public.partner_orders payment_order on payment_order.id=payment.partner_order_id and payment_order.role='professional'
 where payment.status in('paid','partially_refunded','fully_refunded');
 select coalesce(sum(case when state<>'reversed' then round(amount*100)::bigint else 0 end),0)::bigint,
        coalesce(sum(case when state='reversed' then round(amount*100)::bigint else 0 end),0)::bigint
 into earned,reversed from public.partner_earnings where role='professional';
 select coalesce(sum(case when p.status='paid' and p.paid_at is not null and p.provider_reference is not null then p.amount_paise else 0 end),0)::bigint,
        coalesce(sum(case when p.status in('scheduled','processing','failed','uncertain') then p.amount_paise else 0 end),0)::bigint
 into paid_out,scheduled from public.partner_payouts p join public.partner_applications app on app.id=p.partner_id where app.role='professional';
 return jsonb_build_object('customerCapturedPaise',captured,'customerRefundedPaise',refunded,
  'customerNetPaise',captured-refunded,'partnerEarnedPaise',earned,'partnerReversedPaise',reversed,
  'partnerPayablePaise',greatest(earned-reversed-paid_out,0),'paidPayoutPaise',paid_out,
  'scheduledPayoutPaise',scheduled);
end $$;
revoke all on function public.admin_service_partner_finance_summary() from public,anon,authenticated;
grant execute on function public.admin_service_partner_finance_summary() to authenticated;
commit;
