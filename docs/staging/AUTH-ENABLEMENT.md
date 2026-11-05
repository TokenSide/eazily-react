# Auth enablement — the last blocker before login works

Verified state on `ahwbgmnfmzsaiwjglbkb` (`eazily-staging`), 2026-10-03, read-only probe:

```
phone               : ABSENT -> phone OTP NOT enabled
google              : false
uri_sites_allowed   : empty
sms_provider        : twilio
mailer_autoconfirm  : false
```

The frontend is finished and correct — `src/auth/controller.js` calls
`signInWithOtp({ phone })`, `verifyOtp({ type: 'sms' })` and
`signInWithOAuth({ provider: 'google' })`, and `src/auth/policy.js` handles every error
code GoTrue can return. **Nothing is wrong with the code.** There is simply no
provider enabled to sign in against.

---

## 1. Phone OTP (the primary login)

Your normalisation in `policy.js` expects Indian numbers and rewrites them to `+91`,
and the SQL requires `phone_confirmed_at`, so phone is the method the schema was
built around.

- **Supabase dashboard → Authentication → Sign In / Providers → Phone**
  - Enable the Phone provider.
  - Choose an SMS provider. `sms_provider` already reports `twilio`.
- **Twilio credentials are required.** Phone OTP cannot send an SMS without them.
  Either connect a Twilio account under Authentication → SMS Provider, or switch to
  MessageBird / Textlocal / Vonage. This is the step most likely to stall, because it
  needs a paid account and a verified sender.
- Leave **Confirm phone** enabled. The schema rejects a user whose
  `phone_confirmed_at` is null: `raise exception 'Complete mobile OTP verification
  before submitting'`.

Do not enable **Auto confirm of sign-ins**. A seeded or auto-confirmed number would
defeat the phone-confirmation guard.

## 2. Google OAuth (the secondary login)

- **Authentication → Providers → Google**: enable and paste the Client ID and Client
  Secret from a Google Cloud OAuth client of type *Web application*.
- Add your client to **Authentication → URL Configuration**:
  - **Site URL** — the canonical origin, e.g. `http://localhost:5173` for local and the
    deployed origin for staging. It is currently empty, and Google rejects a redirect
    that does not match it.
  - **Redirect URLs** — add, at minimum:
    - `http://localhost:5173`
    - `http://localhost:5173/**`
    - the staging origin, plus `/**` for it if you use deep links
    - `capacitor://localhost` and `eazily://**` if the Android shell signs in

`controller.js` passes `redirectTo: globalThis.location?.origin`, so the redirect must
match the origin the app is served from exactly.

## 3. Email, if you want it later

`mailer_autoconfirm` is `false` and no SMTP provider is configured. Email sign-in is
optional for this journey; leave it off until you need it.

---

## Verify it worked

Re-run the read-only probe. It prints no credentials and performs no writes.

```powershell
node scripts/hosted-recon.cjs
```

You want to see `phone` present rather than `ABSENT`, `google` true, and
`uri_sites_allowed` non-empty. The auth line should read roughly:

```
phone={"enabled":true,...} sms_provider=twilio providers=[...google..., phone, ...]
```

Then confirm the directory has content and the anon surface still works:

```powershell
node scripts/hosted-recon.cjs --all
```

`categories`, `vendor_directory` and `customer_reviews` should be readable and
non-empty; everything sensitive must still answer `401` to the browser role.

## Then prove the whole journey

Login cannot be tested without a real SMS or Google round trip, so this is manual:

1. Start the app connected to staging. See `docs/staging/ENVIRONMENT.md` for the
   variable set; `EAZILY_TARGET_ENV=staging npm run dev -- --mode staging` picks up
   `.env.staging.local`.
2. Sign in with a phone number. Expect: OTP request → SMS arrives → profile row
   created by the `on_auth_user_created` trigger → customer home loads.
3. Confirm a profile row was created, because the trigger is what bootstraps it:
   ```sql
   select id, full_name, phone, account_status from public.profiles order by created_at desc limit 5;
   ```
4. Search for a service. `Plumber`, `AC Service` and `Car Mechanic` are seeded, and
   Bhopal, Indore and Jaipur are covered.
5. Open a professional and check the rating and review count render — those come from
   `vendor_directory`, aggregated from `public.reviews`.

## What will still not work, and why

- **Booking a seeded professional will not complete.** The seed creates display-only
  identities with no verified session and no payment method. See `seed/README.md`.
  A real booking needs a partner who registers through the app with genuine documents,
  which the six-step validator enforces.
- **Payments, payouts and the automation worker are disabled by default** across the
  whole schema, deliberately. Enabling them is a separate, deliberate step — see
  `docs/staging/RUNBOOK.md` and `BACKGROUND-AUTOMATION.md`.
- **Storage uploads** are untested against a live bucket. No seeded vendor has media,
  and the post guard requires a real `storage.objects` row before a media attachment
  is accepted.