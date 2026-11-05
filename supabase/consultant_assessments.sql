-- Versioned, server-graded Consultant Step 5 assessments.
-- Apply after influencer_legal_2026_09_12.sql. No production question content is
-- activated here: each field needs six reviewed questions before its bank can be active.
begin;

create table public.consultant_assessment_banks (
 id uuid primary key default gen_random_uuid(),
 field_id text not null,
 category text not null,
 specialisation text not null,
 version text not null,
 approved boolean not null default false,
 active boolean not null default false,
 reviewed_by uuid references public.profiles(id),
 reviewed_at timestamptz,
 created_at timestamptz not null default now(),
 unique(field_id,version),
 check(not approved or (reviewed_by is not null and reviewed_at is not null)),
 check(not active or approved)
);

create table public.consultant_assessment_questions (
 id uuid primary key default gen_random_uuid(),
 bank_id uuid not null references public.consultant_assessment_banks(id) on delete cascade,
 question_code text not null,
 difficulty text not null check(difficulty in('foundation','standard','advanced')),
 prompt_en text not null,
 prompt_hi text not null,
 options jsonb not null,
 correct_option_id text not null,
 explanation_en text not null,
 explanation_hi text not null,
 approved boolean not null default false,
 unique(bank_id,question_code),
 check(jsonb_typeof(options)='array' and jsonb_array_length(options)=4)
);

create table public.consultant_assessment_attempts (
 id uuid primary key default gen_random_uuid(),
 application_id uuid not null references public.partner_applications(id) on delete cascade,
 account_id uuid not null references public.profiles(id) on delete cascade,
 field_id text not null,
 bank_id uuid not null references public.consultant_assessment_banks(id),
 assessment_version text not null,
 question_order uuid[] not null,
 option_orders jsonb not null,
 responses jsonb not null default '{}',
 status text not null default 'in_progress' check(status in('in_progress','passed','not_passed')),
 correct_count integer check(correct_count between 0 and 6),
 started_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 submitted_at timestamptz,
 check(cardinality(question_order)=6)
);

create unique index one_open_consultant_assessment
 on public.consultant_assessment_attempts(application_id,field_id,assessment_version)
 where status='in_progress';

alter table public.consultant_assessment_banks enable row level security;
alter table public.consultant_assessment_questions enable row level security;
alter table public.consultant_assessment_attempts enable row level security;
revoke all on public.consultant_assessment_banks,public.consultant_assessment_questions,public.consultant_assessment_attempts from anon,authenticated;

create or replace function public.validate_consultant_assessment_question() returns trigger language plpgsql as $$
begin
 if (select count(distinct item->>'id') from jsonb_array_elements(new.options) item)<>4
  or exists(select 1 from jsonb_array_elements(new.options) item where coalesce(item->>'id','')='' or coalesce(item->>'label_en','')='' or coalesce(item->>'label_hi','')='')
  or not exists(select 1 from jsonb_array_elements(new.options) item where item->>'id'=new.correct_option_id)
 then raise exception 'Each assessment question requires four unique bilingual options and one matching answer key'; end if;
 return new;
end $$;
create trigger validate_consultant_assessment_question before insert or update on public.consultant_assessment_questions for each row execute function public.validate_consultant_assessment_question();

create or replace function public.consultant_field_id(p_category text,p_specialisation text) returns text
language sql immutable as $$
 select lower(trim(coalesce(p_category,'')))||'::'||lower(trim(coalesce(p_specialisation,'')))
$$;

create or replace function public.consultant_application_assessments_complete(p_application_id uuid,p_details jsonb) returns boolean
language sql stable security definer set search_path=public as $$
 select not exists(
  select 1
  from jsonb_array_elements(case when jsonb_typeof(p_details->'consultationFields')='array' and jsonb_array_length(p_details->'consultationFields')>0 then p_details->'consultationFields' else jsonb_build_array(jsonb_build_object('category',p_details->>'category','specialisation',p_details->>'specialisation')) end) field
  where not exists(
   select 1 from consultant_assessment_attempts attempt
   where attempt.application_id=p_application_id
    and attempt.field_id=consultant_field_id(field->>'category',field->>'specialisation')
    and attempt.status='passed'
  )
 )
$$;

create or replace function public.consultant_assessment_payload(p_attempt consultant_assessment_attempts,p_language text) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
  'available',true,
  'attemptId',p_attempt.id,
  'fieldId',p_attempt.field_id,
  'version',p_attempt.assessment_version,
  'status',p_attempt.status,
  'correctCount',p_attempt.correct_count,
  'responses',p_attempt.responses,
  'retakeAvailable',false,
  'retakeMessage','No approved retake policy is configured.',
  'questions',coalesce((
   select jsonb_agg(jsonb_build_object(
    'id',q.id,
    'prompt',case when p_language='हिन्दी' then q.prompt_hi else q.prompt_en end,
    'options',(select jsonb_agg(jsonb_build_object('id',configured.value,'label',case when p_language='हिन्दी' then option.value->>'label_hi' else option.value->>'label_en' end) order by configured.ordinality)
      from jsonb_array_elements_text(p_attempt.option_orders->q.id::text) with ordinality configured(value,ordinality)
      join jsonb_array_elements(q.options) option(value) on option.value->>'id'=configured.value),
    'explanation',case when p_attempt.status<>'in_progress' then case when p_language='हिन्दी' then q.explanation_hi else q.explanation_en end end
   ) order by ordered.ordinality)
   from unnest(p_attempt.question_order) with ordinality ordered(question_id,ordinality)
   join consultant_assessment_questions q on q.id=ordered.question_id
  ),'[]'::jsonb)
 )
