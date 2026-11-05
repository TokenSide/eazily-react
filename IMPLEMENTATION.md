# September service-navigation update

## Service Partner three-step posting

Service Partner posting now uses `src/features/partners/ServicePostForm.jsx` and `service-posting.css`. It has exactly three mobile steps: registered service selection, the partner's own charges, then optional work media and a partner-only preview. It reuses the category/service IDs, business, location, service areas, work place and schedule stored during registration. It does not ask for those fields again and it does not display customer markup, commission, GST calculations or platform earnings. The first photo uses the existing private upload flow; extra photos/video stay collapsed. When no photo exists, the existing category artwork is explicitly labelled as a service illustration.

`ServicePostList.jsx` supplies Service-only My Services cards with Live, Paused, Draft and Pending labels, Edit, Duplicate, Archive and Pause/Resume. The Service dashboard includes the requested first-service message and `+ Add Service / Service Jodein` entry. Influencer and Consultant composers, the customer application, registration, booking screens and global Online/Offline behavior are unchanged.

`service_partner_posting.sql` is the dedicated backend migration. Apply it as step 18, after `service_partner_registration.sql` and the complete seller sequence. It derives the exact category/service pair from the authenticated partner's registration, derives area/work-place data rather than trusting the browser, keeps incomplete drafts, converts an unapproved final submission to a draft, sends approved submissions to the existing moderation queue, validates media through the existing hardening trigger, and audits every mutation. Stable post IDs prevent duplicate submit retries; a separate owner-bound operation key makes Duplicate idempotent. Resume is allowed only for a previously published service and still passes the existing approval/subscription/post checks. Shop-only profiles always store a zero visiting charge. No SQL has been deployed.

Run `npm run test:service-posting` for the in-memory database checks and `npm run test:service-posting:browser` while Vite is running for the 360/390/430px flow and screenshots. Existing final quote versions remain immutable under `test:seller`, so changing a listing does not rewrite an already agreed quote. A hosted Supabase deployment must already have Auth, `partner-media` Storage policies, the pricing configuration, subscriptions and moderation functions installed. Production Storage/JWT behavior, real moderation and customer booking were not invoked locally.

## Service Partner six-step registration

Service Partner / Shopkeeper registration is isolated in `src/features/partners/ServicePartnerOnboarding.jsx` and has exactly six stages: personal details, shop details, multi-category services, work preferences, typed bank details, then all document/photo uploads plus the review and agreement. It uses the existing catalogue category IDs and service names, the green role colour, existing private `partner-media` bucket, existing dashboard route, and existing Create Service flow. Service registration has no interview, assessment, score, posting, pricing, payment, subscription purchase, or automatic Online state. Local testing can save a session draft but cannot fake OTP, upload confirmation, submission, approval, or dashboard privileges; Demo Mode remains the safe dashboard preview.

Every Service Partner registration stage has a local `Testing only` / `Skip for now` control. It is governed by `VITE_ENABLE_SERVICE_REGISTRATION_TEST_SKIP` in `serviceRegistrationConfig.js`, requires a Vite development build, and is additionally hidden whenever Supabase is configured. Intermediate skips save only the local draft and move one page forward. Skipping the final page opens a clearly marked local dashboard preview with `registrationStatus: skipped_for_testing`; it records no consent, verification, approval or server write, and live availability remains disabled. Production builds ignore browser storage, query parameters and a true environment value because `import.meta.env.DEV` must also be true. Set the flag to `false` to hide it locally.

`service_partner_registration.sql` adds the dedicated idempotent submission RPC and database triggers. It derives the phone from Supabase Auth, validates the six-step fields/catalogue, accepts only confirmed owner-scoped private uploads with supported MIME types, keeps the application pending for human verification, records both policy versions with database `now()`, audits submission without bank/document contents, redacts sensitive Service Partner fields from future admin-review audit rows, and rejects submission through the older generic RPC. It requires `seller_subscriptions_v2.sql`; the migration refuses to install if the old submission-based trial trigger is still active. The existing 60-day trial therefore continues to start only when the application is actually approved.

The exact Service Partner Terms and Privacy Policy content was not supplied and does not exist in project configuration. Publish authorised rows in `legal_documents` with document keys `eazily-service-partner-terms` and `eazily-service-partner-privacy-policy`, fixed versions and effective dates before production registration can submit. The interface and RPC deliberately block submission while either document is missing. A reverse-geocoding/map provider, IFSC lookup, document verification/reviewer delivery, and production Auth/Storage verification also remain to be configured. Manual address and bank-name entry stay available.

