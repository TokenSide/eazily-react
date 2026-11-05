const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

(async () => {
  const { INFLUENCER_FOLLOWER_FILTERS, matchesFollowerFilter } = await import('../src/lib/influencerFollowers.js');
  assert.deepEqual(INFLUENCER_FOLLOWER_FILTERS, ['All', '20K–100K', '100K–500K', '500K–1M', '1M+']);
  const provider = count => ({ profile_details: { platforms: [{ name: 'Instagram', count }] } });
  const cases = [
    [19_999, 'All'],
    [20_000, '20K–100K'],
    [99_999, '20K–100K'],
    [100_000, '100K–500K'],
    [499_999, '100K–500K'],
    [500_000, '500K–1M'],
    [999_999, '500K–1M'],
    [1_000_000, '1M+'],
  ];
  for (const [count, expected] of cases) {
    const matches = INFLUENCER_FOLLOWER_FILTERS.filter(filter => filter !== 'All' && matchesFollowerFilter(provider(count), filter));
    assert.deepEqual(matches, expected === 'All' ? [] : [expected], `${count} belongs to one tier`);
    assert.equal(matchesFollowerFilter(provider(count), 'All'), true, `All includes ${count}`);
  }

  const service = readFileSync('src/features/services/ServiceExperience.jsx', 'utf8');
  const roles = readFileSync('src/features/services/RoleMarketplace.jsx', 'utf8');
  for (const source of [service, roles]) {
    assert.ok(source.lastIndexOf('Customer Reviews') < source.lastIndexOf('Share this experience with your loved ones'), 'Reviews precede final share section');
    assert.ok(source.includes('Copy Link'), 'Copy Link remains available');
  }
  const promises = readFileSync('src/data/userExperience.js', 'utf8');
  assert.ok(promises.includes('Verified professionals.'));
  assert.ok(!/trained and verified|trained:/i.test(promises));

  const shell = readFileSync('src/lib/nativeShell.js', 'utf8');
  assert.ok(shell.includes("addListener('backButton'"), 'Native Android back listener exists');
  const nativeHandler = shell.slice(shell.indexOf("addListener('backButton'"));
  assert.ok(nativeHandler.indexOf('[role="dialog"]') < nativeHandler.indexOf('requestInAppBack()'), 'Native back closes a dialog before route navigation');
  assert.ok(shell.includes("confirm('Exit Eazily?')"), 'Dashboard roots ask before exiting');

  const styles = readFileSync('src/partner.css', 'utf8');
  for (const name of ['top', 'right', 'bottom', 'left']) assert.ok(styles.includes(`--eazily-safe-${name}`));
  assert.ok(styles.includes('var(--safe-area-inset-top, 0px)'), 'Capacitor safe-area variable is consumed');
  console.log('PASS: follower boundaries, promise copy, detail order/actions, Android back priority, exit confirmation, and four-edge safe-area wiring.');
})().catch(error => { console.error(error); process.exitCode = 1; });
