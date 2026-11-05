-- Append-only catalogue validator update for the 2026-09-20 customer service taxonomy.
-- Apply after service_partner_registration.sql and auth_account_security.sql.
-- This changes no existing posts, applications, bookings, pricing, or approval state.
begin;
create or replace function public.validate_service_partner_registration(p_details jsonb,p_owner uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
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
      when 'home-property' then expected_label := 'Home & Property'; allowed_services := array['Electrician','Plumber','Carpenter','Painter','Tile Worker','POP & False Ceiling','Glass Worker','Aluminium Worker','Home Maintenance','Key Maker','Deep Cleaning','Pest Control','CCTV Technician','AC Service'];
      when 'vehicle' then expected_label := 'Vehicle'; allowed_services := array['Bike Mechanic','Car Mechanic','Heavy Vehicle Mechanic','Battery Technician','Vehicle Modification','Towing Services','Vehicle Driver','Car Wash'];
      when 'personal-daily' then expected_label := 'Personal & Daily'; allowed_services := array['Dry Cleaner','Shoe Repair','Cook','Maid & House Help','Laundry Service','Tailor & Alterations','Ironing Service'];
      when 'electronics' then expected_label := 'Electronics'; allowed_services := array['Mobile Repair','Computer Repair','RO Technician','Refrigerator Repair','Washing Machine Repair','Microwave/Oven Repair','TV Repair','CCTV Technician','AC Service'];
      when 'beauty' then expected_label := 'Personal Care'; allowed_services := array['Women''s Salon','Men''s Salon & Grooming','Hair Services','Makeup Artist','Facial & Skin Care','Waxing & Threading','Manicure & Pedicure','Spa & Massage','Bridal Makeup','Mehendi Artist'];
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

  if coalesce(p_details->>'servicePlace','') not in ('At my shop','At the customerâ€™s location','Both') then raise exception 'Choose where services are provided'; end if;
  if p_details->>'servicePlace' in ('At the customerâ€™s location','Both') and coalesce(trim(p_details->>'serviceAreas'),'') = '' then raise exception 'Enter the localities you serve'; end if;
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

commit;