$$;

create or replace function public.start_or_resume_consultant_assessment(p_application_id uuid,p_category text,p_specialisation text,p_language text default 'English') returns jsonb
language plpgsql security definer set search_path=public as $$
declare app partner_applications; bank consultant_assessment_banks; attempt consultant_assessment_attempts; selected uuid[]; question_id uuid; shuffled jsonb; wanted_field text;
begin
 if auth.uid() is null then raise exception 'Sign in to start the assessment'; end if;
 if p_language not in('English','हिन्दी') then raise exception 'Unsupported assessment language'; end if;
 select * into app from partner_applications where id=p_application_id and customer_id=auth.uid() and role='consultant';
 if app.id is null then raise exception 'Your Consultant application was not found'; end if;
 if not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(app.details->'consultationFields')='array' and jsonb_array_length(app.details->'consultationFields')>0 then app.details->'consultationFields' else jsonb_build_array(jsonb_build_object('category',app.details->>'category','specialisation',app.details->>'specialisation')) end) field where lower(trim(coalesce(field->>'category','')))=lower(trim(coalesce(p_category,''))) and lower(trim(coalesce(field->>'specialisation','')))=lower(trim(coalesce(p_specialisation,'')))) then raise exception 'Assessment field must match a saved Consultant field'; end if;
 wanted_field:=consultant_field_id(p_category,p_specialisation);
 select * into attempt from consultant_assessment_attempts where application_id=app.id and field_id=wanted_field and status in('passed','in_progress') order by case status when 'passed' then 0 else 1 end,started_at desc limit 1;
 if attempt.id is not null then return consultant_assessment_payload(attempt,p_language); end if;
 select b.* into bank from consultant_assessment_banks b where b.field_id=wanted_field and b.approved and b.active
 and (select count(*) from consultant_assessment_questions q where q.bank_id=b.id and q.approved)=6
 and (select count(*) from consultant_assessment_questions q where q.bank_id=b.id and q.approved and q.difficulty='foundation')>=2
 and (select count(*) from consultant_assessment_questions q where q.bank_id=b.id and q.approved and q.difficulty='standard')>=3
 and (select count(*) from consultant_assessment_questions q where q.bank_id=b.id and q.approved and q.difficulty='advanced')>=1
 order by b.reviewed_at desc limit 1;
 if bank.id is null then return jsonb_build_object('available',false,'fieldId',wanted_field,'reason','Fewer than six approved questions with the required difficulty mix are available for this field.'); end if;
 select array_agg(id order by random()) into selected from (
  (select id from consultant_assessment_questions where bank_id=bank.id and approved and difficulty='foundation' order by random() limit 2)
  union all
  (select id from consultant_assessment_questions where bank_id=bank.id and approved and difficulty='standard' order by random() limit 3)
  union all
  (select id from consultant_assessment_questions where bank_id=bank.id and approved and difficulty='advanced' order by random() limit 1)
 ) chosen;
 shuffled:='{}'::jsonb;
 foreach question_id in array selected loop
  select jsonb_agg(item->>'id' order by random()) into shuffled from consultant_assessment_questions q cross join jsonb_array_elements(q.options) item where q.id=question_id;
  attempt.option_orders:=coalesce(attempt.option_orders,'{}'::jsonb)||jsonb_build_object(question_id::text,shuffled);
 end loop;
 insert into consultant_assessment_attempts(application_id,account_id,field_id,bank_id,assessment_version,question_order,option_orders)
 values(app.id,auth.uid(),wanted_field,bank.id,bank.version,selected,coalesce(attempt.option_orders,'{}'::jsonb)) returning * into attempt;
 return consultant_assessment_payload(attempt,p_language);
end $$;

