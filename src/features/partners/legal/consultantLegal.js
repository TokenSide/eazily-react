import terms from './documents/consultant-terms-2026-09-20-draft.txt?raw';
import privacy from './documents/consultant-privacy-2026-09-20-draft.txt?raw';

export const consultantDrafts = [
  { key: 'terms', document_key: 'eazily-consultant-provider-terms', title: 'Consultant Terms & Conditions', content: terms },
  { key: 'privacy', document_key: 'eazily-consultant-provider-privacy-policy', title: 'Consultant Privacy Policy', content: privacy },
].map(document => ({ ...document, version: '2026-09-20-draft', published: false }));

export const consultantDraftNotice = 'Incomplete draft — not available for acceptance. Terms section 33.5 and Privacy section 42 are cut off. The source uses “Easily”; approval of the product name “Eazily” is pending.';
