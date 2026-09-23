# Incremental Sync A — Implementation Plan

Status: **implementation and regression fixes in the working tree; PostgreSQL/browser acceptance pending**.
This document records the approved simple design and verification checklist.
It does not run or imply a database reset. See verification status below.

## Goal

Keep local-first behavior without introducing CRDT, server snapshots, field-level
merge or a distributed queue. The flow is deliberately sequential:

```text
local write -> FIFO outbox -> push until queue is clean -> pull bounded feed -> synced
```

## Invariants

- No silent error and no automatic retry loop.
- Every blocked mutation has a reason and an action.
- “Try again” is only for retryable failures.
- A terminal mutation is never retried with its original payload.
- Pull does not run while the account has pending or blocked outbox items.
- A pull page and its cursor commit atomically only while the queue is clean.
- “Synced” requires zero pending/blocked items and a completed pull.
- Restore from server is always available as an explicit escape hatch.
- Repair creates a new mutation ID and keeps the repaired item at the blocked queue position.
- Timeout/network errors keep the original mutation ID/payload because the server may have committed it.
- Local edits during sync are deferred work, not failures: keep the cursor and last successful timestamp, set pending, and leave automatic sync enabled.
- The workspace's IndexedDB device ID is authoritative for retry, even if localStorage changes or is unavailable.

## Client work

- Dexie v6-v9 migrations add account-scoped `localSeq`, `nextLocalSeq`, explicit failure kind and persisted restore state.
- Outbox stores only actionable `pending` and terminal `blocked` rows; successful rows are deleted.
- Push sends one immutable envelope at a time and stops on the first non-success.
- Retryable failure requires an explicit user action; auto-sync skips while `lastSyncError` exists.
- Terminal failure is visible with repair and restore actions.
- Pull uses `until_seq`; page apply checks outbox cleanliness inside the same Dexie transaction.
- Restore clears local account data/outbox, resets cursor, and rebuilds from server feed. Committed pages survive a reload during restore.
- Sync and restore share one account lock. While restore is active or failed, local entity writes abort in their IndexedDB transaction.
- Bootstrap only patches current sync metadata after network calls; it never writes an old `nextLocalSeq` snapshot back.
- Repair replaces the blocked envelope in-place without overwriting a newer local snapshot for the same entity.
- Reminder IDs are deterministic from account + vehicle + part type so concurrent offline creation converges to one entity ID.
- Session hydration can open cached local workspace on network/server failure, but 401 still requires login. Explicit logout removes the cache.
- Onboarding includes sync/recovery actions even when no vehicle has been loaded yet.
- A separate recovery action is reachable even for retryable pull failures; offline repair is allowed, destructive restore requires online access and explicit confirmation.
- Equal-version pull applies canonical odometer data after ACK; older feed versions are ignored.
- PartType replication uses the changefeed; the old catalog refresh helper is removed from the application flow.

## Server work

- `POST /sync/push` keeps the array envelope but processes one mutation per storage transaction.
- Results are returned as a processed prefix; terminal/retryable result stops later mutations.
- Dedupe lookup happens before state-dependent validation.
- Account sequence row is locked before dedupe lookup, serializing overlapping retries of a previously missing mutation ID. An idempotency-key unique violation is never treated as terminal payload rejection.
- ACK timestamps use PostgreSQL microsecond precision from the first response, so retries return the same timestamp as well as the same sequence.
- Database failures remain retryable/infrastructure errors instead of becoming ownership errors.
- Changefeed payload is canonicalized from the persisted row.
- `GET /sync/pull` uses stateless `until_seq`; persisted pull watermarks are removed by migration.
- PartType seed rows receive account sequence numbers and changefeed entries during signup.
- Account-owned inactive PartTypes remain valid references for offline records created before another device disabled the category.
- Mutable writes use server-order full-record LWW. `base_server_seq` and `conflict_resolved` are no longer part of the current wire contract.

## Explicit trade-offs

- A blocked mutation blocks the account queue on that device until repair or restore.
- Pull from another device is delayed while local work is blocked.
- Repair uses a generic payload editor for now; domain-specific repair UI can replace it later.
- The HTTP request still accepts an array for compatibility, even though the client sends one item per request.
- PostgreSQL migrations are consolidated into `1790121600_baseline` (Unix seconds, consistent with `migrate create`) for a fresh database. Existing development history, including the earlier `20260923000000` baseline, is incompatible; reset is manual.

## Manual dev reset runbook

Do this only when intentionally testing from an empty state:

1. Stop API and frontend tabs.
2. Preserve anything needed from the local development services.
3. For the provided disposable Docker Compose stack, run `docker compose -f server/docker-compose.yml down -v`. This permanently deletes its PostgreSQL volume.
4. Run `make dev-infra`, then `make migrate-up`.
5. If Redis is external instead, clear only this app's session/token keys; the Compose command above recreates its non-persistent Redis instance.
6. In every browser/profile used for testing, clear site data for the frontend origin, including IndexedDB, Cache Storage and service workers.
7. Start the app, create a new account, and test two devices/profiles.

The implementation never drops a schema automatically. Resetting PostgreSQL while
keeping a browser outbox/cursor is unsupported.

## Acceptance checklist

- Parent entity is pushed before child entity even when timestamps are equal.
- Lost push response retries idempotently without duplicate changefeed entries.
- Retryable result does not auto-retry; explicit retry runs once.
- Terminal result becomes blocked and is not resent on reload/foreground.
- Items after a blocked item do not bypass it.
- Repair replaces the blocked mutation with a new ID and resumes FIFO.
- Pending/blocked queue prevents normal pull and synced status.
- Local write racing with pull leaves cursor unchanged and does not overwrite the local write.
- Restore removes local unsynced work, rebuilds all entities, and reaches synced.
- Restore failure/reload can continue from the last committed page.
- Two tabs do not run the same account sync concurrently when Web Locks are used.
- Deleted fuel/service logs are excluded consistently from history and costs.
- PostgreSQL integration tests run with Docker instead of passing only because they were skipped.

## Verification status

- Latest local checks (23/09/2026): 17 frontend test files / 80 tests passed; Go tests with `-race` passed in optional-integration mode; lint/vet and frontend/backend builds passed. Existing Fast Refresh and bundle-size warnings remain. `git diff --check` passed.
- Regression tests cover full client push/ACK/pull, canonical odometer rounding, deferred local edits, repair-to-synced, restore-to-synced and device-stable retry after lost response. HTTP is mocked; these are not browser E2E tests.
- PostgreSQL fixtures register devices, account for the signup seed sequences and run seeding inside transactions. A concurrent same-mutation retry test expects one apply, duplicate acknowledgments and one changefeed row.
- `make test-integration` sets `REQUIRE_POSTGRES_TESTS=1` and disables Go test caching. Docker unavailable is a failure in this mode; ordinary `make test` may skip PostgreSQL tests for local development.
- `make test-integration` was attempted and failed at container startup because this environment cannot start Docker (13 adapter tests + 1 seed test). Their database assertions have not been verified here. PostgreSQL integration and real-browser multi-tab/recovery acceptance must still run before declaring the checklist fully verified. No development database reset has been performed.
