import Dexie, { type Table } from 'dexie'
import type {
  FuelLog,
  IanaTimezone,
  IsoDateTime,
  OdometerLog,
  PartType,
  ReminderConfig,
  ServiceLog,
  Vehicle,
} from '@/domain/types'

/**
 * Cấu trúc local-only — KHÔNG thuộc domain entity, KHÔNG có trong API contract
 * (đây là sổ sách nội bộ của client để biết mình cần push/pull gì).
 */

export type OutboxEntityType = 'vehicle' | 'reminder_config' | 'odometer_log' | 'fuel_log' | 'service_log' | 'part_type'
export type OutboxOperation = 'create' | 'update'
export type OutboxStatus = 'pending' | 'blocked'
export type OutboxFailureKind = 'retryable' | 'terminal'

/**
 * 1 dòng outbox = 1 lần thao tác cần đẩy lên server (không phải 1 entity — 1 entity
 * mutable có thể có nhiều outbox row theo thời gian). `mutationId` khác `entityId`:
 * `entityId` ổn định suốt vòng đời entity, `mutationId` mới mỗi lần ghi.
 */
export type OutboxItem = {
  mutationId: string
  accountId: string
  localSeq: number
  entityType: OutboxEntityType
  operation: OutboxOperation
  entityId: string
  /** Snapshot payload tại thời điểm ghi — JSON-serializable, gửi nguyên vẹn lên server khi push. */
  payload: unknown
  /** Revision used to build this envelope. It must not be read again during retry. */
  baseServerSeq: number | null
  status: OutboxStatus
  retryCount: number
  lastError: string | null
  failureKind: OutboxFailureKind | null
  createdAt: IsoDateTime
}

export type BootstrapState = 'empty' | 'bootstrapping' | 'ready'

/** 1 dòng duy nhất mỗi account — sống CÙNG Dexie DB với data, xem ghi chú bootstrap trong plan. */
export type SyncMeta = {
  accountId: string
  deviceId: string
  lastSeenSeq: number
  nextLocalSeq: number
  lastSyncedAt: IsoDateTime | null
  lastSyncError: string | null
  bootstrapState: BootstrapState
}

/**
 * Snapshot profile để hiển thị offline — KHÔNG chứa token/session id. Session thật
 * là cookie httpOnly do trình duyệt quản lý, JS không đọc/lưu được (và không cần).
 */
export type AccountCache = {
  id: 'current'
  accountId: string
  email: string
  name: string | null
  timezone: IanaTimezone
  emailVerified: boolean
  deviceId: string
  cachedAt: IsoDateTime
}

class VehicleMaintenanceDb extends Dexie {
  vehicles!: Table<Vehicle, string>
  partTypes!: Table<PartType, string>
  reminderConfigs!: Table<ReminderConfig, string>
  odometerLogs!: Table<OdometerLog, string>
  fuelLogs!: Table<FuelLog, string>
  serviceLogs!: Table<ServiceLog, string>
  outbox!: Table<OutboxItem, string>
  syncMeta!: Table<SyncMeta, string>
  accountCache!: Table<AccountCache, string>

