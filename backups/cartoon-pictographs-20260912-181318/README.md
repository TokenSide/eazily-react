# Eazily cartoon pictograph backup

This directory preserves the exact user-app cartoon pictograph implementation that existed immediately before the realistic WebP replacement. Its SHA-256 hashes match the pre-replacement workspace snapshot.

The cartoons are inline SVG code, so their complete visual assets live in `ServiceIllustration.jsx`; `artwork.js` is their original name-to-subject mapping. `user-art.css.reference` is retained for inspection only.

To restore the cartoons from PowerShell at the project root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File backups/cartoon-pictographs-20260912-181318/restore-cartoon-pictographs.ps1
```

The restore script replaces only `src/features/user-art/artwork.js` and `src/features/user-art/ServiceIllustration.jsx`. It deliberately leaves all CSS, layouts, category markup, routes, registration, seller applications, backend code, and functionality untouched. The realistic WebP files remain available but unused.

To return to the installed realistic version:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File backups/cartoon-pictographs-20260912-181318/restore-realistic-pictographs.ps1
```

`manifest.json` records the exact cartoon file hashes and sizes. The `realistic/` directory stores the matching reversible realistic renderer and mapping.
