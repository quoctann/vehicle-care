const STORAGE_KEY = 'lastVehicleId'

function storageKey(accountId: string): string {
  return `${STORAGE_KEY}:${accountId}`
}

/** Tiện ích UI (điều hướng mặc định) — KHÔNG phải nguồn sự thật, Dexie mới là nguồn sự thật về vehicle. */
export function getLastVehicleId(accountId: string): string | null {
  try {
    return localStorage.getItem(storageKey(accountId))
  } catch {
    return null
  }
}

export function setLastVehicleId(accountId: string, id: string): void {
  try {
    localStorage.setItem(storageKey(accountId), id)
  } catch {
    // Safari private mode / storage quota — bỏ qua, chỉ ảnh hưởng redirect mặc định.
  }
}
