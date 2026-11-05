# Consultant policies — implementation and release hold

Status: implemented locally; both supplied documents remain incomplete, unpublished drafts. No production data, billing settings, or deployment was changed. Database checks use disposable in-memory PGlite databases. Browser checks use local Vite with Supabase disabled and development-only OTP fixtures.

## Source findings requiring the document owner's response

The complete supplied attachment is archived in `docs/consultant-legal-source-2026-09-20.txt`. The app's draft documents preserve its wording and punctuation, including **Easily**; only the introductory instruction, the separator instruction, and outer whitespace were excluded from the split documents.

- Terms §33, **CONSUMER COMPLAINTS**, stops at exactly: `33.5 Platform administrative actio`
- Privacy §42, **CONSULTANT'S PROFESSIONAL OBLIGATIONS**, stops at exactly: `Consultants are independently responsible for complying with laws and profes`
- Supply the remainder of those sentences, the remainder of each section, and every subsequent section through the intended end of each document. The attachment does not establish how many later sections exist. None have been invented.
- There are 84 occurrences of **Easily** and two of **EASILY**, with zero occurrences of **Eazily** in the source. The app uses **Eazily**. Proposed correction: use **Eazily/EAZILY** consistently after explicit document-owner approval. The preview banner identifies this discrepancy; source wording has not silently changed.
- Both source dates say 20 September 2026. These are displayed as supplied, not treated as approval or publication. Confirm final effective and last-updated dates when the complete text is approved. The source identifies the operator as United Crew; this implementation does not assert legal validation of the supplied text.

## Existing patterns inspected and reused

Consultants use the shared six-step `PartnerOnboarding`, `ConsultantAssessment`, and `save_partner_application` RPC. Private identity/qualification uploads remain in the existing authenticated `partner-media` account/role/document paths; no document upload or account data migration was introduced.

The existing `legal_documents` table and `consent_events` ledger, ownership RLS, security-definer RPC pattern, `LegalDocument` renderer, mobile `Sheet`, Partner Profile Legal entry, and Partner Admin panel are reused. Admin now has a read-only draft preview and explicit publication hold. There is no publish button for these incomplete drafts.

## Behavior

- Final onboarding review and Consultant workspace/Profile Legal show readable Terms and Privacy screens. Each draft is prominently labeled as incomplete and unavailable for acceptance.
- Separate Terms acceptance and Privacy acknowledgment begin unchecked. Draft controls are disabled. Reading a policy never checks a box. Once two approved effective documents exist, authenticated consultants can explicitly acknowledge both; onboarding submission is disabled until their current consent is confirmed.
- The RPC derives the account from `auth.uid()`, verifies application ownership and role, validates both submitted database document IDs and versions against the current approved pair, and records two events with server timestamps and immutable document references. Retries preserve the original events and timestamps. No client date is accepted for these policy events.
- Approved documents and Consultant policy events are immutable. A new approved, effective version requires renewed acknowledgment; prior records remain. Future-effective versions do not activate early. An API error fails closed, and stale-version submissions are rejected with a refresh instruction.
- Database triggers independently prevent onboarding submission/approval, offering submission/publication, new bookings, and acceptance of requested bookings without current policies. Existing account/application states, appointments, and historical consent rows are not rewritten. Existing appointment completion/cancellation and offer pausing remain possible; account, history, and support access are preserved.
- The existing generic registration consent row is retained for backward compatibility; it does not satisfy the new Consultant policy checks. These use the two separately recorded policy events with server times.
- Demo Mode retains its separate component and in-memory model; it does not mount these real consent controls or write real consent records. Local onboarding previews also cannot record real consent.

## Before any live release

