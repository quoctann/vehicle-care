import type { PartTypeDto } from '@/api/contract.types'
import type { FuelLog, OdometerLog, PartType, ReminderConfig, ServiceLog, Vehicle } from '@/domain/types'

/**
 * Domain object (camelCase, dùng nội bộ app/Dexie) → wire payload (snake_case,
 * đúng shape trong `.docs/sync-api-contract.md`) để ghi vào `outbox.payload` và
 * gửi nguyên vẹn ở `sync/push.ts`. KHÔNG bao gồm `id` (đã có ở `entity_id` của
 * mutation), `account_id` (server tự suy từ session — D7), hay field server-owned
 * (`server_seq`, `received_at_server`).
 */

export function vehicleToPayload(v: Vehicle): Record<string, unknown> {
  return {
    name: v.name,
    plate_number: v.plateNumber,
    archived_at: v.archivedAt,
    deleted_at: v.deletedAt,
  }
}

export function reminderConfigToPayload(r: ReminderConfig): Record<string, unknown> {
  return {
    vehicle_id: r.vehicleId,
    part_type_id: r.partTypeId,
    interval_km: r.intervalKm,
    interval_days: r.intervalDays,
    baseline_odometer_km: r.baselineOdometerKm,
    baseline_date: r.baselineDate,
    enabled: r.enabled,
    deleted_at: r.deletedAt,
  }
}

export function odometerLogToPayload(o: OdometerLog): Record<string, unknown> {
  return {
    vehicle_id: o.vehicleId,
    odometer_km: o.odometerKm,
    recorded_at: o.recordedAt,
    note: o.note,
    source: o.source,
  }
}

export function fuelLogToPayload(f: FuelLog): Record<string, unknown> {
  return {
    vehicle_id: f.vehicleId,
    recorded_at: f.recordedAt,
    liters: f.liters,
    cost_vnd: f.costVnd,
    shop: f.shop,
    note: f.note,
    odometer_log_id: f.odometerLogId,
    is_full_tank: f.isFullTank,
  }
}

export function serviceLogToPayload(s: ServiceLog): Record<string, unknown> {
  return {
    vehicle_id: s.vehicleId,
    part_type_id: s.partTypeId,
    serviced_at: s.servicedAt,
    odometer_km_snapshot: s.odometerKmSnapshot,
    cost_vnd: s.costVnd,
    note: s.note,
  }
}

/**
 * Wire payload (snake_case, từ `PullChange.payload` hoặc `MutationResult.server_snapshot`)
 * → field domain (camelCase) — chiều NGƯỢC của các hàm `*ToPayload` ở trên. Dùng bởi
 * `sync/applyChange.ts`. KHÔNG bao gồm `id` (lấy từ `entity_id` của change/mutation),
 * `accountId` (lấy từ `useSessionStore` tại thời điểm apply), hay field server-owned
 * (`serverSeq`, `receivedAtServer` — gắn riêng bởi caller) và `createdAtClient` (field
 * chỉ để hiển thị, không nằm trong wire payload — xem ghi chú giả định ở `applyChange.ts`).
 */

