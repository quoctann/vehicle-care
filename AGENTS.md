# Repository guidance

## Sources of truth
- `.docs/decision.md` is the authoritative architecture, API/sync contract, and recovery runbook. The HTML files in `.docs/` are layout prototypes, not feature specifications; preserve their bytes.
- Read `server/db/README.md` before schema/query work. Prefer executable config over stale prose: `server/go.mod` requires Go **1.25.11**, despite the README's 1.24+ claim.

## Running locally
- Separate projects: npm/lockfile in `client/`, Go module in `server/`; there is no root npm package. Use Node 22 (CI) and GNU Make/Bash.
- Root setup sequence: `make install`, `make dev-infra`, `make migrate-up`, `make dev`. DB settings are required; use `.env.example` as reference without overwriting existing local env files.
- Make runs Go from `server/`: config loads `server/.env` then root `.env`, without overriding existing environment variables. `AUTO_MIGRATE` defaults false, but `.env.example` enables it.
- `make dev-fe` sets `VITE_API_BASE_URL=http://localhost:8080`; frontend is on 5173. Development uses the real backend, PostgreSQL, and Redis—no MSW or demo account. Match `FRONTEND_ORIGIN` to the frontend origin and use `COOKIE_SECURE=false` for local HTTP.
- Ctrl+C stops app processes; infrastructure needs `make dev-infra-down` separately.

## Verification
- Root checks: `make lint`, `make build`, `make test`; each supports `-fe` / `-be` suffixes. Frontend lint is **oxlint**; build runs **`tsc -b`** then Vite (no separate typecheck script). Backend lint is `go vet`; tests use `-race`.
- Single frontend test: `npm run test --prefix client -- src/domain/odometer.test.ts` (optionally append `-t 'test name'`). Vitest defaults to Node with `fake-indexeddb/auto`, not jsdom.
- Focused Go test, from `server/`: `go test -race ./internal/application/datasync -run TestName`.
- `make test-integration` forces PostgreSQL testcontainers tests with Docker, disables Go test caching, and fails rather than skipping when Docker is unavailable. Ordinary `make test` can skip PostgreSQL tests.
- `npm run test:coverage:contracts --prefix client` enforces 80% only on the contract/persistence files listed in `client/vitest.contract.config.ts`, not all source.
- Browser setup: from `client/`, `npx playwright install chromium`. Run `npm run test:e2e --prefix client`; append `-- e2e/<file>.spec.ts` to focus. Optional installed Chrome: `PLAYWRIGHT_CHANNEL=chrome`. Playwright starts its own Vite on **4179**, mocks API calls, and blocks service workers; it does not verify real backend sync or PWA offline navigation.
- CI runs backend vet/tests and frontend lint/build; it does **not** run frontend unit, coverage, or E2E suites.

## Boundaries and invariants
- Local-first flow: UI → `client/src/data/repositories` → Dexie entity + immutable outbox in **one transaction**. Read through `data/queries`; entity state belongs in IndexedDB, not Zustand. `App.tsx` hydrates session and starts auto-sync.
- `client/src/sync/syncOrchestrator.ts` bootstraps, pushes FIFO, then pulls only once unresolved outbox work is cleared. Preserve account locks/session guards and retry identity; do not replace this with direct UI-to-API writes.
- Wire contracts are snake_case; local/domain records are camelCase via `data/mappers.ts`. Mutable sync payloads are full-record snapshots, not patches. See `api/contract.types.ts` and compile-time checks in `api/contract.typecheck.ts` when changing contracts.
- Odometer logs are append-only; editing/deleting Fuel or Service must not cascade to linked odometer records. Account timezones are fixed UTC offsets, not IANA/DST zones.
- Backend composition is `server/cmd/api/main.go`. Application ports live in `internal/application/{user,datasync}/port.go`; application code must not depend on adapters or expose generated SQL models.
- PostgreSQL mutation processing locks the account sequence **before** dedupe/stateful validation; entity, sequence, changefeed, and saved ACK commit in one transaction.

## Database changes and deployment
- Create new migration pairs with `make migrate-create name=<name>`; do not edit applied migrations or extend the baseline for new changes.
- Edit `server/db/queries/` and run `sqlc generate` **from `server/`** (requires a separately installed sqlc CLI). Commit generated changes in `internal/adapters/postgres/sqlcgen/`; never hand-edit them. No `go generate` workflow exists. Generation and migration are separate steps.
- Baseline `1790121600_baseline` only supports clean databases; old histories or an earlier version of that same baseline do not auto-upgrade. Follow `.docs/decision.md` §8 for recovery; never automatically drop/reset the database or discard local outbox data.
- Production migrations are a separate deploy step with `AUTO_MIGRATE=false`. This repo publishes images; `.github/workflows/ci-cd.yml` dispatches deployment to `quoctann/pisces-infra` rather than deploying directly.
