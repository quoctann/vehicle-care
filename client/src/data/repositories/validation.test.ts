import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/data/db';
import { clearAllTables } from '@/data/testUtils';
import { addFuelLog, deleteFuelLog, updateFuelLog } from './fuelRepository';
import { addServiceLog, deleteServiceLog, updateServiceLog } from './serviceRepository';
import { addOdometerLog } from './odometerRepository';
import { createReminderConfig, updateReminderConfig } from './reminderRepository';
import { createPartType, setPartTypeActive, updatePartTypeName } from './partTypeRepository';

const owner = { accountId: 'acc-1', vehicleId: 'veh-1' };
const fuelInput = {
  ...owner,
  liters: null,
  cost: null,
  note: null,
  odometerKm: null,
  isFullTank: false,
};
const serviceInput = { ...owner, partTypeId: 'pt-1', odometerKmSnapshot: null };
const reminderInput = {
  ...owner,
  partTypeId: 'pt-1',
  intervalKm: 100,
  intervalDays: null,
  baselineOdometerKm: null,
  baselineDate: null,
};
const oversizedNote = '😀'.repeat(501);
const oversizedName = 'ắ'.repeat(167);

afterEach(clearAllTables);
beforeEach(async () => {
  const metadata = {
    createdAtClient: '2026-01-01T00:00:00Z',
    serverSyncedAt: null,
    serverSeq: null,
  };
  await db.vehicles.put({
    id: owner.vehicleId,
    accountId: owner.accountId,
    name: 'Bike',
    plateNumber: null,
    archivedAt: null,
    deletedAt: null,
    dueSoonRatio: null,
    ...metadata,
  });
  await db.partTypes.put({
    id: 'pt-1',
    accountId: owner.accountId,
    code: 'oil',
    displayName: 'Oil',
    displayOrder: 1,
    active: true,
    ...metadata,
  });
});

async function snapshot() {
  return {
    fuel: await db.fuelLogs.toArray(),
    odometer: await db.odometerLogs.toArray(),
    service: await db.serviceLogs.toArray(),
    reminders: await db.reminderConfigs.toArray(),
    parts: await db.partTypes.toArray(),
    outbox: await db.outbox.toArray(),
    meta: await db.syncMeta.toArray(),
  };
}

async function rejectsAtomically(write: () => unknown) {
  const before = await snapshot();
  await expect(Promise.resolve().then(write)).rejects.toThrow();
  expect(await snapshot()).toEqual(before);
}

