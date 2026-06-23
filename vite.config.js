import { defineConfig } from 'vite';

// Mochi consumes the Mochi Design System bundle as a browser global so that the
// design-system components and the app share a single React instance. React /
// ReactDOM (UMD) and the DS bundle are loaded as classic scripts in index.html
// before this module graph runs; see src/lib/globals.js.
export default defineConfig({
  server: {
    port: 5173,
    host: true,
    // For `npm run dev`, proxy the API to a locally running Worker
    // (`npx wrangler dev`, default port 8787). Or just use `npm run cf:dev`,
    // which serves the built app + API together.
    proxy: { '/api': 'http://localhost:8787' },
  },
  preview: { port: 4173, host: true },
});
