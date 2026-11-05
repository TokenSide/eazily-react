import { supabase } from '../lib/supabase.js';
import { checkConsumerTransaction } from './consumerConsent.js';
import { canonicalCatalogService, catalogServiceNames } from '../data/catalog.js';

export function requireBackend() {
  if (!supabase) throw new Error('Live service is not configured. Your request has not been submitted.');
  return supabase;
}

export async function readRows(table, configure = (query) => query) {
  if (!supabase) return [];
  const { data, error } = await configure(supabase.from(table).select('*'));
  if (error) throw error;
  return data ?? [];
}

export async function rpc(name, args = {}) {
  await checkConsumerTransaction(name, args);
  const { data, error } = await requireBackend().rpc(name, args);
  if (error) throw error;
  return data;
}

export function canonicalService(name) {
  const operational = ({ 'Master Electrician': 'Electrician', 'Electrician Visit': 'Electrician', 'Plumbing Professional': 'Plumber', 'Cleaning Specialist': 'Deep Cleaning', 'Home Cleaning': 'Deep Cleaning', 'AC Repair': 'AC Service', 'Painting Service': 'Painter', 'Appliance Technician': 'Appliance Repair' })[name] ?? name;
  return canonicalCatalogService(operational);
}

export function serviceNamesForLookup(name) {
  const canonical = canonicalService(name);
  const operationalAliases = ['Master Electrician', 'Electrician Visit', 'Plumbing Professional', 'Cleaning Specialist', 'Home Cleaning', 'AC Repair', 'Painting Service', 'Appliance Technician'];
  return [...new Set([
    ...catalogServiceNames(canonical),
    ...operationalAliases.filter(alias => canonicalService(alias) === canonical),
  ])];
}

export function experienceLink(service, vendorId) {
  const url = new URL(window.location.href);
  url.hash = '';
  url.search = '';
  url.searchParams.set('service', service.serviceName);
  url.searchParams.set('category', service.categoryId);
  if (vendorId) url.searchParams.set('vendor', vendorId);
  return url.href;
}

export async function shareLink(url, notify, copy = false) {
  try {
    if (!copy && navigator.share) await navigator.share({ title: 'Eazily', url });
    else { await navigator.clipboard.writeText(url); notify('Link copied'); }
  } catch (error) {
    if (error.name !== 'AbortError') notify('Could not share automatically. Copy the link shown below.');
  }
}
