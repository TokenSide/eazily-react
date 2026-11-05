// Local fixtures only; never load live pricing or import payment services.
// Same zero-tax, zero-separate-fee configuration as scripts/seller-test.cjs.
// The real seller_pricing_rules seed is disabled/incomplete. These are NOT live prices.
export function serviceQuote(basePaise) {
  if (!Number.isSafeInteger(basePaise) || basePaise < 10000 || basePaise > 1e9) throw new Error('Sample service price must be ₹100–₹1 crore. Below-₹100 pricing is unconfigured.');
  const markupPaise = Math.round(basePaise * (basePaise <= 100000 ? 2500 : 1200) / 10000);
  return { sellerBasePaise: basePaise, sellerTaxPaise: 0, sellerPayablePaise: basePaise, markupPaise, servicePaise: basePaise + markupPaise, feePaise: 0, taxPaise: 0, totalPaise: basePaise + markupPaise };
}

// Defaults in supabase/partners.sql, formula in cashfree-create-collaboration.
// Real admins may configure different values; this never reads or changes them.
export function collaborationQuote(customerTotal) {
  if (!Number.isFinite(customerTotal) || customerTotal <= 0) throw new Error('Invalid sample package price');
  const platformFee = Math.round(customerTotal * 10) / 100;
  const partnerPayout = customerTotal - platformFee;
  const initialRelease = Math.round(partnerPayout * 70) / 100;
  return { customerTotal, platformFee, partnerPayout, initialRelease, securityHold: partnerPayout - initialRelease };
}
