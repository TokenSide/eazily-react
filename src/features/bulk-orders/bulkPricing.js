// DEMO / BULK PRICING CONFIG
// Test rates stay isolated from normal catalogue, checkout, and partner pricing.
export const BULK_PRICING_IS_DEMO = true;

export const bulkServices = [
  { id: 'ac-service', catalogueService: 'AC Service', name: 'AC Service', description: 'For multiple AC units', unit: 'Unit', units: 'Units', nextUnit: 'ACs', standardRate: 499, tiers: [{ minimum: 5, rate: 429 }, { minimum: 10, rate: 349 }], customQuoteAt: 20 },
  { id: 'electrician', catalogueService: 'Electrician', name: 'Electrician', description: 'For planned electrical work', unit: 'Professional', units: 'Professionals', nextUnit: 'professionals', standardRate: 399, tiers: [{ minimum: 5, rate: 349 }, { minimum: 10, rate: 299 }], customQuoteAt: 20 },
  { id: 'deep-cleaning', catalogueService: 'Deep Cleaning', name: 'Deep Cleaning', description: 'For multiple areas or units', unit: 'Area', units: 'Areas / Units', nextUnit: 'areas', standardRate: 799, tiers: [{ minimum: 5, rate: 699 }, { minimum: 10, rate: 599 }], customQuoteAt: 20 },
  { id: 'painting', catalogueService: 'Painter', name: 'Painting', description: 'For multiple units or properties', unit: 'Unit', units: 'Units / Properties', nextUnit: 'units', standardRate: 999, tiers: [{ minimum: 5, rate: 899 }, { minimum: 10, rate: 799 }], customQuoteAt: 20 },
  { id: 'cctv', catalogueService: 'CCTV Technician', name: 'CCTV Installation / Maintenance', description: 'For multiple cameras', unit: 'Camera', units: 'Cameras', nextUnit: 'cameras', standardRate: 699, tiers: [{ minimum: 5, rate: 599 }, { minimum: 10, rate: 499 }], customQuoteAt: 20 },
  { id: 'appliance', catalogueService: 'Refrigerator Repair', name: 'Fridge / Appliance Service', description: 'For multiple appliances', unit: 'Appliance', units: 'Appliances', nextUnit: 'appliances', standardRate: 449, tiers: [{ minimum: 5, rate: 399 }, { minimum: 10, rate: 349 }], customQuoteAt: 20 },
];

export function priceFor(service, quantity) {
  const safeQuantity = Math.max(1, Number(quantity) || 1);
  const standardTotal = service.standardRate * safeQuantity;
  if (safeQuantity >= service.customQuoteAt) return { customQuote: true, quantity: safeQuantity, rate: null, standardTotal, total: null, savings: null, tier: 'custom', nextTier: null };
  const unlocked = [...service.tiers].reverse().find(tier => safeQuantity >= tier.minimum);
  const rate = unlocked?.rate ?? service.standardRate;
  return {
    customQuote: false,
    quantity: safeQuantity,
    rate,
    standardTotal,
    total: rate * safeQuantity,
    savings: standardTotal - (rate * safeQuantity),
    tier: unlocked ? `tier-${unlocked.minimum}` : 'standard',
    nextTier: service.tiers.find(tier => tier.minimum > safeQuantity) ?? { minimum: service.customQuoteAt, rate: null },
  };
}

export function bulkSummary(quantities) {
  const lines = bulkServices.flatMap(service => {
    const quantity = Number(quantities[service.id] || 0);
    return quantity > 0 ? [{ service, ...priceFor(service, quantity) }] : [];
  });
  const needsQuote = lines.some(line => line.customQuote);
  return {
    lines,
    items: lines.reduce((sum, line) => sum + line.quantity, 0),
    standardTotal: lines.reduce((sum, line) => sum + line.standardTotal, 0),
    total: needsQuote ? null : lines.reduce((sum, line) => sum + line.total, 0),
    savings: needsQuote ? null : lines.reduce((sum, line) => sum + line.savings, 0),
    needsQuote,
  };
}
