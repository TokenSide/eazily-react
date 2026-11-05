# Eazily React

Eazily’s original HTML/CSS/JavaScript prototype converted into a modular React application using Vite. It contains customer, seller and super-admin experiences and can run without a backend in demo mode.

## Requirements

- Node.js 24 LTS or newer
- npm 11 or newer

## Run on Windows in VS Code

Open the extracted `eazily-react` folder in VS Code, then run:

```powershell
npm.cmd install
npm.cmd run dev
```

Open the local URL shown in the terminal (usually `http://localhost:5173`).

Do not use Live Server for this React project. Vite is the development server.

## Production build

```powershell
npm.cmd run build
npm.cmd run preview
```

## Application structure

```text
src/
├── components/          Shared SVG icons and UI components
├── data/                Catalogue and temporary demo data
├── features/requests/   Service, loan, logistics, blood and enquiry forms
├── lib/                 Supabase client configuration
├── pages/               Customer, seller and admin applications
├── services/            Database-facing functions
├── App.jsx              Onboarding and app-mode controller
└── styles.css           Existing visual system plus React UI styles
```

## Connect Supabase later

For staging, follow [the gated staging runbook](docs/staging/RUNBOOK.md) and the [canonical migration manifest](supabase/migration-manifest.json). Do not deploy the base schema alone or use the local demo build as staging. Current local/remote results are in [the staging report](docs/staging/REPORT.md).

1. Create a Supabase project.
2. Open Supabase SQL Editor and run `supabase/schema.sql`.
3. Copy `.env.example` to `.env`.
4. Add the project URL and public anon key:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

5. Restart `npm run dev`.

Browsing works without a backend, but request submission now requires an authenticated Supabase connection. Apply the additional migrations described in [IMPLEMENTATION.md](IMPLEMENTATION.md) before submitting requests.

Durable server-side jobs, the disabled-by-default worker, scheduler setup, and final migration step are documented in [BACKGROUND-AUTOMATION.md](BACKGROUND-AUTOMATION.md). No worker or billing integration is enabled by the React app.

## Security rules

- The anon key may be used in the frontend only with Row Level Security enabled.
- Never put the Supabase service-role key in React or any `VITE_` variable.
- Financial documents, PAN/KYC, bank statements and administrative approvals should use protected storage buckets and server-side authorization.
- Replace demo admin login with Supabase Auth plus an admin-role check before production.
- Add storage policies before uploading any customer or seller document.

## Branding and images

- The legacy logo asset remains in `public/assets`, but the customer and seller interfaces no longer render logo graphics.
- UI pictograms are inline SVG components in `src/components/Icon.jsx`, avoiding emoji encoding problems.
- Demo professional photos currently use remote Unsplash URLs. Move production images to Supabase Storage and store only their URLs in database rows.

## Updated service experience

See [IMPLEMENTATION.md](IMPLEMENTATION.md) for the implemented navigation, customer account, referral and wallet changes, deployment steps, test commands, and the pending Excel integration.
