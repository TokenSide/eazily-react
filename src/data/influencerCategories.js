// The customer catalogue, creator registration and posting share this list.
export const influencerCategories = Object.freeze([
  'Lifestyle Influencer', 'Tech Influencer', 'Education Influencer',
  'Business & Finance Influencer', 'Fitness & Health Influencer',
  'Food & Travel Influencer', 'Gaming Influencer', 'Home & DIY Influencer',
  'Automobile Influencer', 'Real Estate Influencer', 'Entertainment Influencer',
  'Motivational Influencer', 'Political Influencer', 'News & Media Influencer',
  'Religious & Spiritual Influencer', 'Crafts Influencer',
  'Photography Influencer', 'Pet Influencer', 'Environmental Influencer',
  'Book & Literature Influencer',
]);

// Display/search aliases only. Existing stored applications and posts are not rewritten.
const legacyCategories = Object.freeze({
  'Fashion & Beauty Influencer': 'Lifestyle Influencer',
  'Fashion Influencers': 'Lifestyle Influencer',
  'Beauty Influencers': 'Lifestyle Influencer',
  'Parenting Influencers': 'Lifestyle Influencer',
  'Family Influencers': 'Lifestyle Influencer',
  'Parenting & Kids Influencers': 'Lifestyle Influencer',
  'Community Influencers': 'Lifestyle Influencer',
  'Virtual Influencers': 'Tech Influencer',
  'Creator/Educator Influencers': 'Education Influencer',
  'Professional/Industry Influencers': 'Business & Finance Influencer',
  'Business Influencers': 'Business & Finance Influencer',
  'Finance Influencers': 'Business & Finance Influencer',
  'Fitness Influencers': 'Fitness & Health Influencer',
  'Sports Influencers': 'Fitness & Health Influencer',
  'Food Influencers': 'Food & Travel Influencer',
  'Travel Influencers': 'Food & Travel Influencer',
  'Food & Lifestyle': 'Food & Travel Influencer',
  'Home & Interior Influencers': 'Home & DIY Influencer',
  'Automotive Influencer': 'Automobile Influencer',
  'Real Estate Influencers': 'Real Estate Influencer',
  'Entertainment Influencers': 'Entertainment Influencer',
  'Music Influencers': 'Entertainment Influencer',
  'Comedy Influencers': 'Entertainment Influencer',
  'Motivational Influencers': 'Motivational Influencer',
  'Political & Current Affairs Influencers': 'Political Influencer',
  'News & Media Influencers': 'News & Media Influencer',
  'Religious & Spiritual Influencers': 'Religious & Spiritual Influencer',
  'DIY & Crafts Influencers': 'Crafts Influencer',
  'Photography Influencers': 'Photography Influencer',
  'Pet Influencers': 'Pet Influencer',
  'Environmental & Sustainability Influencers': 'Environmental Influencer',
  'Book & Literature Influencers': 'Book & Literature Influencer',
});

export function displayInfluencerCategory(value) {
  return legacyCategories[value] || value || '';
}

export function influencerCategorySearchNames(category) {
  return [category, ...Object.keys(legacyCategories).filter(old => legacyCategories[old] === category)];
}
