import { useEffect, useState } from 'react';
import { readRows, rpc } from '../../services/experience.js';
import { SUBSCRIPTION_PLANS, benefitIsActive, leadQuotaNote } from '../../lib/subscriptions.js';
import { translate as t } from '../../lib/translate.js';
const money = paise => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100);
export default function SubscriptionPanel({ application, notify, onSupport }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  useEffect(() => {
    let active = true;
    Promise.all([readRows('seller_subscription_config'), readRows('seller_plans'), readRows('seller_subscriptions', q => q.eq('partner_id', application.id)), readRows('seller_subscription_requests', q => q.eq('partner_id', application.id))])
      .then(([configs, plans, subscriptions, requests]) => { if (active) setData({ config: configs[0], plans, subscription: subscriptions[0], requests }); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [application.id]);
  async function request(plan) {
    if (busy) return;
    setBusy(true);
    try { const result = await rpc('request_seller_subscription', { p_partner: application.id, p_plan: plan.id, p_key: key }); setData(d => ({ ...d, requests: [...d.requests.filter(r => r.id !== result.id), result] })); notify('Subscription payment request saved. Membership activates only after provider confirmation.'); }
    catch (e) { notify(e.message); } finally { setBusy(false); }
  }
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">{t('Loading…')}</p>;
  const { config, subscription } = data;
  const approved = application.status === 'approved';
  const trialEnd = subscription?.trial_ends_at;
  const founderEnd = subscription?.founder_ends_at;
  const timelineKnown = approved && Boolean(subscription?.approval_started_at && trialEnd && founderEnd) && !subscription?.approval_date_missing;
  const inTrial = timelineKnown && Date.now() < Date.parse(trialEnd);
  const inFounder = timelineKnown && !inTrial && Date.now() < Date.parse(founderEnd);
  const active = subscription?.status === 'active' && subscription.current_period_end && Date.parse(subscription.current_period_end) > Date.now();
  const status = !approved ? 'Pending approval' : !timelineKnown ? 'Dates being updated' : active ? 'Active membership' : inTrial ? 'Free Trial' : inFounder ? 'Founder pricing window' : 'Expired';
  // Built-in fallback plans are only a comparison; a payable amount needs server plan rows.
  const serverPlans = data.plans.length > 0;
  const eligibilityKnown = timelineKnown && serverPlans;
  const plans = serverPlans ? data.plans : SUBSCRIPTION_PLANS.map(p => ({ id: p.id, name: p.name, standard_paise: p.monthlyPrice * 100, founder_paise: p.founderPrice * 100, benefits: p.benefits, monthly_leads: 0, enabled: false }));
  const moneyDate = value => value ? new Date(value).toLocaleDateString('en-IN') : 'Not available';
  const currentPrice = inTrial || inFounder ? 'founder_paise' : 'standard_paise';
  const canRequest = eligibilityKnown && config?.rollout_enabled && config?.payment_checkout_enabled;
  return <section className="seller-panel"><h2>{t('Subscription')}</h2>
    <section className="subscription-status-card"><b>{status}</b>{!approved ? <p>Your free trial starts after approval. Exact dates appear here once recorded.</p> : !timelineKnown ? <><p>We’re updating your subscription dates.</p><button className="link" onClick={onSupport}>Contact support</button></> : <><p>Trial ends: {moneyDate(trialEnd)}</p><p>Founder pricing ends: {moneyDate(founderEnd)}</p>{subscription?.current_period_end && <p>Next renewal: {moneyDate(subscription.current_period_end)}</p>}</>}</section>
    {!canRequest && <p className="subscription-test-banner">Subscription checkout is unavailable here. No payment can be collected from this screen.</p>}
    <details className="subscription-details"><summary>Membership, renewal and tax details</summary><p>Membership is separate from Verified Partner status and applies to this role. It does not change service charges, booking fees, GST, payouts, or Influencer security holds.</p><p>Trial and founder pricing follow the recorded dates above. Standard pricing applies afterward. Renewal and cancellation require supported provider confirmation.</p><p>Displayed prices follow the configured billing tax policy. No subscription payment is available until official checkout and confirmation are enabled.</p></details>
    {!eligibilityKnown && <p className="policy-note">Pricing eligibility is not available yet, so checkout is disabled. The comparison prices below are not a current payable amount.</p>}
    <div className="subscription-plan-grid">{plans.map(plan => <article className="partner-list-card subscription-plan-card" key={plan.id}><h3>{plan.name}</h3>{eligibilityKnown ? <b>{money(plan[currentPrice])} / {t('month')}</b> : <div className="subscription-price-comparison"><span>Founder: {money(plan.founder_paise)}</span><span>Standard: {money(plan.standard_paise)}</span></div>}{inTrial ? <span className="subscription-founder-label">After free trial, until {moneyDate(founderEnd)}</span> : inFounder && <span className="subscription-founder-label">Founder launch price</span>}<p>{(plan.benefits || []).map(b => <span className="subscription-benefit" key={b}>{t(b)}{benefitIsActive(b) ? '' : ' · planned, not active'}</span>)}</p><p className="policy-note">{leadQuotaNote(plan)}</p><button className="btn btn-primary" disabled={busy || !canRequest || !plan.enabled} onClick={() => request(plan)}>{canRequest ? t('Request subscription payment') : t('Checkout unavailable')}</button></article>)}</div>
    <p className="policy-note">Membership badges are separate from document verification and are not shown to customers yet. Detailed analytics, promoted placement and paid priority are not active; bookings are not guaranteed.</p>
    <h3>{t('Payment History')}</h3>{data.requests.map(r => <p key={r.id}>{r.plan_id.toUpperCase()} · {money(r.price_paise)} · {t(r.status)}{r.paid_at ? ` · Paid ${moneyDate(r.paid_at)}` : ''}</p>)}{!data.requests.length && <p>{t('No subscription payments yet')}</p>}
  </section>;
}
