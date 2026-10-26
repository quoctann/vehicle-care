import { generateId } from '@/lib/uuid';
import { isValidLiters, isValidNote, validateOdometerReading } from '@/domain/validation';
import type { FuelLog, OdometerLog } from '@/domain/types';
import { db } from '../db';
import { fuelLogToPayload, odometerLogToPayload } from '../mappers';
import { enqueueMutation } from '../outbox';
import { assertVehicleOwned } from './ownership';
import { isValidCost } from '@/domain/cost';

/**
 * B4: 1 lần đổ xăng KHÔNG bắt buộc nhập KM; nếu có, `FuelLog`+`OdometerLog` phải
 * tạo cùng 1 local transaction (atomically) với UUID ổn định — cả 2 record + 2
 * outbox mutation nằm trong CÙNG `db.transaction`.
 */
export async function addFuelLog(input: {
  accountId: string;
  vehicleId: string;
  recordedAt?: string;
  liters: number | null;
  cost: number | null;
  note: string | null;
  odometerKm: number | null;
  isFullTank: boolean;
}): Promise<{ fuelLog: FuelLog; odometerLog: OdometerLog | null }> {
  if (!isValidNote(input.note)) throw new Error('Note must not exceed 2000 UTF-8 bytes.');
  if (input.liters != null && !isValidLiters(input.liters)) {
    throw new Error('Fuel amount must be greater than 0 and at most 9999.99.');
  }
  if (input.cost != null && !isValidCost(input.cost)) {
    throw new Error('Fuel cost must be between 0 and 99999999.99 with at most two decimals.');
  }
  if (input.recordedAt && Number.isNaN(Date.parse(input.recordedAt))) {
    throw new Error('Recorded time is invalid.');
  }

  if (input.odometerKm != null) {
    const validation = validateOdometerReading(input.odometerKm, null);
    if (!validation.valid) throw new Error(`Odometer không hợp lệ: ${validation.error}`);
  }

  const now = new Date().toISOString();
  const recordedAt = input.recordedAt ?? now;

  let odometerLog: OdometerLog | null = null;
  if (input.odometerKm != null) {
    odometerLog = {
      id: generateId(),
      accountId: input.accountId,
      vehicleId: input.vehicleId,
      odometerKm: input.odometerKm,
      recordedAt,
      note: null,
      source: 'fuel',
      createdAtClient: now,
      serverSyncedAt: null,
      serverSeq: null,
    };
  }

  const fuelLog: FuelLog = {
    id: generateId(),
    accountId: input.accountId,
    vehicleId: input.vehicleId,
    recordedAt,
    liters: input.liters,
    cost: input.cost,
    note: input.note,
    odometerLogId: odometerLog?.id ?? null,
    isFullTank: input.isFullTank,
    deletedAt: null,
    createdAtClient: now,
    serverSyncedAt: null,
    serverSeq: null,
  };

  await db.transaction(
    'rw',
    [db.vehicles, db.fuelLogs, db.odometerLogs, db.outbox, db.syncMeta],
    async () => {
      await assertVehicleOwned(input.accountId, input.vehicleId);
      if (odometerLog) {
        await db.odometerLogs.add(odometerLog);
        await enqueueMutation({
          accountId: input.accountId,
          entityType: 'odometer_log',
          operation: 'create',
          entityId: odometerLog.id,
          payload: odometerLogToPayload(odometerLog),
        });
      }
      await db.fuelLogs.add(fuelLog);
      await enqueueMutation({
        accountId: input.accountId,
        entityType: 'fuel_log',
        operation: 'create',
        entityId: fuelLog.id,
        payload: fuelLogToPayload(fuelLog),
      });
    },
  );

  return { fuelLog, odometerLog };
}

async function writeFuelLogPatch(
  accountId: string,
  id: string,
  patch: Partial<FuelLog>,
): Promise<void> {
  await db.transaction('rw', [db.fuelLogs, db.outbox, db.syncMeta], async () => {
    const current = await db.fuelLogs.get(id);
    if (!current || current.accountId !== accountId) throw new Error(`Fuel log not found: ${id}`);
    const updated: FuelLog = { ...current, ...patch };
    await db.fuelLogs.put(updated);
    await enqueueMutation({
      accountId,
      entityType: 'fuel_log',
      operation: 'update',
      entityId: id,
      payload: fuelLogToPayload(updated),
    });
  });
}

/** Sửa 1 lần đổ xăng đã ghi (feedback Feature #3) — không cho đổi `vehicleId`. */
export function updateFuelLog(
  accountId: string,
  id: string,
  patch: Partial<Pick<FuelLog, 'recordedAt' | 'liters' | 'cost' | 'note' | 'isFullTank'>>,
): Promise<void> {
  if (!isValidNote(patch.note)) throw new Error('Note must not exceed 2000 UTF-8 bytes.');
  if (patch.liters != null && !isValidLiters(patch.liters))
    throw new Error('Fuel amount must be greater than 0 and at most 9999.99.');
  if (patch.cost != null && !isValidCost(patch.cost))
    throw new Error('Fuel cost must be between 0 and 99999999.99 with at most two decimals.');
  if (patch.recordedAt && Number.isNaN(Date.parse(patch.recordedAt)))
    throw new Error('Recorded time is invalid.');
  return writeFuelLogPatch(accountId, id, patch);
}

/** Tombstone — không xóa vật lý (nhất quán với `vehicleRepository.deleteVehicle`). */
export function deleteFuelLog(accountId: string, id: string): Promise<void> {
  return writeFuelLogPatch(accountId, id, { deletedAt: new Date().toISOString() });
}
