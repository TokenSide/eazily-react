-- Forward-only Bulk Orders intake. Quotes are requests, not bookings or prices.
begin;

create table public.bulk_quote_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  idempotency_key uuid not null,
  customer_type text not null,
  services jsonb not null,
  address text not null,
  preferred_date date not null,
  preferred_time text not null,
  company_name text,
  status text not null default 'requested' check (status = 'requested'),
  created_at timestamptz not null default now(),
  unique (customer_id, idempotency_key)
);

alter table public.bulk_quote_requests enable row level security;
create policy "Bulk customer or orders staff read" on public.bulk_quote_requests
  for select to authenticated
  using (customer_id = auth.uid() or public.is_admin() or public.has_staff_permission('orders.view'));
revoke all on public.bulk_quote_requests from public, anon, authenticated;
grant select on public.bulk_quote_requests to authenticated;

create function public.submit_bulk_quote_request(
  p_idempotency_key uuid,
  p_customer_type text,
  p_services jsonb,
  p_address text,
  p_preferred_date date,
  p_preferred_time text,
  p_company_name text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  customer uuid := auth.uid();
  entry jsonb;
  service_id text;
  quantity_text text;
  normalized jsonb := '[]'::jsonb;
  existing public.bulk_quote_requests%rowtype;
  result_id uuid;
  clean_type text := btrim(coalesce(p_customer_type, ''));
  clean_address text := btrim(coalesce(p_address, ''));
  clean_time text := btrim(coalesce(p_preferred_time, ''));
  clean_company text := nullif(btrim(coalesce(p_company_name, '')), '');
begin
  if customer is null then raise exception 'Sign in to submit a bulk quote request'; end if;
  if not exists (select 1 from public.profiles where id = customer and role = 'customer' and account_status = 'active') then
    raise exception 'Active customer account required';
  end if;
  -- A draft/missing legal document must not become an implicit consent bypass.
  if not public.consumer_policies_accepted(customer) then
    raise exception 'Current Consumer Terms and Privacy Policy acknowledgment required';
  end if;
  if p_idempotency_key is null then raise exception 'Request key required'; end if;
  if clean_type not in ('Office', 'Society', 'Shop', 'Hotel', 'School / Institute', 'Commercial Property', 'Other') then
    raise exception 'Choose a valid customer type';
  end if;
  if char_length(clean_address) not between 8 and 1000 then raise exception 'Enter a service address (8–1000 characters)'; end if;
  if p_preferred_date is null or p_preferred_date < current_date or p_preferred_date > current_date + 365 then
    raise exception 'Choose a date within the next year';
  end if;
  if clean_time not in ('Morning', 'Afternoon', 'Evening', 'Flexible') then raise exception 'Choose a valid preferred time'; end if;
  if clean_company is not null and char_length(clean_company) > 160 then raise exception 'Company or society name is too long'; end if;
  if jsonb_typeof(p_services) is distinct from 'array' or jsonb_array_length(p_services) not between 1 and 6 then
    raise exception 'Select one to six bulk services';
  end if;

  for entry in select value from jsonb_array_elements(p_services) loop
    if jsonb_typeof(entry) is distinct from 'object' or
       (select count(*) from jsonb_object_keys(entry)) <> 2 or
       not (entry ? 'service_id' and entry ? 'quantity') or
       jsonb_typeof(entry->'service_id') is distinct from 'string' or
       jsonb_typeof(entry->'quantity') is distinct from 'number' then
      raise exception 'Invalid service and quantity';
    end if;
    service_id := entry->>'service_id';
    quantity_text := entry->>'quantity';
    if service_id not in ('ac-service', 'electrician', 'deep-cleaning', 'painting', 'cctv', 'appliance') or
       quantity_text !~ '^[1-9][0-9]{0,3}$' then
      raise exception 'Invalid service and quantity';
    end if;
    if exists (select 1 from jsonb_array_elements(normalized) previous where previous->>'service_id' = service_id) then
      raise exception 'Duplicate service';
    end if;
    normalized := normalized || jsonb_build_array(jsonb_build_object('service_id', service_id, 'quantity', quantity_text::integer));
  end loop;

  insert into public.bulk_quote_requests
    (customer_id, idempotency_key, customer_type, services, address, preferred_date, preferred_time, company_name)
  values (customer, p_idempotency_key, clean_type, normalized, clean_address, p_preferred_date, clean_time, clean_company)
  on conflict (customer_id, idempotency_key) do nothing returning id into result_id;
  if result_id is not null then return result_id; end if;

  select * into existing from public.bulk_quote_requests
  where customer_id = customer and idempotency_key = p_idempotency_key;
  if existing.id is null or existing.customer_type <> clean_type or existing.services <> normalized or
     existing.address <> clean_address or existing.preferred_date <> p_preferred_date or
     existing.preferred_time <> clean_time or existing.company_name is distinct from clean_company then
    raise exception 'Request key already used with different details';
  end if;
  return existing.id;
end $$;

revoke all on function public.submit_bulk_quote_request(uuid,text,jsonb,text,date,text,text) from public, anon;
grant execute on function public.submit_bulk_quote_request(uuid,text,jsonb,text,date,text,text) to authenticated;

commit;
