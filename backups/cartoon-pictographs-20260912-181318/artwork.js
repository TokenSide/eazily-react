// User-only visual mapping. Catalogue names, order, IDs and destinations remain owned by data/catalog.js.
// A secondary subject identifies the specialism; there is no index-based or random icon cycling.
export const artwork = {
  Services: ['toolkit'], Loans: ['loan'], Influencers: ['creator'], Consultancy: ['adviser'], Transportation: ['truck'], 'Blood Service': ['blood'],
  'Home & Property': ['house'], Vehicle: ['car'], 'Personal & Daily': ['essentials'], Electronics: ['devices'], 'Personal Care': ['salon'], 'Wedding & Occasion': ['wedding'], 'Pet Care': ['pet'], Other: ['assorted'],
  Electrician: ['electrician'], Plumber: ['plumber'], 'AC Service': ['ac'], 'Home Cleaning': ['cleaning'], 'Deep Cleaning': ['cleaning'], 'Appliance Repair': ['washer', 'wrench'], Carpenter: ['carpenter'], 'Beauty & Salon': ['salon'], 'Salon at Home': ['salon'], 'Packers & Movers': ['moving'],
  Painter: ['painting'], 'Tile Worker': ['tiles'], 'POP & False Ceiling': ['ceiling'], 'Glass Worker': ['glass'], 'Aluminium Worker': ['window'], 'Home Maintenance': ['house', 'wrench'], 'Pest Control': ['sprayer'], 'CCTV Technician': ['cctv'],
  'Bike Mechanic': ['motorbike', 'wrench'], 'Car Mechanic': ['car', 'wrench'], 'Heavy Vehicle Mechanic': ['truck', 'wrench'], 'Battery Technician': ['battery'], 'Vehicle Modification': ['car', 'gear'], 'Towing Services': ['tow'], 'Vehicle Driver': ['wheel'], 'Tour & Travel Services': ['travel'], 'Car Wash': ['car', 'cleaning'],
  'Key Maker': ['keys'], 'Dry Cleaner': ['hanger'], 'Shoe Maker': ['shoe'], Cook: ['cooking'], 'House Help': ['essentials'], 'Laundry Service': ['washer', 'hanger'],
  'Mobile Repair': ['phone', 'wrench'], 'Computer Repair': ['devices', 'wrench'], 'RO Technician': ['purifier'], 'Technical Electronics': ['circuit'],
  'Makeup Artist': ['makeup'], 'Bridal Makeup': ['makeup', 'wedding'], 'Mehendi Artist': ['henna'], 'Hair Care': ['hair'], Grooming: ['salon'],
  Photographer: ['camera'], Videographer: ['video'], Decorator: ['balloons'], Caterer: ['cooking', 'plates'], 'DJ & Music': ['music'], 'Stage Setup': ['stage'], Band: ['trumpet'], 'Tent House': ['tent'], 'Event Manager': ['calendar', 'balloons'],
  'Pet Grooming': ['pet', 'salon'], 'Pet Boarding': ['pet', 'house'], 'Pet Walker': ['pet', 'lead'], 'Pet Training': ['pet', 'medal'], 'Pet Rescue': ['pet', 'shield'], 'Emergency Pet Support': ['pet', 'medical'],
  'Tempo Driver': ['truck', 'wheel'], 'Loading Labour': ['boxes', 'trolley'], Courier: ['parcel'], 'Home Tutor': ['books'], 'Yoga Coach': ['yoga'], 'Personal Trainer': ['weights'],
  'Personal Loan': ['loan', 'person'], 'Business Loan': ['loan', 'shop'], 'Home Loan': ['loan', 'house'], 'Vehicle Loan': ['loan', 'car'], 'Loan Against Property': ['house', 'loan'], 'Education Loan': ['loan', 'books'],
  'Lifestyle Influencer': ['creator', 'person'], 'Tech Influencer': ['creator', 'devices'], 'Education Influencer': ['creator', 'books'], 'Business & Finance Influencer': ['creator', 'loan'], 'Fashion & Beauty Influencer': ['creator', 'makeup'], 'Fitness & Health Influencer': ['creator', 'weights'], 'Food & Travel Influencer': ['creator', 'travel'], 'Gaming Influencer': ['creator', 'game'], 'Home & DIY Influencer': ['creator', 'house'], 'Automotive Influencer': ['creator', 'car'], 'Local / City Influencer': ['creator', 'city'],
  'Business Consultant': ['adviser', 'shop'], 'Financial Consultant': ['adviser', 'loan'], 'Investment Consultant': ['adviser', 'chart'], 'CA Consultancy': ['adviser', 'calculator'], 'Architect Consultation': ['adviser', 'house'], 'Career Consultant': ['adviser', 'books'], 'Legal Consultant': ['adviser', 'scales'], 'Healthcare Consultancy': ['adviser', 'medical'], 'Agriculture Consultancy': ['adviser', 'plant'], 'Cybersecurity & Safety Consultancy': ['adviser', 'shield'],
  'Tempo Service': ['truck'], 'Tour & Travel': ['travel'], 'Goods Transportation': ['moving'], 'Vehicle Transportation': ['tow', 'car'], 'Courier Service': ['parcel'], 'Loading & Unloading Labour': ['boxes', 'trolley'], 'Towing Service': ['tow'],
  'Request Blood': ['blood'], 'Find Blood Bank': ['medical', 'blood'], 'Become a Donor': ['person', 'blood'], 'Emergency Information': ['medical', 'document'],
  'Tap repair': ['plumber'], 'Leakage repair': ['pipe'], 'Basin installation': ['basin'], 'Drain cleaning': ['pipe', 'cleaning'],
  'AC Repair': ['ac'], 'Electrician Visit': ['electrician'], 'Painting Service': ['painting'],
};

export function artworkFor(name) { return artwork[name] || ['toolkit']; }
