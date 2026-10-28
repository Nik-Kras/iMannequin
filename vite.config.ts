import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { sentryVitePlugin } from '@sentry/vite-plugin';

const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
})();
const BUILD_ID = `${commit}.${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
// Source maps are uploaded to Sentry (and removed from dist) only when a token is configured: in CI as a
// repository secret, locally in the git-ignored .env.sentry-build-plugin (KEY=value lines).
if (existsSync('.env.sentry-build-plugin')) {
  for (const line of readFileSync('.env.sentry-build-plugin', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
// SENTRY_UPLOAD=0 skips the upload for local test builds.
const uploadSourceMaps = !!process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_UPLOAD !== '0';
// GitHub Pages serves the repo at /iMannequin/ (D10).
const BASE = process.env.BASE_PATH ?? '/iMannequin/';

export default defineConfig({
  base: BASE,
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_ID__: JSON.stringify(BUILD_ID) },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500, sourcemap: uploadSourceMaps ? 'hidden' : false },
  plugins: [
    react(),
    uploadSourceMaps && sentryVitePlugin({
      org: process.env.SENTRY_ORG ?? 'mykyta-krasnytskyi',
      project: process.env.SENTRY_PROJECT ?? 'imannequin',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      url: process.env.SENTRY_URL ?? 'https://de.sentry.io/',
      release: { name: `imannequin@${pkg.version}+${BUILD_ID}` },
      sourcemaps: { filesToDeleteAfterUpload: ['dist/**/*.map'] },
    }),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'iMannequin',
        short_name: 'iMannequin',
        description: 'Your wardrobe on a paper mannequin of you. Private: photos never leave the phone.',
        lang: 'en',
        theme_color: '#EEECE7',
        background_color: '#EEECE7',
        display: 'standalone',
        orientation: 'portrait',
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,webp,webmanifest}'],
        globIgnores: ['vendor/**', 'models/**', '**/ort-wasm-*'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Runtimes and the self-hosted pose models are cached on first use, then work offline (R4).
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/vendor/') || url.pathname.includes('/models/'),
            handler: 'CacheFirst',
            options: { cacheName: 'imannequin-runtimes', expiration: { maxEntries: 40 } },
          },
        ],
      },
    }),
  ],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
