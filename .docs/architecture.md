# Backend architecture

Backend uses hexagonal boundaries:

```text
cmd/api                         composition root
cmd/migrate                     go run ./cmd/migrate up|down|status|seed|create <name>
internal/domain                 transport-independent data model
internal/application            authentication, device, and sync use cases
internal/ports                  persistence capabilities required by use cases (Store)
internal/adapters/httpapi       Gin transport, cookies, CSRF, CORS
internal/adapters/postgres      sqlc-generated queries + sqlx transaction orchestration
internal/adapters/redis         session/token store
internal/platform               configuration and logging
db/migrations/, db/queries/, sqlc.yaml
```

The `postgres` adapter implements the `Store` port's account/sync methods and must
preserve the invariant: sequence allocation, entity update, changefeed append, and
processed-mutation recording happen atomically inside one database transaction.

## Persistence layout (implemented)

- sqlc owns stable, typed SQL queries and generated row models inside the PostgreSQL adapter.
- sqlx owns connection setup and transaction orchestration; it does not create a parallel repository API.
- Generated SQL models do not cross the adapter boundary.
- Redis replaces only session/token capabilities. Account and sync data remain in PostgreSQL.
- The migration command exposes `go run ./cmd/migrate up|down|status|create <name>` and uses source-controlled migrations under `db/migrations/`. Migration files are timestamp-prefixed (`<unix_timestamp>_<name>.up.sql`/`.down.sql`), not sequentially numbered, so migrations authored on parallel branches never collide on ordering; `create` generates the timestamp and a sanitized snake_case name automatically. `db/migrations.Up(db)` is the shared "apply everything pending" implementation — used by `cmd/migrate up`, `cmd/api`'s optional startup auto-migration, and `pgtest`.
- API startup does not run migrations automatically by default. `AUTO_MIGRATE=true` (local dev only, default off) makes `cmd/api` call `db/migrations.Up` before it starts listening — a convenience so `make dev-be` never fails on a stale schema. Production/Kubernetes should leave it off and keep migrations a separate, explicit deploy step; `migrations.Up` is still safe to enable everywhere if ever needed, since golang-migrate's Postgres driver holds a session-level advisory lock for the run, so concurrent callers (e.g. several replicas racing on startup) serialize instead of corrupting state — the deploy-step preference is about change control, not a correctness requirement.
- Known limitation: the Postgres adapter's `ApplyMutations` currently accepts exactly one mutation per call (matches the current `application.Service.Push` caller); the API-level batch of up to 100 mutations/request is still handled by looping this call once per mutation rather than in a single multi-row transaction. See `.docs/20260918-consolidate.md` §2.2 if this needs to become a true batch later.

Kubernetes injects configuration through environment variables. `godotenv` is a local convenience and does not override existing environment variables.
