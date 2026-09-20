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
export type OutboxStatus = 'pending' | 'sent' | 'applied' | 'rejected' | 'retryable_error'

/**
 * 1 dòng outbox = 1 lần thao tác cần đẩy lên server (không phải 1 entity — 1 entity
 * mutable có thể có nhiều outbox row theo thời gian). `mutationId` khác `entityId`:
 * `entityId` ổn định suốt vòng đời entity, `mutationId` mới mỗi lần ghi.
 */
export type OutboxItem = {
  mutationId: string
  entityType: OutboxEntityType
  operation: OutboxOperation
  entityId: string
  /** Snapshot payload tại thời điểm ghi — JSON-serializable, gửi nguyên vẹn lên server khi push. */
  payload: unknown
  status: OutboxStatus
  retryCount: number
  lastError: string | null
  createdAt: IsoDateTime
}

export type BootstrapState = 'empty' | 'bootstrapping' | 'ready'

/** 1 dòng duy nhất mỗi account — sống CÙNG Dexie DB với data, xem ghi chú bootstrap trong plan. */
export type SyncMeta = {
  accountId: string
  deviceId: string
  lastSeenSeq: number
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
  }
}

export const db = new VehicleMaintenanceDb()
