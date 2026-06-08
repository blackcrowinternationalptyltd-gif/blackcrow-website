import {defineConfig} from 'vite';
import {hydrogen} from '@shopify/hydrogen/vite';
import {vitePlugin as remix} from '@remix-run/dev';
import {fileURLToPath} from 'url';
import path from 'path';

// Polyfill node:* built-ins that Supabase uses but Cloudflare Workers doesn't have
const nodePolyfillPlugin = {
  name: 'node-builtins-polyfill',
  resolveId(id) {
    if (id === 'node:assert' || id === 'assert') return '\0node-assert-polyfill';
    if (id === 'node:buffer' || id === 'buffer') return '\0node-buffer-polyfill';
    if (id === 'node:process' || id === 'process') return '\0node-process-polyfill';
  },
  load(id) {
    if (id === '\0node-assert-polyfill') {
      return `
        function assert(val, msg) { if (!val) throw new Error(msg || 'Assertion failed'); }
        assert.ok = assert;
        assert.strictEqual = (a, b, msg) => { if (a !== b) throw new Error(msg || a + ' !== ' + b); };
        assert.deepStrictEqual = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(msg || 'Deep equal failed'); };
        assert.notStrictEqual = (a, b, msg) => { if (a === b) throw new Error(msg || a + ' === ' + b); };
        assert.fail = (msg) => { throw new Error(msg || 'Assertion failed'); };
        export default assert;
        export const { ok, strictEqual, deepStrictEqual, notStrictEqual, fail } = assert;
      `;
    }
    if (id === '\0node-buffer-polyfill') {
      return `export const Buffer = globalThis.Buffer || { from: (d) => d, isBuffer: () => false };`;
    }
    if (id === '\0node-process-polyfill') {
      return `export default { env: {}, version: '', platform: 'browser' };`;
    }
  },
};

export default defineConfig({
  plugins: [
    nodePolyfillPlugin,
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
