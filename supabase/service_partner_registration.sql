-- Six-step Service Partner registration, server validation, and versioned consent.
-- Apply after seller_subscriptions_v2.sql, influencer_legal_2026_09_12.sql,
-- and consultant_assessments.sql. Service Partner policy rows must be published
-- separately with document_key values used below; this migration invents no policy text.
begin;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise exception 'Apply storage.sql before service_partner_registration.sql so private uploads can be verified';
  end if;
  if to_regclass('public.seller_subscriptions') is not null and not exists (
    select 1 from pg_trigger
    where tgname='seller_subscription_after_approval' and not tgisinternal
  ) then
    raise exception 'Apply seller_subscriptions_v2.sql before service_partner_registration.sql so submission cannot start a trial';
  end if;
end $$;

create or replace function public.validate_service_partner_registration(p_details jsonb,p_owner uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  selection jsonb;
  allowed_services text[];
  expected_label text;
  item jsonb;
  day_name text;
begin
  if coalesce(p_details->>'serviceRegistrationVersion','') <> 'service-registration-2026-09-14' then
    raise exception 'Use the current six-step Service Partner registration';
  end if;
  if coalesce(length(trim(p_details->>'name')),0) < 2 then raise exception 'Enter your full name'; end if;
  if coalesce(p_details->>'verifiedPhone','') = '' then raise exception 'A verified mobile number is required'; end if;
  if coalesce(p_details->>'dateOfBirth','') !~ '^\d{4}-\d{2}-\d{2}$' or (p_details->>'dateOfBirth')::date > current_date then raise exception 'Enter a valid date of birth'; end if;
  if coalesce(p_details->>'email','') <> '' and p_details->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address'; end if;

  if coalesce(length(trim(p_details->>'businessName')),0) < 2 then raise exception 'Enter the shop or business name'; end if;
  if coalesce(p_details->>'shopOwnership','') not in ('Owned','Rented') then raise exception 'Choose Owned or Rented'; end if;
  if coalesce(trim(p_details->>'address'),'') = '' or coalesce(trim(p_details->>'locality'),'') = '' or coalesce(trim(p_details->>'city'),'') = '' or coalesce(trim(p_details->>'state'),'') = '' then raise exception 'Complete the shop address'; end if;
  if coalesce(p_details->>'pinCode','') !~ '^\d{6}$' then raise exception 'Enter a valid 6-digit PIN code'; end if;

  if jsonb_typeof(p_details->'serviceSelections') <> 'array' or jsonb_array_length(p_details->'serviceSelections') = 0 then raise exception 'Select at least one service'; end if;
  for selection in select value from jsonb_array_elements(p_details->'serviceSelections') loop
    case selection->>'categoryId'
      when 'home-property' then expected_label := 'Home & Property'; allowed_services := array['Electrician','Plumber','Carpenter','Painter','Tile Worker','POP & False Ceiling','Glass Worker','Aluminium Worker','Home Maintenance','Deep Cleaning','Pest Control','CCTV Technician','AC Service'];
      when 'vehicle' then expected_label := 'Vehicle'; allowed_services := array['Bike Mechanic','Car Mechanic','Heavy Vehicle Mechanic','Battery Technician','Vehicle Modification','Towing Services','Vehicle Driver','Tour & Travel Services','Car Wash'];
      when 'personal-daily' then expected_label := 'Personal & Daily'; allowed_services := array['Key Maker','Dry Cleaner','Shoe Maker','Cook','House Help','Laundry Service'];
      when 'electronics' then expected_label := 'Electronics'; allowed_services := array['Mobile Repair','Computer Repair','RO Technician','Technical Electronics','Appliance Repair','CCTV Technician','AC Service'];
      when 'beauty' then expected_label := 'Personal Care'; allowed_services := array['Salon at Home','Makeup Artist','Bridal Makeup','Mehendi Artist','Hair Care','Grooming'];
      when 'wedding' then expected_label := 'Wedding & Occasion'; allowed_services := array['Photographer','Videographer','Decorator','Caterer','DJ & Music','Stage Setup','Band','Tent House','Event Manager'];
      when 'pet' then expected_label := 'Pet Care'; allowed_services := array['Pet Grooming','Pet Boarding','Pet Walker','Pet Training','Pet Rescue','Emergency Pet Support'];
      when 'other' then expected_label := 'Other'; allowed_services := array['Packers & Movers','Tempo Driver','Loading Labour','Courier','Home Tutor','Yoga Coach','Personal Trainer'];
      else raise exception 'Unknown Service Partner category';
    end case;
    if selection->>'categoryLabel' <> expected_label
      or coalesce(selection->>'serviceId','') = ''
      or selection->>'serviceId' <> selection->>'serviceName'
      or not (selection->>'serviceId' = any(allowed_services)) then
      raise exception 'A selected service does not match the approved catalogue';
    end if;
  end loop;
  if coalesce(p_details->>'experienceYears','') !~ '^\d+$' or (p_details->>'experienceYears')::integer not between 0 and 80 then raise exception 'Enter valid years of experience'; end if;
  if coalesce(p_details->>'experienceMonths','') !~ '^\d+$' or (p_details->>'experienceMonths')::integer not between 0 and 11 then raise exception 'Enter valid additional months'; end if;
  if coalesce(p_details->>'workerCount','') !~ '^\d+$' then raise exception 'Enter the number of workers'; end if;

  if coalesce(p_details->>'servicePlace','') not in ('At my shop','At the customer’s location','Both') then raise exception 'Choose where services are provided'; end if;
  if p_details->>'servicePlace' in ('At the customer’s location','Both') and coalesce(trim(p_details->>'serviceAreas'),'') = '' then raise exception 'Enter the localities you serve'; end if;
  if jsonb_typeof(p_details->'workingDays') <> 'array' or jsonb_array_length(p_details->'workingDays') = 0 then raise exception 'Select at least one working day'; end if;
  for item in select value from jsonb_array_elements(p_details->'workingDays') loop
    day_name := trim(both '"' from item::text);
    if day_name not in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') then raise exception 'Invalid working day'; end if;
    if coalesce((p_details->>'sameTiming')::boolean,true) = false and (
      coalesce(p_details#>>array['dailyTimings',day_name,'open'],'') !~ '^([01]\d|2[0-3]):[0-5]\d$'
      or coalesce(p_details#>>array['dailyTimings',day_name,'close'],'') !~ '^([01]\d|2[0-3]):[0-5]\d$'
      or p_details#>>array['dailyTimings',day_name,'open'] >= p_details#>>array['dailyTimings',day_name,'close']
    ) then raise exception 'Enter valid daily working times'; end if;
  end loop;
  if coalesce((p_details->>'sameTiming')::boolean,true) and (
    coalesce(p_details->>'openingTime','') !~ '^([01]\d|2[0-3]):[0-5]\d$'
    or coalesce(p_details->>'closingTime','') !~ '^([01]\d|2[0-3]):[0-5]\d$'
    or p_details->>'openingTime' >= p_details->>'closingTime'
  ) then raise exception 'Enter valid opening and closing times'; end if;

  if coalesce(trim(p_details->>'accountHolder'),'') = '' then raise exception 'Enter the account holder name'; end if;
  if coalesce(p_details->>'accountNumber','') !~ '^\d{6,18}$' then raise exception 'Enter a valid bank account number'; end if;
  if p_details->>'accountNumber' <> p_details->>'accountConfirmation' then raise exception 'Bank account numbers do not match'; end if;
  if upper(coalesce(p_details->>'ifsc','')) !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then raise exception 'Enter a valid IFSC code'; end if;
  if coalesce(trim(p_details->>'bankName'),'') = '' then raise exception 'Enter the bank name'; end if;

  if jsonb_typeof(p_details->'aadhaar') <> 'array' or jsonb_array_length(p_details->'aadhaar') = 0 then raise exception 'Upload Aadhaar'; end if;
  if jsonb_typeof(p_details->'pan') <> 'array' or jsonb_array_length(p_details->'pan') = 0 then raise exception 'Upload PAN'; end if;
  if (jsonb_typeof(p_details->'gumasta') <> 'array' or jsonb_array_length(p_details->'gumasta') = 0) and p_details->'gumastaHelp' is distinct from 'true'::jsonb then raise exception 'Upload Gumasta or request help'; end if;
  for item in select value from jsonb_array_elements(coalesce(p_details->'aadhaar','[]'::jsonb) || coalesce(p_details->'pan','[]'::jsonb) || coalesce(p_details->'gumasta','[]'::jsonb) || coalesce(p_details->'udyam','[]'::jsonb)) loop
    if coalesce(item->>'path','') !~ ('^' || p_owner::text || '/professional/documents/') then raise exception 'A private document reference is invalid'; end if;
    if coalesce(item->>'type','') not in ('image/jpeg','image/png','application/pdf') then raise exception 'A document has an unsupported file type'; end if;
    if not exists(select 1 from storage.objects where bucket_id='partner-media' and name=item->>'path') then raise exception 'A document upload was not confirmed by private storage'; end if;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(p_details->'ownerShopMedia','[]'::jsonb)) loop
    if coalesce(item->>'path','') !~ ('^' || p_owner::text || '/professional/') then raise exception 'The owner/shop photo reference is invalid'; end if;
    if coalesce(item->>'type','') not in ('image/jpeg','image/png') then raise exception 'The owner/shop photo must be JPG or PNG'; end if;
    if not exists(select 1 from storage.objects where bucket_id='partner-media' and name=item->>'path') then raise exception 'The owner/shop photo upload was not confirmed by private storage'; end if;
  end loop;
end $$;

create or replace function public.submit_service_partner_application(p_details jsonb)
returns partner_applications language plpgsql security definer set search_path=public as $$
declare
  result partner_applications;
  verified_phone text;
  terms_doc legal_documents;
  privacy_doc legal_documents;
  submitted_details jsonb;
  canonical_categories jsonb;
  canonical_services jsonb;
  first_category text;
begin
  if auth.uid() is null then raise exception 'Sign in to submit Service Partner registration'; end if;
  select nullif(phone,'') into verified_phone from auth.users where id=auth.uid();
  if verified_phone is null then raise exception 'Complete mobile OTP verification before submitting'; end if;
  submitted_details := jsonb_set(p_details,'{verifiedPhone}',to_jsonb(verified_phone),true);
  perform validate_service_partner_registration(submitted_details,auth.uid());
  select to_jsonb(array_agg(category_id order by category_id)) into canonical_categories from (
    select distinct value->>'categoryId' category_id from jsonb_array_elements(submitted_details->'serviceSelections')
  ) selected_categories;
  select to_jsonb(array_agg(service_name order by service_name)) into canonical_services from (
    select distinct value->>'serviceName' service_name from jsonb_array_elements(submitted_details->'serviceSelections')
  ) selected_services;
  first_category := submitted_details#>>'{serviceSelections,0,categoryLabel}';
  submitted_details := jsonb_set(submitted_details,'{serviceCategories}',canonical_categories,true);
  submitted_details := jsonb_set(submitted_details,'{services}',canonical_services,true);
  submitted_details := jsonb_set(submitted_details,'{category}',to_jsonb(first_category),true);
  submitted_details := jsonb_set(submitted_details,'{experience}',to_jsonb((submitted_details->>'experienceYears') || ' years ' || (submitted_details->>'experienceMonths') || ' months'),true);
  submitted_details := jsonb_set(submitted_details,'{workStyle}',to_jsonb(case when (submitted_details->>'workerCount')::integer=0 then 'Alone' else 'Team' end),true);
  if submitted_details->>'servicePlace'='At my shop' then submitted_details := jsonb_set(submitted_details,'{serviceAreas}','""'::jsonb,true); end if;
  if coalesce((submitted_details->>'sameTiming')::boolean,true) then
    submitted_details := jsonb_set(submitted_details,'{dailyTimings}','{}'::jsonb,true);
  else
    submitted_details := jsonb_set(jsonb_set(submitted_details,'{openingTime}','""'::jsonb,true),'{closingTime}','""'::jsonb,true);
  end if;

  select * into terms_doc from legal_documents where document_key='eazily-service-partner-terms' and language='English' and published order by effective_at desc limit 1;
  select * into privacy_doc from legal_documents where document_key='eazily-service-partner-privacy-policy' and language='English' and published order by effective_at desc limit 1;
  if terms_doc.id is null or privacy_doc.id is null then raise exception 'Published Service Partner Terms and Privacy Policy are required'; end if;
  if submitted_details#>>'{consent,termsAccepted}' <> 'true'
    or submitted_details#>>'{consent,informationAccurate}' <> 'true'
    or submitted_details#>>'{consent,terms,documentId}' <> terms_doc.document_key
    or submitted_details#>>'{consent,terms,version}' <> terms_doc.version
    or submitted_details#>>'{consent,privacy,documentId}' <> privacy_doc.document_key
    or submitted_details#>>'{consent,privacy,version}' <> privacy_doc.version then
    raise exception 'Accept the current Service Partner policies before submitting';
  end if;

  insert into partner_applications(customer_id,role,status,details,submitted_at)
  values(auth.uid(),'professional','submitted',submitted_details,now())
  on conflict(customer_id,role) do update set
    details=excluded.details,
    status=case when partner_applications.status in('approved','under_review') then partner_applications.status else 'submitted' end,
    submitted_at=case when partner_applications.submitted_at is null then now() else partner_applications.submitted_at end,
    updated_at=now()
  returning * into result;

  insert into consent_events(account_id,partner_application_id,consent_type,version,accepted,consent_text,recorded_at)
  values
    (auth.uid(),result.id,terms_doc.document_key,terms_doc.version,true,'I agree to Eazily’s Service Partner Terms & Conditions.',now()),
    (auth.uid(),result.id,privacy_doc.document_key,privacy_doc.version,true,'I acknowledge the Eazily Service Partner Privacy Policy.',now())
  on conflict(partner_application_id,consent_type,version) where partner_application_id is not null do nothing;

  insert into partner_audit_log(actor_id,action,entity_type,entity_id,after_data)
  values(auth.uid(),'submit_service_partner_registration','partner_application',result.id::text,
    jsonb_build_object('status',result.status,'registrationVersion','service-registration-2026-09-14','termsVersion',terms_doc.version,'privacyVersion',privacy_doc.version));
  return result;
end $$;

create or replace function public.enforce_current_service_partner_registration()
returns trigger language plpgsql security definer set search_path=public as $$
declare should_check boolean;
begin
  should_check := new.role='professional' and new.status in('submitted','under_review','approved') and (
    tg_op='INSERT'
    or new.details ? 'serviceRegistrationVersion'
    or old.status not in('submitted','under_review','approved')
    or new.details is distinct from old.details
  );
  if should_check then perform validate_service_partner_registration(new.details,new.customer_id); end if;
  return new;
end $$;

drop trigger if exists enforce_current_service_partner_registration on public.partner_applications;
create trigger enforce_current_service_partner_registration
before insert or update on public.partner_applications
for each row execute function public.enforce_current_service_partner_registration();

create or replace function public.enforce_service_partner_policy_records()
returns trigger language plpgsql security definer set search_path=public as $$
declare should_check boolean;
begin
  should_check := new.role='professional' and new.status in('submitted','under_review','approved') and (
    tg_op='INSERT'
    or new.details ? 'serviceRegistrationVersion'
    or old.status not in('submitted','under_review','approved')
    or new.details is distinct from old.details
  );
  if should_check and (
    not exists(select 1 from consent_events where partner_application_id=new.id and account_id=new.customer_id and consent_type=new.details#>>'{consent,terms,documentId}' and version=new.details#>>'{consent,terms,version}' and accepted)
    or not exists(select 1 from consent_events where partner_application_id=new.id and account_id=new.customer_id and consent_type=new.details#>>'{consent,privacy,documentId}' and version=new.details#>>'{consent,privacy,version}' and accepted)
  ) then raise exception 'Server-recorded Service Partner policy consent is required'; end if;
  return new;
end $$;

drop trigger if exists enforce_service_partner_policy_records on public.partner_applications;
create constraint trigger enforce_service_partner_policy_records
after insert or update on public.partner_applications
deferrable initially deferred
for each row execute function public.enforce_service_partner_policy_records();

create or replace function public.redact_service_partner_audit_details()
returns trigger language plpgsql security definer set search_path=public as $$
declare sensitive_keys text[] := array['verifiedPhone','dateOfBirth','email','address','landmark','latitude','longitude','accountHolder','accountNumber','accountConfirmation','ifsc','bankName','aadhaar','pan','gumasta','ownerShopMedia','udyam','consent'];
begin
  if new.entity_type='partner_application' and coalesce(new.before_data->>'role',new.after_data->>'role')='professional' then
    if new.before_data ? 'details' then new.before_data := jsonb_set(new.before_data,'{details}',(new.before_data->'details') - sensitive_keys); end if;
    if new.after_data ? 'details' then new.after_data := jsonb_set(new.after_data,'{details}',(new.after_data->'details') - sensitive_keys); end if;
  end if;
  return new;
end $$;

drop trigger if exists redact_service_partner_audit_details on public.partner_audit_log;
create trigger redact_service_partner_audit_details
before insert or update on public.partner_audit_log
for each row execute function public.redact_service_partner_audit_details();

revoke all on function public.validate_service_partner_registration(jsonb,uuid),public.submit_service_partner_application(jsonb),public.enforce_current_service_partner_registration(),public.enforce_service_partner_policy_records(),public.redact_service_partner_audit_details() from public,anon;
grant execute on function public.submit_service_partner_application(jsonb) to authenticated;

commit;
