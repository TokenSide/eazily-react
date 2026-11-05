# User home carousel artwork

This artwork belongs only to the user application's four existing home-carousel slides. It does not change slide copy, timing, destinations, indicators, or partner applications.

## Production assets

| Existing slide | Person | Asset |
| --- | --- | --- |
| Need help today? | Indian repair technician / plumber | `/assets/user-carousel/urgent-repair.webp` |
| Home care made simple | Indian home-care professional | `/assets/user-carousel/home-care.webp` |
| Book with confidence | Indian electrician | `/assets/user-carousel/book-confidence.webp` |
| Moving or urgent repair? | Indian moving professional | `/assets/user-carousel/moving-help.webp` |

All four files are transparent 480 x 600 WebP images. Their combined production size is **125,094 bytes (122.2 KiB)**; each file is below 37 KiB. Full-size generated PNG sources remain under `.tmp/home-carousel-sources` and are excluded from production builds.

The first slide is preloaded and rendered eagerly with high fetch priority. Slides two through four use native lazy loading and low fetch priority. The banner CSS adds the purple/blue background, glow, shadow, and lower-body fade without baking those effects into the portraits.

## Integration points

- `src/features/home/homeHeroArtwork.js`: maps existing slide IDs to assets.
- `src/features/home/UserHome.jsx`: renders the portrait and controls loading priority.
- `src/features/home/home-carousel.css`: responsive two-column banner presentation.
- `scripts/optimize-home-carousel.ps1`: crops and prepares transparent source images.
- `scripts/compress-home-carousel.cjs`: produces and validates the production WebP files.

## Generation prompts

The images were generated with the built-in OpenAI image generator. No Urban Company image was supplied to the generator. Each prompt asked for an original, photorealistic Indian professional isolated on a truly transparent background, a natural pose and expression, premium work clothing, complete face/hands/tool or prop, soft studio lighting, no words or logos, and a vertical waist-up composition designed for the right side of a mobile banner. The four subjects were:

1. A male plumber in a navy polo holding a pipe wrench.
2. A female home-care professional in a navy and lavender uniform holding a microfiber cloth.
3. A female electrician in a charcoal utility jacket holding an insulated screwdriver.
4. A male moving professional in a blue polo carrying a small cardboard box.

## Verification

Browser captures for every slide at 360, 390, and 430 px are in `docs/home-carousel/after`. The browser test checks image dimensions and URLs, preload/lazy-loading behavior, left/right separation, clipping, overflow, indicator clearance, existing navigation, and automatic advancement.
