# Partner dashboard mobile visual redesign

Open `http://127.0.0.1:5173/` while the local Vite server is running. Sign in through the existing flow or restore your partner workspace, then open Home. The former static **Preview samples** control is now **Enter Demo Mode** when `VITE_PARTNER_DEMO=true` in development. See [PARTNER-DEMO.md](PARTNER-DEMO.md) for interactive journeys, isolation, limitations and removal instructions. No real account or authorization bypass was added.

## Presentation changes

- Service: existing green colors, visible availability, service requests and ongoing/upcoming jobs.
- Influencer: existing coral identity/navigation with light-purple surfaces and purple dashboard accents; collaboration enquiries, active collaborations, existing deliverable text and latest posts.
- Consultant: existing blue colors, consultation requests and upcoming appointments, with date tiles when an existing deadline is available. Availability uses the same existing destination.
- All three: compact branding/identity, four icon-led metrics with unchanged definitions, honest empty states, quieter verification notices, existing shortcuts and earnings/rewards. Existing subscriptions and the eligible campaign carousel remain connected.
- Home stays within a centered 430px mobile frame on desktop and uses the full available width on phones up to 430px. There are no desktop columns or side panels. Profile/review information, a 2 by 2 overview, incoming work, quick actions, ongoing work, latest posts where supported and earnings follow in a single vertical stack. The other tabs, posting sheets, registration and customer app keep their existing layouts. Styles are scoped to `partner-dashboard-home-view` and its Home components.

## Samples are separate (superseded by interactive Demo Mode)

The original static `DashboardPreview.jsx` has been retired. Its single entry point now opens an isolated interactive workspace in `src/features/partners/demo/`, clearly labelled **Demo Mode — sample data, no real bookings or payments.** The real partner workspace is unmounted while it is open.

Demo actions update only the demo's own orders, counts, earnings, notifications and messages. Samples never enter actual-account state, browser storage or a database. The production build excludes the interactive demo module and fixtures. Production continues to use real data and empty states.

## Files

- `src/pages/PartnerApp.jsx`: Home-only header/component integration; existing loading, data fetching, handlers, non-Home tabs and sheet routing preserved.
- `src/features/partners/PartnerDashboard.jsx`: dashboard presentation using existing values and callbacks.
- `src/features/partners/partner-dashboard.css`: scoped visual and responsive styles.
- `src/features/partners/demo/`: isolated development-only interactive workspace; see the dedicated guide.
- `scripts/partner-dashboard-test.cjs`: expanded local browser checks and screenshots.
- `IMPLEMENTATION.md`, this document and `docs/dashboard-preview/`: review notes and screenshots.

## Verification

`npm.cmd run lint`, `npm.cmd run build`, `npm.cmd run test:smoke`, and `node scripts/partner-dashboard-test.cjs` cover static checks, compilation, the existing registration/posting/customer flows, 360px, 390px and 430px mobile layouts and the centered mobile frame at a 1280px desktop viewport, 44px touch targets, readable metric/body text, bottom-navigation clearance, demo entry/exit isolation and the existing carousel. The focused browser test also checks metric definitions and order/availability callbacks using isolated in-memory fixtures of the actual dashboard component. No fixture records are sent to Supabase. The separate demo model/browser checks and their screenshots are documented in PARTNER-DEMO.md.

The build retains its existing non-fatal bundle-size warning. Live backend transactions cannot be verified without a configured backend; no live payment, booking, approval or deployment was attempted.

File checksums confirmed that registration, onboarding, role selection, posting forms, business services, pricing/payment/booking logic, SQL (including the completed subscription fix), customer components and shared styles/components were unchanged. A source comparison also confirmed that `PartnerApp.jsx` changes are limited to the dashboard component extraction, conditional Home header and Home styling class.

## Screenshots

The full preview images use phone-width viewports with the full page height so the labelled sample cards can be reviewed. Separate 844px-tall viewport screenshots are saved for each tested phone width; desktop screenshots show the centered phone frame.

The screenshots show a local testing account with honest zero totals and separately labelled sample cards.

| Dashboard | Full mobile preview (390px) | Desktop phone frame |
| --- | --- | --- |
| Service | [Mobile](docs/dashboard-preview/professional-mobile.png) | [Desktop](docs/dashboard-preview/professional-desktop.png) |
| Influencer | [Mobile](docs/dashboard-preview/influencer-mobile.png) | [Desktop](docs/dashboard-preview/influencer-desktop.png) |
| Consultant | [Mobile](docs/dashboard-preview/consultant-mobile.png) | [Desktop](docs/dashboard-preview/consultant-desktop.png) |

| Phone viewport | Service | Influencer | Consultant |
| --- | --- | --- | --- |
| 360px | [View](docs/dashboard-preview/professional-360.png) | [View](docs/dashboard-preview/influencer-360.png) | [View](docs/dashboard-preview/consultant-360.png) |
| 390px | [View](docs/dashboard-preview/professional-390.png) | [View](docs/dashboard-preview/influencer-390.png) | [View](docs/dashboard-preview/consultant-390.png) |
| 430px | [View](docs/dashboard-preview/professional-430.png) | [View](docs/dashboard-preview/influencer-430.png) | [View](docs/dashboard-preview/consultant-430.png) |
