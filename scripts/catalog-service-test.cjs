const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');

(async () => {
  const { catalog, canonicalCatalogService, catalogServiceNames } = await import('../src/data/catalog.js');
  const { topServices, popularServices } = await import('../src/data/userExperience.js');
  const { artworkFor, assetById } = await import('../src/features/user-art/artwork.js');
  const groups = catalog.find(entry => entry.id === 'manpower').groups;
  const group = id => groups.find(entry => entry.id === id);

  assert.equal(groups.length, 8, 'The eight customer service groups remain intact');
  assert.deepEqual(group('vehicle').items, ['Bike Mechanic', 'Car Mechanic', 'Heavy Vehicle Mechanic', 'Battery Technician', 'Vehicle Modification', 'Towing Services', 'Vehicle Driver', 'Car Wash']);
  assert.ok(group('home-property').items.includes('Key Maker'));
  assert.ok(!group('personal-daily').items.includes('Key Maker'));
  assert.deepEqual(group('personal-daily').items, ['Dry Cleaner', 'Shoe Repair', 'Cook', 'Maid & House Help', 'Laundry Service', 'Tailor & Alterations', 'Ironing Service']);
  assert.deepEqual(group('electronics').items, ['Mobile Repair', 'Computer Repair', 'RO Technician', 'Refrigerator Repair', 'Washing Machine Repair', 'Microwave/Oven Repair', 'TV Repair', 'CCTV Technician', 'AC Service']);
  assert.deepEqual(group('beauty').items, ["Women's Salon", "Men's Salon & Grooming", 'Hair Services', 'Makeup Artist', 'Facial & Skin Care', 'Waxing & Threading', 'Manicure & Pedicure', 'Spa & Massage', 'Bridal Makeup', 'Mehendi Artist']);

  const visible = groups.flatMap(entry => entry.items);
  for (const removed of ['Tour & Travel Services', 'Shoe Maker', 'House Help', 'Technical Electronics', 'Appliance Repair', 'Salon at Home', 'Hair Care', 'Grooming']) {
    assert.ok(!visible.includes(removed), `${removed} is not a duplicate customer tile`);
  }
  for (const [oldName, current] of [['Shoe Maker', 'Shoe Repair'], ['House Help', 'Maid & House Help'], ['Salon at Home', "Women's Salon"], ['Hair Care', 'Hair Services'], ['Grooming', "Men's Salon & Grooming"]]) {
    assert.equal(canonicalCatalogService(oldName), current);
    assert.ok(catalogServiceNames(current).includes(oldName));
  }

  for (const name of visible) {
    const asset = assetById[artworkFor(name)[0]];
    assert.ok(asset && existsSync(`public${asset}`), `Mapped image exists for ${name}`);
  }
  assert.equal(artworkFor('Refrigerator Repair')[0], 'refrigerator-repair');
  assert.equal(artworkFor('Washing Machine Repair')[0], 'washer');
  assert.equal(artworkFor('Microwave/Oven Repair')[0], 'microwave-repair');
  assert.equal(artworkFor('TV Repair')[0], 'tv-repair');
  assert.ok(topServices.some(service => service.requestName === 'Washing Machine Repair'));
  assert.ok(!topServices.some(service => service.requestName === 'Appliance Repair'));
  assert.deepEqual(popularServices.map(service => service.name), ['AC Service', 'Deep Cleaning', 'Electrician', 'Painter']);

  const sql = readFileSync('supabase/service_catalog_2026_09_20.sql', 'utf8');
  for (const name of ['Key Maker', 'Shoe Repair', 'Maid & House Help', 'Refrigerator Repair', 'Washing Machine Repair', 'Microwave/Oven Repair', 'TV Repair', "Women''s Salon", "Men''s Salon & Grooming", 'Spa & Massage']) assert.ok(sql.includes(name), `Server validator contains ${name}`);
  const manifest = JSON.parse(readFileSync('supabase/migration-manifest.json', 'utf8'));
  const migration = manifest.migrations.find(entry => entry.file === 'service_catalog_2026_09_20.sql');
  assert.equal(migration.file, 'service_catalog_2026_09_20.sql');
  assert.equal(migration.sha256, createHash('sha256').update(readFileSync(`supabase/${migration.file}`)).digest('hex'));
  console.log(`PASS ${visible.length} customer services, aliases, homepage mappings, local artwork and append-only validator migration.`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
