export const PRICING_CONFIG = Object.freeze({
  safetyFee: 30,
  taxRate: 0.08,
  service: { lowerTierLimit: 1000, lowerTierMargin: 0.25, upperTierMargin: 0.12 },
  influencerMargin: 0.25,
  consultationShare: 0.5,
});

export function toMoney(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
}

export function formatMoney(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", minimumFractionDigits: 2,
  }).format(toMoney(value));
}

export function calculateServicePricing(charges, config = PRICING_CONFIG) {
  const normalizedCharges = Object.fromEntries(
    Object.entries(charges).map(([key, value]) => [key, toMoney(value)]),
  );
  const basePrice = Object.values(normalizedCharges).reduce((total, value) => total + value, 0);
  const marginRate = basePrice <= config.service.lowerTierLimit
    ? config.service.lowerTierMargin
    : config.service.upperTierMargin;
  const margin = basePrice * marginRate;
  const customerPrice = basePrice + margin;
  const taxableAmount = customerPrice + config.safetyFee;
  const tax = taxableAmount * config.taxRate;
  return {
    charges: normalizedCharges, basePrice, marginRate, margin, customerPrice,
    safetyFee: config.safetyFee, taxableAmount, taxRate: config.taxRate, tax,
    total: taxableAmount + tax, providerPayout: basePrice,
    eazilyRevenue: margin + config.safetyFee,
  };
}
