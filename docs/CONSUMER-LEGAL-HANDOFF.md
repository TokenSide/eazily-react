# Consumer policies: local implementation, publication blocked

Both supplied documents remain unpublished drafts. No missing wording, entity details, or feature claims were invented. No deployment, remote database change, provider activation, or billing enablement was performed.

## Source review and exact unresolved endings

The original attachment is archived at `docs/consumer-legal-source-2026-09-20.txt`. Split app documents preserve the source wording, punctuation, and spelling. Only the user's introductory/separator/trailing instructions and outer whitespace were excluded. The privacy document's `EASILY` heading was retained from the separator line.

**Terms §33 — SERVICE QUALITY** ends with this list:

> Will be available;
> Will be provided on time;
> Will meet every expectation;
> Will be error-free;
> Will achieve a particular.

The last item is grammatically incomplete. Supply the remainder of that item, the complete ending of §33, and any intended subsequent sections through the end of the Terms. The attachment does not establish the intended number or content of later sections.

**Privacy §34 — LOAN AND FINANCIAL PRIVACY** ends with exactly:

> The relevant financial institution may independently collect and process additional information under its own privacy policy

This last line has no terminal punctuation. Unlike the Terms fragment, it could be a complete sentence, so code review cannot establish whether more words were intended. The document owner must confirm or supply its continuation, complete §34, and provide any remaining sections and closing material. Privacy §24 also refers to “the contact information below,” but the supplied document contains no such contact block.

The source has **92** occurrences of `Easily`, **4** of `EASILY`, and **0** of `Eazily`. The app's brand is Eazily. Consistent replacement with `Eazily`/`EAZILY` is proposed for approval, not applied to the source drafts. Terms §§1/3 and Privacy §1 also describe use/browsing as agreement or acknowledgment; that wording needs review against the explicit two-checkbox process implemented here. Browsing and phone entry never create consent events.

Both source documents say effective/last updated **20 September 2026**. Those dates are displayed as supplied; they are not treated as approval or publication dates.

## Legal operator verification: unresolved

The attachment identifies **United Crew**, but it does not provide an entity type, registration identifier, registered address, or official identity source. The previous Consultant source says the same; the older Influencer policies still contain `[UNRESOLVED: Full legal company name]`. These are supplied assertions, not independent identity verification.

A targeted public search for Eazily/Easily with United Crew did not establish an authoritative connection to a registered legal operator. No unrelated namesake was treated as evidence. The user was asked for the exact registered name, entity type, registration identifier, official address, or an official registry link. Until supplied and verified, **United Crew must not be represented as a verified legal entity**. The draft retains its wording with a visible operator-review notice.

## Feature claims requiring legal/product review

This is a repository capability review, not a statement that hosted services are operational. Remote configuration was not inspected or changed.

| Source provisions | Repository evidence | Review needed before approval |
| --- | --- | --- |
| Terms §§6, 15–21; Privacy §§11, 16.1, 18.2: payments, fees, refunds | `src/services/paymentCheckout.js`, `supabase/seller_gateway.sql`, `supabase/functions/seller-create-payment/index.ts`: payment requests/quotes and provider integration exist, but checkout defaults off and the Edge financial-provider flag must be explicitly enabled. Saved payment-method setup is disabled in Profile. | Confirm actual payment methods/providers, launch configuration, fee disclosures, refund channels and cancellation rules. Do not imply working checkout, instant refunds, or saved-card functionality merely from prepared code. Nothing was enabled. |
| Terms §13; Privacy §§9, 34: lenders, credit processing, financial partners | `RequestSheet.jsx` collects loan-enquiry details and a separate purpose-specific data checkbox. `experience.sql` stores the request and loan outbox. The UI says workbook connection is pending configuration; automation/provider defaults are disabled. | Identify actual lenders/recipients and data transfer mechanisms. No functioning lending decision, credit-bureau integration, disbursement, or lender API was established. General policy acknowledgment does not replace the loan-specific consent. |
| Terms §10; Privacy §§4–5, 18.1, 23, 33: transport fares, rides, driver/passenger data, safety | `RequestSheet.jsx` uses callback enquiries, pickup/drop and mandatory BHK shipment size, with optional passenger/vehicle or parcel fields for some categories. `submit_request` validates logistics data and queues an outbox item. | Review descriptions of point-to-point/airport rides, fare calculation, waiting/toll charges, driver dispatch, trip tracking, vehicle compliance, lost property and transport safety. A callback form does not establish those operational capabilities. |
| Terms §11; Privacy §§8, 25, 32: donor discovery, blood-bank/hospital connections and disclosure | Blood-request/donor forms and emergency guidance exist. `Find Blood Bank` explicitly says `No live directory connected`. | Confirm donor/hospital recipients, sharing rules, notifications, medical coordination and public visibility before describing them as available. No screening, matching, inventory or live blood-bank connection was established. |
| Terms §§25–26, 32; Privacy §§14, 18: communications and sharing | Chat, participant RLS, private attachments, booking projections, support tickets and Supabase storage are implemented. Background messaging adapters/automation need separate setup. | Approve the recipient/vendor inventory, deployment regions, actual data fields and access rules. Prepared infrastructure does not verify every claimed analytics, fraud, messaging or verification provider. |
| Privacy §§12–13, 22: telemetry, cookies/SDKs/pixels and analytics | Local/session storage, Supabase session handling and app preferences exist. The dependency list does not establish a deployed advertising-pixel or analytics-provider integration. | Confirm actual instrumentation, collected device identifiers, logs, retention and any marketing tracking. Do not imply all listed technologies are installed. |
| Privacy §§4, 23: location and safety features | Customer address/location controls use browser geolocation; manual entries remain possible. No continuous trip tracking or operational location-based emergency system was established. | Confirm the precise location collection, retention, recipient and safety-feature statements. |
| Privacy §§19, 24, 26–31: retention, children, cross-border processing, rights, deletion, marketing | Account/profile changes, notification preferences and support tickets exist. Support contact details may be pending configuration. A complete self-service account-deletion/portability/rights workflow and actual cross-border safeguards are not established by the supplied source. | Supply contact/grievance details, approved retention schedules, deletion/rights procedures, marketing opt-out delivery behavior, age rules and actual hosting/transfer arrangements. |

