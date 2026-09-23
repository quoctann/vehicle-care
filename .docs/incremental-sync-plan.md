# Incremental Sync A — Implementation Plan

Status: **implemented in the current working tree**. This document records the
approved simple design and the verification checklist. It does not run or imply a
database reset.

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

## Client work

- Dexie v6/v7/v8 migrations add account-scoped `localSeq`, `nextLocalSeq`, and explicit failure kind.
- Outbox stores only actionable `pending` and terminal `blocked` rows; successful rows are deleted.
- Push sends one immutable envelope at a time and stops on the first non-success.
- Retryable failure requires an explicit user action; auto-sync skips while `lastSyncError` exists.
- Terminal failure is visible with repair and restore actions.
- Pull uses `until_seq`; page apply checks outbox cleanliness inside the same Dexie transaction.
- Restore clears local account data/outbox, resets cursor, and rebuilds from server feed. Committed pages survive a reload during restore.
- Session hydration can open cached local workspace on network/server failure, but 401 still requires login. Explicit logout removes the cache.
- PartType replication uses the changefeed; the old catalog refresh helper is removed from the application flow.

## Server work

- `POST /sync/push` keeps the array envelope but processes one mutation per storage transaction.
- Results are returned as a processed prefix; terminal/retryable result stops later mutations.
- Dedupe lookup happens before state-dependent validation.
- Database failures remain retryable/infrastructure errors instead of becoming ownership errors.
- Changefeed payload is canonicalized from the persisted row.
- `GET /sync/pull` uses stateless `until_seq`; persisted pull watermarks are removed by migration.
- PartType seed rows receive account sequence numbers and changefeed entries during signup.
- Mutable writes use server-order full-record LWW. `base_server_seq` and `conflict_resolved` are no longer part of the current wire contract.

## Explicit trade-offs

- A blocked mutation blocks the account queue on that device until repair or restore.
- Pull from another device is delayed while local work is blocked.
- Repair uses a generic payload editor for now; domain-specific repair UI can replace it later.
- The HTTP request still accepts an array for compatibility, even though the client sends one item per request.
- Existing development data may not be compatible with the new seed/changefeed semantics. Reset is a manual operation.

## Manual dev reset runbook

Do this only when intentionally testing from an empty state:

1. Stop API and frontend tabs.
2. Use a new PostgreSQL database or explicitly reset the dev database.
3. Run `make migrate-up`.
4. Clear Redis session/token data if old sessions are still present.
5. Clear IndexedDB and PWA storage in every browser/profile used for testing.
6. Start the app, create a new account, and test two devices/profiles.

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
