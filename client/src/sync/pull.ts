import * as api from '@/api/client'
import type { PullResponse } from '@/api/contract.types'
import { db } from '@/data/db'
import { DEFAULT_SYNC_PAGE_SIZE } from '@/domain/constants'
import { applyPulledChange } from './applyChange'
import { assertActiveSyncAccount } from './sessionGuard'

function validatePage(response: PullResponse, afterSeq: number, expectedWatermark: string | null): void {
  if (!Number.isSafeInteger(response.next_cursor) || response.next_cursor < afterSeq) {
    throw new Error('Sync pull returned an invalid cursor')
  }
  if (expectedWatermark != null && response.watermark !== expectedWatermark) {
    throw new Error('Sync pull changed its watermark during pagination')
  }
  if (response.has_more && (!response.watermark || response.next_cursor <= afterSeq)) {
    throw new Error('Sync pull did not make progress')
  }

  let previousSeq = afterSeq
  for (const change of response.changes) {
    if (
      !Number.isSafeInteger(change.server_seq) ||
      change.server_seq <= previousSeq ||
      change.server_seq > response.next_cursor ||
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

/** Pulls one stable-watermark session and commits each page with its cursor atomically. */
export async function pullChanges(accountId: string): Promise<void> {
  const meta = await db.syncMeta.get(accountId)
  if (!meta) throw new Error(`Sync metadata is missing for account ${accountId}`)

  let afterSeq = meta.lastSeenSeq
  let watermark: string | null = null

  while (true) {
    assertActiveSyncAccount(accountId)
    const response = await api.pullChanges({
      afterSeq,
      limit: DEFAULT_SYNC_PAGE_SIZE,
      watermark: watermark ?? '',
    })
    assertActiveSyncAccount(accountId)
    validatePage(response, afterSeq, watermark)
    watermark ??= response.watermark

    await db.transaction('rw', [db.vehicles, db.reminderConfigs, db.odometerLogs, db.fuelLogs, db.serviceLogs, db.syncMeta], async () => {
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