The source's conditional “may” wording is preserved. This table flags decisions for the authorized reviewer; it does not rewrite their legal meaning.

## Implementation and preserved behavior

- Customer sign-in still verifies identity only. Public `/terms` and `/privacy`, sign-up links, and Profile → Legal remain accessible without consent or an authenticated session.
- Draft text is clearly marked and cannot be acknowledged. The existing Admin panel has a read-only Consumer draft review. No incomplete-document publish control was added.
- After both complete, approved, published documents become effective, a post-sign-in customer onboarding reminder requests separate Terms acceptance and Privacy acknowledgment. Both start unchecked. Customers can continue browsing and reading policies; the next authenticated transaction requires current acknowledgment.
- The shared transaction service presents a review dialog before service requests, partner bookings/free introductions, wallet redemption, payment requests, quote approval and referral claims. It never automatically repeats a transaction after acknowledgment; the user retries deliberately. Disputes, cancellations, support and history remain accessible through their existing authorization rules.
- The backend independently checks these operations. Booking table triggers also protect direct or secondary writes. The trusted checkout-preparation function rechecks the authenticated customer's supplied ID from the existing Edge authentication flow. Provider callbacks, refunds, completion and cancellation are not newly blocked by these Consumer policy gates.
- Draft-only or partially approved first release does **not** activate enforcement. A new draft does not replace an approved current policy. The latest approved effective version per document is used; future-effective versions do not activate early.
- Existing `legal_documents`, `consent_events`, ownership RLS and `admin_audit_events` are reused. Consumer consent is account-level (`partner_application_id` remains null), separate from partner registration history. Each event records `auth.uid()`, immutable database document ID, stable document key, version and server time. The caller cannot supply a customer ID or timestamp. Duplicate retries retain the original events and timestamps and do not add duplicate audit events.
- Approved document content and Consumer events are immutable; new versions require new acknowledgment. No previous customer, partner, booking, payment or consent rows are overwritten or deleted.
- Demo Mode remains its separate in-memory workspace. Local previews and page/phone interactions do not call the acceptance RPC; a real authenticated backend account is required. Existing demo tests also verify no network/storage operations in the demo model.

## Migration and release prerequisites

This task prepared local SQL only. Before any separately authorized release:

1. Obtain the complete Terms ending and the confirmed/completed Privacy ending, all intended later material, and the missing contact information. Approve wording, brand, actual operator identity, feature descriptions and final dates.
2. Reconcile the deployment's existing migration history. After **all existing** auth/partner/transaction migrations and `consultant_legal.sql`, apply `consumer_legal.sql`, then `consumer_legal_transactions.sql`, then `consumer_legal_drafts_2026_09_20.sql`. The two schema/transaction migrations run once; the unpublished draft seed is idempotent. The canonical historical manifest was not modified or used to deploy these new local files.
3. The transaction migration preserves original business logic under non-callable `consumer_legacy_*` functions and exposes guarded wrappers with matching signatures and original public roles. Do not later replay an old transaction migration over these wrappers. Add the new files/checksums to the authorized deployment ledger after release review.
4. Create **new versioned** complete rows under `eazily-consumer-terms` (`kind='terms'`) and `eazily-consumer-privacy-policy` (`kind='privacy_policy'`), `language='English'`. The reserved `2026-09-20-draft` version cannot be published. Keep drafts as source history.
5. The authorized publication process must set `consumer_complete`, `consumer_branding_approved`, `consumer_operator_verified`, and `consumer_features_reviewed` only after review, and supply the actual `consumer_operator_name`, `consumer_review_reference`, `consumer_approved_by` account, `consumer_approved_at` server approval time, final content/version/effective date and publication flag. These fields are explicit review evidence, not automated legal verification. Both documents must be approved/effective before enforcement starts.
6. Verify real Supabase sessions, grants/RLS, new and existing customer flows, current/stale versions, interruptions, and payment-disabled behavior in isolated staging. Coordinate backend and frontend release; the frontend expects the new status RPC. Obtain separate deployment authorization. This implementation does not enable billing or any provider.

