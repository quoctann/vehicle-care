import { useSyncExternalStore } from 'react'

/**
 * LESSON LEARNED (bug thật đã xảy ra — xem PR đổi hành vi "chọn xe ở Settings không điều
 * hướng đi đâu"): bất kỳ state nào 1 trang cần ĐỌC nhưng KHÔNG SỞ HỮU và KHÔNG suy ra được
 * từ URL của chính trang đó — ví dụ AppShell (sidebar/bottom-nav/VehicleSwitcher) cần biết
 * "xe đang chọn" trong khi đang đứng ở `/settings` (route không có `:vehicleId`) — PHẢI sống
 * trong 1 reactive store (Zustand như `stores/useSessionStore.ts`/`useUiStore.ts`, hoặc
 * `useSyncExternalStore` như file này), KHÔNG được đọc bằng hàm đồng bộ kiểu
 * `localStorage.getItem` thẳng.
 *
 * Lý do: nếu trang A ghi (vd `setLastVehicleId`) còn trang B chỉ gọi hàm đọc đồng bộ mỗi lần
 * render, B sẽ không tự re-render khi A ghi — B chỉ "tình cờ" thấy giá trị mới nếu B render
 * lại vì lý do KHÁC (đổi route, đổi prop cha...). Đây chính xác là bug đã xảy ra: AppShell gọi
 * `getLastVehicleId` (hàm đồng bộ) trong lúc render, SettingsPage gọi `setLastVehicleId` khi
 * user đổi xe mà không điều hướng — sidebar/bottom-nav kẹt ở xe cũ cho tới khi có route change
 * khác "vô tình" ép AppShell render lại.
 *
 * Ngược lại: nếu state suy ra được từ URL (đa số trang `/v/:vehicleId/...`), CỨ dùng route
 * param — React Router tự lo reactivity, không cần store riêng, đơn giản hơn hẳn.
 */

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

/**
 * Pub/sub nội bộ cho reactivity CÙNG TAB — sự kiện `storage` gốc của trình duyệt chỉ bắn
 * sang tab KHÁC, không bắn lại chính tab vừa gọi `setItem`. Cần cái này vì AppShell (sidebar,
 * bottom nav, VehicleSwitcher) và trang gọi `setLastVehicleId` (vd SettingsPage đổi xe mà
 * không điều hướng đi đâu — xem `useLastVehicleId`) là 2 component khác nhau trong cùng cây,
 * không tự re-render nhau nếu chỉ đọc/ghi localStorage đồng bộ.
 */
const listeners = new Set<() => void>()

export function setLastVehicleId(accountId: string, id: string): void {
  try {
    localStorage.setItem(storageKey(accountId), id)
  } catch {
    // Safari private mode / storage quota — bỏ qua, chỉ ảnh hưởng redirect mặc định.
  }
  for (const listener of listeners) listener()
}

/**
 * Bản reactive của `getLastVehicleId` — dùng ở nơi cần re-render ngay khi `setLastVehicleId`
 * được gọi từ nơi khác trong cùng tab (AppShell dùng cái này thay vì gọi thẳng
 * `getLastVehicleId`, để sidebar/bottom nav/vehicle switcher cập nhật ngay khi user đổi xe
 * từ trang Settings).
 */
export function useLastVehicleId(accountId: string | undefined): string | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange)
      return () => listeners.delete(onStoreChange)
    },
    () => (accountId ? getLastVehicleId(accountId) : null),
  )
}
