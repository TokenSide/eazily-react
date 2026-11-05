export const INFLUENCER_FOLLOWER_FILTERS = ['All', '20K–100K', '100K–500K', '500K–1M', '1M+'];

export function influencerFollowerCount(provider) {
  const platforms = provider?.profile_details?.platforms || provider?.details?.platforms || provider?.platforms || [];
  const counts = platforms.map(item => Number(item.count || item.followers || 0)).filter(Number.isFinite);
  return Math.max(Number(provider?.follower_count || 0), ...counts, 0);
}

export function matchesFollowerFilter(provider, filter) {
  if (filter === 'All') return true;
  const count = influencerFollowerCount(provider);
  if (filter === '20K–100K') return count >= 20_000 && count < 100_000;
  if (filter === '100K–500K') return count >= 100_000 && count < 500_000;
  if (filter === '500K–1M') return count >= 500_000 && count < 1_000_000;
  return filter === '1M+' && count >= 1_000_000;
}
