import * as api from '@/api/client'
import type { MutationResult, PushMutation } from '@/api/contract.types'
import { db, type OutboxItem } from '@/data/db'
import { listPendingOutbox, markOutboxApplied, markOutboxRejected, markOutboxRetryable } from '@/data/outbox'
import { DEFAULT_SYNC_PAGE_SIZE } from '@/domain/constants'
import { applyServerSnapshotToEntity } from './applyChange'
import { assertActiveSyncAccount } from './sessionGuard'
import { entityTable, isMutableEntityType, updateEntitySyncMeta } from './types'

type MutableEntityType = 'vehicle' | 'reminder_config' | 'fuel_log' | 'service_log' | 'part_type'

/** Đọc `serverSeq` hiện có trên entity Dexie tương ứng — "bản client biết gần nhất"
 * — TẠI THỜI ĐIỂM build request, để đính kèm `base_server_seq`. Chỉ áp dụng cho
 * entity mutable; `odometer_log` không cần field này. */
async function readCurrentServerSeq(entityType: MutableEntityType, entityId: string): Promise<number | null> {
  const row = await entityTable(entityType).get(entityId)
  return row?.serverSeq ?? null
}

/**
 * Coalesce: với entity mutable, nếu nhiều outbox row `pending` trỏ cùng `entityId`
 * trong batch này, chỉ gửi row `createdAt` mới nhất — payload của row đó đã phản ánh
 * đầy đủ state hiện tại, gửi thêm các bản cũ hơn là thừa (và có thể mang
 * `base_server_seq` lỗi thời). Các row bị coalesce được đánh dấu `applied` ngay,
 * không gửi. Log luôn gửi hết, không coalesce (mỗi log là 1 bản ghi độc lập).
 */
function coalesceOutbox(items: OutboxItem[]): {
  toSend: OutboxItem[]
  toSkip: OutboxItem[]
} {
  const latestTimestampByEntity = new Map<string, string>()
  for (const item of items) {
    if (!isMutableEntityType(item.entityType)) continue
    const key = `${item.entityType}:${item.entityId}`
    const current = latestTimestampByEntity.get(key)
    if (!current || item.createdAt > current) latestTimestampByEntity.set(key, item.createdAt)
  }

  const toSend: OutboxItem[] = []
  const toSkip: OutboxItem[] = []
  for (const item of items) {
    if (!isMutableEntityType(item.entityType)) {
      toSend.push(item)
      continue
    }
    const key = `${item.entityType}:${item.entityId}`
    // Equal timestamps cannot be ordered safely, so send every tied snapshot rather
    // than discarding one based on IndexedDB's primary-key ordering.
    if (latestTimestampByEntity.get(key) === item.createdAt) toSend.push(item)
    else toSkip.push(item)
  }
  return { toSend, toSkip }
}

async function itemBelongsToAccount(item: OutboxItem, accountId: string): Promise<boolean> {
  const row = await entityTable(item.entityType).get(item.entityId)
  return row?.accountId === accountId
}

function validateResults(items: OutboxItem[], results: MutationResult[]): Map<string, MutationResult> {
  if (results.length !== items.length) throw new Error('Sync push returned an incomplete result set')

  const expectedIds = new Set(items.map((item) => item.mutationId))
  const byId = new Map<string, MutationResult>()
  for (const result of results) {
    if (!expectedIds.has(result.mutation_id) || byId.has(result.mutation_id)) {
      throw new Error('Sync push returned an invalid mutation result set')
    }
    if (
      (result.status === 'applied' || result.status === 'duplicate' || result.status === 'conflict_resolved') &&
      (result.server_seq == null || result.received_at_server == null)
    ) {
      throw new Error(`Sync push omitted acknowledgment metadata for ${result.mutation_id}`)
    }
    if (
      result.server_seq != null &&
      (!Number.isSafeInteger(result.server_seq) || result.server_seq <= 0 || !result.received_at_server || Number.isNaN(Date.parse(result.received_at_server)))
    ) {
      throw new Error(`Sync push returned invalid acknowledgment metadata for ${result.mutation_id}`)
    }
    if (result.status === 'conflict_resolved' && result.server_snapshot == null) {
      throw new Error(`Sync push omitted the conflict snapshot for ${result.mutation_id}`)
    }
    byId.set(result.mutation_id, result)
  }
  return byId
}