For a future database deployment, apply `storage.sql` in hosted Supabase after `partners.sql`, then apply `service_partner_registration.sql` as step 17 after the full seller sequence, `influencer_legal_2026_09_12.sql`, and `consultant_assessments.sql`. The registration migration checks for the managed `storage.objects` table and refuses to install without it. No SQL has been deployed. `npm run test:service-registration` uses the real migrations in PGlite with a minimal private-storage table and clearly labelled test-only policy fixtures; it verifies catalogue, bank/private-path and stored-object validation, Auth phone replacement, server consent time, generic-RPC bypass rejection, retry idempotency, and no subscription row at submission.

## Influencer legal version 2026-09-12 and Consultant Step 5 assessment

The Influencer interface now uses two separate fixed documents: `eazily-influencer-provider-terms` and `eazily-influencer-provider-privacy-policy`, both at version `2026-09-12`, Effective Date `12 September 2026`, and Last Updated `12 September 2026`. The source documents are in `src/features/partners/legal/documents/`; `influencerLegal.js` is the immutable UI manifest. The registration link/modal and Influencer Profile → Legal use `InfluencerLegal.jsx`. Viewing either document does not create consent. Registration and the existing-account gate call only the server functions in `src/services/partners.js`; the required Terms record uses the authenticated account, exact document identifier/version, and database `now()`. Existing consent rows are retained and an existing matching acceptance is returned rather than rewritten.

No verified values were present in project configuration for the legal company name, registered address, official email, privacy email, support number, website, grievance contact/name, grievance email, or court city/state. Those exact locations are marked `[UNRESOLVED: …]` in this immutable version. They were not inferred from Bhopal. Resolve them with authorised company information and publish a new document version; do not silently edit text already accepted under `2026-09-12`.

Consultant Registration Step 5 now uses six bilingual MCQs for each selected category/specialisation field. `ConsultantAssessment.jsx` restores a server attempt, preserves question/option order and saved responses, and displays the exact server result. SQL keeps answer keys and grading out of browser reads, accepts only six responses, and passes only scores of 4–6. Attempts are independent by canonical field ID and version. Application submission/approval, Consultant post writes, and Consultant booking writes require a pass for every selected field; document checks, human approval, consent and assigned-rate rules remain separate.

No approved Consultant question content was supplied. `consultant_assessments.sql` therefore creates no active production banks. A field honestly reports assessment unavailable until its exact category/specialisation has one active, reviewer-attributed bank containing exactly six approved bilingual questions in the required 2 foundation / 3 standard / 1 advanced mix. Current fields needing reviewed content are Business, Financial, Investment, CA & Tax, Architecture, Career, Legal, Healthcare, Agriculture, and Cybersecurity & Safety, for each supported specialisation. No unrelated fallback questions are used. No retake policy existed in the project, so failed attempts remain intact and the UI reports that no approved retake policy is configured.

The local preview skip is controlled in `src/features/partners/consultantAssessmentConfig.js` by `VITE_ENABLE_CONSULTANT_ASSESSMENT_TEST_SKIP`. It is enabled by default only while Vite is in development and can be disabled with `VITE_ENABLE_CONSULTANT_ASSESSMENT_TEST_SKIP=false`. `import.meta.env.DEV` is also mandatory, so production builds ignore a browser flag, URL parameter, localStorage value, or a true environment value. The skip writes only a local testing draft with `assessmentStatus: skipped_for_testing`; there is no backend skip function. The resulting local dashboard shows Test preview, and the production submission/approval/work triggers reject this marker without a real pass. “Take assessment” returns to Step 5. The testing account cache retains only this marker, not answers or answer keys.

For a future database deployment, use the existing full order below and then apply:

15. `influencer_legal_2026_09_12.sql` — requires `partners.sql` and `operations.sql`; adds document keys/dates, publishes the two supplied Influencer documents, replaces only the registration consent branch for Influencers, and adds the existing-account acceptance RPC.
16. `consultant_assessments.sql` — requires the preceding legal migration because it removes the obsolete five-answer Consultant validation from the current registration RPC; adds private versioned banks/questions/attempts, server grading, owner-only RPCs, and application/post/booking gates.
17. `service_partner_registration.sql` — requires the preceding migrations and the approval-based subscription trigger from `seller_subscriptions_v2.sql`; adds the isolated six-step Service Partner submission validation and server consent records. Publish the two authorised Service Partner legal rows separately before accepting registrations.
18. `service_partner_posting.sql` — requires Service Partner registration plus `seller_posting.sql`, `seller_workspace.sql`, `seller_subscriptions_v2.sql` and `seller_hardening.sql`; adds the role-scoped posting/management RPC and multi-category moderation check.

