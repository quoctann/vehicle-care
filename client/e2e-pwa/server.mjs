import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';

// Build markers exist only in disposable output; tracked source is never rewritten.
const directory = await mkdtemp('/tmp/opencode/vehicle-pwa-');
let current = 'A';
try {
  for (const version of ['A', 'B']) {
    await build({
      mode: 'production',
      build: { outDir: path.join(directory, version), emptyOutDir: true },
      plugins: [
        {
          name: 'pwa-regression-build-marker',
          transform(code, id) {
            if (id === path.resolve('src/main.tsx')) {
              return `document.documentElement.dataset.pwaBuild = ${JSON.stringify(version)};\n${code}`;
            }
          },
          transformIndexHtml: () => [
            {
              tag: 'meta',
              attrs: { name: 'pwa-test-build', content: version },
              injectTo: 'head',
            },
          ],
        },
      ],
      // Same-origin topology like the production nginx proxy: an empty
      // VITE_API_BASE_URL makes browser navigations to backend paths (for
      // example the Google OAuth start) stay on this origin, where the
      // fixture below answers them instead of the SPA fallback.
      define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('') },
    });
  }
} catch (error) {
  await rm(directory, { recursive: true, force: true });
  throw error;
}

const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost:4180');
    response.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/__pwa/ready') return response.end('ready');
    if (url.pathname === '/__pwa/build/B' && request.method === 'POST') {
      current = 'B';
      return response.end('B');
    }
    // A disposable auth fixture, not a mocked worker or application entrypoint.
    // Mirrors client/nginx.conf: prefix locations proxy /auth/, /account/,
    // /devices/, /sync/ and the exact /part-types to the backend instead of
    // the SPA fallback, so the real service worker topology is exercised.
    const backendProxied =
      ['/auth/', '/account/', '/devices/', '/sync/'].some((prefix) =>
        url.pathname.startsWith(prefix),
      ) || url.pathname === '/part-types';
    if (backendProxied) {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      return response.end(
        JSON.stringify({
          error: {
            code: 'auth_invalid',
            message: 'Sign in',
            retryable: false,
            request_id: 'pwa-fixture',
          },
        }),
      );
    }
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const root = path.join(directory, current);
    const target = path.resolve(root, relative);
    if (!target.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403);
      return response.end();
    }
    let content;
    let extension = path.extname(target);
    try {
      content = await readFile(target);
    } catch {
      // Retain A's content-addressed chunks throughout rollout, like production hosting.
      if (relative.startsWith('assets/')) {
        content = await readFile(path.join(directory, 'A', relative));
      } else if (!extension) {
        content = await readFile(path.join(root, 'index.html'));
        extension = '.html';
      } else {
        response.writeHead(404);
        return response.end();
      }
    }
    response.writeHead(200, { 'Content-Type': mime[extension] || 'application/octet-stream' });
    response.end(content);
  } catch {
    response.writeHead(500);
    response.end('PWA fixture request failed');
  }
});
server.listen(4180, 'localhost');

async function shutdown() {
  server.close();
  await rm(directory, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
