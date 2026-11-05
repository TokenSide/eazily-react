import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { buildPolicy } from './scripts/build-policy.mjs';

export default defineConfig({
  plugins: [react(), buildPolicy()],
  build: { copyPublicDir: false, sourcemap: false, rollupOptions: { output: { manualChunks(id) {
    if(/node_modules\/(react|react-dom|scheduler)\//.test(id.replaceAll('\\','/')))return 'react-runtime';
  } } } },
  server: {
    host: true,
    port: 5173,
    watch: {
      // Browser test profiles contain locked cache files, not application source.
      ignored: ["**/.tmp/**"],
    },
  },
});