Apply both after the seller scripts so later function definitions do not replace their protections. `storage.sql` remains separate. Neither migration has been deployed. `npm run test:legal-assessment` applies the real SQL to PGlite and verifies full document counts, the fixed IDs/version/dates, server time, idempotent acceptance, hidden answer keys, restored attempts/responses, incomplete rejection, exact 3/6 fail and 4/6–6/6 pass results, per-field isolation, and rejection of the testing skip by production SQL.

## Development-only partner demo (September 12)

The former partner Preview samples control now opens an interactive, isolated Demo Mode for all three roles. See [PARTNER-DEMO.md](PARTNER-DEMO.md) for supported journeys, unavailable stages, the single `VITE_PARTNER_DEMO` flag, exact files/integration points and complete removal instructions. The real partner body is preserved apart from the gate/entry integration; registration, posting, authentication, business services, SQL and public assets are unchanged. No SQL or app deployment was performed.

Verified locally: production build and demo exclusion, lint, actual-SQL pricing comparisons in PGlite, demo state/transition tests, three-role Edge journeys at 360/390/430px and centered desktop width, network/storage isolation, original dashboard callbacks and carousel, and the existing production smoke suite. Screenshots are in `docs/partner-demo/`. Live backend/provider transactions remain untested and were not invoked.

The supplied Word document contains the product specification but no embedded screenshots. The implementation uses the existing Eazily colours and components.

## Implemented

- Exact Services group names; compact category sidebar and tiles.
- General service entry points open the matching service/vendor listing. Loan, Logistics and Blood requests retain their dedicated forms.
- Published vendor directory filtered by city and service, with rating/price/availability controls. Home and saved-vendor cards open the selected vendor.
- Scrollable vendor profiles, one profile at a time, sticky booking action, saved vendors, Escape/device-back handling, focus restoration and scroll preservation.
- Related services, process, promises, relevant professionals, FAQs, sharing, real reviews and review expansion in the specified order. Unpublished policies and absent reviews show honest empty states.
- Customer account identity from Supabase; three shortcuts and the eight requested menu rows in order. Profile editing, saved addresses, support requests, booking records, wallet ledger, memberships and saved payment-method records.
- Configurable referral amount, minimum qualifying paid amount, eligible services, expiry, checkout redemption percentage and refund treatment. Referral capture after OTP verification, unique codes, private referral records, idempotent credits/reversals, wallet debit and cancellation refund handling.
- Server-validated requests with idempotency keys. Loan and Logistics submissions atomically enqueue their respective Excel destinations separately from customer success.
- Logo graphics removed from shared customer/seller entry points and splash. Ordinary Eazily text remains.
- Persistent English/Hindi preference and translations for core navigation, account and service screens. Vendor-written content and unpublished service policies are not automatically translated.

## Required deployment setup

Staging deployment is governed by [the staging runbook](docs/staging/RUNBOOK.md) and [the authoritative migration manifest](supabase/migration-manifest.json). The original sequence remains intact with `staging_security.sql` appended as step 23; older references to step 22 as final describe the pre-audit implementation.

There is no `.env` with a live Supabase connection in this workspace. These migrations have been tested locally, **not deployed to a Supabase project**.

The secure messaging addition is documented in `CHAT-MESSAGING.md`. Its additive `chat_messaging.sql` migration remains step 21 after `realtime_events.sql`. The durable worker described in `BACKGROUND-AUTOMATION.md` adds `background_automation.sql` as the final step 22; older seller migrations must not be rerun to change their order.

1. On a new project, apply `supabase/schema.sql`, `supabase/experience.sql`, `supabase/wallet.sql`, `supabase/partners.sql`, and then `supabase/operations.sql`. Apply `supabase/storage.sql` for the private partner-document and customer-profile media buckets. On an existing project, review and back up the database before applying only the migrations it has not received.
2. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Keep all privileged credentials on the server. Configure Supabase SMS authentication; the customer sign-in screen now verifies OTPs.
   Until those two Supabase variables are configured, sign-in runs in clearly labelled local testing mode and accepts OTP `0000` without sending an SMS. This fallback is automatically unavailable whenever a Supabase client is configured.