1. Obtain the complete Terms and Privacy texts and approval of the product-name correction, dates, and final wording from the authorized document owner/reviewer.
2. Keep `2026-09-20-draft` as source history. Create new uniquely versioned records for the complete, approved texts; do not modify an accepted version or attempt to publish the reserved draft version.
3. In a separately authorized release, apply `supabase/consultant_legal.sql` **after all existing partner migrations**, including `influencer_legal_2026_09_12.sql`, `consultant_assessments.sql`, and Service Partner migrations. Then apply `supabase/consultant_legal_drafts_2026_09_20.sql` for the unpublished archive. The seed is idempotent; the schema migration is intended to run once through the normal migration process.
4. An authorized database/Admin release process must supply the approved complete document rows using the exact document keys below, `language='English'`, correct `kind`, a new version, final content, effective date, `consultant_complete=true`, the actual reviewer account in `consultant_approved_by`, and the approval timestamp in `consultant_approved_at`. Publish only after approval. UI does not infer approval or offer a one-click override. Both documents must be approved and effective for onboarding or new service offers to proceed.
5. Verify real Supabase authentication/RLS and the approved-version mobile flow in isolated staging, then obtain deployment authorization. This task did not deploy or publish. Until policies are ready, applying these gates would intentionally block new Consultant onboarding/work; coordinate the eventual application and database release.

Document keys: `eazily-consultant-provider-terms` and `eazily-consultant-provider-privacy-policy`.

## Changed files

- `src/features/partners/legal/ConsultantLegal.jsx` — policy screens, version-aware checks, separate explicit controls and consent history.
- `src/features/partners/legal/consultantLegal.js` — draft metadata and release-hold explanation.
- `src/features/partners/legal/documents/consultant-terms-2026-09-20-draft.txt`
- `src/features/partners/legal/documents/consultant-privacy-2026-09-20-draft.txt`
- `src/features/partners/legal/influencer-legal.css` — shared mobile styling additions scoped to Consultant screens.
- `src/features/partners/PartnerOnboarding.jsx` — final-review policies and fresh server eligibility check before submission.
- `src/pages/PartnerApp.jsx` — Consultant workspace notice, work eligibility and Profile Legal entry.
- `src/features/partners/PartnerAdmin.jsx` — read-only review of blocked drafts.
- `supabase/consultant_legal.sql` — consent RPCs, document approval safeguards, append-only history and server work gates.
- `supabase/consultant_legal_drafts_2026_09_20.sql` — exact unpublished source text.
- `scripts/consultant-legal-test.cjs` — ownership, RLS, versioning, preservation and negative-path database tests.
- `scripts/legal-assessment-test.cjs` — assessment and policy-gate integration.
- `scripts/legal-assessment-browser-test.cjs` — current OTP controls, onboarding draft checks and 320/390px checks. Removed obsolete assumptions that saving a local draft grants a workspace.
- `package.json` — Consultant legal and legal-browser test commands.
- `docs/consultant-legal-source-2026-09-20.txt` — original attachment archive.
- `docs/CONSULTANT-LEGAL-HANDOFF.md` — this handoff.

## Verification

- `npm run test:consultant-legal`: passed. Draft fidelity/idempotent seed; draft RLS and publication rejection; missing, false, null and stale consent rejection; account isolation; server timestamps; retry idempotency; immutable history; version change/future-effective behavior; service gating; existing records preserved.
- `npm run test:legal-assessment`: passed. Existing Influencer/Consultant assessment regressions plus policy gating after passing an assessment and submission after both current policies are acknowledged.
- `npm run test:database`: passed.
- `npm run test:seller`: passed.
- `npm run test:service-registration`: passed.
- `node scripts/partner-demo-model-test.cjs`: passed, including no network/storage operations and production Demo Mode gate.
- `npm run lint`: passed.
- `npm run build`: passed. Local esbuild required execution outside sandbox process restrictions.
- `npm run test:legal:browser`: passed against isolated local Vite in headless Edge, at 390×844 and 320×740. Terms has 33 numbered headings; Privacy has 42. Draft controls stay disabled and unchecked; reading does not imply consent; no horizontal document overflow or uncaught runtime exceptions. Browser screenshots are saved under `.tmp/legal-assessment-browser-*`.

Limits: approved-version consent writes were verified in local PostgreSQL-compatible tests, not against live Supabase. Mobile checks use browser emulation, not a physical Android/iOS device. Full production/legal approval remains outstanding.
