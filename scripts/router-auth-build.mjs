// TEST-ONLY bundler for the router authorization harness. Not part of the app build.
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { copyFileSync, readdirSync, writeFileSync } from 'node:fs';
const mockPlugin = {
  name: 'test-mocks',
  setup(b) {
    b.onResolve({ filter: /(^|\/)supabase\.js$/ }, a => a.importer.includes('/src/') ? { path: resolve('scripts/mocks/supabase-mock.js') } : null);
    b.onResolve({ filter: /(^|\/)runtime\.js$/ }, a => a.importer.endsWith('useAuth.js') ? { path: resolve('scripts/mocks/auth-runtime-mock.js') } : null);
  },
};
await build({
  entryPoints: ['scripts/router-auth-fixture.jsx'],
  bundle: true, jsx: 'automatic', loader: { '.js': 'jsx', '.css': 'empty' },
  outfile: '.tmp/router-auth.js', logLevel: 'error',
  define: { 'import.meta.env': JSON.stringify({ DEV: false, VITE_ENABLE_LOCAL_OTP: 'false', VITE_SUPABASE_URL: 'https://fixture.invalid', VITE_SUPABASE_ANON_KEY: 'fixture', VITE_SUPABASE_PUBLISHABLE_KEY: 'fixture' }) },
  plugins: [mockPlugin],
});
// Serve the REAL production stylesheet so full-shell captures are pixel-meaningful; ui-fixture.css is legacy and unused.
const appCss = readdirSync('dist/assets').find(name => /^index-.*\.css$/.test(name));
if (!appCss) throw new Error('Build the app first: dist/assets/index-*.css missing');
copyFileSync('dist/assets/' + appCss, '.tmp/app.css');
writeFileSync('.tmp/router-auth.html', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="router-auth.js"></script></body></html>');
console.log('router-auth harness built');