async function applyMutationResult(item: OutboxItem, result: MutationResult, accountId: string): Promise<void> {
  const table = entityTable(item.entityType)
  switch (result.status) {
    case 'applied':
    case 'duplicate':
      await db.transaction('rw', [db.outbox, table], async () => {
        const current = await table.get(item.entityId)
        if (current?.serverSeq != null && result.server_seq! < current.serverSeq) {
          throw new Error(`Sync push returned a stale acknowledgment for ${item.mutationId}`)
        }
        await markOutboxApplied(item.mutationId)
        await updateEntitySyncMeta(item.entityType, item.entityId, result.server_seq!, result.received_at_server!)
      })
      return
    case 'rejected':
      await db.transaction('rw', [db.outbox], async () => {
        await markOutboxRejected(item.mutationId, result.error_message ?? 'Rejected by server')
      })
      return
    case 'retryable_error':
      await db.transaction('rw', [db.outbox], async () => {
        await markOutboxRetryable(item.mutationId, result.error_message ?? 'Retryable server error')
      })
      return
    case 'conflict_resolved':
      await db.transaction('rw', [db.outbox, db.vehicles, db.reminderConfigs, db.odometerLogs, db.fuelLogs, db.serviceLogs, db.partTypes], async () => {
        await applyServerSnapshotToEntity(
          item.entityType,
          item.entityId,
          result.server_snapshot!,
          result.server_seq!,
          result.received_at_server!,
          accountId,
        )
        await markOutboxApplied(item.mutationId)
      })
      return
  }
}

/**
 * Đẩy các outbox item `pending` của account hiện tại theo batch tối đa
 * `DEFAULT_SYNC_PAGE_SIZE`. Item retryable chỉ được thử một lần trong mỗi lượt gọi.
 * Nếu `api.pushMutations` tự nó throw (mất mạng/lỗi HTTP không phải lỗi per-mutation) —
 * để nguyên toàn bộ outbox `pending`, ném lỗi lên cho `syncOrchestrator` (retry ở
 * lần sync sau); KHÔNG đánh dấu gì cho các mutation trong batch đó.
 */
export async function pushOutbox(deviceId: string, accountId: string): Promise<void> {
  const attempted = new Set<string>()

  while (true) {
    assertActiveSyncAccount(accountId)
    const pending = (await listPendingOutbox(Number.MAX_SAFE_INTEGER)).filter((item) => !attempted.has(item.mutationId))
    if (pending.length === 0) return

    const ownership = await Promise.all(
      pending.map(async (item) => ({
        item,
        owned: await itemBelongsToAccount(item, accountId),
      })),
    )
    const scoped = ownership.filter(({ owned }) => owned).map(({ item }) => item)
    for (const { item, owned } of ownership) {
      if (!owned) attempted.add(item.mutationId)
    }
    if (scoped.length === 0) return

    const { toSend: allToSend, toSkip } = coalesceOutbox(scoped)
    for (const item of toSkip) attempted.add(item.mutationId)

    const toSend = allToSend.slice(0, DEFAULT_SYNC_PAGE_SIZE)
    if (toSend.length === 0) continue
    for (const item of toSend) attempted.add(item.mutationId)

    const mutations: PushMutation[] = await Promise.all(
      toSend.map(async (item): Promise<PushMutation> => {
        const mutation: PushMutation = {
          mutation_id: item.mutationId,
          entity_type: item.entityType,
          operation: item.operation,
          entity_id: item.entityId,
          payload: item.payload as Record<string, unknown>,
        }
        if (isMutableEntityType(item.entityType)) {
          const baseServerSeq = await readCurrentServerSeq(item.entityType as MutableEntityType, item.entityId)
          mutation.base_server_seq = baseServerSeq
          // A local create may have newer update rows coalesced into this payload.
          // Without a server version yet, the effective operation is still create.
          if (baseServerSeq == null) mutation.operation = 'create'
        }
        return mutation
      }),
    )

    const response = await api.pushMutations({
      device_id: deviceId,
      api_version: '1',
      mutations,
    })
    assertActiveSyncAccount(accountId)
    const resultByMutationId = validateResults(toSend, response.results)
    for (const item of toSend) {
      await applyMutationResult(item, resultByMutationId.get(item.mutationId)!, accountId)
    }

    const acceptedEntityKeys = new Set(
      toSend
        .filter((item) => {
          const status = resultByMutationId.get(item.mutationId)!.status
          return status === 'applied' || status === 'duplicate' || status === 'conflict_resolved'
        })
        .map((item) => `${item.entityType}:${item.entityId}`),
    )
    const superseded = toSkip.filter((item) => acceptedEntityKeys.has(`${item.entityType}:${item.entityId}`))
    if (superseded.length > 0) {
      await db.transaction('rw', db.outbox, async () => {
        await Promise.all(superseded.map((item) => markOutboxApplied(item.mutationId)))
      })
    }
  }
}
