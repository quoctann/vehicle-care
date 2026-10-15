import { db } from '@/data/db';
import { createReminderConfig } from '@/data/repositories/reminderRepository';
import {
    addServiceLog,
    deleteServiceLog,
    updateServiceLog,
} from '@/data/repositories/serviceRepository';
import { clearAllTables } from '@/data/testUtils';
import type { OdometerLog, ServiceLog } from '@/domain/types';
import { liveQuery } from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCurrentOdometer, listReminderStatusesForVehicle } from './reminderQueries';

afterEach(clearAllTables);

const VEHICLE_ID = 'veh-1';
const PART_TYPE_ID = 'pt-engine-oil';
const ACCOUNT_ID = 'acc-1';

async function seedVehicle() {
  await db.vehicles.put({
    id: VEHICLE_ID,
    accountId: ACCOUNT_ID,
    name: 'Test bike',
    plateNumber: null,
    archivedAt: null,
    deletedAt: null,
    dueSoonRatio: null,
    createdAtClient: '2026-01-01T00:00:00.000Z',
    serverSyncedAt: null,
    serverSeq: null,
  });
}

async function seedPartType() {
  await db.partTypes.put({
    id: PART_TYPE_ID,
    code: 'engine_oil',
    displayName: 'Dầu nhớt động cơ',
    displayOrder: 1,
    active: true,
    accountId: ACCOUNT_ID,
    createdAtClient: '2026-01-01T00:00:00.000Z',
    serverSyncedAt: null,
    serverSeq: null,
  });
}

async function seedOdometer(overrides: Partial<OdometerLog> = {}) {
  await db.odometerLogs.add({
    id: 'odometer-1',
    accountId: ACCOUNT_ID,
    vehicleId: VEHICLE_ID,
    odometerKm: 1000,
    recordedAt: '2026-02-01T00:00:00.000Z',
    note: null,
    source: 'manual',
    createdAtClient: '2026-02-01T00:00:00.000Z',
    serverSyncedAt: null,
    serverSeq: null,
    ...overrides,
  });
}

async function seedService(overrides: Partial<ServiceLog> = {}) {
  await db.serviceLogs.add({
    id: 'service-1',
    accountId: ACCOUNT_ID,
    vehicleId: VEHICLE_ID,
    partTypeId: PART_TYPE_ID,
    servicedAt: '2026-03-01T00:00:00.000Z',
    odometerKmSnapshot: 1500,
    cost: null,
    note: null,
    deletedAt: null,
    createdAtClient: '2026-03-01T00:00:00.000Z',
    serverSyncedAt: null,
    serverSeq: null,
    ...overrides,
  });
}