  constructor() {
    super('vehicle-maintenance')
    // Index tối thiểu đối chiếu A6 (implementation-plan-section-5.md). `&code` = unique.
    this.version(1).stores({
      vehicles: 'id, accountId, archivedAt, deletedAt',
      partTypes: 'id, &code, active',
      reminderConfigs: 'id, accountId, vehicleId, [vehicleId+partTypeId], deletedAt',
      odometerLogs: 'id, accountId, vehicleId, [vehicleId+recordedAt]',
      fuelLogs: 'id, accountId, vehicleId',
      serviceLogs: 'id, accountId, vehicleId, [vehicleId+partTypeId+servicedAt]',
      outbox: 'mutationId, entityId, [status+createdAt]',
      syncMeta: 'accountId',
      accountCache: 'id',
    })
    // v2: fuel_log/service_log sửa/xoá được (feedback Feature #3) — thêm index
    // deletedAt để lọc bỏ record đã tombstone khi query lịch sử.
    this.version(2).stores({
      fuelLogs: 'id, accountId, vehicleId, deletedAt',
      serviceLogs: 'id, accountId, vehicleId, [vehicleId+partTypeId+servicedAt], deletedAt',
    })
    // v3: part_type thành entity mutable thật, có thể do account tự tạo
    // (feedback Feature #2) — thêm index accountId để lọc "hạng mục của tôi".
    this.version(3).stores({
      partTypes: 'id, &code, active, accountId',
    })
    // v4: bỏ tầng global seed dùng chung — mỗi account giờ có bộ part_types riêng,
    // NHIỀU account có thể cùng `code` (vd "engine_oil"), nên `code` không còn unique
    // toàn cục được nữa (server cũng đổi UNIQUE(code) -> UNIQUE(account_id, code), xem
    // migration part_types_owned_by_account). Giữ &code unique sẽ làm ConstraintError
    // khi ghi part_types của 1 account thứ 2 trùng code với account khác đã có sẵn
    // trong Dexie, làm cả transaction bị abort và không ghi được gì.
    this.version(4).stores({
      partTypes: 'id, &[accountId+code], active, accountId',
    })
    // v5: remove the old account-less catalog. Those rows predate per-account
    // part types and must never leak into an authenticated account's pickers.
    this.version(5).stores({}).upgrade(async (transaction) => {
      const partTypes = transaction.table<PartType, string>('partTypes')
      const legacyIds = (await partTypes.toArray())
        .filter((partType) => !partType.accountId)
        .map((partType) => partType.id)
      if (legacyIds.length === 0) return

      await partTypes.bulkDelete(legacyIds)
      await transaction.table<OutboxItem, string>('outbox').where('entityId').anyOf(legacyIds).delete()
    })
    // v6: account-scoped FIFO outbox. Acknowledged legacy rows are discarded;
    // retryable legacy rows remain pending and rejected rows become blocked.
    this.version(6).stores({
      outbox: 'mutationId, entityId, accountId, localSeq, [accountId+localSeq], [accountId+status+localSeq]',
    }).upgrade(async (transaction) => {
      const outbox = transaction.table('outbox')
      const rows = await outbox.toArray() as Array<Record<string, unknown>>
      const entities = {
        vehicle: transaction.table('vehicles'),
        reminder_config: transaction.table('reminderConfigs'),
        odometer_log: transaction.table('odometerLogs'),
        fuel_log: transaction.table('fuelLogs'),
        service_log: transaction.table('serviceLogs'),
        part_type: transaction.table('partTypes'),
      } as const
      const nextByAccount = new Map<string, number>()

      for (const row of rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
        const entityTable = entities[row.entityType as keyof typeof entities]
        const entity = entityTable ? await entityTable.get(row.entityId as string) as { accountId?: string; serverSeq?: number | null } : undefined
        const accountId = typeof row.accountId === 'string' ? row.accountId : entity?.accountId
        if (!accountId) {
          await outbox.delete(row.mutationId as string)
          continue
        }

        const localSeq = nextByAccount.get(accountId) ?? 1
        nextByAccount.set(accountId, localSeq + 1)
        const legacyStatus = row.status as string
        if (legacyStatus === 'applied') {
          await outbox.delete(row.mutationId as string)
          continue
        }
        await outbox.put({
          ...row,
          accountId,
          localSeq,
          baseServerSeq: row.baseServerSeq ?? entity?.serverSeq ?? null,
          status: legacyStatus === 'rejected' ? 'blocked' : 'pending',
          failureKind: legacyStatus === 'rejected' ? 'terminal' : null,
        })
      }

      const syncMeta = transaction.table('syncMeta')
      for (const [accountId, nextLocalSeq] of nextByAccount) {
        const existing = await syncMeta.get(accountId) as Record<string, unknown> | undefined
        await syncMeta.put({
          accountId,
          deviceId: existing?.deviceId ?? '',
          lastSeenSeq: existing?.lastSeenSeq ?? 0,
          nextLocalSeq: Math.max(Number(existing?.nextLocalSeq ?? 1), nextLocalSeq),
          lastSyncedAt: existing?.lastSyncedAt ?? null,
          lastSyncError: existing?.lastSyncError ?? null,
          bootstrapState: existing?.bootstrapState ?? 'empty',
        })
      }
      for (const existing of await syncMeta.toArray() as Array<Record<string, unknown>>) {
        if (typeof existing.nextLocalSeq === 'number') continue
        await syncMeta.put({ ...existing, nextLocalSeq: 1 })
      }
    })
    // v7: retain a simple status index for global pending-count consumers.
    this.version(7).stores({
      outbox: 'mutationId, entityId, accountId, status, localSeq, [accountId+localSeq], [accountId+status+localSeq]',
    }).upgrade(async (transaction) => {
      const syncMeta = transaction.table('syncMeta')
      for (const existing of await syncMeta.toArray() as Array<Record<string, unknown>>) {
        if (typeof existing.nextLocalSeq === 'number') continue
        await syncMeta.put({ ...existing, nextLocalSeq: 1 })
      }
    })
    // v8: explicitly classify the last failure so retry and terminal actions
    // cannot be inferred from a human-readable error string.
    this.version(8).stores({}).upgrade(async (transaction) => {
      const outbox = transaction.table('outbox')
      for (const row of await outbox.toArray() as Array<Record<string, unknown>>) {
        if (row.failureKind === 'retryable' || row.failureKind === 'terminal') continue
        await outbox.put({ ...row, failureKind: row.status === 'blocked' ? 'terminal' : null })
      }
    })
  }
}

export const db = new VehicleMaintenanceDb()
