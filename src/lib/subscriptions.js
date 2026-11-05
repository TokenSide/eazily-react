export const SUBSCRIPTION_PLANS = Object.freeze([
  {
    id: "pre", name: "PRE", monthlyPrice: 3000, founderPrice: 299,
    bestFor: "Core partner access",
    benefits: ["Posting and new bookings", "Messaging and work management", "Basic performance summary", "PRE membership badge", "Standard support"],
  },
  {
    id: "pro", name: "PRO", monthlyPrice: 5000, founderPrice: 499, popular: true,
    bestFor: "More detailed partner tools",
    benefits: ["All PRE benefits", "Detailed analytics where available", "Eligibility for labelled promoted discovery", "Priority support queue", "PRO membership badge"],
  },
  {
    id: "legend", name: "LEGEND", monthlyPrice: 7000, founderPrice: 699,
    bestFor: "Highest eligible placement access",
    benefits: ["All PRO benefits", "Higher weighting in eligible promoted rotation", "Eligibility for rotating homepage/category features", "Highest support queue priority", "LEGEND membership badge"],
  },
]);

// Only benefits the backend actually delivers today are shown as included. Membership badges,
// analytics, promoted placement and priority support are not tracked or shown anywhere yet,
// so every other benefit (including unknown future text) is labelled planned.
const DELIVERED_BENEFITS = new Set(['Posting and new bookings', 'Messaging and work management', 'Basic performance summary', 'Standard support', 'All PRE benefits']);
export function benefitIsActive(text) {
  return DELIVERED_BENEFITS.has(String(text || '').trim());
}

// No plan has a tracked lead quota (monthly_leads is 0 and no usage is recorded), so never show a count.
export function leadQuotaNote(plan) {
  return Number(plan?.monthly_leads) === 0
    ? 'No monthly lead quota or guaranteed lead count. Each real booking request creates at most one lead.'
    : 'Lead quota is not tracked for this plan yet. No lead or booking count is guaranteed.';
}

export const TRIAL_DAYS = 60;
export const FOUNDER_OFFER_MONTHS = 6;

export function getSubscriptionPrice(plan, founderOffer = true) {
  return founderOffer ? plan.founderPrice : plan.monthlyPrice;
}

export function getSubscriptionRevenue(plan, founderOffer = true, months = 1) {
  return getSubscriptionPrice(plan, founderOffer) * Math.max(1, Number(months) || 1);
}
