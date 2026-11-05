-- Apply after all existing partner/auth/payment migrations and consultant_legal.sql.
-- Consumer enforcement activates only when BOTH approved documents are effective.
-- No account, booking, historical consent, payment flag or draft is published here.
begin;
alter table public.legal_documents add column if not exists consumer_complete boolean not null default false;
alter table public.legal_documents add column if not exists consumer_branding_approved boolean not null default false;
alter table public.legal_documents add column if not exists consumer_operator_verified boolean not null default false;
alter table public.legal_documents add column if not exists consumer_features_reviewed boolean not null default false;
alter table public.legal_documents add column if not exists consumer_operator_name text;
alter table public.legal_documents add column if not exists consumer_review_reference text;
alter table public.legal_documents add column if not exists consumer_approved_by uuid references public.profiles(id);
alter table public.legal_documents add column if not exists consumer_approved_at timestamptz;
alter table public.consent_events add column if not exists legal_document_id uuid references public.legal_documents(id);
create unique index consumer_consent_version on public.consent_events(account_id,consent_type,version)
 where partner_application_id is null and consent_type in ('eazily-consumer-terms','eazily-consumer-privacy-policy');

create function public.guard_consumer_document() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op<>'INSERT' and old.document_key in ('eazily-consumer-terms','eazily-consumer-privacy-policy') then
  if old.consumer_approved_at is not null or exists(select 1 from consent_events where legal_document_id=old.id) then
   raise exception 'Approved Consumer documents are immutable; create a new version';
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 if new.document_key in ('eazily-consumer-terms','eazily-consumer-privacy-policy') then
  if (new.document_key='eazily-consumer-terms' and new.kind<>'terms') or (new.document_key='eazily-consumer-privacy-policy' and new.kind<>'privacy_policy') then raise exception 'Consumer document kind does not match identifier'; end if;
  if new.published or new.consumer_approved_at is not null then
   if new.version='2026-09-20-draft' or new.content like '%Will achieve a particular.%'
    or trim(new.content) ~ 'under its own privacy policy[[:space:]]*$'
    or not new.consumer_complete or not new.consumer_branding_approved or not new.consumer_operator_verified or not new.consumer_features_reviewed
    or new.consumer_approved_by is null or new.consumer_approved_at is null
    or coalesce(length(trim(new.consumer_operator_name)),0)=0 or coalesce(length(trim(new.consumer_review_reference)),0)=0
    or length(trim(new.content))=0 then
     raise exception 'Consumer publication blocked: complete endings, approved branding, verified operator, feature review and final approval are required';
   end if;
  end if;
 end if;
 return new;
end $$;
create trigger guard_consumer_document before insert or update or delete on public.legal_documents for each row execute function public.guard_consumer_document();

create function public.current_consumer_documents() returns setof legal_documents
language sql stable security definer set search_path=public,pg_temp as $$
 select distinct on (document_key) d.* from legal_documents d
 where document_key in ('eazily-consumer-terms','eazily-consumer-privacy-policy') and language='English'
 and published and consumer_complete and consumer_branding_approved and consumer_operator_verified and consumer_features_reviewed
 and consumer_approved_by is not null and consumer_approved_at is not null and effective_at<=now()
 order by document_key,effective_at desc,consumer_approved_at desc,id