3. Publish actual vendors with exact catalogue service names, coverage city names, authorised photos, prices and experience. Publish actual service FAQ policies in `service_policies`; `faq` is a seven-answer array in the order specified in the document. `fixed_price` enables the published vendor price as the quote.
4. Use an authenticated admin profile to configure Refer & Earn in Admin → Settings. The programme starts disabled with no assumed reward amount. The existing demo admin login does **not** grant an admin database role.
5. Connect the existing payment/fulfilment backend to trusted updates of `service_requests.payment_status`, `paid_amount` and `status`. The completion trigger credits referrals only after an eligible service is marked both paid and completed. Browser users cannot write those fields. `paid_amount` is the official-channel money actually collected, excluding wallet credit. Wallet use is a reservation/debit against an existing quote; it does not simulate a gateway payment. Payment methods and memberships require their actual provider integration to create live records.
6. Customer reviews must be published by the backend/moderation flow. Verified-booking status is derived from a matching completed booking, not a user-supplied flag. Upload and authorise review/portfolio photos before publishing their URLs. The pre-existing loan document inputs still need a private storage upload integration.

## Partner dashboard and subscription deployment order (checked 2026-09-11)

These instructions describe a future deployment. No remote database was changed and no live billing was enabled during this review. SQL files were left unchanged during the dashboard review; the subsequent local date-correction fix is described below.

For a **new** Supabase database, apply these files in order from `supabase/`:

1. `schema.sql`
2. `experience.sql`
3. `wallet.sql`
4. `partners.sql`
5. `operations.sql`
6. `seller_subscriptions.sql`
7. `seller_pricing.sql`
8. `seller_posting.sql`
9. `seller_workspace.sql`
10. `seller_finance_extensions.sql`
11. `seller_hardening.sql`
12. `seller_gateway.sql`
13. `seller_subscriptions_v2.sql` — review the known issues below before deployment.
14. `partner_dashboard_banners.sql`

Apply `storage.sql` separately after `partners.sql`, in Supabase where the managed `storage` schema exists. It supplies private upload buckets and policies; it is not a dependency of the two new scripts. The local SQL check does not emulate Supabase Storage or deploy Edge Functions.

The base files supply Auth-linked profiles, partner applications/posts, admin authorization and auditing. The seller sequence supplies subscriptions, the private pricing/quote schema, posting validation, workspace records, finance records and their hardening. `seller_gateway.sql` depends on those private quote/payment records and adds `payment_checkout_enabled`. Keep it before v2: it adds that column without `IF NOT EXISTS`, while v2 also declares it. V2 replaces subscription/booking functions and the trial trigger and adds a posting-access trigger; applying older seller scripts afterward would undo or conflict with these definitions.

The banner table requires `gen_random_uuid()` and `is_admin()` from the base setup, plus authenticated access to `is_admin()` granted by `seller_subscriptions.sql`. Its SQL does not reference the v2 subscription columns, but the dashboard uses subscription approval/trial/payment data to determine display eligibility, so install it after the completed seller sequence. Active, currently scheduled campaigns can be read under row security; the dashboard filters by partner role. Admin management also requires the appropriate table privileges in the deployed Supabase project; an admin row policy alone does not grant write privileges.

For an existing database, first check its migration history and back up its data. Apply only missing files in this dependency order. These are not universally repeatable scripts: for example, v2 creates `seller_subscription_after_approval` without dropping an existing trigger of that name. Do not rerun the whole list against an existing installation.

### Subscription date-correction fix and deployment considerations

- Fixed locally: `admin_correct_seller_subscription` now checks `result.partner_id` instead of the nonexistent `result.id`. `seller_subscriptions.partner_id` is the primary key declared in `seller_subscriptions.sql`. This is the only SQL change; the admin check, required approval timestamp, update conditions, date calculations, status handling, grants and audit insert are unchanged.
- `node scripts/subscription-correction-test.cjs` reproduced the original missing-field failure before the fix and passes afterward. It applies the real migrations to an in-memory PGlite database and uses the actual profile-based `is_admin()` function. It checks admin success; rejection of owners, unrelated users and anonymous callers; null dates and missing subscriptions; the configured trial/founder dates; preservation of other subscription fields and other partners; saved audit actor/entity/payload; existing optional status updates; unchanged registration rows, configuration and plan rules; and disabled billing flags.
- V2 marks legacy subscription rows with no trusted approval timestamp as `approval_date_missing`. Its approval trigger uses `ON CONFLICT DO NOTHING`, so those existing rows still need the admin correction path with a verified timestamp rather than automatic replacement. The test covers correcting such a legacy row.
- The approval trigger requires a non-null `reviewed_at` to populate the non-null trial dates. The supplied admin review function sets it; direct/manual approval writes must also supply the real timestamp.

