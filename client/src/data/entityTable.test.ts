import { beforeEach, describe, expect, it } from 'vitest';
import { SyncEntityType } from '@/api/contract.types';
import { db } from './db';
import { clearAllTables } from './testUtils';
import { entityTable, updateEntitySyncMeta } from './entityTable';

beforeEach(clearAllTables);

const tables = {
  vehicle: db.vehicles,
  reminder_config: db.reminderConfigs,
  odometer_log: db.odometerLogs,
  fuel_log: db.fuelLogs,
  service_log: db.serviceLogs,
  part_type: db.partTypes,
};

describe('entity table dispatch', () => {
  for (const entityType of Object.values(SyncEntityType)) {
    it(`maps ${entityType} and updates only acknowledgment metadata`, async () => {
      const table = entityTable(entityType);
      expect(table).toBe(tables[entityType]);
      // Minimal persisted fixture: metadata updates must leave business fields alone.
      const snapshot = { id: 'entity', accountId: 'account', name: 'Keep 🔧', serverSeq: null };
      await db.table(table.name).put(snapshot);
      await updateEntitySyncMeta(entityType, snapshot.id, 7, '2026-10-19T00:00:00Z');
      expect(await table.get(snapshot.id)).toEqual({
        ...snapshot,
        serverSeq: 7,
        serverSyncedAt: '2026-10-19T00:00:00Z',
      });
    });

    it(`does not recreate a missing ${entityType} on acknowledgment`, async () => {
      await updateEntitySyncMeta(entityType, 'missing', 7, '2026-10-19T00:00:00Z');
      expect(await entityTable(entityType).get('missing')).toBeUndefined();
    });
  }
});
