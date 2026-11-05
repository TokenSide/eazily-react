-- Optional admin-managed partner campaign integration. Empty until approved campaign content is configured.
begin;
create table if not exists public.partner_dashboard_banners (
 id uuid primary key default gen_random_uuid(),
 role text not null check(role in('professional','influencer','consultant')),
 headline text not null,
 supporting_line text not null,
 image_url text,
 image_alt text not null,
 action_label text not null,
 action_kind text not null check(action_kind in('subscription','training','post','orders','profile','support')),
 sponsored boolean not null default false,
 starts_at timestamptz not null,
 ends_at timestamptz,
 sort_order integer not null default 0,
 active boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.partner_dashboard_banners enable row level security;
drop policy if exists "Active partner banners readable" on public.partner_dashboard_banners;
create policy "Active partner banners readable" on public.partner_dashboard_banners for select using(active and starts_at<=now() and (ends_at is null or ends_at>now()));
drop policy if exists "Admins manage partner banners" on public.partner_dashboard_banners;
create policy "Admins manage partner banners" on public.partner_dashboard_banners for all using(is_admin()) with check(is_admin());
grant select on public.partner_dashboard_banners to authenticated;
commit;
