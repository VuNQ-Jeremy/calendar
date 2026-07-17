import { cloudflare } from '@cloudflare/vite-plugin';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vite';
import { dataLocPlugin } from './vite-plugin-data-loc';

export default defineConfig({
  plugins: [
    dataLocPlugin(),
    tailwindcss(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    reactRouter(),
    tsconfigPaths(),
  ],
});