The fix has not been deployed. Live Supabase Auth/JWT behavior, remote permissions and execution against production data were not tested. If v2 is already installed elsewhere, a future authorized deployment should replace only the corrected function, preserving its grants, rather than rerun the non-repeatable full v2 script.

In the isolated fresh-database check, all 14 scripts applied in the order above, `enabled`, `rollout_enabled` and `payment_checkout_enabled` remained false, and the banner table contained zero rows. This confirms SQL installation order, not production readiness or complete v2 behavior. The existing `test:database` and `test:seller` suites currently stop at `seller_gateway.sql`; they do not cover v2 or banners.

### Dashboard banner behavior

`PartnerApp.jsx` renders the carousel once, on Home below the partner header. The working carousel is in `src/features/partners/PartnerBannerCarousel.jsx`; the discarded JSX expression outside the returned markup was removed. Slide selection now tolerates a shrinking list, visibility tracking attaches after asynchronous loading, and manual pause is preserved across hover/swipe interactions. Hidden browser tabs also suspend automatic advancement.

Existing eligibility is preserved: an approved partner with trusted approval/trial dates, an ended trial and a currently active paid subscription. The component displays at most four campaigns for that role. Actions use existing Subscription, Training, Post, Orders, Profile and Support destinations. No campaign content, ads or offers were seeded. Missing backend data or no eligible campaigns produces no banner. Role palettes and mobile layout styles were not changed.

### Local verification from this review

- `npm.cmd run lint` and `npm.cmd run build` passed. The build reports a non-fatal JavaScript bundle-size warning.
- `npm.cmd run test:smoke` passed the existing registration flows for all three partner roles, dashboard restoration, role-specific posting forms and a saved professional knowledge-post draft, with no uncaught browser errors. These are local testing flows, not live approvals or publishing.
- With `npm.cmd run dev -- --host 127.0.0.1 --strictPort` running, `node scripts/partner-dashboard-test.cjs` checks all three dashboards at 360px, 390px and 430px plus a 1280px desktop viewport, their existing role colors, horizontal overflow, touch targets, text sizes, bottom-navigation clearance, registration editing/posting entry points, the centered mobile dashboard frame and the preserved 430px posting sheet. The visual redesign and its screenshots are documented in [DASHBOARD-REDESIGN.md](DASHBOARD-REDESIGN.md).
- The same focused check renders the actual carousel in an isolated local fixture and verifies delayed loading, shrinking lists, role/trust filtering, all six action destinations, pause/play, swipe and offscreen pause/resume. Test campaigns are held in memory on port 5201; they are never inserted into the application or a database. The test uses a separate headless Edge profile and saves screenshots under `.tmp/partner-dashboard-review-<timestamp>/`.
- Running browser tests while Vite was watching `.tmp` exposed a Windows `EBUSY` crash on a locked Edge cache file. `vite.config.js` now excludes `**/.tmp/**` from watching. The restarted server remained reachable throughout the successful focused browser check.

The pre-edit backup is `C:\Users\ajayk\Downloads\eazily-react (1)\eazily-backup-20260911-062420`. It contains 79 copied project files (1,714,066 bytes), each checked with SHA-256, plus `BACKUP-MANIFEST.json`. It includes source, public assets, SQL/Edge Functions, scripts, root configuration/package files and documentation; dependencies, builds and temporary browser data are excluded.

## Excel is pending, as requested

No workbook has been connected and no successful sync is simulated. The user asked to wait for Excel destinations.

`excel_lead_outbox` is a server-only durable queue keyed uniquely by lead ID. Rows start at `pending_configuration`. It has `attempts`, `next_attempt_at`, `last_error`, and `synced_at` fields for the future worker. **The Microsoft connection and retry worker remain to be implemented once workbook access is available.**

For each destination, supply the drive/workbook/table identifiers, column mapping, approved server authentication method and server secrets. The future worker must claim jobs, check the destination Lead ID before append (including after uncertain network results), retry transient failures with backoff, and mark success only after confirming the row exists. Keep Loan and Logistics destinations separate.

