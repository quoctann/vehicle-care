# Adding endpoints and integration paths

Practical guide for wiring new backend↔frontend integrations without breaking
the same-origin proxy topology or the PWA service worker. Written after the
**2026-11-06 Google OAuth incident**, where one user-visible symptom ("clicking
Google just puts me back on `/sign-in`") turned out to be three stacked problems:
a stale deployment, a service worker that swallowed backend navigations, and a
CDN serving an outdated worker script. Read together with:

- `.docs/decision.md` — authoritative architecture, Google OAuth config (§8)
- `.docs/flow.md` — the Google OAuth transaction flow end to end
- `client/nginx.conf` — the actual proxy configuration
- `client/vite.config.ts` — the denylist and its build-time guard

## 1. The topology in one paragraph

The browser only ever talks to **one public origin** (e.g.
`https://app.example.com`). `client/nginx.conf` proxies selected top-level
paths to the backend Kubernetes Service; everything else falls back to the SPA
(`try_files ... /index.html`). `VITE_API_BASE_URL` is empty in production so
fetches stay same-origin — this is what keeps `SameSite=Lax` session cookies
and CSRF double-submit working.

| nginx location | Kind | Serves |
|---|---|---|
| `location /auth/`, `/account/`, `/devices/`, `/sync/` | prefix proxy | backend |
| `location = /part-types` | exact proxy | backend (registered without trailing slash) |
| `location = /auth/google/callback` | exact proxy | backend, access/error logging disabled (never log OAuth query) |
| `location = /sw.js` | static | service worker, `Cache-Control: no-cache` |
| `location = /healthz` | static | nginx itself, `200 ok` (pod probes only) |
| `location /assets/` | static | hashed assets, `immutable` 1-year cache |
| `location /` | SPA fallback | `index.html` for all app routes |

## 2. Risk map: when can the service worker break an integration?

The Workbox `NavigationRoute` created by `navigateFallback` intercepts only
**document navigations** (`request.mode === 'navigate'`). It never touches
`fetch()`/XHR.

| Scenario | Service worker risk | Action |
|---|---|---|
| New endpoint called via `fetch()` (the `api/client.ts` pattern) | **None** | Nothing worker-related |
| New endpoint under an existing prefix (`/auth/...`, `/sync/...`) | **None** — prefix locations and denylist regexes cover sub-paths automatically | Nothing worker-related |
| New **top-level** backend prefix + `fetch()` only | None for the worker, but nginx must proxy it or the SPA fallback answers with HTML | Add nginx location |
| New **full-page navigation** to a backend path (OAuth/SSO start, provider callback, payment redirect, download links) | **This is the incident class** — the cached app shell answers instead of the backend's 302 chain | nginx location **and** denylist entry; the build guard enforces the pair |

## 3. Checklist by scenario

### A. Endpoint under an existing prefix (e.g. `/auth/magic-link`)

1. Register the route in `server/internal/adapters/httpapi/server.go` (`routes()`).
2. Wire contracts: `client/src/api/contract.types.ts` (snake_case on the wire),
   compile-time checks in `api/contract.typecheck.ts`, `data/mappers.ts` for
   local-first entities — see the repo `AGENTS.md` invariants.
3. No nginx/denylist changes needed.

### B. New top-level backend prefix (e.g. `/billing/`)

1. Everything in A, plus:
2. Add the nginx `location` block in `client/nginx.conf` (copy the proxy
   headers: `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`).
3. Add the matching regex to `navigateFallbackDenylist` in
   `client/vite.config.ts`. **If you forget, `npm run build` fails** with the
   uncovered path (see §4). Use `^\/billing\/` (trailing slash) so the denylist
   does not over-match SPA paths, mirroring nginx prefix semantics.
4. Extend `client/tests/nginx-routing/smoke.py` (`check_proxy` for the new
   prefix, incl. query preservation).
5. If any flow **navigates** to the prefix, add it to `BACKEND_NAVIGATIONS` in
   `client/e2e-pwa/backend-navigation.spec.ts`.

### C. Full-page navigation flow (OAuth/SSO/payment redirects)

1. Everything in B for **both** directions: the outbound start path *and* the
   provider's return callback must live under denied prefixes. A missing
   denylist on the callback silently destroys the authorization code — the SPA
   boots, `useGoogleCallback`/`googleCallback()` strips `code`/`state` from the
   URL, and the backend never sees them.
2. Navigate with `window.location.href`, never `fetch()` — the backend answers
   with a browser redirect chain.
3. Validate provider authorization URLs before navigating
   (see `trustedGoogleAuthorizationUrl` in `client/src/lib/googleAuth.ts`).
4. Follow `.docs/flow.md` for the transaction/state/cookie pattern, and
   `.docs/decision.md` §8 for provider env/credentials injected at the infra
   layer (never baked into images or `VITE_*`).

## 4. The build guard: `validate-sw-denylist`

`client/vite.config.ts` registers a plugin that parses `client/nginx.conf` on
every build start (dev, `vite build`, CI build job, Docker image build,
e2e-pwa programmatic builds, vitest) and **fails the build** when:

- nginx proxies a path the denylist does not cover (the incident class), or
- a denylist regex matches no nginx proxy location (stale entry disables the
  SPA fallback for a path nothing serves).

Error example:

```
client/nginx.conf proxies /billing/, /billing/probe, /billing/probe?probe=1 but
the navigateFallbackDenylist in vite.config.ts does not cover it. ... Add the
path to both files.
```

Fix the error by aligning the two files — do not silence the guard. The denylist
source lives in a `const navigateFallbackDenylist` at the top of
`vite.config.ts`, shared by the guard and `VitePWA`.

## 5. Which test catches what

| Layer | Catches | Cannot catch |
|---|---|---|
| `client/tests/nginx-routing/smoke.py` (real nginx in Docker) | proxy routing, header forwarding, `sw.js` no-cache, OAuth query kept out of logs | service worker behavior |
| `client/e2e/*.spec.ts` (Playwright, **service workers blocked**) | UI flows against mocked API | anything worker-related — passing e2e is *not* evidence the worker is fine |
| `client/e2e-pwa/*.spec.ts` (real worker, real A/B builds) | worker navigation passthrough (`backend-navigation.spec.ts`), update consent flow (`update.spec.ts`) | real backend/OAuth |
| Backend Go tests | handler/service logic | routing/nginx/worker |

When touching routing or the worker, run the first and third locally:
`python3 client/tests/nginx-routing/smoke.py` and, from `client/`,
`npx playwright test --config playwright.pwa.config.ts`.

## 6. Deploying worker changes (the non-code traps)

- **`registerType: 'prompt'`**: users keep the *old* worker until they accept
  the "Cập nhật" toast and confirm per tab. During a worker incident,
  **deployed ≠ live for users** — the fix only reaches them after they accept
  the prompt.
- **nginx serves `sw.js` with `Cache-Control: no-cache`** so browsers/CDNs
  revalidate the worker script. Never add a long TTL for it.
- **Cloudflare** (or any CDN in front): `.js` is cached by extension, and a
  zone *Browser Cache TTL* override can beat the origin header (observed
  `max-age=14400`). Configure once, at the CDN:
  - Cache Rule for `/sw.js` → **Bypass cache**
  - Browser Cache TTL → **Respect Existing Headers**
  - Until that is set, **purge the `sw.js` URL after every deploy that changes
    it**, or browsers keep updating from the stale edge entry.
- **Verify the deploy actually rolled out** before debugging "the fix doesn't
  work": in this incident the pipeline had not shipped the new images at all
  while the code looked correct in `main`. Check the Actions run, the infra
  dispatch, Argo CD sync, then confirm live assets, e.g.
  `curl -sI https://<origin>/sw.js` (`last-modified`) or grep the live bundle
  for a string only the new build contains.

## 7. Debugging playbook: "clicking X bounces me back to /sign-in"

1. **`GET /auth/session → 401` is normal for anonymous users** —
   `requireSession` rejects a missing `sid` cookie before touching Redis. It is
   a red herring; do not chase it.
2. Reproduce without the worker: `curl -i 'https://<origin>/auth/google/start'`
   - `302 → https://accounts.google.com/...` — backend fine; suspect the
     worker/CDN (continue at step 4).
   - `302 → .../sign-in?google_error=<code>` — backend answered; the code is
     the reason (`unavailable` = feature flag/env or Redis limiter, `failed` =
     transaction cookie, `expired` = replayed state; see `.docs/flow.md`).
   - `200` HTML or a body like `{"error":...}` from an old build — the deploy
     is stale; fix the pipeline first (§6).
3. Reproduce in an **incognito window** (no service worker). Works there but
   not in a normal window → the browser is running an old worker.
4. Check the CDN between the browser and the worker script:
   `curl -sI 'https://<origin>/sw.js'` → `cf-cache-status: HIT` with an old
   `last-modified` means the edge is serving a stale worker. Compare with a
   cache-busted fetch (`/sw.js?x=1`, forced `MISS`) to see what the origin
   really has. Purge if they differ.
5. In the browser, DevTools → Application → Service Workers: **Unregister**
   (or accept the update prompt) and reload to pick up the new worker.

## 8. Incident record: 2026-11-06

Symptom: clicking Google on `/sign-in` navigated to `/auth/google/start`, then
landed back on `/sign-in`; `GET /auth/session` returned 401; the Google consent
page never appeared. Three stacked root causes:

1. **Stale deployment** — production still ran the Oct 26 images; the backend
   answered with the pre-OAuth stub `400 "Google sign-in is not implemented
   yet."` (removed in `e68dfaa`). Re-triggering the pipeline fixed it.
2. **Service worker app shell swallowed the OAuth navigation** —
   `navigateFallback` had no denylist, so the worker answered
   `/auth/google/start` (and would have answered `/auth/google/callback`) with
   cached `index.html`; the SPA router then bounced to `/sign-in`. Fixed by the
   `navigateFallbackDenylist`, the nginx `sw.js` no-cache header, the
   `validate-sw-denylist` build guard, and the `e2e-pwa/backend-navigation.spec.ts`
   regression test.
3. **Cloudflare served the old `sw.js`** (`cf-cache-status: HIT`,
   last-modified Oct 26) even after the correct deploy, so browsers never
   discovered the new worker; the zone also forced `max-age=14400` over the
   origin `no-cache`. Fixed by purging; the durable CDN settings in §6 were
   still pending at the time of writing.
