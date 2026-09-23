import * as api from '@/api/client'
import type { PullResponse } from '@/api/contract.types'
import { db } from '@/data/db'
import { DEFAULT_SYNC_PAGE_SIZE } from '@/domain/constants'
import { applyPulledChange } from './applyChange'
import { assertActiveSyncAccount } from './sessionGuard'

function validatePage(response: PullResponse, afterSeq: number, expectedUntilSeq: number | null): void {
  if (!Number.isSafeInteger(response.next_cursor) || response.next_cursor < afterSeq) {
    throw new Error('Sync pull returned an invalid cursor')
  }
  if (!Number.isSafeInteger(response.until_seq) || response.until_seq < response.next_cursor) {
    throw new Error('Sync pull returned an invalid upper bound')
  }
  if (expectedUntilSeq != null && response.until_seq !== expectedUntilSeq) {
    throw new Error('Sync pull changed its upper bound during pagination')
  }
  if (response.has_more && response.next_cursor <= afterSeq) {
    throw new Error('Sync pull returned an empty page without making progress')
  }
  if (response.has_more && response.next_cursor >= response.until_seq) {
    throw new Error('Sync pull did not make progress')
  }

  let previousSeq = afterSeq
  for (const change of response.changes) {
    if (
      !Number.isSafeInteger(change.server_seq) ||
      change.server_seq <= previousSeq ||
      change.server_seq > response.next_cursor ||
      change.server_seq > response.until_seq ||
      typeof change.entity_id !== 'string' ||
      change.entity_id.length === 0 ||
      typeof change.payload !== 'object' ||
      change.payload == null ||
      Number.isNaN(Date.parse(change.received_at_server))
    ) {
      throw new Error('Sync pull returned changes out of sequence')
    }
    previousSeq = change.server_seq
  }
}

/** Pulls a bounded feed and commits each page only while the account outbox is clean. */
export async function pullChanges(accountId: string): Promise<void> {
  const meta = await db.syncMeta.get(accountId)
  if (!meta) throw new Error(`Sync metadata is missing for account ${accountId}`)

  let afterSeq = meta.lastSeenSeq
  let untilSeq: number | null = null

  while (true) {
    assertActiveSyncAccount(accountId)
    const response = await api.pullChanges({
      afterSeq,
      limit: DEFAULT_SYNC_PAGE_SIZE,
      ...(untilSeq == null ? {} : { untilSeq }),
    })
    assertActiveSyncAccount(accountId)
    validatePage(response, afterSeq, untilSeq)
    untilSeq ??= response.until_seq

    await db.transaction('rw', [db.vehicles, db.reminderConfigs, db.odometerLogs, db.fuelLogs, db.serviceLogs, db.partTypes, db.syncMeta, db.outbox], async () => {
      const dirtyOutbox = await db.outbox.where('accountId').equals(accountId).count()
      if (dirtyOutbox > 0) throw new Error(`Cannot apply server changes while account ${accountId} has local mutations`)
      for (const change of response.changes) {
        await applyPulledChange(change, accountId)
      }
      const updated = await db.syncMeta.update(accountId, {
        lastSeenSeq: response.next_cursor,
      })
      if (updated !== 1) throw new Error(`Sync metadata disappeared for account ${accountId}`)
    })

    afterSeq = response.next_cursor
    if (!response.has_more) return
  }
}
