# User application artwork

The Eazily user app uses realistic, locally bundled WebP object pictographs. Open `http://127.0.0.1:5173/` while `npm.cmd run dev` is running, then check Home → Explore Services, Explore → categories, Influencers, Consultancy, a service group, and an individual service listing.

## Scope

- Home Explore, category/group/service browsing, Influencers, Consultancy, and related-service cards share the same user-only image renderer.
- The purple theme, grids, left sidebar, Back button, category hierarchy, labels, order, filters, pricing, booking routes, and navigation actions are unchanged.
- Partner dashboards, partner Demo Mode, registration, onboarding, verification, posting, payments, Supabase scripts, and backend services do not import or use these assets.

## Files

| Path | Purpose |
| --- | --- |
| `public/assets/user-services/*.webp` | 105 optimized 216 × 216 transparent production images |
| `src/features/user-art/artwork.js` | Stable user-facing name-to-asset mapping and reuse aliases |
| `src/features/user-art/ServiceIllustration.jsx` | Decorative local `<img>` renderer with no SVG fallback |
| `src/features/user-art/user-art.css` | User-only sizing and `object-fit: contain` |
| `docs/realistic-artwork-prompts.json` | Final generation prompt manifest and subjects |
| `docs/realistic-artwork/staged/manifest.json` | Exact per-file and total compressed sizes |
| `docs/realistic-artwork/STATUS.md` | Detailed implementation and verification record |

The total production pictograph set is **1,207,102 bytes (1.15 MiB)**. Individual files are **5,212–22,694 bytes**. The files remain below the 5 MiB budget and preserve clarity where their natural size is below 15 KB.

Full generated renders and intermediate PNGs are stored only under `.tmp/` and are excluded from production. Runtime artwork uses no remote URLs.

## Verification

Passed locally:

- `npm.cmd run lint`
- `npm.cmd run build`
- `node scripts/user-art-coverage-test.cjs`
- `node scripts/user-art-browser-test.cjs` at 360, 390, and 430px
- `npm.cmd run test:smoke`

The browser check traverses all six categories and every service group, verifies that user-facing images decode from `.webp` files at 216 × 216, and rejects SVG fallback. It also checks category order, labels, horizontal overflow, booking and related-service destinations, browser Back behavior, and the Packers & Movers request sheet. Supabase is disabled in the fixture and no live write, payment, or deployment occurs.

Before/after comparisons are in `docs/realistic-artwork/comparisons/`.

## Reversible cartoon backup

The exact former cartoon renderer and mapping are preserved in `backups/cartoon-pictographs-20260912-181318/`, with a checksum manifest and scripts for switching between cartoon and realistic artwork. Both restore directions were tested byte-for-byte. The scripts replace only the artwork component and mapping, leaving the current CSS, layouts, routes, registration, posting, partner apps, and application logic untouched.

## Category-card containment

The six “Choose a category” cards use a uniform 164px card height, an 84px overflow-hidden image area, 12px card padding, and 10px separation before the independent text section. Artwork is centered at 75px with `object-fit: contain`, `object-position: center`, and 90% maximum bounds. Browser geometry checks verify equal card heights and fully contained images at 360, 390, and 430px.
