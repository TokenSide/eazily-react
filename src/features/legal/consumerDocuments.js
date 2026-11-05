import terms from './documents/consumer-terms-2026-09-20-draft.txt?raw';
import privacy from './documents/consumer-privacy-2026-09-20-draft.txt?raw';

export const consumerDraftNotice = 'Draft — not approved for acceptance. The endings, Easily/Eazily branding, legal operator and feature descriptions need confirmation.';
export const consumerDrafts = [
  { document_key: 'eazily-consumer-terms', title: 'Consumer Terms & Conditions', kind: 'terms', content: terms },
  { document_key: 'eazily-consumer-privacy-policy', title: 'Consumer Privacy Policy', kind: 'privacy_policy', content: privacy },
].map(doc => ({ ...doc, version: '2026-09-20-draft', published: false }));
