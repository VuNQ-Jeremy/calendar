import { defineConfig } from 'vite';

// Mochi consumes the Mochi Design System bundle as a browser global so that the
// design-system components and the app share a single React instance. React /
// ReactDOM (UMD) and the DS bundle are loaded as classic scripts in index.html
// before this module graph runs; see src/lib/globals.js.
export default defineConfig({
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
});
