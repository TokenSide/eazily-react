/* Unit check: subscription screens only mark backend-delivered benefits as included and never show a lead count. */
const assert = require('node:assert/strict');

(async () => {
  const { SUBSCRIPTION_PLANS, benefitIsActive, leadQuotaNote, TRIAL_DAYS, FOUNDER_OFFER_MONTHS } = await import('../src/lib/subscriptions.js');
  for (const text of ['Posting and new bookings', 'Messaging and work management', 'Basic performance summary', 'Standard support', 'All PRE benefits'])
    assert.equal(benefitIsActive(text), true, `Delivered: ${text}`);
  for (const text of ['PRE membership badge', 'PRO membership badge', 'LEGEND membership badge', 'Detailed analytics where available', 'Eligibility for labelled promoted discovery', 'Priority support queue', 'Highest support queue priority', 'Higher weighting in eligible promoted rotation', 'Eligibility for rotating homepage/category features', 'All PRO benefits', 'Unknown future benefit', '', null])
    assert.equal(benefitIsActive(text), false, `Planned, not active: ${text}`);
  for (const plan of SUBSCRIPTION_PLANS) for (const benefit of plan.benefits) if (/badge|analytics|promot|priority|rotation|homepage/i.test(benefit)) assert.equal(benefitIsActive(benefit), false, `${plan.id}: ${benefit}`);
  assert.match(leadQuotaNote({ monthly_leads: 0 }), /No monthly lead quota or guaranteed lead count/);
  for (const plan of [{ monthly_leads: 20 }, {}, null]) { const note = leadQuotaNote(plan); assert.match(note, /not tracked/); assert.doesNotMatch(note, /\d/, 'No lead number is ever shown'); }
  assert.equal(TRIAL_DAYS, 60); assert.equal(FOUNDER_OFFER_MONTHS, 6);
  console.log('PASS: only delivered subscription benefits show as included; badges, analytics, promotion and priority are planned; no lead count is shown; trial/founder constants unchanged.');
})().catch(error => { console.error(error); process.exitCode = 1; });
