-- Apply AFTER influencer_legal_2026_09_12.sql, consultant_assessments.sql and
-- other existing partner migrations. Local preparation only; no publication.
begin;
alter table public.legal_documents add column if not exists consultant_complete boolean not null default false;
alter table public.legal_documents add column if not exists consultant_approved_by uuid references public.profiles(id);
alter table public.legal_documents add column if not exists consultant_approved_at timestamptz;
alter table public.consent_events add column if not exists legal_document_id uuid references public.legal_documents(id);

create or replace function public.guard_consultant_document() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if tg_op <> 'INSERT' and old.document_key in ('eazily-consultant-provider-terms','eazily-consultant-provider-privacy-policy') then
  if old.consultant_approved_at is not null or exists(select 1 from consent_events where legal_document_id=old.id) then
   raise exception 'Approved Consultant documents are immutable; create a new version';
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 if new.document_key in ('eazily-consultant-provider-terms','eazily-consultant-provider-privacy-policy') then
  if new.published or new.consultant_approved_at is not null then
   if new.version='2026-09-20-draft' or new.content ~ '33[.]5 Platform administrative actio([[:space:]]|$)'
      or new.content ~ 'laws and profes([[:space:]]|$)'
      or not new.consultant_complete or new.consultant_approved_by is null or new.consultant_approved_at is null
      or length(trim(new.content))=0 then
    raise exception 'Complete, reviewed Consultant text and approval metadata required; supplied drafts cannot be published';
   end if;
  end if;
 end if;
 return new;
end $$;
create trigger guard_consultant_document before insert or update or delete on public.legal_documents
for each row execute function public.guard_consultant_document();

create or replace function public.current_consultant_documents() returns setof legal_documents
language sql stable security definer set search_path=public as $$
 select distinct on (document_key) d.* from legal_documents d
 where document_key in ('eazily-consultant-provider-terms','eazily-consultant-provider-privacy-policy')
 and language='English' and published and consultant_complete and consultant_approved_at is not null
 and consultant_approved_by is not null and effective_at <= now()
 order by document_key,effective_at desc,consultant_approved_at desc,id
$$;

