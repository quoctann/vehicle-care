# Production nginx routing smoke test

From the repository root:

```sh
python3 client/tests/nginx-routing/smoke.py
```

Prerequisites: Python 3, Docker CLI and a running Docker daemon. The harness pulls
`nginxinc/nginx-unprivileged:1.29-alpine` (matching `client/Dockerfile`) and
`python:3.13-alpine` if absent. Missing prerequisites fail the command, not skip it.
No host nginx, app build, database, Redis, or npm installation is required.

The production `client/nginx.conf` is mounted **unchanged and read-only**. A unique
Docker network resolves `vehicle-care-backend` to a disposable Python echo fixture.
nginx publishes an ephemeral port on loopback only. Temporary HTML/assets are test
fixtures, not a frontend build. Containers, network and temporary files are cleaned
up on success or failure. Temporary files use `/tmp/opencode` by default (`TMPDIR`
overrides it).

Checks run against real nginx: `nginx -t`, account timezone POST method/path/body,
query preservation, cookies/CSRF, forwarded headers, upstream status/JSON/response
cookie, existing auth/devices/sync routes, SPA `/settings` fallback, static asset
cache headers, missing asset 404, and `/healthz`. This tests routing, **not** backend
authentication, timezone validation, or real database writes. `/part-types` routing
is outside this change's scope.

For regression experiments without editing the production file:

```sh
python3 client/tests/nginx-routing/smoke.py --config /absolute/path/to/nginx.conf
```
