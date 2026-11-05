# Realistic user-app artwork — installed locally

The user app now uses realistic object cutouts instead of the former inline SVG cartoons. The shared user-only artwork component renders local WebP images in Home Explore, category and service browsing, Influencers, Consultancy, and related-service cards. No partner component imports this artwork system.

## Assets and size

- Production path: `public/assets/user-services/`
- 105 reusable transparent WebP files cover 117 existing category, group, service, and related-service names.
- Each image is 216 × 216 pixels: 2× the largest 108px shared category slot and about 3–5× the common 44–70px slots.
- Total: **1,207,102 bytes (1.15 MiB)**. Individual files: **5,212–22,694 bytes**.
- Files are loaded by stable semantic IDs in `src/features/user-art/artwork.js`; aliases reuse the same file.
- Full generated source renders remain under `.tmp/realistic-art-sources/` and are excluded from the build. Intermediate PNGs remain under `.tmp/realistic-art-optimized/` and are also excluded.

The WebPs use genuine alpha transparency and were reviewed on white and pale-purple backgrounds at 48px and sidebar-size 32px. Quality was kept where files naturally fell below the requested 15KB guideline; files were not padded or blurred merely to match a byte target.

## Integration

- `src/features/user-art/ServiceIllustration.jsx`: shared decorative `<img>` renderer; no SVG fallback.
- `src/features/user-art/artwork.js`: stable user-only name-to-asset mapping and local WebP URLs.
- `src/features/user-art/user-art.css`: `object-fit: contain` preserves image proportions inside existing dimensions.
- Existing consumers remain `src/features/home/UserHome.jsx`, `src/pages/UserApp.jsx`, and `src/features/services/ServiceExperience.jsx`; their actions and layouts were not changed.

## Verification

- Production build passed. The existing large JavaScript chunk warning remains informational.
- ESLint passed.
- Artwork coverage passed: 117 mappings, 105 distinct local transparent WebPs, 1.15 MiB total, and 78 protected existing source/SQL/asset files unchanged.
- Backend-free Edge verification passed at 360, 390, and 430px. It walked all six categories and every service group, decoded the mapped WebPs, checked the image dimensions and `object-fit`, and confirmed there was no SVG fallback.
- Existing category order, labels, navigation, direct links, browser Back behavior, related Plumber routing, and Packers & Movers request-sheet destination passed.
- Registration, posting, authentication, partner dashboards, partner Demo Mode, SQL, and backend services were not changed. No deployment or live write occurred.

Before screenshots are under `docs/realistic-artwork/unchanged-app/`; after screenshots are under `docs/realistic-artwork/after/`; paired comparisons are under `docs/realistic-artwork/comparisons/`.

The artwork was generated with the built-in image-generation tool using `docs/realistic-artwork-prompts.json`. No third-party remote image URL is used at runtime.
