// One approved list for customer discovery and new Consultant selections.
export const consultantCategories = Object.freeze([
  'Business Consultancy',
  'CA Consultancy',
  'Real Estate Consultancy',
  'Career Consultancy',
  'Legal Consultancy',
  'Health Consultancy',
  'Agriculture & Dairy Consultancy',
  'Cybersecurity & Safety Consultancy',
  'Engineering Consultancy',
  'Immigration & Visa Consultancy',
  'Loan Consultancy',
  'Import & Export Consultancy',
  'NGO & CSR Consultancy',
]);

// Compatibility aliases only: never rewrite saved applications or assessment field IDs.
// Unrelated retired specialties stay visible under their original label on old profiles.
const legacyConsultantCategories = Object.freeze({
  'Business Consultant': 'Business Consultancy',
  Business: 'Business Consultancy',
  'Financial Consultant': 'Business Consultancy',
  Financial: 'Business Consultancy',
  'Investment Consultant': 'Business Consultancy',
  Investment: 'Business Consultancy',
  'CA & Tax': 'CA Consultancy',
  'Career Consultant': 'Career Consultancy',
  Career: 'Career Consultancy',
  'Legal Consultant': 'Legal Consultancy',
  Legal: 'Legal Consultancy',
  'Healthcare Consultancy': 'Health Consultancy',
  Healthcare: 'Health Consultancy',
  'Healthcare & Wellness Consultancy': 'Health Consultancy',
  'Agriculture Consultancy': 'Agriculture & Dairy Consultancy',
  Agriculture: 'Agriculture & Dairy Consultancy',
  'Cybersecurity & Safety': 'Cybersecurity & Safety Consultancy',
  'Security & Safety Consultancy': 'Cybersecurity & Safety Consultancy',
  'Architect Consultation': 'Engineering Consultancy',
  Architecture: 'Engineering Consultancy',
  'Construction & Engineering Consultancy': 'Engineering Consultancy',
  'Electrical & Energy Consultancy': 'Engineering Consultancy',
  'Export & Import Consultancy': 'Import & Export Consultancy',
});

export function displayConsultantCategory(value) {
  return legacyConsultantCategories[value] || value || '';
}

export function consultantCategorySearchNames(value) {
  const category = displayConsultantCategory(value);
  return [category, ...Object.keys(legacyConsultantCategories).filter(old => legacyConsultantCategories[old] === category)];
}