describe('getCurrentOdometer', () => {
  it('notifies live subscribers after offline service creation, edits and deletion', async () => {
    await seedVehicle();
    await seedPartType();
    await seedOdometer();
    let readings: Array<number | null> = [];
    const subscription = liveQuery(() => getCurrentOdometer(ACCOUNT_ID, VEHICLE_ID)).subscribe(
      (value) => {
        readings = [...readings, value];
      },
    );
    try {
      await vi.waitFor(() => expect(readings.at(-1)).toBe(1000));
      const service = await addServiceLog({
        accountId: ACCOUNT_ID,
        vehicleId: VEHICLE_ID,
        partTypeId: PART_TYPE_ID,
        servicedAt: '2026-03-01T00:00:00.000Z',
        odometerKmSnapshot: 1500,
      });
      await vi.waitFor(() => expect(readings.at(-1)).toBe(1500));
      await updateServiceLog(ACCOUNT_ID, service.id, { odometerKmSnapshot: 900 });
      await vi.waitFor(() => expect(readings.at(-1)).toBe(900));
      await updateServiceLog(ACCOUNT_ID, service.id, { servicedAt: '2026-01-01T00:00:00.000Z' });
      await vi.waitFor(() => expect(readings.at(-1)).toBe(1000));
      await updateServiceLog(ACCOUNT_ID, service.id, { servicedAt: '2026-03-01T00:00:00.000Z' });
      await vi.waitFor(() => expect(readings.at(-1)).toBe(900));
      await deleteServiceLog(ACCOUNT_ID, service.id);
      await vi.waitFor(() => expect(readings.at(-1)).toBe(1000));
    } finally {
      subscription.unsubscribe();
    }
  });
  it('null khi chưa có OdometerLog nào', async () => {
    await seedVehicle();
    expect(await getCurrentOdometer(ACCOUNT_ID, VEHICLE_ID)).toBeNull();
  });

  it('trả về log recordedAt mới nhất', async () => {
    await seedVehicle();
    await db.odometerLogs.bulkAdd([
      {
        id: 'o1',
        accountId: 'acc-1',
        vehicleId: VEHICLE_ID,
        odometerKm: 100,
        recordedAt: '2026-01-01T00:00:00.000Z',
        note: null,
        source: 'manual',
        createdAtClient: '2026-01-01T00:00:00.000Z',
        serverSyncedAt: null,
        serverSeq: null,
      },
      {
        id: 'o2',
        accountId: 'acc-1',
        vehicleId: VEHICLE_ID,
        odometerKm: 250,
        recordedAt: '2026-02-01T00:00:00.000Z',
        note: null,
        source: 'manual',
        createdAtClient: '2026-02-01T00:00:00.000Z',
        serverSyncedAt: null,
        serverSeq: null,
      },
    ]);
    expect(await getCurrentOdometer(ACCOUNT_ID, VEHICLE_ID)).toBe(250);
  });

  it('reads an offline service snapshot without requiring an odometer log or sync', async () => {
    await seedVehicle();
    await seedPartType();
    const service = await addServiceLog({
      accountId: ACCOUNT_ID,
      vehicleId: VEHICLE_ID,
      partTypeId: PART_TYPE_ID,
      servicedAt: '2026-03-01T00:00:00.000Z',
      odometerKmSnapshot: 1500,
    });

    expect(service.serverSyncedAt).toBeNull();
    expect(service.serverSeq).toBeNull();
    expect(await db.odometerLogs.count()).toBe(0);
    expect(await getCurrentOdometer(ACCOUNT_ID, VEHICLE_ID)).toBe(1500);
  });

  it.each(['manual', 'fuel'] as const)(
    'does not let a backdated service override a later %s reading even when created later',
    async (source) => {
      await seedVehicle();
      await seedOdometer({ source });
      await seedService({
        servicedAt: '2026-01-01T00:00:00.000Z',
        createdAtClient: '2026-04-01T00:00:00.000Z',
        odometerKmSnapshot: 5000,
      });

      expect(await getCurrentOdometer(ACCOUNT_ID, VEHICLE_ID)).toBe(1000);
    },
  );

  it.each(['manual', 'fuel'] as const)(
    'uses a newer lower service snapshot rather than the maximum %s mileage',
    async (source) => {
      await seedVehicle();
      await seedOdometer({ source, odometerKm: 5000 });
      await seedService({ odometerKmSnapshot: 900 });

      expect(await getCurrentOdometer(ACCOUNT_ID, VEHICLE_ID)).toBe(900);
    },
  );

  it('orders service snapshots by servicedAt rather than insertion or creation time', async () => {
    await seedVehicle();
    await seedService({ odometerKmSnapshot: 900 });
    await seedService({
      id: 'backdated-service',
      servicedAt: '2026-01-01T00:00:00.000Z',
      createdAtClient: '2026-04-01T00:00:00.000Z',
      odometerKmSnapshot: 5000,
    });

    expect(await getCurrentOdometer(ACCOUNT_ID, VEHICLE_ID)).toBe(900);
  });

  it('ignores a newer null service snapshot and retains the last known service mileage', async () => {
    await seedVehicle();
    await seedService();
    await seedService({
      id: 'service-without-mileage',
      servicedAt: '2026-04-01T00:00:00.000Z',
      odometerKmSnapshot: null,
    });

    expect(await getCurrentOdometer(ACCOUNT_ID, VEHICLE_ID)).toBe(1500);
  });

  it('returns null when the only service has no mileage snapshot', async () => {
    await seedVehicle();
    await seedService({ odometerKmSnapshot: null });

    expect(await getCurrentOdometer(ACCOUNT_ID, VEHICLE_ID)).toBeNull();
  });

  it.each([
    { reason: 'deleted', overrides: { deletedAt: '2026-05-01T00:00:00.000Z' } },
    { reason: 'other-account', overrides: { accountId: 'acc-2' } },
    { reason: 'other-vehicle', overrides: { vehicleId: 'veh-2' } },
  ])('ignores a newer $reason service snapshot', async ({ overrides }) => {
    await seedVehicle();
    await seedService();
    await seedService({
      id: 'excluded-service',
      servicedAt: '2026-04-01T00:00:00.000Z',
      odometerKmSnapshot: 5000,
      ...overrides,
    });

    expect(await getCurrentOdometer(ACCOUNT_ID, VEHICLE_ID)).toBe(1500);
  });

  it('recomputes mileage after editing the latest service snapshot', async () => {
    await seedVehicle();
    await seedOdometer();
    await seedService();
    await updateServiceLog(ACCOUNT_ID, 'service-1', { odometerKmSnapshot: 800 });

    expect(await getCurrentOdometer(ACCOUNT_ID, VEHICLE_ID)).toBe(800);
  });

  it('recomputes event order when a service date is edited', async () => {
    await seedVehicle();
    await seedOdometer();
    await seedService();
    await updateServiceLog(ACCOUNT_ID, 'service-1', {
      servicedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(await getCurrentOdometer(ACCOUNT_ID, VEHICLE_ID)).toBe(1000);

    await updateServiceLog(ACCOUNT_ID, 'service-1', {
      servicedAt: '2026-04-01T00:00:00.000Z',
    });
    expect(await getCurrentOdometer(ACCOUNT_ID, VEHICLE_ID)).toBe(1500);
  });

  it('falls back to an older service snapshot after deleting the latest service', async () => {
    await seedVehicle();
    await seedService();
    await seedService({
      id: 'latest-service',
      servicedAt: '2026-04-01T00:00:00.000Z',
      odometerKmSnapshot: 2000,
    });
    await deleteServiceLog(ACCOUNT_ID, 'latest-service');

    expect(await getCurrentOdometer(ACCOUNT_ID, VEHICLE_ID)).toBe(1500);
    await deleteServiceLog(ACCOUNT_ID, 'service-1');
    expect(await getCurrentOdometer(ACCOUNT_ID, VEHICLE_ID)).toBeNull();
  });
});

describe('listReminderStatusesForVehicle', () => {
  it('uses offline mileage from servicing another part to calculate kilometer progress', async () => {
    await seedPartType();
    await seedVehicle();
    await createReminderConfig({
      accountId: ACCOUNT_ID,
      vehicleId: VEHICLE_ID,
      partTypeId: PART_TYPE_ID,
      intervalKm: 1000,
      intervalDays: null,
      baselineOdometerKm: 0,
      baselineDate: null,
    });
    await seedService({ partTypeId: 'pt-other-part', odometerKmSnapshot: 950 });

    const results = await listReminderStatusesForVehicle(
      ACCOUNT_ID,
      VEHICLE_ID,
      'Asia/Ho_Chi_Minh',
      '2026-06-01T00:00:00.000Z',
    );

    expect(results).toHaveLength(1);
    expect(results[0].result).toMatchObject({
      status: 'due_soon',
      km: { baseline: 0, used: 950, remaining: 50, ratioUsed: 0.95 },
      basis: { usedServiceLog: false },
    });
  });

  it('kết hợp ReminderConfig + PartType + odometer hiện tại ra đúng domain status', async () => {
    await seedPartType();
    await seedVehicle();
    await createReminderConfig({
      accountId: 'acc-1',
      vehicleId: VEHICLE_ID,
      partTypeId: PART_TYPE_ID,
      intervalKm: 1000,
      intervalDays: null,
      baselineOdometerKm: 0,
      baselineDate: null,
    });
    await db.odometerLogs.add({
      id: 'o1',
      accountId: 'acc-1',
      vehicleId: VEHICLE_ID,
      odometerKm: 950,
      recordedAt: '2026-01-01T00:00:00.000Z',
      note: null,
      source: 'manual',
      createdAtClient: '2026-01-01T00:00:00.000Z',
      serverSyncedAt: null,
      serverSeq: null,
    });

    const results = await listReminderStatusesForVehicle(
      ACCOUNT_ID,
      VEHICLE_ID,
      'Asia/Ho_Chi_Minh',
      '2026-06-01T00:00:00.000Z',
    );
    expect(results).toHaveLength(1);
    expect(results[0].partType.displayName).toBe('Dầu nhớt động cơ');
    expect(results[0].result.status).toBe('due_soon'); // 950/1000 = 0.95 >= 0.9
  });

  it('bỏ qua reminder đã tombstone hoặc disabled', async () => {
    await seedPartType();
    await seedVehicle();
    const reminder = await createReminderConfig({
      accountId: 'acc-1',
      vehicleId: VEHICLE_ID,
      partTypeId: PART_TYPE_ID,
      intervalKm: 1000,
      intervalDays: null,
      baselineOdometerKm: 0,
      baselineDate: null,
    });
    await db.reminderConfigs.update(reminder.id, { enabled: false });

    const results = await listReminderStatusesForVehicle(
      ACCOUNT_ID,
      VEHICLE_ID,
      'Asia/Ho_Chi_Minh',
    );
    expect(results).toHaveLength(0);
  });
});
