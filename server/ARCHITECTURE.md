# Backend architecture

Backend uses hexagonal boundaries:

```text
cmd/api                         composition root
internal/domain                 transport-independent data model
internal/application            authentication, device, and sync use cases
internal/ports                  persistence capabilities required by use cases
internal/adapters/httpapi       Gin transport, cookies, CSRF, CORS
internal/adapters/memory        current process-local persistence
internal/platform               configuration and logging
```

The memory store deliberately performs sequence allocation, entity update, changefeed append, and processed-mutation recording under one lock. The PostgreSQL adapter must preserve this as one database transaction.

## Planned persistence layout

```text
cmd/migrate/
db/migrations/
db/queries/
internal/adapters/postgres/
internal/adapters/redis/
sqlc.yaml
```

- sqlc owns stable, typed SQL queries and generated row models inside the PostgreSQL adapter.
- sqlx owns connection setup and transaction orchestration; it must not create a parallel repository API.
- Generated SQL models do not cross the adapter boundary.
- Redis replaces only session/token capabilities. Account and sync data remain in PostgreSQL.
- The migration command will expose `go run ./cmd/migrate up|down|status` and use source-controlled migrations.
- API startup must never run migrations automatically.

Kubernetes injects configuration through environment variables. `godotenv` is a local convenience and does not override existing environment variables.
