import type { OdometerLog } from './types';

export type OdometerReading = Pick<
  OdometerLog,
  'odometerKm' | 'recordedAt' | 'serverSyncedAt' | 'createdAtClient'
>;

/** Date.parse normalizes offsets but drops the server's micro/nanoseconds. */
function compareTimestamps(a: string, b: string): number {
  const milliseconds = Date.parse(a) - Date.parse(b);
  if (milliseconds !== 0) return milliseconds;
  const fraction = (value: string) =>
    (value.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/)?.[1] ?? '').padEnd(9, '0');
  const fractionA = fraction(a);
  const fractionB = fraction(b);
  return fractionA > fractionB ? 1 : fractionA < fractionB ? -1 : 0;
}

/**
 * D-01: odometer hiện tại = log có `recordedAt` mới nhất; nếu trùng `recordedAt`,
 * log được SERVER tiếp nhận sau cùng thắng. Với 2 log cùng `recordedAt` mà cả 2
 * đều CHƯA sync (`serverSyncedAt` null — chưa có thứ tự server để phân định),
 * dùng `createdAtClient` để phân định giữa các nguồn. Nếu vẫn trùng, dùng vị trí
 * trong mảng làm tie-break cuối cùng; caller phải cung cấp thứ tự ổn định.
 */
function isNewer(a: OdometerReading, b: OdometerReading, indexA: number, indexB: number): boolean {
  const eventOrder = compareTimestamps(a.recordedAt, b.recordedAt);
  if (eventOrder !== 0) return eventOrder > 0;
  if (a.serverSyncedAt && b.serverSyncedAt) {
    const serverOrder = compareTimestamps(a.serverSyncedAt, b.serverSyncedAt);
    if (serverOrder !== 0) return serverOrder > 0;
  }
  if (a.serverSyncedAt && !b.serverSyncedAt) return true;
  if (!a.serverSyncedAt && b.serverSyncedAt) return false;
  const creationOrder = compareTimestamps(a.createdAtClient, b.createdAtClient);
  if (creationOrder !== 0) return creationOrder > 0;
  return indexA > indexB;
}

export function deriveLatestOdometerLog<T extends OdometerReading>(logs: T[]): T | null {
  if (logs.length === 0) return null;
  let bestIndex = 0;
  for (let i = 1; i < logs.length; i++) {
    if (isNewer(logs[i], logs[bestIndex], i, bestIndex)) bestIndex = i;
  }
  return logs[bestIndex];
}

export function deriveCurrentOdometer(logs: OdometerReading[]): number | null {
  return deriveLatestOdometerLog(logs)?.odometerKm ?? null;
}
