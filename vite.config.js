import {defineConfig} from 'vite';
import {hydrogen} from '@shopify/hydrogen/vite';
import {vitePlugin as remix} from '@remix-run/dev';
import {fileURLToPath} from 'url';
import path from 'path';

export default defineConfig({
  plugins: [
    hydrogen(),
    remix({
      presets: [hydrogen.preset()],
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '~': path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'app'),
    },
  },
  define: {
    // Replace process.env.NODE_ENV at build time — Cloudflare Workers has no process
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    assetsInlineLimit: 0,
  },
  ssr: {
    noExternal: true,
  },
});