function requiredString(payload: Record<string, unknown>, field: string): string {
  const value = payload[field]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid sync payload field: ${field}`)
  return value
}

function nullableString(payload: Record<string, unknown>, field: string): string | null {
  const value = payload[field]
  if (value == null) return null
  if (typeof value !== 'string') throw new Error(`Invalid sync payload field: ${field}`)
  return value
}

function nullableNumber(payload: Record<string, unknown>, field: string, minimum = 0): number | null {
  const value = payload[field]
  if (value == null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new Error(`Invalid sync payload field: ${field}`)
  }
  return value
}

function requiredNumber(payload: Record<string, unknown>, field: string, minimum = 0): number {
  const value = nullableNumber(payload, field, minimum)
  if (value == null) throw new Error(`Invalid sync payload field: ${field}`)
  return value
}

function isoDateTime(payload: Record<string, unknown>, field: string): string {
  const value = requiredString(payload, field)
  if (Number.isNaN(Date.parse(value))) throw new Error(`Invalid sync payload field: ${field}`)
  return value
}

function nullableIsoDateTime(payload: Record<string, unknown>, field: string): string | null {
  const value = nullableString(payload, field)
  if (value != null && Number.isNaN(Date.parse(value))) throw new Error(`Invalid sync payload field: ${field}`)
  return value
}

export function vehicleFieldsFromPayload(
  payload: Record<string, unknown>,
): Omit<Vehicle, 'id' | 'accountId' | 'createdAtClient' | 'serverSeq' | 'receivedAtServer'> {
  return {
    name: requiredString(payload, 'name'),
    plateNumber: nullableString(payload, 'plate_number'),
    archivedAt: nullableIsoDateTime(payload, 'archived_at'),
    deletedAt: nullableIsoDateTime(payload, 'deleted_at'),
  }
}

export function reminderConfigFieldsFromPayload(
  payload: Record<string, unknown>,
): Omit<ReminderConfig, 'id' | 'accountId' | 'createdAtClient' | 'serverSeq' | 'receivedAtServer'> {
  const intervalKm = nullableNumber(payload, 'interval_km', Number.EPSILON)
  const intervalDays = nullableNumber(payload, 'interval_days', Number.EPSILON)
  const enabled = payload.enabled
  const baselineDate = nullableString(payload, 'baseline_date')
  if (intervalKm == null && intervalDays == null) throw new Error('Invalid sync reminder without an interval')
  if (typeof enabled !== 'boolean') throw new Error('Invalid sync payload field: enabled')
  if (baselineDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(baselineDate)) throw new Error('Invalid sync payload field: baseline_date')
  return {
    vehicleId: requiredString(payload, 'vehicle_id'),
    partTypeId: requiredString(payload, 'part_type_id'),
    intervalKm,
    intervalDays,
    baselineOdometerKm: nullableNumber(payload, 'baseline_odometer_km'),
    baselineDate,
    enabled,
    deletedAt: nullableIsoDateTime(payload, 'deleted_at'),
  }
}

export function odometerLogFieldsFromPayload(
  payload: Record<string, unknown>,
): Omit<OdometerLog, 'id' | 'accountId' | 'createdAtClient' | 'serverSeq' | 'receivedAtServer'> {
  return {
    vehicleId: requiredString(payload, 'vehicle_id'),
    odometerKm: requiredNumber(payload, 'odometer_km'),
    recordedAt: isoDateTime(payload, 'recorded_at'),
    note: nullableString(payload, 'note'),
    source: payload.source === 'manual' || payload.source === 'fuel' ? payload.source : (() => { throw new Error('Invalid sync payload field: source') })(),
  }
}

export function fuelLogFieldsFromPayload(
  payload: Record<string, unknown>,
): Omit<FuelLog, 'id' | 'accountId' | 'createdAtClient' | 'serverSeq' | 'receivedAtServer'> {
  return {
    vehicleId: requiredString(payload, 'vehicle_id'),
    recordedAt: isoDateTime(payload, 'recorded_at'),
    liters: nullableNumber(payload, 'liters', Number.EPSILON),
    costVnd: nullableNumber(payload, 'cost_vnd'),
    shop: nullableString(payload, 'shop'),
    note: nullableString(payload, 'note'),
    odometerLogId: nullableString(payload, 'odometer_log_id'),
    isFullTank: typeof payload.is_full_tank === 'boolean' ? payload.is_full_tank : false,
  }
}

/**
 * `PartTypeDto` (wire, `GET /part-types` — xem `contract.types.ts` mục 2.14) →
 * `PartType` (domain). Khác các hàm `*FieldsFromPayload` ở trên vì nguồn là response
 * JSON đã typed (không phải `Record<string, unknown>` từ change-feed) nên không cần
 * validate runtime lại. `seed_version` server là chuỗi (`"v1"`, `"v2"`, ...) còn domain
 * `PartType.seedVersion` là số — lấy phần số, mặc định 1 nếu không parse được.
 */
export function partTypeFromDto(dto: PartTypeDto): PartType {
  const seedVersion = Number(dto.seed_version.replace(/^v/, ''))
  return {
    id: dto.id,
    code: dto.code,
    displayName: dto.name_vi,
    displayOrder: dto.display_order,
    active: dto.active,
    seedVersion: Number.isFinite(seedVersion) ? seedVersion : 1,
  }
}

export function serviceLogFieldsFromPayload(
  payload: Record<string, unknown>,
): Omit<ServiceLog, 'id' | 'accountId' | 'createdAtClient' | 'serverSeq' | 'receivedAtServer'> {
  return {
    vehicleId: requiredString(payload, 'vehicle_id'),
    partTypeId: requiredString(payload, 'part_type_id'),
    servicedAt: isoDateTime(payload, 'serviced_at'),
    odometerKmSnapshot: nullableNumber(payload, 'odometer_km_snapshot'),
    costVnd: nullableNumber(payload, 'cost_vnd'),
    note: nullableString(payload, 'note'),
  }
}
