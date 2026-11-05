# Partner Demo Mode / Test Workspace

## Open locally

1. Run `npm.cmd run dev` from this project if the server is not running.
2. Open **http://127.0.0.1:5173/**. Use your existing sign-in/registration flow and open any partner dashboard. The demo does not bypass authentication or onboarding. A pending partner can enter the separate fictional workspace without changing their actual verification status.
3. On Home, choose **Enter Demo Mode** in the former Preview samples position, beneath incoming requests. This replaces the static preview; there is only one demo entry.
4. Use **Demo partner type** (or the header's Switch button to focus that selector), **Simulate New Lead**, **Reset Demo Data**, and **Exit Demo Mode**.

The dashboard URLs are `/seller/service/dashboard`, `/seller/influencer/dashboard`, and `/seller/consultant/dashboard` on the same local server. Normal account access checks still apply to these URLs. There is no anonymous demo route or account-verification shortcut.

## Click through the supported journeys

All three roles start with seven fictional Bhopal requests, sample posts and a demo-only verified profile. Dates are relative to when you enter/reset. Switching roles retains each role's local progress. Reset resets all three demo roles; exit or page refresh discards the entire demo session.

### Service Partner

1. **My Orders → Ceiling fan repair → Accept sample request**.
2. **Open mock conversation**, type a message, and **Send demo message**. Return through My Orders and reopen the job.
3. Enter sample arrival code **246810**, then **Verify demo arrival**.
4. **Send sample final quote → Simulate customer quote approval → Simulate successful payment → Simulate customer completion**.
5. Home's completed count, the job activity, notifications and pending earnings update. **Home → View details** opens demo Earnings. The ₹400 job adds ₹400 to the initial ₹900 pending balance. No automatic service payout release is invented.

Try rejecting the other new request with a reason of at least three characters. Repeated Simulate New Lead clicks create separate requests and increase the incoming count.

### Influencer Partner

1. **My Orders → Café launch reel → Accept sample request**. You can open a mock conversation.
2. **Unavailable:** the existing seller screen has no connected action to start a campaign or submit deliverables after accepting an enquiry. The demo explicitly identifies this gap instead of creating a fictional product transition.
3. Separately open **Dessert launch story**, a fixture already at the prepaid checkout stage: **Simulate prepaid payment → Simulate trusted scope confirmation → Simulate customer completion → Simulate trusted hold release**.
4. Earnings show the pending portion and the security hold. The hold becomes available only after the explicit trusted-release simulation. This is not a seller permission or an automatic timer.

### Consultation Partner

1. **My Orders → CV review session → Accept sample request**. Try the mock conversation.
2. **Unavailable:** the existing seller screen has no connected start-session/finish-session action, and paid consultation checkout is not wired here. The demo does not invent these actions or an admin price.
3. Separately open **Five-minute career introduction**, a later-stage fixture, and press **Simulate customer completion**. Completed sessions update. This free introduction creates no charge or earnings.

The separate later-stage fixtures do not imply that an accepted influencer or consultation enquiry can currently progress end-to-end through the seller UI. Registration, editing/publishing posts, account settings, support, rewards, subscriptions, real calls and real checkout are unavailable inside this isolated workspace. Exit to use the existing real-account screens.

## Isolation and pricing

- `DemoGate` unmounts the real partner workspace while the demo is active. Only the initial role and an exit callback reach the demo. Real accounts, IDs, data, RPC callbacks and posting/payment forms are never passed in.
- All mock state lives in a dedicated React reducer in memory. The demo uses **no localStorage, sessionStorage, IndexedDB, cookies or persistence**. Reset only replaces this reducer's data. Exit unmounts it and restores the actual partner dashboard from the unchanged account.
- No demo module imports Supabase, live services, payment SDKs, OrderDetail, registration or posting forms. Reused components are presentation components with local callbacks. Notifications and messages never leave the page; no push permissions, phone links, payable QR codes or external contacts exist.
- Service calculations use the **existing local test configuration** in `scripts/seller-test.cjs`, with zero taxes/fees and the SQL markup thresholds from `supabase/seller_pricing.sql`. These are not claims about live pricing. The live pricing seed remains disabled/incomplete. Below-₹100 sample quotes are rejected because that rule is unspecified.
- Influencer figures use the repository's `partner_config` defaults (10% platform fee and 70/30 payout allocation), matching `cashfree-create-collaboration`. Payment alone does not credit earnings: simulated scope confirmation creates pending/security-hold entries; simulated trusted hold release moves only the hold to available. The original edge functions are never invoked. Real admin configuration may differ.
- Consultation enquiry amounts are illustrative. The completion fixture is the existing five-minute free-introduction concept; no paid rate or payout is fabricated.
- Customer approval/completion and trusted provider/scope/release events have explicit simulation labels. They do not grant a real seller those permissions.

## One flag and removal instructions

The single enable/disable flag is **`VITE_PARTNER_DEMO`** in **`.env.development.local`**, currently:

```dotenv
VITE_PARTNER_DEMO=true
```

Set it to `false` (or remove it) and restart Vite to disable entry. `src/features/partners/demo/config.js` additionally requires `import.meta.env.DEV`; a production build cannot enable Demo Mode even if the flag is `true`. The production bundle is checked for exclusion of the interactive demo module and fixtures. This flag neither configures a backend nor enables billing.

Dedicated files:

| File | Purpose |
| --- | --- |
| `src/features/partners/demo/config.js` | Flag plus hard development gate |
| `src/features/partners/demo/DemoGate.jsx` | Lazy import and actual/demo boundary |
| `src/features/partners/demo/DemoWorkspace.jsx` | Demo-only screens, controls and safe local callbacks |
| `src/features/partners/demo/fixtures.js` | Fictional role profiles, seven requests per role, posts and balances |
| `src/features/partners/demo/model.js` | Pure local transitions, notifications, messages, reset and earnings |
| `src/features/partners/demo/pricing.js` | Explicit sample calculations matching repository rules/tests |
| `src/features/partners/demo/demo.css` | Styles scoped exclusively to `.demo-workspace` |
| `scripts/partner-demo-model-test.cjs` | State, local SQL pricing, dependency graph and flag checks |
| `scripts/partner-demo-browser-test.cjs` | Isolated Edge mobile journeys, API traps, storage and exit checks |
| `docs/partner-demo/` | Mobile, full-page, desktop and completed-stage screenshots |

Only two production source integration points were needed:

1. `src/pages/PartnerApp.jsx`: imports DemoGate; its export wraps the original body (now named ActualPartnerApp) and passes the optional `onEnterDemo` callback to DashboardHome. The original body, service callbacks, tabs and sheets are otherwise unchanged.
2. `src/features/partners/PartnerDashboard.jsx`: replaces static Preview samples state/rendering with the optional entry callback/button. Its original dashboard calculations and actions remain unchanged.

To remove completely: unwrap PartnerApp, restore its original exported function name and remove the DemoGate import and `onEnterDemo` prop plumbing; remove the optional entry control/prop from PartnerDashboard; delete the dedicated demo directory, flag line, demo scripts, screenshots and this guide. In `scripts/partner-dashboard-test.cjs`, remove only the demo entry/exit assertions; keep the dashboard/mobile/action checks. No SQL, authentication, registration or posting file needs to change. The old static `DashboardPreview.jsx` was retired, not left as a second mode.

## Verification

Run after the production build (for the bundle-exclusion assertion), with the local dev server available for browser tests:

```text
npm.cmd run lint
npm.cmd run build
node scripts/partner-demo-model-test.cjs
node scripts/partner-demo-browser-test.cjs
node scripts/partner-dashboard-test.cjs
npm.cmd run test:smoke
```

The model check uses an in-memory PGlite database loaded from the actual SQL scripts, never Supabase. Browser checks use independent Edge profiles and test-account fixtures, not your browser or real account. They check each role at 360/390/430px, the centered 430px desktop frame, supported actions, message/notification/earnings consistency, role switching, reset, exit, no overflow, and bottom navigation clearance. They trap network/storage/external/push API attempts during demo interactions and compare actual account storage before and after. The original dashboard regression also checks real posting and registration destinations and the banner carousel.

Live Supabase accounts, gateway transactions and external provider workflows have not been exercised. No SQL or application deployment is part of this work. The existing production bundle-size warning remains non-fatal.
