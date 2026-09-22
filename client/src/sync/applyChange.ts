import type { PullChange, SyncEntityType } from '@/api/contract.types'
import { db } from '@/data/db'
import {
  fuelLogFieldsFromPayload,
  odometerLogFieldsFromPayload,
  partTypeFieldsFromPayload,
  reminderConfigFieldsFromPayload,
  serviceLogFieldsFromPayload,
  vehicleFieldsFromPayload,
} from '@/data/mappers'

async function assertReferencedVehicle(accountId: string, vehicleId: string): Promise<void> {
  const vehicle = await db.vehicles.get(vehicleId)
  if (!vehicle || vehicle.accountId !== accountId) {
    throw new Error(`Sync payload references a vehicle outside account ${accountId}`)
  }
}

/**
 * Áp 1 thay đổi (từ pull, hoặc từ `server_snapshot` của push `conflict_resolved`)
 * vào Dexie.
 *
 * Giả định tự quyết định (tài liệu không nói rõ): `createdAtClient` chỉ để hiển thị
 * (không dùng cho LWW/dedupe — xem `domain/types.ts`) và KHÔNG có mặt trong wire
 * payload (không hàm `*ToPayload` nào gửi field này). Khi insert 1 entity MỚI do
 * thiết bị khác tạo (mình chưa từng thấy), không có cách nào biết giá trị gốc — dùng
 * `receivedAtServer` làm giá trị thay thế hợp lý nhất. Khi entity đã tồn tại cục bộ,
 * luôn giữ nguyên `createdAtClient`/`id`/`accountId` hiện có (chỉ `update()` phần
 * field đổi được, không bao giờ `put()` đè toàn bộ record đã tồn tại).
 */
async function applyEntityChange(
  accountId: string,
  entityType: SyncEntityType,
  entityId: string,
  payload: Record<string, unknown>,
  serverSeq: number,
  receivedAtServer: string,
): Promise<void> {
  switch (entityType) {
    case 'vehicle': {
      const existing = await db.vehicles.get(entityId)
      if (!existing) {
        const fields = vehicleFieldsFromPayload(payload)
        await db.vehicles.put({
          id: entityId,
          accountId,
          ...fields,
          createdAtClient: receivedAtServer,
          serverSeq,
          receivedAtServer,
        })
      } else {
        if (existing.accountId !== accountId) throw new Error(`Vehicle ${entityId} belongs to another account`)
        if (existing.serverSeq != null && existing.serverSeq > serverSeq) return
        await db.vehicles.update(entityId, {
          ...vehicleFieldsFromPayload(payload),
          serverSeq,
          receivedAtServer,
        })
      }
      return
    }
    case 'reminder_config': {
      const existing = await db.reminderConfigs.get(entityId)
      const fields = reminderConfigFieldsFromPayload(payload)
      await assertReferencedVehicle(accountId, fields.vehicleId)
      if (!existing) {
        await db.reminderConfigs.put({
          id: entityId,
          accountId,
          ...fields,
          createdAtClient: receivedAtServer,
          serverSeq,
          receivedAtServer,
        })
      } else {
        if (existing.accountId !== accountId) throw new Error(`Reminder config ${entityId} belongs to another account`)
        if (existing.serverSeq != null && existing.serverSeq > serverSeq) return
        await db.reminderConfigs.update(entityId, {
          ...fields,
          serverSeq,
          receivedAtServer,
        })
      }
      return
    }
    case 'odometer_log': {
      const existing = await db.odometerLogs.get(entityId)
      if (existing) {
        if (existing.accountId !== accountId) throw new Error(`Odometer log ${entityId} belongs to another account`)
        if (existing.serverSeq == null || existing.serverSeq < serverSeq) {
          await db.odometerLogs.update(entityId, {
            serverSeq,
            receivedAtServer,
          })
        }
        return
      }
      const fields = odometerLogFieldsFromPayload(payload)
      await assertReferencedVehicle(accountId, fields.vehicleId)
      await db.odometerLogs.put({
        id: entityId,
        accountId,
        ...fields,
        createdAtClient: receivedAtServer,
        serverSeq,
        receivedAtServer,
      })
      return
    }
    case 'fuel_log': {
      const existing = await db.fuelLogs.get(entityId)
      const fields = fuelLogFieldsFromPayload(payload)
      await assertReferencedVehicle(accountId, fields.vehicleId)
      if (!existing) {
        await db.fuelLogs.put({
          id: entityId,
          accountId,
          ...fields,
          createdAtClient: receivedAtServer,
          serverSeq,
          receivedAtServer,
        })
      } else {
        if (existing.accountId !== accountId) throw new Error(`Fuel log ${entityId} belongs to another account`)
        if (existing.serverSeq != null && existing.serverSeq > serverSeq) return
        await db.fuelLogs.update(entityId, {
          ...fields,
          serverSeq,
          receivedAtServer,
        })
      }
      return
    }
    case 'service_log': {
      const existing = await db.serviceLogs.get(entityId)
      const fields = serviceLogFieldsFromPayload(payload)
      await assertReferencedVehicle(accountId, fields.vehicleId)
      if (!existing) {
        await db.serviceLogs.put({
          id: entityId,
          accountId,
          ...fields,
          createdAtClient: receivedAtServer,
          serverSeq,
          receivedAtServer,
        })
      } else {
        if (existing.accountId !== accountId) throw new Error(`Service log ${entityId} belongs to another account`)
        if (existing.serverSeq != null && existing.serverSeq > serverSeq) return
        await db.serviceLogs.update(entityId, {
          ...fields,
          serverSeq,
          receivedAtServer,
        })
      }
      return
    }
    case 'part_type': {
      const existing = await db.partTypes.get(entityId)
      const fields = partTypeFieldsFromPayload(payload)
      if (!existing) {
        await db.partTypes.put({
          id: entityId,
          accountId,
          ...fields,
          createdAtClient: receivedAtServer,
          serverSeq,
          receivedAtServer,
        })
      } else {
        if (existing.accountId !== accountId) throw new Error(`Part type ${entityId} belongs to another account`)
        if (existing.serverSeq != null && existing.serverSeq > serverSeq) return
        await db.partTypes.update(entityId, {
          ...fields,
          serverSeq,
          receivedAtServer,
        })
      }
      return
    }
  }
}