## Changed files for this request

- `src/features/legal/ConsumerLegal.jsx` — public policy pages, sign-up links, Profile center and customer acknowledgment prompt.
- `src/features/legal/useConsumerLegal.js` — status loading, refresh and error handling.
- `src/features/legal/consumerDocuments.js` — draft metadata and notices.
- `src/features/legal/consumer-legal.css` — readable mobile documents and consent controls.
- `src/features/legal/documents/consumer-terms-2026-09-20-draft.txt`
- `src/features/legal/documents/consumer-privacy-2026-09-20-draft.txt`
- `src/services/consumerConsent.js` — status/acceptance API and transaction preflight.
- `src/services/experience.js` — shared preflight integration.
- `src/features/services/RoleMarketplace.jsx` — free introductions use the shared guarded RPC path.
- `src/auth/AuthScreen.jsx` — sign-up/sign-in policy links.
- `src/App.jsx` — public `/terms` and `/privacy` handling, including unauthenticated access.
- `src/pages/UserApp.jsx` — customer onboarding reminder and transaction review host.
- `src/features/account/ProfileDetails.jsx` — Consumer-specific Legal area, replacing the unfiltered partner/generic document list.
- `src/features/partners/PartnerAdmin.jsx` — read-only Consumer draft review.
- `supabase/consumer_legal.sql` — review metadata, immutable documents/events, account-level consent and audit, booking guards.
- `supabase/consumer_legal_transactions.sql` — guarded transaction wrappers and revoked legacy entry points.
- `supabase/consumer_legal_drafts_2026_09_20.sql` — exact unpublished draft seeds.
- `scripts/consumer-legal-test.cjs` — full canonical database sequence plus new Consumer migrations and security/behavior assertions.
- `scripts/consumer-legal-fixture.jsx` — isolated approved-version browser contract fixture, excluded from production builds.
- `scripts/consumer-legal-browser-test.cjs` — real public/sign-up/Profile pages and mocked approved-version UI at 360/390/430px.
- `package.json` — Consumer legal database/browser commands.
- `docs/consumer-legal-source-2026-09-20.txt` — original attachment archive.
- `docs/CONSUMER-LEGAL-HANDOFF.md` — source review, feature matrix, release blockers and test record.

## Verification

| Check | Result |
| --- | --- |
| `npm run test:consumer-legal` | PASS: canonical migration integration, source fidelity, draft/partial release inactivity, publication guards, caller identity, null/false/stale rejection, server times, deduplication/audit, immutable history, version changes, future dates, transaction gates, ownership isolation, existing cancellation/history and disabled billing |
| `npm run test:auth` | PASS: OTP/configuration/session/account restrictions; no remote Auth or SMS |
| `npm run test:database` | PASS: existing customer requests, ownership/RLS, idempotency, wallet and lead-outbox regressions |
| `npm run test:seller` | PASS: quotes, customer payment authorization, seller finance and cross-account restrictions |
| `npm run test:legal-assessment` | PASS: partner legal/assessment and Consultant acknowledgment regressions |
| `npm run test:consultant-legal` | PASS: existing Consultant draft and secure-consent behavior |
| `npm run test:catalog` | PASS: 70 customer services and mappings |
| `node scripts/partner-demo-model-test.cjs` | PASS: isolated state, supported transitions, no network/storage operations and production Demo Mode gate |
| `npm run test:smoke` | PASS: existing customer routing, guest/auth behavior, Profile layout, mobile widths, service selection and back/scroll behavior |
| `npm run test:consumer-legal:browser` | PASS: real public policy, sign-up and guest Profile pages; 360/390/430px document readability/no overflow; unchecked disabled drafts; approved-version mock verifies separate checks, transaction prompt, no automatic replay, re-acknowledgment, stale/error recovery; no external requests |
| `npm run lint` | PASS: no warnings/errors |
| `npm run build` | PASS: production build with Supabase explicitly disabled for local browser tests; fixture excluded |

Browser screenshots are under `.tmp/consumer-legal-browser-*`. Build and headless Edge needed execution outside sandbox child-process restrictions; they remained local. Approved-consent behavior was tested in PostgreSQL-compatible PGlite and a mocked browser contract, not against hosted Supabase or a live payment provider. Mobile checks are emulated Edge viewports, not physical-device certification. Final document approval and operator verification remain outstanding.