describe('repository validation before enqueue', () => {
  it.each([-1, 100000000, 1.001, NaN, Infinity])(
    'keeps cost validation atomic on create/update: %s',
    async (cost) => {
      await rejectsAtomically(() => addFuelLog({ ...fuelInput, cost }));
      await rejectsAtomically(() => addServiceLog({ ...serviceInput, cost }));
      const { fuelLog } = await addFuelLog(fuelInput);
      const service = await addServiceLog(serviceInput);
      await rejectsAtomically(() => updateFuelLog(owner.accountId, fuelLog.id, { cost }));
      await rejectsAtomically(() => updateServiceLog(owner.accountId, service.id, { cost }));
    },
  );
  it('keeps invalid timestamp rejection atomic on create/update', async () => {
    await rejectsAtomically(() => addFuelLog({ ...fuelInput, recordedAt: 'invalid' }));
    await rejectsAtomically(() => addServiceLog({ ...serviceInput, servicedAt: 'invalid' }));
    await rejectsAtomically(() =>
      addOdometerLog({ ...owner, odometerKm: 1, recordedAt: 'invalid' }),
    );
    const { fuelLog } = await addFuelLog(fuelInput);
    const service = await addServiceLog(serviceInput);
    await rejectsAtomically(() =>
      updateFuelLog(owner.accountId, fuelLog.id, { recordedAt: 'invalid' }),
    );
    await rejectsAtomically(() =>
      updateServiceLog(owner.accountId, service.id, { servicedAt: 'invalid' }),
    );
  });
  it('accepts exact byte-limit names on create/update and keeps custom identity', async () => {
    const name = 'ắ'.repeat(166) + 'ab';
    const part = await createPartType(owner.accountId, ` ${name} `);
    expect(part).toMatchObject({ code: part.id, displayName: name });
    await updatePartTypeName(owner.accountId, part.id, ` ${name} `);
    await setPartTypeActive(owner.accountId, part.id, false);
    expect(await db.partTypes.get(part.id)).toMatchObject({
      code: part.id,
      displayName: name,
      active: false,
    });
    expect(await db.outbox.where('entityId').equals(part.id).count()).toBe(3);
    await rejectsAtomically(() => updatePartTypeName('other-account', part.id, 'Changed'));
  });
  it('keeps linked odometer records immutable when updating or deleting logs', async () => {
    const { fuelLog, odometerLog } = await addFuelLog({ ...fuelInput, odometerKm: 123.456 });
    const service = await addServiceLog(serviceInput);
    await updateFuelLog(owner.accountId, fuelLog.id, { liters: null, cost: null, note: null });
    await updateServiceLog(owner.accountId, service.id, {
      odometerKmSnapshot: null,
      cost: null,
      note: null,
    });
    await deleteFuelLog(owner.accountId, fuelLog.id);
    await deleteServiceLog(owner.accountId, service.id);
    expect(await db.odometerLogs.get(odometerLog!.id)).toEqual(odometerLog);
  });
  it.each([99999999.991, -1, NaN, Infinity])(
    'rejects invalid linked fuel KM %s atomically',
    async (odometerKm) => {
      await rejectsAtomically(() => addFuelLog({ ...fuelInput, odometerKm }));
    },
  );
  it.each([9999.991, 0, -1, NaN, Infinity])(
    'rejects fuel liters %s on create and update',
    async (liters) => {
      await rejectsAtomically(() => addFuelLog({ ...fuelInput, liters }));
      const { fuelLog } = await addFuelLog(fuelInput);
      await rejectsAtomically(() => updateFuelLog(owner.accountId, fuelLog.id, { liters }));
    },
  );
  it.each([99999999.991, -1, NaN, Infinity])(
    'rejects service KM %s on create and update',
    async (odometerKmSnapshot) => {
      await rejectsAtomically(() => addServiceLog({ ...serviceInput, odometerKmSnapshot }));
      const log = await addServiceLog(serviceInput);
      await rejectsAtomically(() =>
        updateServiceLog(owner.accountId, log.id, { odometerKmSnapshot }),
      );
    },
  );
  it('rejects oversized Unicode notes on every create/update boundary', async () => {
    await rejectsAtomically(() => addOdometerLog({ ...owner, odometerKm: 1, note: oversizedNote }));
    await rejectsAtomically(() => addFuelLog({ ...fuelInput, note: oversizedNote }));
    await rejectsAtomically(() => addServiceLog({ ...serviceInput, note: oversizedNote }));
    const { fuelLog } = await addFuelLog(fuelInput);
    const service = await addServiceLog(serviceInput);
    await rejectsAtomically(() =>
      updateFuelLog(owner.accountId, fuelLog.id, { note: oversizedNote }),
    );
    await rejectsAtomically(() =>
      updateServiceLog(owner.accountId, service.id, { note: oversizedNote }),
    );
  });
  it.each([99999999.991, -1, NaN, Infinity])(
    'validates reminder baseline %s at creation',
    async (baselineOdometerKm) => {
      await rejectsAtomically(() => createReminderConfig({ ...reminderInput, baselineOdometerKm }));
    },
  );
  it.each([{ intervalKm: 99999999.991 }, { intervalDays: 2147483648 }, { intervalDays: 1.5 }])(
    'validates reminder intervals on create/update: %o',
    async (patch) => {
      await rejectsAtomically(() => createReminderConfig({ ...reminderInput, ...patch }));
      const reminder = await createReminderConfig(reminderInput);
      await rejectsAtomically(() => updateReminderConfig(owner.accountId, reminder.id, patch));
    },
  );
  it('validates the part-name byte limit on create/update', async () => {
    await rejectsAtomically(() => createPartType(owner.accountId, oversizedName));
    await rejectsAtomically(() => updatePartTypeName(owner.accountId, 'pt-1', oversizedName));
  });
  it('accepts exact maxima and keeps fractional values unchanged for canonical server rounding', async () => {
    const { fuelLog, odometerLog } = await addFuelLog({
      ...fuelInput,
      liters: 9999.99,
      odometerKm: 99999999.99,
      cost: 99999999.99,
      note: '😀'.repeat(500),
    });
    expect(fuelLog.liters).toBe(9999.99);
    expect(odometerLog?.odometerKm).toBe(99999999.99);
    await addOdometerLog({ ...owner, odometerKm: 123.456 });
    const service = await addServiceLog({ ...serviceInput, odometerKmSnapshot: 123.456 });
    await updateFuelLog(owner.accountId, fuelLog.id, { liters: 123.456 });
    await updateServiceLog(owner.accountId, service.id, { odometerKmSnapshot: 99999999.99 });
    const reminder = await createReminderConfig({
      ...reminderInput,
      intervalKm: 123.456,
      intervalDays: 2147483647,
      baselineOdometerKm: 99999999.99,
    });
    expect(reminder.intervalKm).toBe(123.456);
    expect((await db.outbox.toArray()).map((row) => row.payload)).toContainEqual(
      expect.objectContaining({ odometer_km: 123.456 }),
    );
  });
});
