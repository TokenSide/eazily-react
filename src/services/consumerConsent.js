import { supabase } from '../lib/supabase.js';

export async function getConsumerLegalStatus() {
  if (!supabase) return { documents: [], acceptances: [], required: false, accepted: false };
  const { data, error } = await supabase.rpc('get_consumer_legal_status');
  if (error) throw error;
  return data;
}

export async function acceptConsumerPolicies(documents, terms, privacy) {
  if (!supabase) throw new Error('Policy acknowledgment requires a real authenticated account.');
  const { data, error } = await supabase.rpc('accept_consumer_policies', {
    p_documents: documents.map(doc => ({ id: doc.id, version: doc.version })),
    p_terms_accepted: terms === true,
    p_privacy_acknowledged: privacy === true,
  });
  if (error) throw error;
  window.dispatchEvent(new Event('eazily-consumer-consent-updated'));
  return data;
}

const transactions = new Set(['submit_request', 'book_partner_offering', 'book_free_introduction', 'reserve_wallet', 'request_official_payment', 'claim_referral']);
export function requiresConsumerConsent(name, args) {
  return transactions.has(name) || (name === 'respond_to_quote' && args.p_approve === true);
}

export async function checkConsumerTransaction(name, args) {
  if (!supabase || !requiresConsumerConsent(name, args)) return;
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session) return; // The existing transaction RPC enforces authentication.
  const status = await getConsumerLegalStatus();
  if (status.required && !status.accepted) {
    window.dispatchEvent(new Event('eazily-consumer-consent-required'));
    throw new Error('Review and acknowledge the current Consumer Terms and Privacy Policy, then retry your transaction.');
  }
}
