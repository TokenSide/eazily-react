begin;
create function eazily_private.guard_profile_changes() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.status='approved' and not is_admin() and (old.details->'services' is distinct from new.details->'services' or old.details->'category' is distinct from new.details->'category' or old.details->'platforms' is distinct from new.details->'platforms' or old.details->'specialisation' is distinct from new.details->'specialisation') then
  new.status:='submitted'; new.review_notes:='Profile changes require renewed verification.';
 end if;
 return new;
end $$;
create trigger review_changed_partner_eligibility before update of details on partner_applications for each row execute function eazily_private.guard_profile_changes();
create function eazily_private.guard_published_post() returns trigger language plpgsql security definer set search_path=public,eazily_private as $$
declare a partner_applications; media jsonb; valid boolean; kind text;
begin
 if new.status not in('published','pending_review') then return new; end if;
 select * into a from partner_applications where id=new.partner_id;
 if a.status<>'approved' or a.role<>new.role then raise exception 'Approved matching partner role required';end if;
 if new.details->>'category' is distinct from a.details->>'category' then raise exception 'Registered category required';end if;
 if new.role='professional' and coalesce(new.details->>'postType','offering')='offering' and not coalesce(a.details->'services','[]') ? (new.details->>'service') then raise exception 'Registered service required';end if;
 for media in select value from jsonb_array_elements(coalesce(new.details->'media','[]')) loop
  if media->>'path' like '%/documents/%' or media->>'path' not like a.customer_id::text||'/'||a.role||'/%' or media->>'type' not in('image/jpeg','image/png','image/webp','video/mp4','video/webm') then raise exception 'Only your public work media can be attached';end if;
  if to_regclass('storage.objects') is null then raise exception 'Media storage validation is not available';end if;
  execute 'select exists(select 1 from storage.objects where bucket_id=''partner-media'' and name=$1 and owner_id=$2 and (metadata->>''size'')::bigint between 1 and 52428800 and metadata->>''mimetype''=$3)' into valid using media->>'path',a.customer_id::text,media->>'type';
  if not valid then raise exception 'Upload must finish before submission';end if;
 end loop;
 kind:=coalesce(new.details->>'postType','offering');
 if new.status='published' and kind='offering' and not eazily_private.post_price(new) ? 'totalPaise' then raise exception 'Configure complete customer pricing before publishing';end if;
 return new;
end $$;
create trigger validate_moderated_seller_post before insert or update on partner_posts for each row execute function eazily_private.guard_published_post();
-- Preserve legacy JSON privately before removing mixed-party fields from order reads.
create table eazily_private.legacy_order_details as select id,details from partner_orders;
update partner_orders set details=eazily_private.pick(details,array['postId','title','service','category','description','mode','duration','durationMinutes','deliverables','specialisation']);
drop policy "Partner configuration readable" on partner_config;
create policy "Admin reads internal partner config" on partner_config for select using(is_admin());
create view public.partner_public_config as select id,influencer_threshold,influencer_initial_release_percent,influencer_review_window_hours,availability_minutes,free_intro_minutes,cashfree_enabled from partner_config;
grant select on partner_public_config to anon,authenticated;
-- Audit configuration changes without exposing the records to non-admin callers.
create function eazily_private.audit_seller_configuration() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into partner_audit_log(actor_id,action,entity_type,entity_id,before_data,after_data) values(auth.uid(),TG_OP,TG_TABLE_NAME,new.id::text,case when TG_OP='UPDATE' then to_jsonb(old) end,to_jsonb(new));return new;
end $$;
create trigger audit_pricing_rules after insert or update on seller_pricing_rules for each row execute function eazily_private.audit_seller_configuration();
create trigger audit_subscription_rules after update on seller_subscription_config for each row execute function eazily_private.audit_seller_configuration();
create trigger audit_subscription_plans after update on seller_plans for each row execute function eazily_private.audit_seller_configuration();
revoke all on function eazily_private.guard_profile_changes(),eazily_private.guard_published_post(),eazily_private.audit_seller_configuration() from public,anon,authenticated;
commit;