create or replace function public.save_consultant_assessment_answer(p_attempt_id uuid,p_question_id uuid,p_option_id text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare attempt consultant_assessment_attempts;
begin
 select * into attempt from consultant_assessment_attempts where id=p_attempt_id and account_id=auth.uid() and status='in_progress' for update;
 if attempt.id is null then raise exception 'Active assessment attempt not found'; end if;
 if not (p_question_id=any(attempt.question_order)) then raise exception 'Question is not part of this attempt'; end if;
 if not exists(select 1 from jsonb_array_elements_text(attempt.option_orders->p_question_id::text) value where value=p_option_id) then raise exception 'Answer option is not part of this question'; end if;
 update consultant_assessment_attempts set responses=responses||jsonb_build_object(p_question_id::text,p_option_id),updated_at=now() where id=attempt.id returning * into attempt;
 return jsonb_build_object('attemptId',attempt.id,'responses',attempt.responses,'status',attempt.status);
end $$;

create or replace function public.submit_consultant_assessment(p_attempt_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare attempt consultant_assessment_attempts; score integer;
begin
 select * into attempt from consultant_assessment_attempts where id=p_attempt_id and account_id=auth.uid() and status='in_progress' for update;
 if attempt.id is null then raise exception 'Active assessment attempt not found'; end if;
 if (select count(*) from jsonb_each(attempt.responses))<>6 or exists(select 1 from unnest(attempt.question_order) question_id where not attempt.responses ? question_id::text) then raise exception 'All six assessment questions must be answered'; end if;
 select count(*) into score from unnest(attempt.question_order) question_id join consultant_assessment_questions q on q.id=question_id where attempt.responses->>question_id::text=q.correct_option_id;
 update consultant_assessment_attempts set correct_count=score,status=case when score>=4 then 'passed' else 'not_passed' end,submitted_at=now(),updated_at=now() where id=attempt.id returning * into attempt;
 insert into partner_audit_log(actor_id,action,entity_type,entity_id,after_data) values(auth.uid(),'submit_consultant_assessment','consultant_assessment_attempt',attempt.id::text,jsonb_build_object('applicationId',attempt.application_id,'fieldId',attempt.field_id,'version',attempt.assessment_version,'score',attempt.correct_count,'status',attempt.status));
 return jsonb_build_object('attemptId',attempt.id,'status',attempt.status,'correctCount',attempt.correct_count,'fieldId',attempt.field_id,'version',attempt.assessment_version,'retakeAvailable',false,'retakeMessage','No approved retake policy is configured.');
end $$;

create or replace function public.get_consultant_assessment_eligibility(p_application_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare app partner_applications;
begin
 select * into app from partner_applications where id=p_application_id and customer_id=auth.uid() and role='consultant';
 if app.id is null then raise exception 'Your Consultant application was not found'; end if;
 return jsonb_build_object(
  'eligible',consultant_application_assessments_complete(app.id,app.details),
  'fields',(select coalesce(jsonb_agg(jsonb_build_object(
   'fieldId',consultant_field_id(field->>'category',field->>'specialisation'),
   'category',field->>'category','specialisation',field->>'specialisation',
   'status',coalesce((select status from consultant_assessment_attempts attempt where attempt.application_id=app.id and attempt.field_id=consultant_field_id(field->>'category',field->>'specialisation') order by case status when 'passed' then 0 when 'in_progress' then 1 else 2 end,started_at desc limit 1),'not_started')
  )),'[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(app.details->'consultationFields')='array' and jsonb_array_length(app.details->'consultationFields')>0 then app.details->'consultationFields' else jsonb_build_array(jsonb_build_object('category',app.details->>'category','specialisation',app.details->>'specialisation')) end) field)
 );
end $$;

create or replace function public.require_consultant_assessment_pass() returns trigger language plpgsql security definer set search_path=public as $$
declare checked_application_id uuid;
begin
 checked_application_id:=new.id;
 if tg_op='INSERT' and new.role='consultant' then
  select id into checked_application_id from partner_applications where customer_id=new.customer_id and role='consultant';
  checked_application_id:=coalesce(checked_application_id,new.id);
 end if;
 if new.role='consultant' and new.status in('submitted','under_review','approved') and not consultant_application_assessments_complete(checked_application_id,new.details) then raise exception 'A passed six-question assessment is required for every selected Consultant field'; end if;
 return new;
end $$;
create trigger enforce_consultant_assessment_on_application before insert or update on public.partner_applications for each row execute function public.require_consultant_assessment_pass();

create or replace function public.require_consultant_assessment_for_work() returns trigger language plpgsql security definer set search_path=public as $$
declare app partner_applications;
begin
 if new.role<>'consultant' then return new; end if;
 select * into app from partner_applications where id=new.partner_id;
 if app.status<>'approved' or not consultant_application_assessments_complete(app.id,app.details) then raise exception 'Approved Consultant status and passed assessments for every selected field are required'; end if;
 return new;
end $$;
create trigger enforce_consultant_assessment_on_posts before insert or update on public.partner_posts for each row execute function public.require_consultant_assessment_for_work();
create trigger enforce_consultant_assessment_on_bookings before insert or update on public.partner_orders for each row execute function public.require_consultant_assessment_for_work();

revoke all on function public.validate_consultant_assessment_question(),public.consultant_field_id(text,text),public.consultant_application_assessments_complete(uuid,jsonb),public.consultant_assessment_payload(consultant_assessment_attempts,text),public.start_or_resume_consultant_assessment(uuid,text,text,text),public.save_consultant_assessment_answer(uuid,uuid,text),public.submit_consultant_assessment(uuid),public.get_consultant_assessment_eligibility(uuid),public.require_consultant_assessment_pass(),public.require_consultant_assessment_for_work() from public,anon;
grant execute on function public.start_or_resume_consultant_assessment(uuid,text,text,text),public.save_consultant_assessment_answer(uuid,uuid,text),public.submit_consultant_assessment(uuid),public.get_consultant_assessment_eligibility(uuid) to authenticated;

commit;
