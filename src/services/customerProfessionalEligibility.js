import { canonicalCatalogService } from '../data/catalog.js';

const operationalAliases = {
  'Master Electrician': 'Electrician',
  'Electrician Visit': 'Electrician',
  'Plumbing Professional': 'Plumber',
  'Cleaning Specialist': 'Deep Cleaning',
  'Home Cleaning': 'Deep Cleaning',
  'AC Repair': 'AC Service',
  'Painting Service': 'Painter',
  'Appliance Technician': 'Appliance Repair',
};
const canonical = name => canonicalCatalogService(operationalAliases[name] || name);
const lower = value => String(value ?? '').trim().toLocaleLowerCase();
const unavailablePattern = /(^|\b)(unavailable|not accepting|offline only|suspended|blocked)(\b|$)/i;

export function isCustomerEligibleProfessional(vendor, serviceName, location) {
  if (!vendor) return false;
  if (vendor.demo === true) return true;
  if (vendor.partner_role && vendor.partner_role !== 'professional') return false;
  if (vendor.verification_status !== 'verified') return false;
  if (vendor.account_status && vendor.account_status !== 'active') return false;
  if (vendor.post_status && vendor.post_status !== 'published') return false;
  if (vendor.partner_role && !vendor.post_status) return false;
  if (vendor.published === false || vendor.accepting_bookings === false || vendor.offline_only_unavailable === true) return false;
  if (!vendor.available_now && unavailablePattern.test(vendor.availability || vendor.availability_status || '')) return false;
  const requested = canonical(serviceName);
  if (!(vendor.service_names || []).some(name => canonical(name) === requested)) return false;
  const city = lower(location);
  const coverage = [...(vendor.coverage || []), vendor.city].filter(Boolean).map(lower);
  return !city || coverage.some(area => area === city || area.includes(city) || city.includes(area));
}
