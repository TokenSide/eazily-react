-- Run this in the Supabase SQL editor after creating your project.
create extension if not exists "pgcrypto";

create type public.user_role as enum ('customer', 'seller', 'admin');
create type public.request_status as enum ('pending', 'accepted', 'in_progress', 'completed', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'customer',
  full_name text,
  phone text,
  city text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  icon text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  name text not null,
  slug text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(category_id, slug)
);

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  business_name text not null,
  description text,
  verification_status text not null default 'pending',
  rating numeric(2,1) not null default 0,
  city text,
  created_at timestamptz not null default now()
);

create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.profiles(id) on delete set null default auth.uid(),
  category_id text,
  service_name text not null,
  request_type text not null,
  details jsonb not null default '{}'::jsonb,
  status public.request_status not null default 'pending',
  assigned_vendor_id uuid references public.vendors(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 3000),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.services enable row level security;
alter table public.vendors enable row level security;
alter table public.service_requests enable row level security;
alter table public.messages enable row level security;

create policy "Public categories are readable" on public.categories for select using (active = true);
create policy "Public services are readable" on public.services for select using (active = true);
create policy "Users read own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Customers create requests" on public.service_requests for insert with check (auth.uid() = customer_id);
create policy "Customers read own requests" on public.service_requests for select using (auth.uid() = customer_id);
create policy "Participants read request messages" on public.messages for select using (
  exists (select 1 from public.service_requests r where r.id = request_id and r.customer_id = auth.uid())
  or sender_id = auth.uid()
);
create policy "Users send own messages" on public.messages for insert with check (sender_id = auth.uid());

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new.phone);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users for each row execute procedure public.handle_new_user();
