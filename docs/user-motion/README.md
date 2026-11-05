# User application interaction polish

This change is scoped by the `.user-app-root` wrapper and the CSS in `src/features/user-motion/user-motion.css`. Partner, influencer-provider, consultation-provider, registration, posting, and admin files are unchanged.

## Motion

- Tap feedback: 150 ms, `scale(.98)`, applied to existing user buttons and clickable controls.
- Page navigation: 220 ms opacity-only fade. Navigation remains immediate and content has no positional transform.
- Home carousel: one 220 ms opacity fade on the existing keyed slide and a 180 ms indicator transition. The four slides and 4.5-second timer are unchanged.
- Tabs, bottom navigation, form focus states, selections, and toggles: 160 ms colour, border, shadow, opacity, and transform transitions.
- Reduced motion: interaction/page/carousel motion is effectively disabled, smooth scrolling becomes immediate, and carousel autoplay stops.

## Loading feedback

Static, dimension-matched skeletons appear only while existing vendor, professional, provider, offering, or account requests are pending. Existing submit, booking, consultation, support, and wallet actions show a small spinner inside the same button dimensions while their real promise is pending. No delay is added.

## Verification

- The Home and Categories screenshots at 360 and 430 px are byte-for-byte identical before and after once animations settle.
- The complete user browser suite also passed at 360, 390, and 430 px with no horizontal overflow or clipped service/category content.
- The focused motion browser test passed tap feedback, immediate navigation, fixed-position fades, carousel controls, loading replacement, submit success timing, button dimensions, and reduced-motion autoplay behavior.
- Production build, ESLint, customer smoke tests, and seller regression tests passed.

The before and after screenshots are stored in the `before` and `after` folders. Side-by-side Home comparisons are `comparison-home-360.png` and `comparison-home-430.png`.