Loan mapping: request `id`, `created_at`, `service_name`, `status`, plus `details.fullName`, `phone`, `email`, `address`, `occupation`, `income`, `amount`. Logistics mapping: the same identifiers/contact fields plus `transportMode`, `pickup`, `drop`, `shipmentSize`. All additional form fields remain in `details`.

## Verification

- `npm run lint`
- `npm run build`
- `npm run test:database` — executes all migrations in a local PostgreSQL WASM instance and checks row security, self-referrals, duplicate submissions, reward credits, wallet reservations, cancellations, refund reversals, expiry and the lead outbox. Uses [PGlite](https://pglite.dev/extensions/).
- `npm run test:smoke` — after building, uses the installed Windows Edge browser in headless mode. Tests real production navigation/account screens and an isolated vendor fixture for modal replacement, selected-service preservation, device back and scroll restoration. Fixture data is not imported by the production application.

The live Excel delivery, production payment webhook, SMS provider and production database permissions still require deployment verification. The app intentionally shows empty/error states when those live dependencies are absent.

## Unified customer and partner workspaces

- The welcome screen supports customer exploration, partner registration, and existing-account sign-in. One verified Supabase account can hold Customer, Service Professional, Influencer, Consultant, and authorised Admin workspaces.
- Each partner role has separate application, post, order, availability, and earnings data. Applications and posts use draft, review, approved/published, changes-required, rejected, and paused states enforced by database functions and row-level security.
- Service Professionals use the green workspace and expiring online availability. Influencers use the coral-on-light-purple workspace, require at least 5,000 followers on one platform, and can publish paid collaborations only. Consultants use the blue workspace, admin-assigned rates, and a server-enforced single five-minute introduction per customer-consultant pair.
- Partner uploads go to the private `partner-media` bucket with progress, retry, size validation, and owner-only storage policies. A production moderation service must create authorised previews or signed URLs.
- Partner dashboard Home uses a single-column mobile layout at every viewport, with a maximum 430px frame centered on desktop. Metrics stay in a 2 by 2 grid, and bottom navigation stays inside the same phone-width frame. Splash, language, welcome, authentication, onboarding, customer, the other partner tabs, Admin and dialogs retain their existing 430px mobile shell. Provider profiles and posting forms retain their mobile sheets. The Home-only styles do not expand registration, posting or the customer application.

## Cashfree deployment

Cashfree is implemented as disabled-by-default server functions. Set `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`, `CASHFREE_BASE_URL`, `CASHFREE_SPLIT_API_VERSION`, and a strong `CASHFREE_INTERNAL_SECRET` as Edge Function secrets. Configure and verify the payment webhook, onboard each influencer as an Easy Split vendor, and test order creation, signed webhooks, split release, refunds, disputes, and hold release in Cashfree sandbox. Only then set `partner_config.cashfree_enabled=true` through an authenticated admin account.

Deploy `cashfree-create-collaboration`, `cashfree-webhook`, `cashfree-release-split`, and `cashfree-release-hold`. The two release functions require `x-eazily-internal-secret` and are intended only for trusted confirmation workflows. The customer button stays disabled until Cashfree is enabled, so absent credentials cannot create a fake payment or payout.

## Registration, customer Profile, and Super Admin additions

- Partner registration now uses six saved stages for each role. It includes role-specific categories, conditional business/social/qualification fields, one-time location permission with manual city/PIN fallback, private document uploads, bank-verification pending states, latest influencer follower bands, consultant interview answers for human review, editable review, and versioned unchecked consent.
- The customer Profile contains Account & Profile, Location & Addresses, Notifications, Payments, Service Management, App Preferences, Help & Support, Legal, and About Eazily. Payment methods, legal documents, support contacts, invoices, email/phone verification, and app links show pending or unavailable states until their real providers/content are configured.
- `operations.sql` adds private preferences, expanded addresses, payment/refund records in integer paise, support tickets, legal/configuration records, consent events, staff scopes, balanced-ledger building blocks, partner payouts, expenses, platform ratings, cancellation locking, and an authorized Admin summary. Super Admin screens read these records and no longer use prototype business totals.
- Populate `app_configuration` and publish versioned `legal_documents` before release. Configure email verification, phone-change OTP, notification delivery, invoice storage, AI help/interview providers, profile/document moderation, staff permissions, financial posting, reconciliation, exports, and backup/restore in the trusted backend. Missing integrations remain visibly pending.
