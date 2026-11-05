import { influencerCategories } from './influencerCategories.js';
import { consultantCategories } from './consultantCategories.js';

export const catalog = [
  {
    id: "manpower",
    label: "Services",
    title: "Local professionals and daily services",
    icon: "workers",
    groups: [
      {
        id: "home-property",
        label: "Home & Property",
        icon: "home",
        items: [
          "Electrician", "Plumber", "Carpenter", "Painter", "Tile Worker",
          "POP & False Ceiling", "Glass Worker", "Aluminium Worker",
          "Home Maintenance", "Key Maker", "Deep Cleaning", "Pest Control", "CCTV Technician", "AC Service",
        ],
      },
      {
        id: "vehicle",
        label: "Vehicle",
        icon: "car",
        items: [
          "Bike Mechanic", "Car Mechanic", "Heavy Vehicle Mechanic", "Battery Technician",
          "Vehicle Modification", "Towing Services", "Vehicle Driver", "Car Wash",
        ],
      },
      {
        id: "personal-daily",
        label: "Personal & Daily",
        icon: "person",
        items: ["Dry Cleaner", "Shoe Repair", "Cook", "Maid & House Help", "Laundry Service", "Tailor & Alterations", "Ironing Service"],
      },
      {
        id: "electronics",
        label: "Electronics",
        icon: "devices",
        items: [
          "Mobile Repair", "Computer Repair", "RO Technician", "Refrigerator Repair",
          "Washing Machine Repair", "Microwave/Oven Repair", "TV Repair", "CCTV Technician", "AC Service",
        ],
      },
      {
        id: "beauty",
        label: "Personal Care",
        icon: "sparkles",
        items: [
          "Women's Salon", "Men's Salon & Grooming", "Hair Services", "Makeup Artist",
          "Facial & Skin Care", "Waxing & Threading", "Manicure & Pedicure",
          "Spa & Massage", "Bridal Makeup", "Mehendi Artist",
        ],
      },
      {
        id: "wedding",
        label: "Wedding & Occasion",
        icon: "calendar",
        items: ["Photographer", "Videographer", "Decorator", "Caterer", "DJ & Music", "Stage Setup", "Band", "Tent House", "Event Manager"],
      },
      {
        id: "pet",
        label: "Pet Care",
        icon: "paw",
        items: ["Pet Grooming", "Pet Boarding", "Pet Walker", "Pet Training", "Pet Rescue", "Emergency Pet Support"],
      },
      {
        id: "other",
        label: "Other",
        icon: "grid",
        items: ["Packers & Movers", "Tempo Driver", "Loading Labour", "Courier", "Home Tutor", "Yoga Coach", "Personal Trainer"],
      },
    ],
  },
  {
    id: "loans",
    label: "Loans",
    title: "Compare and request suitable loan options",
    icon: "rupee",
    items: ["Personal Loan", "Business Loan", "Home Loan", "Vehicle Loan", "Loan Against Property", "Education Loan"],
  },
  {
    id: "influencers",
    label: "Influencers",
    title: "Find creators by category and audience size",
    icon: "megaphone",
    filter: ["All", "20K–100K", "100K–500K", "500K–1M", "1M+"],
    items: influencerCategories,
  },
  {
    id: "consultancy",
    label: "Consultancy",
    title: "Connect with verified professional consultants",
    icon: "briefcase",
    items: consultantCategories,
  },
  {
    id: "transportation",
    label: "Transportation",
    title: "Local and out-of-city logistics requests",
    icon: "truck",
    items: [
      "Packers & Movers", "Tempo Service", "Tour & Travel", "Goods Transportation",
      "Vehicle Transportation", "Courier Service", "Loading & Unloading Labour", "Towing Service",
    ],
  },
  {
    id: "blood-bank",
    label: "Blood Service",
    title: "Blood requests and voluntary donor support",
    icon: "drop",
    items: ["Request Blood", "Find Blood Bank", "Become a Donor", "Emergency Information"],
  },
];

export const searchAliases = {
  "POP & False Ceiling": ["pop", "ceiling"],
  "RO Technician": ["water purifier", "ro repair"],
  "Shoe Repair": ["shoe maker", "cobbler"],
  "Maid & House Help": ["house help", "maid", "sweeper", "household assistance"],
  "Tailor & Alterations": ["tailor", "clothing alteration"],
  "Ironing Service": ["ironing", "clothes press"],
  "Refrigerator Repair": ["fridge repair", "appliance repair"],
  "Washing Machine Repair": ["washer repair", "appliance repair"],
  "Microwave/Oven Repair": ["microwave repair", "oven repair", "appliance repair"],
  "TV Repair": ["television repair", "technical electronics"],
  "Women's Salon": ["salon at home", "women salon"],
  "Men's Salon & Grooming": ["grooming", "men salon"],
  "Hair Services": ["hair care", "haircut"],
  "Facial & Skin Care": ["facial", "skin care"],
  "Waxing & Threading": ["waxing", "threading"],
  "Manicure & Pedicure": ["nail care", "manicure", "pedicure"],
  "Spa & Massage": ["spa", "massage"],
  "Bridal Makeup": ["wedding makeup", "bridal beauty"],
  "Packers & Movers": ["shifting", "moving", "1 bhk", "2 bhk", "3 bhk"],
  "Tempo Service": ["mini truck", "delivery vehicle"],
  "CA Consultancy": ["tax", "gst", "accountant"],
  "Request Blood": ["blood donor", "urgent blood"],
};

// Old labels remain resolvable for historical posts and deep links. New records use
// the canonical labels above; no existing database row is rewritten by this map.
export const legacyServiceNames = Object.freeze({
  "Shoe Maker": "Shoe Repair",
  "House Help": "Maid & House Help",
  "Salon at Home": "Women's Salon",
  "Grooming": "Men's Salon & Grooming",
  "Hair Care": "Hair Services",
});

export function canonicalCatalogService(name) {
  return legacyServiceNames[name] ?? name;
}

export function catalogServiceNames(name) {
  const canonical = canonicalCatalogService(name);
  return [canonical, ...Object.entries(legacyServiceNames)
    .filter(([, current]) => current === canonical)
    .map(([legacy]) => legacy)];
}

export function createSearchIndex() {
  return catalog.flatMap((main) => {
    const root = [{ name: main.label, path: main.label, mainId: main.id }];
    const grouped = (main.groups ?? []).flatMap((group) => [
      { name: group.label, path: `${main.label} → ${group.label}`, mainId: main.id, groupId: group.id },
      ...group.items.map((name) => ({
        name,
        path: `${main.label} → ${group.label} → ${name}`,
        mainId: main.id,
        groupId: group.id,
        aliases: searchAliases[name] ?? [],
      })),
    ]);
    const direct = (main.items ?? []).map((name) => ({
      name,
      path: `${main.label} → ${name}`,
      mainId: main.id,
      aliases: searchAliases[name] ?? [],
    }));
    return [...root, ...grouped, ...direct];
  });
}
