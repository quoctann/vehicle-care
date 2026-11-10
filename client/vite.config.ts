import fs from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Backend-proxied paths (see client/nginx.conf) must bypass the cached app
// shell: the Google OAuth start and callback are full-page navigations whose
// backend 302 chain would otherwise be swallowed by the service worker
// serving index.html instead. Workbox matches these against
// url.pathname + url.search.
const navigateFallbackDenylist = [
  /^\/auth\//,
  /^\/account\//,
  /^\/devices\//,
  /^\/sync\//,
  /^\/part-types($|\?)/,
];

// Extracts every location block that contains proxy_pass. Anchors on the
// nearest preceding `location` header so directives inside nested blocks
// still attribute correctly; full-line and trailing comments are stripped.
function nginxProxyLocations(conf: string) {
  const source = conf.replace(/#.*$/gm, '');
  const locations: { exact: boolean; name: string }[] = [];

  for (const pass of source.matchAll(/(^|[{;\s])proxy_pass\s+\S+\s*;/g)) {
    const before = source.slice(0, pass.index ?? 0);
    let current: { exact: boolean; name: string } | null = null;

    for (const location of before.matchAll(
      /(^|\s)location\s+(?:(=|~\*|~|\^~)\s+)?([^\s{]+)\s*\{/g,
    )) {
      current = { exact: location[2] === '=', name: location[3] ?? '' };
    }
    if (current) locations.push(current);
  }

  return locations;
}

// Fails the build whenever client/nginx.conf and the denylist drift apart,
// so a future proxied path can never silently fall back into the app shell.
function assertDenylistCoversNginxProxies() {
  const conf = fs.readFileSync(path.resolve(import.meta.dirname, 'nginx.conf'), 'utf8');
  const locations = nginxProxyLocations(conf);
  if (locations.length === 0) {
    throw new Error('client/nginx.conf has no proxy_pass locations; denylist check could not run.');
  }

  // Every path nginx proxies to the backend must be exempt from the app
  // shell, including navigations carrying a query string (OAuth callbacks).
  const uncovered: string[] = [];
  for (const { exact, name } of locations) {
    const probes = exact
      ? [name, `${name}?probe=1`]
      : [name, `${name}probe`, `${name}probe?probe=1`];

    for (const probe of probes) {
      if (!navigateFallbackDenylist.some((pattern) => pattern.test(probe))) uncovered.push(probe);
    }
  }

  if (uncovered.length > 0) {
    throw new Error(
      `client/nginx.conf proxies ${uncovered.join(', ')} but the navigateFallbackDenylist in ` +
        'vite.config.ts does not cover it. A full-page navigation there would be answered by the ' +
        'cached app shell instead of the backend (the Google OAuth failure). Add the path to both files.',
    );
  }

  // Reverse direction: denylist entries with no matching nginx location
  // disable the SPA fallback for paths nothing serves.
  const stale = navigateFallbackDenylist.filter(
    (pattern) => !locations.some(({ exact, name }) => pattern.test(exact ? name : `${name}probe`)),
  );

  if (stale.length > 0) {
    throw new Error(
      `navigateFallbackDenylist patterns ${stale.map(String).join(', ')} match no proxy_pass ` +
        'location in client/nginx.conf; remove them or add the matching nginx location.',
    );
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    {
      name: 'validate-sw-denylist',
      enforce: 'pre',
      buildStart() {
        assertDenylistCoversNginxProxies();
      },
    },
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      devOptions: { enabled: false },
      includeAssets: [
        'favicon.ico',
        'icons/favicon.svg',
        'icons/favicon-32.png',
        'icons/pwa-icon.svg',
        'icons/apple-touch-icon.png',
        'icons/pwa-192.png',
        'icons/pwa-512.png',
        'icons/maskable-192.png',
        'icons/maskable-512.png',
      ],
      manifest: {
        name: 'Xế iu',
        short_name: 'Xế iu',
        description: 'Theo dõi số km, lịch bảo dưỡng và chi phí của xế iu',
        theme_color: '#f9f9fb',
        background_color: '#f9f9fb',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icons/pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist,
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
});
