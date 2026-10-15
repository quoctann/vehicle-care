# Backend architecture

Backend uses hexagonal boundaries:

```text
cmd/api                         composition root
cmd/migrate                     go run ./cmd/migrate up|down|status|create <name>
internal/domain                 transport-independent data model
internal/application            authentication, device, and sync use cases
application/*/port.go           persistence capabilities required by each use case
internal/adapters/httpapi       Gin transport, cookies, CSRF, CORS
internal/adapters/postgres      sqlc-generated queries + sqlx transaction orchestration
internal/adapters/redis         session/token store
internal/platform               configuration and logging
db/migrations/, db/queries/, sqlc.yaml
```

The `postgres` adapter implements the application ports' account/sync methods and must
preserve the invariant: sequence allocation, entity update, changefeed append, and
processed-mutation recording happen atomically inside one database transaction.

## Persistence layout (implemented)

- sqlc owns stable, typed SQL queries and generated row models inside the PostgreSQL adapter.
- sqlx owns connection setup and transaction orchestration; it does not create a parallel repository API.
- Generated SQL models do not cross the adapter boundary.
- Redis replaces only session/token capabilities. Account and sync data remain in PostgreSQL.
- The migration command exposes `go run ./cmd/migrate up|down|status|create <name>` and uses source-controlled migrations under `db/migrations/`. Migration files are timestamp-prefixed (`<unix_timestamp>_<name>.up.sql`/`.down.sql`), not sequentially numbered, so migrations authored on parallel branches never collide on ordering; `create` generates the timestamp and a sanitized snake_case name automatically. `db/migrations.Up(db)` is the shared "apply everything pending" implementation — used by `cmd/migrate up`, `cmd/api`'s optional startup auto-migration, and `pgtest`.
- The current PostgreSQL history is consolidated into `1790121600_baseline` (Unix seconds, same format as the generator) and supports fresh databases only. A development database carrying replaced versions, including the earlier `20260923000000` baseline, must be reset explicitly or replaced by a new development database; neither API startup nor the migration command drops it automatically.
- API startup does not run migrations automatically by default. `AUTO_MIGRATE=true` (local dev only, default off) makes `cmd/api` call `db/migrations.Up` before it starts listening — a convenience so `make dev-be` never fails on a stale schema. Production/Kubernetes should leave it off and keep migrations a separate, explicit deploy step; `migrations.Up` is still safe to enable everywhere if ever needed, since golang-migrate's Postgres driver holds a session-level advisory lock for the run, so concurrent callers (e.g. several replicas racing on startup) serialize instead of corrupting state — the deploy-step preference is about change control, not a correctness requirement.
- Sync push is intentionally serialized one mutation at a time. The HTTP request keeps a batch envelope for compatibility, but processing stops at the first retryable or terminal result. This preserves FIFO dependency order and keeps partial success explicit.
- Each mutation transaction first locks the account sequence row, then checks dedupe. Concurrent retries cannot both decide to apply a missing mutation. Sequence/entity/feed/ACK commit together. An idempotency unique-key collision is retryable, not a terminal validation result.
- Pull uses a stateless `until_seq` upper bound instead of persisted watermarks. The client applies a page and advances `last_seen_seq` only in one local transaction while the account outbox is clean.
- The client outbox has account-scoped `local_seq`, immutable mutation envelopes, `pending` and `blocked` states. Retryable failures require explicit retry; terminal failures require repair or restore from server.
- Normal sync and restore share one account-scoped Web Lock (with an in-process fallback). Restore persists its operation state, blocks local writes, and resumes from the last page committed atomically with its cursor.
- New local edits defer pull without creating a failure or disabling auto-sync. Equal-version pull still applies canonical fields after a metadata-only ACK. IndexedDB's workspace device identity is preserved across localStorage loss.
- `make test-integration` requires real PostgreSQL testcontainers and fails if Docker is unavailable (`REQUIRE_POSTGRES_TESTS=1`), unlike the optional local-development test mode.

Kubernetes injects configuration through environment variables. `godotenv` is a local convenience and does not override existing environment variables.
