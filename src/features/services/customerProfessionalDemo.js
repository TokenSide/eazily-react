import { PARTNER_DEMO_ENABLED } from '../partners/demo/config.js';
export const CUSTOMER_PROFESSIONAL_DEMO_ENABLED = PARTNER_DEMO_ENABLED;

export async function getDemoCustomerProfessionals(serviceName, location, isolatedDemo = false) {
  if (!CUSTOMER_PROFESSIONAL_DEMO_ENABLED || !isolatedDemo) return [];
  const { customerProfessionalSamples } = await import('../partners/demo/customerProfessionalFixtures.js');
  return customerProfessionalSamples.filter(profile => profile.service_names.includes(serviceName) && profile.coverage.includes(location));
}

export async function getDemoNearbyCustomerProfessionals(location, isolatedDemo = false) {
  if (!CUSTOMER_PROFESSIONAL_DEMO_ENABLED || !isolatedDemo) return [];
  const { customerProfessionalSamples } = await import('../partners/demo/customerProfessionalFixtures.js');
  const city = String(location || '').trim().toLowerCase();
  return customerProfessionalSamples.filter(profile => !city || profile.coverage.some(area => area.toLowerCase().includes(city) || city.includes(area.toLowerCase())));
}