$$;
create function public.consumer_policies_accepted(p_customer uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select (select count(*) from current_consumer_documents())=2 and not exists(
  select 1 from current_consumer_documents() d where not exists(
   select 1 from consent_events c where c.account_id=p_customer and c.partner_application_id is null
   and c.legal_document_id=d.id and c.consent_type=d.document_key and c.version=d.version and c.accepted))
$$;
create function public.require_consumer_policies(p_customer uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if (select count(*) from current_consumer_documents())=2 and not consumer_policies_accepted(p_customer) then
  raise exception 'Current Consumer Terms acceptance and Privacy Policy acknowledgment are required' using errcode='P0001';
 end if;
end $$;

-- Public policy access does not require signing in and NEVER writes consent.
create function public.get_consumer_legal_status() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
 'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'document_key',d.document_key,'kind',d.kind,'title',d.title,'content',d.content,'version',d.version,'effective_at',d.effective_at,'published',d.published)) from current_consumer_documents() d),'[]'::jsonb),
 'required',(select count(*) from current_consumer_documents())=2,
 'accepted',consumer_policies_accepted(auth.uid()),
 'acceptances',coalesce((select jsonb_agg(to_jsonb(c) order by recorded_at desc) from consent_events c where account_id=auth.uid() and partner_application_id is null and consent_type in ('eazily-consumer-terms','eazily-consumer-privacy-policy')),'[]'::jsonb))
$$;

create function public.accept_consumer_policies(p_documents jsonb,p_terms_accepted boolean,p_privacy_acknowledged boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare doc legal_documents; recorded_id uuid;
begin
 if auth.uid() is null then raise exception 'Sign in to acknowledge Consumer policies'; end if;
 if not exists(select 1 from profiles where id=auth.uid() and account_status='active') then raise exception 'Active customer profile required'; end if;
 if p_terms_accepted is distinct from true or p_privacy_acknowledged is distinct from true then raise exception 'Separate explicit Terms acceptance and Privacy acknowledgment are required'; end if;
 lock table legal_documents in share mode;
 if (select count(*) from current_consumer_documents())<>2 then raise exception 'Approved Consumer policies are not available for acknowledgment'; end if;
 if jsonb_typeof(p_documents) is distinct from 'array' then raise exception 'Both current document identifiers and versions are required'; end if;
 if jsonb_array_length(p_documents)<>2 then raise exception 'Both current document identifiers and versions are required'; end if;
 for doc in select * from current_consumer_documents() loop
  if not exists(select 1 from jsonb_array_elements(p_documents) item where item->>'id'=doc.id::text and item->>'version'=doc.version) then raise exception 'Consumer policies changed; review both current versions'; end if;
 end loop;
 for doc in select * from current_consumer_documents() loop
  recorded_id:=null;
  insert into consent_events(account_id,partner_application_id,consent_type,version,accepted,consent_text,recorded_at,legal_document_id)
  values(auth.uid(),null,doc.document_key,doc.version,true,
   case when doc.kind='terms' then 'I have read and agree to the Consumer Terms & Conditions.' else 'I have read and acknowledge the Consumer Privacy Policy.' end,now(),doc.id)
  on conflict(account_id,consent_type,version) where partner_application_id is null and consent_type in ('eazily-consumer-terms','eazily-consumer-privacy-policy') do nothing returning id into recorded_id;
  if recorded_id is not null then
   insert into admin_audit_events(actor_id,action,entity_type,entity_id,after_data)
   values(auth.uid(),'consumer_policy_acknowledged','legal_document',doc.id::text,jsonb_build_object('documentId',doc.document_key,'version',doc.version,'consentEventId',recorded_id));
  end if;
 end loop;
 return get_consumer_legal_status();
end $$;

create function public.guard_consumer_consent() returns trigger language plpgsql as $$
begin
 if (case when tg_op='DELETE' then old.consent_type else new.consent_type end) in ('eazily-consumer-terms','eazily-consumer-privacy-policy')
 or (tg_op='UPDATE' and old.consent_type in ('eazily-consumer-terms','eazily-consumer-privacy-policy')) then
  if tg_op<>'INSERT' or current_user in ('anon','authenticated') then raise exception 'Consumer consent is append-only and server-recorded'; end if;
  if new.partner_application_id is not null or new.legal_document_id is null then raise exception 'Consumer consent requires an account and document reference'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger guard_consumer_consent before insert or update or delete on public.consent_events for each row execute function public.guard_consumer_consent();

-- Table guards defend against direct writes and secondary booking RPCs. Existing
-- order updates, cancellation, refunds and provider callbacks remain available.
create function public.guard_consumer_booking() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin perform require_consumer_policies(new.customer_id); return new; end $$;
create trigger consumer_service_request before insert on public.service_requests for each row execute function public.guard_consumer_booking();
create trigger consumer_partner_order before insert on public.partner_orders for each row execute function public.guard_consumer_booking();

revoke all on function public.guard_consumer_document(),public.current_consumer_documents(),public.consumer_policies_accepted(uuid),public.require_consumer_policies(uuid),public.guard_consumer_consent(),public.guard_consumer_booking(),public.get_consumer_legal_status(),public.accept_consumer_policies(jsonb,boolean,boolean) from public,anon,authenticated;
grant execute on function public.get_consumer_legal_status() to anon,authenticated;
grant execute on function public.accept_consumer_policies(jsonb,boolean,boolean) to authenticated;
commit;
