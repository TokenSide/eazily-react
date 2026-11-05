import termsContent from './documents/influencer-terms-2026-09-12.txt?raw';
import privacyContent from './documents/influencer-privacy-2026-09-12.txt?raw';

export const INFLUENCER_LEGAL_VERSION = '2026-09-12';

export const influencerLegalDocuments = Object.freeze({
  terms: Object.freeze({
    key: 'terms',
    documentId: 'eazily-influencer-provider-terms',
    version: INFLUENCER_LEGAL_VERSION,
    title: 'Influencer Terms & Conditions',
    effectiveDate: '12 September 2026',
    lastUpdated: '12 September 2026',
    content: termsContent,
  }),
  privacy: Object.freeze({
    key: 'privacy',
    documentId: 'eazily-influencer-provider-privacy-policy',
    version: INFLUENCER_LEGAL_VERSION,
    title: 'Influencer Privacy Policy',
    effectiveDate: '12 September 2026',
    lastUpdated: '12 September 2026',
    content: privacyContent,
  }),
});

export const influencerTerms = influencerLegalDocuments.terms;
export const influencerPrivacy = influencerLegalDocuments.privacy;
