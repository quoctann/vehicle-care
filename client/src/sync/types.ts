import type { SyncEntityType } from '@/api/contract.types'
import { db } from '@/data/db'

/**
 * Type/helper nội bộ tối giản cho sync engine. Phần lớn shape mượn thẳng từ
 * `api/contract.types.ts` (wire, snake_case) và `domain/types.ts` + `data/db.ts`
 * (Dexie, camelCase) — file này chỉ thêm những gì 2 nơi đó chưa có: map
 * `entityType` -> Dexie table, và danh sách entity mutable (LWW).
 */

/** 2 entity mutable cần `base_server_seq` khi push và có thể nhận `conflict_resolved`.
 * Log (odometer_log/fuel_log/service_log) append-only, không nằm trong danh sách này
 * (dedupe theo id, không bao giờ conflict — decision.md mục 3.4). */
const MUTABLE_ENTITY_TYPES: ReadonlySet<SyncEntityType> = new Set(['vehicle', 'reminder_config'])

export function isMutableEntityType(entityType: SyncEntityType): boolean {
  return MUTABLE_ENTITY_TYPES.has(entityType)
}

/** Bảng Dexie tương ứng 1 `SyncEntityType` — dùng để liệt kê bảng trong `db.transaction(...)`. */
export function entityTable(entityType: SyncEntityType) {
  switch (entityType) {
    case 'vehicle':
      return db.vehicles
    case 'reminder_config':
      return db.reminderConfigs
    case 'odometer_log':
      return db.odometerLogs
    case 'fuel_log':
      return db.fuelLogs
    case 'service_log':
      return db.serviceLogs
  }
}

/**
 * Cập nhật CHỈ 2 field sync metadata (không đụng field nghiệp vụ) — dùng khi push
 * trả về `applied`/`duplicate`: server xác nhận payload gửi lên đã là bản mới nhất,
 * không có field nào khác cần ghi đè.
 */
export async function updateEntitySyncMeta(
  entityType: SyncEntityType,
  entityId: string,
  serverSeq: number,
  receivedAtServer: string,
): Promise<void> {
  switch (entityType) {
    case 'vehicle':
      await db.vehicles.update(entityId, { serverSeq, receivedAtServer })
      return
    case 'reminder_config':
      await db.reminderConfigs.update(entityId, { serverSeq, receivedAtServer })
      return
    case 'odometer_log':
      await db.odometerLogs.update(entityId, { serverSeq, receivedAtServer })
      return
    case 'fuel_log':
      await db.fuelLogs.update(entityId, { serverSeq, receivedAtServer })
      return
    case 'service_log':
      await db.serviceLogs.update(entityId, { serverSeq, receivedAtServer })
      return
  }
}
