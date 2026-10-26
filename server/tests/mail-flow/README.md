# Real mail-flow smoke test

From the repository root:

```sh
python3 server/tests/mail-flow/smoke.py
```

Requires Python 3 (stdlib only), Docker with a running daemon, Go 1.25.11
(or Go's automatic toolchain download), and network access for images/modules.
No frontend or existing local services need to run.

The script pulls PostgreSQL 16, Redis 7 and Mailpit 1.27 images, creates a unique
Docker network and three disposable containers, and publishes only dynamically
allocated loopback ports. PostgreSQL uses tmpfs; there are no host data mounts.
It builds the current Go API into a temporary directory under `/tmp/opencode`,
starts it there with explicit isolated configuration and `AUTO_MIGRATE=true`, and
uses Mailpit's HTTP API to inspect mail actually delivered over SMTP.
It never reads local `.env` files or changes existing containers/databases.

Checks include signup/verification mail, fragment-only tokens, one-use
verification/reset, generic no-mail recovery responses, password change,
revocation of multiple old sessions, and preservation of an unrelated session
and its cookies during reset. This is a backend test, not browser E2E coverage.

Exit code is nonzero on failure. Output intentionally excludes tokens, passwords,
mail bodies, compiler output and server logs. Normal completion, failures,
Ctrl+C and SIGTERM attempt to stop the API and remove only this run's labeled
containers (including anonymous volumes), network and temporary directory.
SIGKILL/power loss cannot be cleaned up automatically; resources are identifiable
by their unique `vehicle-mail-smoke-<uuid>` names and matching `mail-smoke` label.
Pulled images and normal Go caches are retained.