create or replace function public.consultant_policies_accepted(p_application_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select (select count(*) from current_consultant_documents())=2 and not exists(
  select 1 from current_consultant_documents() d where not exists(
   select 1 from consent_events c join partner_applications a on a.id=c.partner_application_id
   where a.id=p_application_id and a.role='consultant' and c.account_id=a.customer_id
   and c.legal_document_id=d.id and c.consent_type=d.document_key and c.version=d.version and c.accepted
  )
 )
$$;

create or replace function public.get_consultant_legal_status(p_application_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Sign in to read Consultant consent'; end if;
 if p_application_id is not null and not exists(select 1 from partner_applications where id=p_application_id and customer_id=auth.uid() and role='consultant') then
  raise exception 'Your Consultant application was not found';
 end if;
 return jsonb_build_object(
  'documents',coalesce((select jsonb_agg(to_jsonb(d)) from current_consultant_documents() d),'[]'::jsonb),
  'acceptances',coalesce((select jsonb_agg(to_jsonb(c) order by recorded_at desc) from consent_events c where partner_application_id=p_application_id and account_id=auth.uid() and consent_type in ('eazily-consultant-provider-terms','eazily-consultant-provider-privacy-policy')),'[]'::jsonb),
  'eligible',consultant_policies_accepted(p_application_id));
end $$;

create or replace function public.accept_consultant_policies(p_application_id uuid,p_documents jsonb,p_terms_accepted boolean,p_privacy_acknowledged boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare app partner_applications; doc legal_documents;
begin
 if auth.uid() is null then raise exception 'Sign in to accept Consultant policies'; end if;
 select * into app from partner_applications where id=p_application_id and customer_id=auth.uid() and role='consultant' for update;
 if app.id is null then raise exception 'Your Consultant application was not found'; end if;
 if p_terms_accepted is distinct from true or p_privacy_acknowledged is distinct from true then
  raise exception 'Separate Terms acceptance and Privacy acknowledgment are required';
 end if;
 -- Serialize publication with acceptance so the checked versions are the recorded versions.
 lock table legal_documents in share mode;
 if (select count(*) from current_consultant_documents())<>2 then raise exception 'Approved Consultant policies are unavailable'; end if;
 if jsonb_typeof(p_documents) is distinct from 'array' then raise exception 'Both current document identifiers and versions are required'; end if;
 if jsonb_array_length(p_documents)<>2 then raise exception 'Both current document identifiers and versions are required'; end if;
 for doc in select * from current_consultant_documents() loop
  if not exists(select 1 from jsonb_array_elements(p_documents) item where item->>'id'=doc.id::text and item->>'version'=doc.version) then
   raise exception 'Consultant policies changed; read and acknowledge both current versions';
  end if;
 end loop;
 for doc in select * from current_consultant_documents() loop
  insert into consent_events(account_id,partner_application_id,consent_type,version,accepted,consent_text,recorded_at,legal_document_id)
  values(auth.uid(),app.id,doc.document_key,doc.version,true,
   case when doc.kind='terms' then 'I have read and agree to the Consultant Terms & Conditions.' else 'I have read and acknowledge the Consultant Privacy Policy.' end,now(),doc.id)
  on conflict(partner_application_id,consent_type,version) where partner_application_id is not null do nothing;
 end loop;
 return get_consultant_legal_status(app.id);
end $$;

-- Existing consent RLS is read-only for account holders; also defend installations
-- with wider historical grants. Only the security-definer owner can write these rows.
create or replace function public.guard_consultant_consent() returns trigger language plpgsql as $$
begin
 if (case when tg_op='DELETE' then old.consent_type else new.consent_type end) in ('eazily-consultant-provider-terms','eazily-consultant-provider-privacy-policy') or (tg_op='UPDATE' and old.consent_type in ('eazily-consultant-provider-terms','eazily-consultant-provider-privacy-policy')) then
  if tg_op<>'INSERT' or current_user in ('authenticated','anon') then raise exception 'Consultant consent records are append-only and server-recorded'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger guard_consultant_consent before insert or update or delete on public.consent_events for each row execute function public.guard_consultant_consent();

create or replace function public.require_consultant_policies() returns trigger
language plpgsql security definer set search_path=public as $$
declare app_id uuid; enforce boolean := false;
begin
 if new.role<>'consultant' then return new; end if;
 if tg_table_name='partner_applications' then
  app_id:=new.id;
  if tg_op='INSERT' then
   -- save_partner_application uses INSERT ON CONFLICT, so resolve the existing draft.
   select id into app_id from partner_applications where customer_id=new.customer_id and role='consultant';
   app_id:=coalesce(app_id,new.id);
   enforce:=new.status in ('submitted','under_review','approved');
  else enforce:=new.status in ('submitted','under_review','approved') and (old.status is distinct from new.status or new.submitted_at is distinct from old.submitted_at);
  end if;
 else
  app_id:=new.partner_id;
  if tg_table_name='partner_posts' then enforce:=new.status in ('pending_review','published');
  else
   if tg_op='INSERT' then enforce:=true;
   else enforce:=new.status='accepted' and old.status is distinct from new.status;
   end if;
  end if;
 end if;
 if enforce and not consultant_policies_accepted(app_id) then raise exception 'Current approved Consultant Terms acceptance and Privacy acknowledgment are required'; end if;
 return new;
end $$;
create trigger require_consultant_policies_application before insert or update on public.partner_applications for each row execute function public.require_consultant_policies();
create trigger require_consultant_policies_post before insert or update on public.partner_posts for each row execute function public.require_consultant_policies();
create trigger require_consultant_policies_booking before insert or update on public.partner_orders for each row execute function public.require_consultant_policies();

revoke all on function public.current_consultant_documents(),public.consultant_policies_accepted(uuid),public.get_consultant_legal_status(uuid),public.accept_consultant_policies(uuid,jsonb,boolean,boolean),public.require_consultant_policies(),public.guard_consultant_document(),public.guard_consultant_consent() from public,anon,authenticated;
grant execute on function public.get_consultant_legal_status(uuid),public.accept_consultant_policies(uuid,jsonb,boolean,boolean) to authenticated;
commit;
