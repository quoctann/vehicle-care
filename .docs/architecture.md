# Backend architecture

Backend uses hexagonal boundaries:

```text
cmd/api                         composition root
cmd/migrate                     go run ./cmd/migrate up|down|status|seed|create <name>
internal/domain                 transport-independent data model
internal/application            authentication, device, and sync use cases
internal/ports                  persistence capabilities required by use cases (Store)
internal/adapters/httpapi       Gin transport, cookies, CSRF, CORS
internal/adapters/memory        process-local persistence (STORE_DRIVER=memory, default for dev/test)
internal/adapters/postgres      sqlc-generated queries + sqlx transaction orchestration (STORE_DRIVER=live)
internal/adapters/redis         session/token store (STORE_DRIVER=live)
internal/platform               configuration and logging
db/migrations/, db/queries/, sqlc.yaml
```

Both the `memory` and `postgres` adapters implement the same `Store` port and must
preserve the same invariant: sequence allocation, entity update, changefeed append,
and processed-mutation recording happen atomically (one lock for `memory`, one
database transaction for `postgres`).

## Persistence layout (implemented)

- sqlc owns stable, typed SQL queries and generated row models inside the PostgreSQL adapter.
- sqlx owns connection setup and transaction orchestration; it does not create a parallel repository API.
- Generated SQL models do not cross the adapter boundary.
- Redis replaces only session/token capabilities. Account and sync data remain in PostgreSQL.
- The migration command exposes `go run ./cmd/migrate up|down|status|seed|create <name>` and uses source-controlled migrations under `db/migrations/`. Migration files are timestamp-prefixed (`<unix_timestamp>_<name>.up.sql`/`.down.sql`), not sequentially numbered, so migrations authored on parallel branches never collide on ordering; `create` generates the timestamp and a sanitized snake_case name automatically.
- API startup never runs migrations automatically.
- Known limitation: the Postgres adapter's `ApplyMutations` currently accepts exactly one mutation per call (matches the current `application.Service.Push` caller); the API-level batch of up to 100 mutations/request is still handled by looping this call once per mutation rather than in a single multi-row transaction. See `.docs/20260918-consolidate.md` §2.2 if this needs to become a true batch later.

Kubernetes injects configuration through environment variables. `godotenv` is a local convenience and does not override existing environment variables.