/**
 * Áp 1 `PullChange` — 1 Dexie transaction riêng (sẽ tự gộp vào transaction ngoài nếu
 * được gọi từ trong 1 transaction khác đang chạy, vd `sync/pull.ts` gộp nhiều change +
 * cập nhật `syncMeta` cùng lúc — xem ghi chú trong `outbox.ts`).
 */
export async function applyPulledChange(change: PullChange, accountId: string): Promise<void> {
  await db.transaction('rw', [db.vehicles, db.reminderConfigs, db.odometerLogs, db.fuelLogs, db.serviceLogs, db.partTypes], async () => {
    await applyEntityChange(accountId, change.entity_type, change.entity_id, change.payload, change.server_seq, change.received_at_server)
  })
}

/**
 * Dùng chung với `applyPulledChange` cho case `conflict_resolved` của push — input là
 * `server_snapshot` (đã trùng payload mình gửi trong model LWW-by-server-receipt hiện
 * tại, xem `.docs/sync-api-contract.md` mục 2.12) thay vì 1 `PullChange`. Luôn xử lý
 * như 1 `update` (ghi đè field nghiệp vụ theo bản server) — nếu vì lý do nào đó local
 * chưa có entity này (không nên xảy ra, đây là phản hồi của chính mutation mình vừa
 * gửi) thì `applyEntityChange` tự insert mới.
 */
export async function applyServerSnapshotToEntity(
  entityType: SyncEntityType,
  entityId: string,
  snapshotPayload: Record<string, unknown>,
  serverSeq: number,
  receivedAtServer: string,
  accountId: string,
): Promise<void> {
  await db.transaction('rw', [db.vehicles, db.reminderConfigs, db.odometerLogs, db.fuelLogs, db.serviceLogs, db.partTypes], async () => {
    await applyEntityChange(accountId, entityType, entityId, snapshotPayload, serverSeq, receivedAtServer)
  })
}
