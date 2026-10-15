import { DUE_SOON_REMAINING_RATIO } from '@/domain/constants';
import { deriveCurrentOdometer, type OdometerReading } from '@/domain/odometer';
import { calculateReminderStatus } from '@/domain/reminder';
import type {
  IanaTimezone,
  IsoDateTime,
  PartType,
  ReminderCalculationResult,
  ReminderConfig,
} from '@/domain/types';
import { db } from '../db';
import { listPartTypes } from './partTypeQueries';

export type ReminderWithStatus = {
  config: ReminderConfig;
  partType: PartType;
  result: ReminderCalculationResult;
};

export async function getCurrentOdometer(
  accountId: string,
  vehicleId: string,
): Promise<number | null> {
  const vehicle = await db.vehicles.get(vehicleId);
  if (!vehicle || vehicle.accountId !== accountId || vehicle.deletedAt != null) return null;
  const [logs, services] = await Promise.all([
    db.odometerLogs.where('vehicleId').equals(vehicleId).toArray(),
    db.serviceLogs.where('vehicleId').equals(vehicleId).toArray(),
  ]);
  const serviceReadings: OdometerReading[] = services.flatMap((log) =>
    log.accountId === accountId && log.deletedAt == null && log.odometerKmSnapshot != null
      ? [
          {
            odometerKm: log.odometerKmSnapshot,
            recordedAt: log.servicedAt,
            createdAtClient: log.createdAtClient,
            serverSyncedAt: log.serverSyncedAt,
          },
        ]
      : [],
  );
  return deriveCurrentOdometer([
    ...logs.filter((log) => log.accountId === accountId),
    ...serviceReadings,
  ]);
}

/**
 * Danh sách reminder ĐANG HOẠT ĐỘNG (enabled, chưa tombstone) của 1 xe, kèm kết
 * quả tính toán domain (`calculateReminderStatus`) — dùng thẳng cho Home page
 * (Overdue/Due soon) và Settings (danh sách reminder theo xe, khi cần).
 */
export async function listReminderStatusesForVehicle(
  accountId: string,
  vehicleId: string,
  accountTimezone: IanaTimezone,
  now: IsoDateTime = new Date().toISOString(),
  includeDisabled = false,
): Promise<ReminderWithStatus[]> {
  const [configs, partTypes, currentOdometerKm, vehicle] = await Promise.all([
    db.reminderConfigs
      .where('vehicleId')
      .equals(vehicleId)
      .and((config) => config.accountId === accountId)
      .toArray(),
    listPartTypes(accountId),
    getCurrentOdometer(accountId, vehicleId),
    db.vehicles.get(vehicleId),
  ]);
  const dueSoonRatio = vehicle?.dueSoonRatio ?? DUE_SOON_REMAINING_RATIO;

  const activeConfigs = configs.filter(
    (c) => c.deletedAt == null && (includeDisabled || c.enabled),
  );
  const partTypeById = new Map(partTypes.map((p) => [p.id, p]));

  const results = await Promise.all(
    activeConfigs.map(async (config): Promise<ReminderWithStatus | null> => {
      const partType = partTypeById.get(config.partTypeId);
      if (!partType) return null; // PartType chưa sync xong hoặc dữ liệu chưa nhất quán — bỏ qua thay vì crash

      const serviceLogs = await db.serviceLogs
        .where('vehicleId')
        .equals(vehicleId)
        .and(
          (l) =>
            l.accountId === accountId && l.partTypeId === config.partTypeId && l.deletedAt == null,
        )
        .toArray();
      const lastServiceLog =
        serviceLogs.length > 0
          ? serviceLogs.reduce((a, b) => (b.servicedAt > a.servicedAt ? b : a))
          : null;

      const result = calculateReminderStatus({
        config,
        currentOdometerKm,
        lastServiceLog: lastServiceLog
          ? {
              odometerKmSnapshot: lastServiceLog.odometerKmSnapshot,
              servicedAt: lastServiceLog.servicedAt,
            }
          : null,
        now,
        accountTimezone,
        dueSoonRatio,
      });
      return { config, partType, result };
    }),
  );

  return results.filter((r): r is ReminderWithStatus => r !== null);
}
