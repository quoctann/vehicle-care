import { describe, expect, it } from 'vitest';
import { deriveCurrentOdometer, deriveLatestOdometerLog } from './odometer';
import type { OdometerLog } from './types';

function log(overrides: Partial<OdometerLog>): OdometerLog {
  return {
    id: 'log-1',
    accountId: 'acc-1',
    vehicleId: 'veh-1',
    odometerKm: 0,
    recordedAt: '2026-01-01T00:00:00.000Z',
    note: null,
    source: 'manual',
    createdAtClient: '2026-01-01T00:00:00.000Z',
    serverSyncedAt: null,
    serverSeq: null,
    ...overrides,
  };
}

describe('deriveCurrentOdometer', () => {
  it('preserves sub-millisecond precision in server receipt ordering', () => {
    expect(
      deriveCurrentOdometer([
        log({ odometerKm: 100, serverSyncedAt: '2026-03-01T08:00:00.123100Z' }),
        log({ odometerKm: 200, serverSyncedAt: '2026-03-01T08:00:00.123900Z' }),
      ]),
    ).toBe(200);
  });

  it('uses stable array order when event and server receipt times are identical', () => {
    expect(
      deriveCurrentOdometer([
        log({ odometerKm: 100, serverSyncedAt: '2026-03-01T08:00:00.123Z' }),
        log({ odometerKm: 200, serverSyncedAt: '2026-03-01T08:00:00.123000Z' }),
      ]),
    ).toBe(200);
  });
  it('compares event times as instants, including different timezone offsets', () => {
    expect(
      deriveCurrentOdometer([
        log({ recordedAt: '2026-03-01T14:30:00+07:00', odometerKm: 100 }),
        log({ recordedAt: '2026-03-01T08:00:00.000Z', odometerKm: 200 }),
      ]),
    ).toBe(200);
  });

  it('breaks offline equal-time ties by local creation time across sources', () => {
    expect(
      deriveCurrentOdometer([
        log({ odometerKm: 200, createdAtClient: '2026-03-01T08:01:00.000Z' }),
        log({ odometerKm: 100, createdAtClient: '2026-03-01T08:00:00.000Z' }),
      ]),
    ).toBe(200);
  });
  it('trả về null khi không có log nào', () => {
    expect(deriveCurrentOdometer([])).toBeNull();
  });

  it('chọn log có recordedAt mới nhất, bất kể thứ tự trong mảng', () => {
    const logs = [
      log({ id: 'a', recordedAt: '2026-01-10T00:00:00.000Z', odometerKm: 100 }),
      log({ id: 'b', recordedAt: '2026-01-05T00:00:00.000Z', odometerKm: 50 }),
    ];
    expect(deriveCurrentOdometer(logs)).toBe(100);
  });

  it('log lệch thứ tự tạo (odometer giảm) vẫn chọn theo recordedAt, không theo thứ tự tạo', () => {
    // Log "50" được server nhận sau nhưng recordedAt của nó CŨ hơn — recordedAt vẫn thắng.
    const logs = [
      log({
        id: 'a',
        recordedAt: '2026-01-01T00:00:00.000Z',
        odometerKm: 50,
        serverSyncedAt: '2026-01-02T00:00:00.000Z',
      }),
      log({
        id: 'b',
        recordedAt: '2026-01-10T00:00:00.000Z',
        odometerKm: 200,
        serverSyncedAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    expect(deriveCurrentOdometer(logs)).toBe(200);
  });

  it('cùng recordedAt: log được server nhận sau cùng thắng', () => {
    const logs = [
      log({
        id: 'a',
        recordedAt: '2026-01-05T00:00:00.000Z',
        odometerKm: 100,
        serverSyncedAt: '2026-01-05T10:00:00.000Z',
      }),
      log({
        id: 'b',
        recordedAt: '2026-01-05T00:00:00.000Z',
        odometerKm: 105,
        serverSyncedAt: '2026-01-05T11:00:00.000Z',
      }),
    ];
    expect(deriveCurrentOdometer(logs)).toBe(105);
  });

  it('cùng recordedAt, cả 2 đều chưa sync: log tạo cục bộ sau (vị trí sau trong mảng) thắng', () => {
    const logs = [
      log({ id: 'a', recordedAt: '2026-01-05T00:00:00.000Z', odometerKm: 100 }),
      log({ id: 'b', recordedAt: '2026-01-05T00:00:00.000Z', odometerKm: 110 }),
    ];
    expect(deriveCurrentOdometer(logs)).toBe(110);
  });

  it('log đã sync (có serverSyncedAt) thắng log cùng recordedAt nhưng chưa sync', () => {
    const logs = [
      log({ id: 'a', recordedAt: '2026-01-05T00:00:00.000Z', odometerKm: 999 }), // chưa sync, tạo sau trong mảng
      log({
        id: 'b',
        recordedAt: '2026-01-05T00:00:00.000Z',
        odometerKm: 100,
        serverSyncedAt: '2026-01-05T10:00:00.000Z',
      }),
    ];
    expect(deriveLatestOdometerLog(logs)?.id).toBe('b');
  });
});
