import type { OdometerLog } from './types'

/**
 * D-01: odometer hiện tại = log có `recordedAt` mới nhất; nếu trùng `recordedAt`,
 * log được SERVER tiếp nhận sau cùng thắng. Với 2 log cùng `recordedAt` mà cả 2
 * đều CHƯA sync (`receivedAtServer` null — chưa có thứ tự server để phân định),
 * dùng vị trí trong mảng làm proxy cho "tạo cục bộ sau" — vì vậy hàm này giả định
 * `logs` được truyền vào theo đúng thứ tự tạo cục bộ (vd thứ tự Dexie trả về theo
 * `id`/thời gian insert tăng dần), KHÔNG phải thứ tự ngẫu nhiên.
 */
function isNewer(a: OdometerLog, b: OdometerLog, indexA: number, indexB: number): boolean {
  if (a.recordedAt !== b.recordedAt) return a.recordedAt > b.recordedAt
  if (a.receivedAtServer && b.receivedAtServer) return a.receivedAtServer > b.receivedAtServer
  if (a.receivedAtServer && !b.receivedAtServer) return true
  if (!a.receivedAtServer && b.receivedAtServer) return false
  return indexA > indexB
}

export function deriveLatestOdometerLog(logs: OdometerLog[]): OdometerLog | null {
  if (logs.length === 0) return null
  let bestIndex = 0
  for (let i = 1; i < logs.length; i++) {
    if (isNewer(logs[i], logs[bestIndex], i, bestIndex)) bestIndex = i
  }
  return logs[bestIndex]
}

export function deriveCurrentOdometer(logs: OdometerLog[]): number | null {
  return deriveLatestOdometerLog(logs)?.odometerKm ?? null
}
