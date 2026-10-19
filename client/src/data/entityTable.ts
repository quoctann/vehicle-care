import type { SyncEntityType } from '@/api/contract.types';
import { db } from './db';

const entityTables = {
  vehicle: db.vehicles,
  reminder_config: db.reminderConfigs,
  odometer_log: db.odometerLogs,
  fuel_log: db.fuelLogs,
  service_log: db.serviceLogs,
  part_type: db.partTypes,
} satisfies Record<SyncEntityType, unknown>;

/** Shared dispatch for local outbox transactions and push acknowledgments. */
export function entityTable(entityType: SyncEntityType) {
  return entityTables[entityType];
}

/** ACKs update metadata only; canonical business fields arrive through pull. */
export async function updateEntitySyncMeta(
  entityType: SyncEntityType,
  entityId: string,
  serverSeq: number,
  serverSyncedAt: string,
): Promise<void> {
  await entityTable(entityType).update(entityId, { serverSeq, serverSyncedAt });
}
