# Eazily real-time synchronization

This implementation adds one shared, authenticated real-time transport for the existing Customer, Service Partner, Influencer, Consultant, and authorised Admin workspaces. It does not add a second booking, payment, subscription, or notification system.

## How it works

`public.realtime_events` is a small invalidation stream. Its rows contain only an event ID, audience, scope, source type, source ID, and server timestamp. They never contain a booking body, price calculation, bank field, identity document, private note, payment-provider payload, or protected Admin data.

Database triggers add an event only after the source row changes. The browser receives that hint and reloads the authoritative source through its existing RLS-protected table, view, or RPC. Browser arrival order cannot overwrite a newer record because event payloads are never applied to UI state. Event IDs are remembered for deduplication, events arriving within 120 ms are batched, and reconnect/foreground recovery performs a fresh authoritative load.

The shared client opens at most these scoped channels:

- Signed-in account: `audience_key = <auth user UUID>`.
- Current approved partner role: `professional`, `influencer`, or `consultant`.
- Customer discovery: the selected city, such as `city:bhopal`.
- Authorised Admin workspace: `admin`.

Channels are removed when the session, workspace, or city changes and at logout. Public provider data is still fetched from the existing sanitized directory views. The event stream is only a refresh hint.

## Files and integration points

- `src/lib/realtime.jsx`: channel lifecycle, reconnect, deduplication, event batching, foreground recovery, and the shared React context.
- `src/components/RealtimeStatus.jsx`: small Live, Connecting, Reconnecting, or Offline indicator with Retry.
- `src/realtime.css`: isolated status-indicator styling and reduced-motion handling.
- `src/App.jsx`: starts the transport only after account and workspace restoration; refreshes account metadata for application, profile, consent, and assessment changes.
- `src/pages/UserApp.jsx`: sets the customer city subscription and refreshes a directly opened provider.
- `src/pages/PartnerApp.jsx`: refreshes the active partner dashboard, availability, trial/subscription, banners, and Consultant eligibility.
- `src/pages/AdminApp.jsx`, `src/features/partners/PartnerAdmin.jsx`, and `SellerAdminSettings.jsx`: refresh authorised queues, records, summaries, finance, and partner configuration.
- `src/features/services/PartnerOfferings.jsx`, `RoleMarketplace.jsx`, and `ServiceExperience.jsx`: refresh customer discovery, public availability, bookings, messages, and reviews.
- `src/features/account/CustomerAccount.jsx` and `ProfileDetails.jsx`: refresh account records, wallet, payments, services, support, and legal records without resetting form state.
- `src/features/partners/OrderDetail.jsx`: refreshes the open order, quote, and history; blocks protected order/payment actions while the browser is offline.
- `supabase/realtime_events.sql`: additive table, RLS, event helpers, source triggers, retention function, and minimal Realtime publication entry.
- `scripts/realtime-test.cjs`: local PGlite security and event-routing checks.

## Migration order and dependencies

The authoritative order and checksums now live in [migration-manifest.json](supabase/migration-manifest.json). The original 22-step sequence below is followed by `staging_security.sql` (step 23). Use [the staging runbook](docs/staging/RUNBOOK.md) for deployment gates.

Keep every existing migration unchanged. For a new environment, use the project’s established order:

1. `schema.sql`
2. `experience.sql`
3. `wallet.sql`
4. `partners.sql`
5. `operations.sql`
6. `storage.sql`
7. `seller_subscriptions.sql`
8. `seller_pricing.sql`
9. `seller_posting.sql`
10. `seller_workspace.sql`
11. `seller_finance_extensions.sql`
12. `seller_hardening.sql`
13. `seller_gateway.sql`
14. `seller_subscriptions_v2.sql`
15. `influencer_legal_2026_09_12.sql`
16. `consultant_assessments.sql`
17. `service_partner_registration.sql`
18. `service_partner_posting.sql`
19. `partner_dashboard_banners.sql`
20. `realtime_events.sql`
21. `chat_messaging.sql`
22. `background_automation.sql`

The real-time migration depends on all preceding source tables. The additive chat migration depends on its event helpers. Durable automation is the final step because it schedules work from the completed booking, finance, subscription, realtime, and chat structures. None of these migrations is deployed by the React application. See `CHAT-MESSAGING.md` and `BACKGROUND-AUTOMATION.md` for access, worker, retention, and verification details.

## Supabase configuration

The React app already uses `VITE_SUPABASE_URL` and the public `VITE_SUPABASE_ANON_KEY`. No service-role key belongs in a frontend environment variable.

The migration attempts to add only `public.realtime_events` to the `supabase_realtime` publication. If the migration role cannot alter publications, enable this one table in **Supabase Dashboard → Database → Replication**. Subscribe to INSERT events only. Do not enable Realtime on the source tables or private schemas.

After step 22 is enabled, the trusted automation worker performs the seven-day realtime cleanup. Browser accounts cannot run this cleanup or process the queue.

## Covered source changes

- Partner applications, assessments, legal acceptance, posts/moderation, public directories, availability, role banners, and Consultant rates.
- Direct partner orders, status/history, leads, messages, quotes, payment requests, Cashfree collaboration state, earnings, payouts, refunds, rewards, subscriptions, and trials.
- Customer service requests, payments, refunds, wallet entries, support tickets, reviews, and legacy public vendors.
- Admin queues and summaries for the same records.

The current product uses direct provider booking: each `partner_order` already has one assigned partner. `change_seller_order` locks the order row and checks the assigned approved partner before acceptance, and it locks the partner when checking appointment capacity. There is no existing multi-provider automatic-matching offer model. This work does not invent one or claim that two partners receive the same offer. If automatic matching is added later, its server-side offer table and atomic winner RPC must emit the same `orders` scope.

## Verification boundaries

`npm run test:realtime` runs the event/RLS checks without contacting a Supabase project. A true two-device or two-browser-session latency, WebSocket reconnect, and server publication test requires a local or sandbox Supabase project with the migration applied and at least two authenticated fixture accounts. The repository does not contain those credentials, and this implementation intentionally does not deploy the migration.
