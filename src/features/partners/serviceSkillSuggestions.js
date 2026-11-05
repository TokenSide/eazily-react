// Suggestions are guidance only. Only serviceSelections become offered services.
const categorySkills = {
  'home-property': ['Home Repair', 'Installation', 'Maintenance'],
  vehicle: ['Vehicle Inspection', 'Vehicle Repair', 'Parts Replacement'],
  'personal-daily': ['Household Support', 'Garment Care', 'Scheduled Visits'],
  electronics: ['Device Diagnosis', 'Device Repair', 'Device Installation'],
  beauty: ['Grooming', 'Skin Care', 'Styling'],
  wedding: ['Event Setup', 'Decoration', 'On-site Coordination'],
  pet: ['Pet Care', 'Pet Grooming', 'Pet Walking'],
  other: ['Service Planning', 'On-site Support', 'Custom Work'],
};

const serviceSkills = {
  Electrician: ['Wiring', 'Switch Repair', 'Fan Installation'],
  Plumber: ['Tap Repair', 'Leak Repair', 'Pipe Installation'],
  Carpenter: ['Furniture Repair', 'Door Fitting', 'Cabinet Installation'],
  Painter: ['Wall Painting', 'Surface Preparation', 'Touch-up Painting'],
  'AC Service': ['AC Cleaning', 'Cooling Diagnosis', 'AC Installation'],
  'Deep Cleaning': ['Kitchen Deep Cleaning', 'Bathroom Deep Cleaning', 'Floor Scrubbing'],
  'Washing Machine Repair': ['Fault Diagnosis', 'Drum Repair', 'Water Drainage Repair'],
  'Mobile Repair': ['Phone Diagnosis', 'Screen Replacement', 'Charging Port Repair'],
  'Computer Repair': ['Computer Diagnosis', 'Software Troubleshooting', 'Hardware Repair'],
  'RO Technician': ['Water Purifier Servicing', 'Filter Replacement', 'Water Flow Diagnosis'],
  'CCTV Technician': ['Camera Installation', 'DVR Setup', 'CCTV Troubleshooting'],
  'Bike Mechanic': ['Bike Servicing', 'Brake Repair', 'Engine Diagnosis'],
  'Car Mechanic': ['Car Servicing', 'Brake Repair', 'Engine Diagnosis'],
};

export function uniqueSkills(skills) {
  const seen = new Set();
  return skills.map(skill => String(skill).trim().replace(/\s+/g, ' ')).filter(skill => {
    const key = skill.toLocaleLowerCase();
    if (!skill || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function suggestedSkills(selections, activeCategoryId) {
  const categories = [...new Set([activeCategoryId, ...selections.map(item => item.categoryId)].filter(Boolean))];
  return uniqueSkills([
    ...categories.flatMap(id => categorySkills[id] || []),
    ...selections.flatMap(item => serviceSkills[item.serviceName] || []),
  ]);
}

export function draftServiceBio({ name, serviceSelections, experienceYears, experienceMonths, skills }) {
  const categories = [...new Set(serviceSelections.map(item => item.categoryLabel).filter(Boolean))];
  if (!categories.length) return '';
  const categoryText = categories.length <= 3 ? categories.join(', ') : `${categories.slice(0, 3).join(', ')} and other selected categories`;
  const years = Number(experienceYears), months = Number(experienceMonths);
  const duration = [Number.isFinite(years) && years > 0 ? `${years} year${years === 1 ? '' : 's'}` : '', Number.isFinite(months) && months > 0 ? `${months} month${months === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ');
  const subject = name?.trim() || 'I';
  const verb = subject === 'I' ? 'provide' : 'provides';
  const confirmed = uniqueSkills(Array.isArray(skills) ? skills : []).slice(0, 5);
  return `${subject} ${verb} ${categoryText} services${duration ? ` with ${duration} of experience` : ''}.${confirmed.length ? ` Skills include ${confirmed.join(', ')}.` : ''}`;
}
