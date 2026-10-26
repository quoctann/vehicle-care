import { afterEach, expect, it } from 'vitest';
import type { PullChange, SyncEntityType } from '@/api/contract.types';
import { db } from '@/data/db';
import { entityTable } from '@/data/entityTable';
import { clearAllTables } from '@/data/testUtils';
import { applyPulledChange } from './applyChange';

const timestamp = '2026-10-25T00:00:00.000Z';
const accountId = 'account-1';
const payloads = {
  vehicle: {
    name: 'Vehicle',
    plate_number: null,
    archived_at: null,
    deleted_at: null,
    due_soon_ratio: null,
  },
  part_type: { code: 'custom', name: 'Part', active: true, display_order: 0 },
  reminder_config: {
    vehicle_id: 'parent',
    part_type_id: 'part',
    interval_km: 1000,
    interval_days: null,
    baseline_odometer_km: null,
    baseline_date: null,
    enabled: true,
    deleted_at: null,
  },
  odometer_log: {
    vehicle_id: 'parent',
    odometer_km: 123.46,
    recorded_at: timestamp,
    source: 'manual',
    note: null,
  },
  fuel_log: {
    vehicle_id: 'parent',
    liters: 2,
    cost: null,
    recorded_at: timestamp,
    note: null,
    odometer_log_id: null,
    is_full_tank: false,
    deleted_at: null,
  },
  service_log: {
    vehicle_id: 'parent',
    part_type_id: 'part',
    serviced_at: timestamp,
    odometer_km_snapshot: null,
    cost: null,
    note: null,
    deleted_at: null,
  },
};

function change(entityType: SyncEntityType, seq: number): PullChange {
  return {
    entity_type: entityType,
    entity_id: 'target',
    operation: 'create',
    payload: payloads[entityType],
    server_seq: seq,
    server_synced_at: timestamp,
  } as PullChange;
}

async function seedParent() {
  await applyPulledChange({ ...change('vehicle', 1), entity_id: 'parent' }, accountId);
}

afterEach(clearAllTables);

it.each(Object.keys(payloads) as SyncEntityType[])(
  'applies, canonicalizes equal versions, and ignores older %s records',
  async (entityType) => {
    await seedParent();
    const table = entityTable(entityType);
    await applyPulledChange(change(entityType, 2), accountId);
    const first = await table.get('target');
    expect(first).toMatchObject({ accountId, serverSeq: 2, serverSyncedAt: timestamp });
    await applyPulledChange(change(entityType, 2), accountId);
    expect(await table.get('target')).toEqual(first);
    await applyPulledChange(change(entityType, 3), accountId);
    await applyPulledChange(change(entityType, 1), accountId);
    expect(await table.get('target')).toMatchObject({ serverSeq: 3 });
  },
);

it.each(Object.keys(payloads) as SyncEntityType[])(
  'rejects cross-account existing %s records atomically',
  async (entityType) => {
    await seedParent();
    await applyPulledChange(change(entityType, 2), accountId);
    const table = entityTable(entityType);
    const before = await table.get('target');
    await expect(applyPulledChange(change(entityType, 3), 'account-2')).rejects.toThrow(/account/);
    expect(await table.get('target')).toEqual(before);
  },
);

it('rejects a missing referenced vehicle without inserting the record', async () => {
  await expect(applyPulledChange(change('fuel_log', 1), accountId)).rejects.toThrow(
    /outside account/,
  );
  expect(await db.fuelLogs.count()).toBe(0);
});
