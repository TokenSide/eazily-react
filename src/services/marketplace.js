import { supabase } from "../lib/supabase.js";
import { canonicalService, readRows, rpc, serviceNamesForLookup } from "./experience.js";
import { isCustomerEligibleProfessional } from './customerProfessionalEligibility.js';
export { isCustomerEligibleProfessional } from './customerProfessionalEligibility.js';

export async function createServiceRequest(payload) {
  return rpc('submit_request', { p_category: payload.categoryId, p_service: payload.serviceName, p_kind: payload.requestType, p_details: payload.details, p_key: payload.idempotencyKey, p_vendor: payload.vendorId || null });
}

export async function bookPartnerOffering(payload) {
  return rpc('book_partner_offering', { p_post: payload.partnerPostId, p_slot: payload.slot, p_key: payload.idempotencyKey });
}

export async function getServiceBookingEstimate(partnerPostId) {
  return rpc('service_booking_estimate', { p_post: partnerPostId });
}

export async function getServiceMatchCapabilities() {
  return rpc('service_match_capabilities');
}

export async function requestProfessionalBooking(payload) {
  const address = payload.address?.trim() || '';
  const requirement = payload.requirement?.trim() || '';
  if (address.length < 5 || requirement.length < 5) throw new Error('Add a service address and a short work requirement before booking.');
  return rpc('request_professional_booking_with_intake', {
    p_post: payload.partnerPostId, p_slot: payload.slot, p_key: payload.idempotencyKey,
    p_backup: Boolean(payload.backup), p_city: payload.city,
    p_address: address, p_requirement: requirement,
  });
}

export async function getCategories() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("categories")
    .select("id,name,slug,icon,sort_order,services(id,name,slug,active)")
    .eq("active", true)
    .order("sort_order");
  if (error) throw error;
  return data;
}

export async function getActiveServiceCatalogue() {
  const categories = await getCategories();
  if (!categories) return [];
  return categories.flatMap(category => (category.services || [])
    .filter(service => service.active)
    .map(service => ({
      id: service.id,
      name: service.name,
      requestName: canonicalService(service.name),
      categoryId: 'manpower',
      catalogueCategory: category.slug,
    })));
}

function dedupeProfessionals(rows) {
  const seen = new Set();
  return rows.filter(row => {
    const key = row.partner_id ? `partner:${row.partner_id}:${canonicalService(row.selected_service || row.service_names?.[0])}` : `vendor:${row.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function withServicePartnerFacts(rows) {
  const partnerIds = [...new Set(rows.map(row => row.partner_id).filter(Boolean))];
  const facts = partnerIds.length ? await readRows('customer_service_verification', query => query.in('partner_id', partnerIds)).catch(() => []) : [];
  const byPartner = new Map(facts.map(row => [row.partner_id, row]));
  return rows.map(row => row.partner_id ? ({ ...row,
    document_verified_at: byPartner.get(row.partner_id)?.verified_at || null,
    reported_skills: byPartner.get(row.partner_id)?.reported_skills || [],
  }) : row);
}

export async function getCustomerProfessionals(serviceName, location) {
  if (!supabase) return [];
  const aliases = serviceNamesForLookup(serviceName);
  const modern = await readRows('customer_professional_directory', query => query.overlaps('service_names', aliases).limit(50)).catch(() => []);
  const legacy = await readRows('vendor_directory', query => query.overlaps('service_names', aliases).limit(50)).catch(() => []);
  return dedupeProfessionals([...(await withServicePartnerFacts(modern)), ...legacy])
    .filter(vendor => isCustomerEligibleProfessional(vendor, serviceName, location));
}

export async function getNearbyCustomerProfessionals(location) {
  if (!supabase) return [];
  const [modern, legacy] = await Promise.all([
    readRows('customer_professional_directory', query => query.limit(50)).catch(() => []),
    readRows('vendor_directory', query => query.limit(50)).catch(() => []),
  ]);
  return dedupeProfessionals([...(await withServicePartnerFacts(modern)), ...legacy])
    .filter(profile => profile.service_names?.some(name => isCustomerEligibleProfessional(profile, name, location)))
    .sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0))
    .slice(0, 8);
}

export async function getCustomerProfessionalById(id, serviceName, location) {
  if (!supabase) return null;
  const tables = ['customer_professional_directory', 'vendor_directory'];
  for (const table of tables) {
    const rows = await readRows(table, query => query.eq('id', id).limit(1)).catch(() => []);
    if (rows[0] && isCustomerEligibleProfessional(rows[0], serviceName, location)) {
      return (await withServicePartnerFacts(rows))[0];
    }
  }
  return null;
}

export async function getCustomerProfessionalReviews(vendor, serviceName) {
  if (vendor.demo) return vendor.demo_reviews || [];
  if (vendor.partner_id) {
    return readRows('customer_professional_reviews', query => query.eq('partner_id', vendor.partner_id).order('created_at', { ascending: false }).limit(100)).catch(() => []);
  }
  return readRows('customer_reviews', query => query.eq('vendor_id', vendor.id).eq('service_name', serviceName).order('created_at', { ascending: false }).limit(100)).catch(() => []);
}

const mediaPath = media => typeof media === 'string' ? null : media?.path;
const directMediaUrl = media => typeof media === 'string' ? media : media?.url || null;

async function signedMediaUrl(media, transform) {
  const direct = directMediaUrl(media);
  if (direct) return direct;
  const path = mediaPath(media);
  if (!supabase || !path) return null;
  const { data, error } = await supabase.storage.from('partner-media').createSignedUrl(path, 900, transform ? { transform } : undefined);
  if (error) throw error;
  return data?.signedUrl || null;
}

export async function getCustomerProfessionalMedia(vendor) {
  const portfolio = (vendor.portfolio_media || vendor.portfolio || []).filter(media => typeof media === 'string' || media?.type?.startsWith('image/'));
  const thumbnails = await Promise.all(portfolio.map(media => signedMediaUrl(media, { width: 520, height: 390, resize: 'cover', quality: 75 }).catch(() => signedMediaUrl(media).catch(() => null))));
  const profileSource = vendor.profile_photo_media || vendor.photo_url;
  const photo = await signedMediaUrl(profileSource, { width: 240, height: 240, resize: 'cover', quality: 78 }).catch(() => signedMediaUrl(profileSource).catch(() => null));
  return { photo, portfolio: portfolio.map((media, index) => ({ media, thumbnail: thumbnails[index] })).filter(item => item.thumbnail) };
}

export async function getCustomerProfessionalFullImage(media) {
  return signedMediaUrl(media).catch(() => directMediaUrl(media));
}

export async function getCurrentProfile() {
  if (!supabase) return null;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", auth.user.id).single();
  if (error) throw error;
  return data;
}

export async function signInWithPhone(phone) {
  if (!supabase) throw new Error('Phone verification is not configured in this environment.');
  const { normalizeIndianPhone } = await import('../auth/policy.js');
  const { data, error } = await supabase.auth.signInWithOtp({ phone: normalizeIndianPhone(phone) });
  if (error) throw error;
  return data;
}
