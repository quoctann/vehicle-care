import { generateId } from './uuid'

const STORAGE_KEY = 'deviceId'

/**
 * `device_id` bền vững qua `localStorage` — sinh 1 lần, dùng mãi cho thiết bị này
 * (cùng tinh thần `lib/lastVehicle.ts`). Độc lập với đăng nhập/đăng xuất: 1 thiết bị
 * giữ nguyên `device_id` kể cả khi đổi account trên đó.
 */
export function getOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY)
    if (existing) return existing
    const created = generateId()
    localStorage.setItem(STORAGE_KEY, created)
    return created
  } catch {
    // Safari private mode / storage quota — sinh id tạm cho phiên này, không persist được.
    return generateId()
  }
}
