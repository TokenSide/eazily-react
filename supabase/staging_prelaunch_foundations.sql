-- Apply immediately after influencer_legal_2026_09_12.sql. Keep historical
-- consent records; unresolved drafts must never count as live documents.
begin;

-- Explicit grants needed when Supabase's optional automatic API grants are off.
-- RLS still limits profile reads to the owner or authorized staff, and category
-- reads to active rows. Profile writes remain column-restricted elsewhere.
grant select on public.profiles to authenticated;
grant select on public.categories to anon, authenticated;

-- Top-level IDs, labels, and icons mirror the reviewed src/data/catalog.js.
-- Existing category rows retain their IDs, names, and active state.
insert into public.categories(name,slug,icon,sort_order)
values
  ('Services','manpower','workers',0),
  ('Loans','loans','rupee',10),
  ('Influencers','influencers','megaphone',20),
  ('Consultancy','consultancy','briefcase',30),
  ('Transportation','transportation','truck',40),
  ('Blood Service','blood-bank','drop',50)
on conflict(slug) do nothing;

update public.legal_documents
set published=false
where document_key in (
  'eazily-influencer-provider-terms',
  'eazily-influencer-provider-privacy-policy'
) and published and content like '%[UNRESOLVED%';

create function public.reject_unresolved_influencer_publication() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.published and new.document_key in (
    'eazily-influencer-provider-terms',
    'eazily-influencer-provider-privacy-policy'
  ) and new.content like '%[UNRESOLVED%' then
    raise exception 'Influencer legal document has unresolved approved wording';
  end if;
  return new;
end $$;
create trigger reject_unresolved_influencer_publication
before insert or update of published,content,document_key on public.legal_documents
for each row execute function public.reject_unresolved_influencer_publication();
revoke all on function public.reject_unresolved_influencer_publication()
from public,anon,authenticated;

commit;
