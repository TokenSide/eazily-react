export const partnerRoles = {
  professional: { label: 'Service Professional', description: 'Offer local and specialised services.', icon: 'workers', colour: '#15803D', background: '#F0FDF4', post: 'Post a Service', orders: 'My Orders' },
  influencer: { label: 'Influencer', description: 'Connect with brands for paid collaborations.', icon: 'megaphone', colour: '#C2410C', background: '#F5F3FF', post: 'Create Collaboration', orders: 'Collaborations' },
  consultant: { label: 'Consultant', description: 'Earn by sharing your expertise.', icon: 'briefcase', colour: '#2563EB', background: '#EFF6FF', post: 'Offer Consultation', orders: 'Appointments' },
};
export const applicationStatuses = ['Draft', 'Submitted', 'Under Review', 'Approved', 'Changes Required'];
export const postStatuses = ['Draft', 'Pending Review', 'Published', 'Changes Required', 'Rejected', 'Paused'];
export function eligibilityBand(platforms = [], threshold = 5000) {
  const count = Math.max(0, ...platforms.map(p => Number(p.count) || 0));
  if (count < threshold) return 'Not yet eligible';
  return count < 10000 ? '5K–under 10K' : count < 100000 ? '10K–under 100K' : count < 1000000 ? '100K–under 1M' : '1M+';
}
export function consultationRate(rates, partnerId, category, duration) {
  return rates.find(r => r.partner_id === partnerId && r.category === category && r.duration === Number(duration)) ?? rates.find(r => !r.partner_id && r.category === category && r.duration === Number(duration));
}
