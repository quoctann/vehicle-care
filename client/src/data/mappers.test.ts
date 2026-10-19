import { describe, expect, it } from 'vitest';
import {
  fuelLogFieldsFromPayload,
  fuelLogToPayload,
  odometerLogFieldsFromPayload,
  odometerLogToPayload,
  partTypeFieldsFromPayload,
  partTypeToPayload,
  reminderConfigFieldsFromPayload,
  reminderConfigToPayload,
  serviceLogFieldsFromPayload,
  serviceLogToPayload,
  vehicleFieldsFromPayload,
  vehicleToPayload,
} from './mappers';

describe('sync payload contract', () => {
  const meta = {
    id: 'entity',
    accountId: 'account',
    createdAtClient: '2026-01-01T00:00:00Z',
    serverSeq: 42,
    serverSyncedAt: '2026-01-02T00:00:00Z',
  };
  const time = '2026-01-01T00:00:00Z';
  const snapshots = [
    {
      label: 'vehicle',
      payload: () =>
        vehicleToPayload({
          ...meta,
          name: 'Xe 🔧',
          plateNumber: null,
          archivedAt: null,
          deletedAt: null,
          dueSoonRatio: 0.25,
        }),
      parse: vehicleFieldsFromPayload,
      wire: {
        name: 'Xe 🔧',
        plate_number: null,
        archived_at: null,
        deleted_at: null,
        due_soon_ratio: 0.25,
      },
      fields: {
        name: 'Xe 🔧',
        plateNumber: null,
        archivedAt: null,
        deletedAt: null,
        dueSoonRatio: 0.25,
      },
    },
    {
      label: 'reminder',
      payload: () =>
        reminderConfigToPayload({
          ...meta,
          vehicleId: 'v',
          partTypeId: 'p',
          intervalKm: 5000,
          intervalDays: null,
          baselineOdometerKm: 0,
          baselineDate: '2026-01-01',
          enabled: true,
          deletedAt: null,
        }),
      parse: reminderConfigFieldsFromPayload,
      wire: {
        vehicle_id: 'v',
        part_type_id: 'p',
        interval_km: 5000,
        interval_days: null,
        baseline_odometer_km: 0,
        baseline_date: '2026-01-01',
        enabled: true,
        deleted_at: null,
      },
      fields: {
        vehicleId: 'v',
        partTypeId: 'p',
        intervalKm: 5000,
        intervalDays: null,
        baselineOdometerKm: 0,
        baselineDate: '2026-01-01',
        enabled: true,
        deletedAt: null,
      },
    },
    {
      label: 'odometer',
      payload: () =>
        odometerLogToPayload({
          ...meta,
          vehicleId: 'v',
          odometerKm: 0,
          recordedAt: time,
          note: null,
          source: 'fuel',
        }),
      parse: odometerLogFieldsFromPayload,
      wire: { vehicle_id: 'v', odometer_km: 0, recorded_at: time, note: null, source: 'fuel' },
      fields: { vehicleId: 'v', odometerKm: 0, recordedAt: time, note: null, source: 'fuel' },
    },
    {
      label: 'fuel',
      payload: () =>
        fuelLogToPayload({
          ...meta,
          vehicleId: 'v',
          recordedAt: time,
          liters: 2.5,
          cost: 12.34,
          note: "' unicode 🔧",
          odometerLogId: 'o',
          isFullTank: true,
          deletedAt: time,
        }),
      parse: fuelLogFieldsFromPayload,
      wire: {
        vehicle_id: 'v',
        recorded_at: time,
        liters: 2.5,
        cost: 12.34,
        note: "' unicode 🔧",
        odometer_log_id: 'o',
        is_full_tank: true,
        deleted_at: time,
      },
      fields: {
        vehicleId: 'v',
        recordedAt: time,
        liters: 2.5,
        cost: 12.34,
        note: "' unicode 🔧",
        odometerLogId: 'o',
        isFullTank: true,
        deletedAt: time,
      },
    },
    {
      label: 'service',
      payload: () =>
        serviceLogToPayload({
          ...meta,
          vehicleId: 'v',
          partTypeId: 'p',
          servicedAt: time,
          odometerKmSnapshot: null,
          cost: 0,
          note: null,
          deletedAt: null,
        }),
      parse: serviceLogFieldsFromPayload,
      wire: {
        vehicle_id: 'v',
        part_type_id: 'p',
        serviced_at: time,
        odometer_km_snapshot: null,
        cost: 0,
        note: null,
        deleted_at: null,
      },
      fields: {
        vehicleId: 'v',
        partTypeId: 'p',
        servicedAt: time,
        odometerKmSnapshot: null,
        cost: 0,
        note: null,
        deletedAt: null,
      },
    },
    {
      label: 'part type',
      payload: () =>
        partTypeToPayload({
          ...meta,
          code: 'custom-🔧',
          displayName: 'Dầu',
          displayOrder: 999,
          active: false,
        }),
      parse: partTypeFieldsFromPayload,
      wire: { code: 'custom-🔧', name: 'Dầu', display_order: 999, active: false },
      fields: { code: 'custom-🔧', displayName: 'Dầu', displayOrder: 999, active: false },
    },
  ];

  it.each(snapshots)(
    'preserves exact $label wire snapshot and domain roundtrip',
    ({ payload, parse, wire, fields }) => {
      const actual = payload();
      expect(actual).toEqual(wire);
      expect(JSON.parse(JSON.stringify(actual))).toEqual(wire);
      expect(parse(actual)).toEqual(fields);
      expect(actual).not.toHaveProperty('id');
      expect(actual).not.toHaveProperty('account_id');
      expect(actual).not.toHaveProperty('server_seq');
      expect(actual).not.toHaveProperty('created_at_client');
    },
  );

  it.each(snapshots)(
    'runtime-checks missing required $label fields rather than trusting TypeScript',
    ({ parse }) => {
      expect(() => parse({})).toThrow();
      expect(() => parse({ name: 123, vehicle_id: null, code: false })).toThrow();
    },
  );

  it('keeps legacy incoming defaults without weakening full outgoing snapshots', () => {
    expect(vehicleFieldsFromPayload({ name: 'Legacy' })).toEqual({
      name: 'Legacy',
      plateNumber: null,
      archivedAt: null,
      deletedAt: null,
      dueSoonRatio: null,
    });
    expect(fuelLogFieldsFromPayload({ vehicle_id: 'v', recorded_at: time }).isFullTank).toBe(false);
  });

  it.each([0, -1, 1.1, NaN, Infinity, '0.2'])(
    'rejects invalid runtime ratio %s',
    (due_soon_ratio) => {
      expect(() => vehicleFieldsFromPayload({ name: 'v', due_soon_ratio })).toThrow(
        'due_soon_ratio',
      );
    },
  );

  it('checks timestamps, positive intervals and source literals at runtime', () => {
    expect(() =>
      odometerLogFieldsFromPayload({
        vehicle_id: 'v',
        odometer_km: 1,
        recorded_at: 'not-a-date',
        source: 'manual',
      }),
    ).toThrow('recorded_at');
    expect(() =>
      odometerLogFieldsFromPayload({
        vehicle_id: 'v',
        odometer_km: 1,
        recorded_at: time,
        source: 'typo',
      }),
    ).toThrow('source');
    expect(() => reminderConfigFieldsFromPayload({ interval_km: 0 })).toThrow('interval_km');
    expect(() =>
      partTypeFieldsFromPayload({ code: 'p', name: 'P', display_order: 0, active: 'true' }),
    ).toThrow('active');
  });

  it('reads part type name without legacy seed metadata', () => {
    expect(
      partTypeFieldsFromPayload({ code: 'oil', name: 'Dầu nhớt', display_order: 1, active: true }),
    ).toEqual({ code: 'oil', displayName: 'Dầu nhớt', displayOrder: 1, active: true });
  });

  it('reads decimal cost and rejects values beyond numeric(10,2)', () => {
    const fuel = { vehicle_id: 'vehicle', recorded_at: '2026-01-01T00:00:00Z', cost: 12.34 };
    const service = {
      vehicle_id: 'vehicle',
      part_type_id: 'oil',
      serviced_at: '2026-01-01T00:00:00Z',
      cost: 99999999.99,
    };
    expect(fuelLogFieldsFromPayload(fuel).cost).toBe(12.34);
    expect(serviceLogFieldsFromPayload(service).cost).toBe(99999999.99);
    expect(() => fuelLogFieldsFromPayload({ ...fuel, cost: 12.345 })).toThrow('cost');
    expect(() => serviceLogFieldsFromPayload({ ...service, cost: 100000000 })).toThrow('cost');
  });
});
