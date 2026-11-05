-- Permit support staff to read only customer-owned screenshots linked to tickets.
-- The profile-media bucket remains private and existing owner access is unchanged.
create policy "Support staff read linked ticket screenshots"
on storage.objects for select to authenticated
using (
  bucket_id = 'profile-media'
  and (public.is_admin() or public.has_staff_permission('support.manage'))
  and exists (
    select 1 from public.support_tickets t
    where t.screenshot_path = storage.objects.name
      and (storage.foldername(storage.objects.name))[1] = t.customer_id::text
      and (storage.foldername(storage.objects.name))[2] = 'support'
      and storage.objects.owner_id = t.customer_id::text
  )
);
