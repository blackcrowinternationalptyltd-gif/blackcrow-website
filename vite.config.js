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
      'react/jsx-runtime': path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'node_modules/react/jsx-runtime.js'),
      'react/jsx-dev-runtime': path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'node_modules/react/jsx-dev-runtime.js'),
    },
  },
  build: {
    assetsInlineLimit: 0,
  },
  ssr: {
    noExternal: true,
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
});
