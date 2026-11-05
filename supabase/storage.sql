-- Apply in Supabase after partners.sql. Partner media stays private until moderated/published.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('partner-media','partner-media',false,52428800,array['image/jpeg','image/png','image/webp','video/mp4','video/webm','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy "Partners upload own media" on storage.objects for insert to authenticated
with check(bucket_id='partner-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "Partners manage own media" on storage.objects for update to authenticated
using(bucket_id='partner-media' and owner_id=auth.uid()::text)
with check(bucket_id='partner-media' and owner_id=auth.uid()::text);
create policy "Partners delete own media" on storage.objects for delete to authenticated
using(bucket_id='partner-media' and owner_id=auth.uid()::text);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-media','profile-media',false,10485760,array['image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy "Customers upload own profile media" on storage.objects for insert to authenticated
with check(bucket_id='profile-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "Customers read own profile media" on storage.objects for select to authenticated
using(bucket_id='profile-media' and owner_id=auth.uid()::text);
create policy "Customers update own profile media" on storage.objects for update to authenticated
using(bucket_id='profile-media' and owner_id=auth.uid()::text) with check(bucket_id='profile-media' and owner_id=auth.uid()::text);
create policy "Customers delete own profile media" on storage.objects for delete to authenticated
using(bucket_id='profile-media' and owner_id=auth.uid()::text);
create policy "Partners read own media" on storage.objects for select to authenticated
using(bucket_id='partner-media' and owner_id=auth.uid()::text);
