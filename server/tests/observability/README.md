# Real backend LGTM smoke

Run from the repository root:

```sh
python3 server/tests/observability/smoke.py
```

Requires Python 3 (standard library only), the Go version in `server/go.mod`,
Docker, and sufficient memory for the LGTM all-in-one image. Missing images are
pulled automatically: PostgreSQL 16, Redis 7, `grafana/otel-lgtm:0.29.0`, and
`grafana/alloy:v1.14.0`.

The test builds and starts the real API with automatic migrations against a
disposable database and Redis. It verifies a two-request burst followed by a
retryable 429 with `Retry-After`, health exemptions, live OTLP metrics in
Prometheus, a propagated trace in Tempo, and correlated JSON logs shipped through
the checked-in Alloy configuration to Loki. A randomized unknown-path/query
probe checks that OAuth-like code/state values do not appear in that trace,
local JSON logs, queried metrics, or exported logs. This is a focused smoke
check, not proof that all application telemetry is free of sensitive data.

Every published port is dynamically assigned on loopback. Existing `.env`
files, databases, and containers are not used or modified. Only the temporary
log directory and checked-in Alloy configuration are mounted. The shared mail
smoke resource helper supplies ownership-labelled lifecycle management; only
containers and the network created by this run are removed, including on
failure or interruption. Temporary binaries/logs are deleted; command output
and raw server/exporter errors are suppressed to avoid printing credentials.
All telemetry assertions run while the API is still alive, before cleanup.
