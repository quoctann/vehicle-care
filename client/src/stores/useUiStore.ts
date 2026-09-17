import { create } from 'zustand'

/**
 * CHỈ cho state UI cross-cutting thật sự không hợp với route hay local state —
 * vd sheet "Switch vehicle" mở được từ nhiều nơi (sidebar desktop VÀ phone
 * header) và không gắn với 1 route cụ thể. Sheet chỉ dùng ở 1 chỗ (vd "Update
 * odometer") nên nằm trong `useState` cục bộ của component gọi nó, KHÔNG đưa
 * vào đây — tránh store phình to không cần thiết.
 */
type UiStore = {
  vehicleSwitcherOpen: boolean
  openVehicleSwitcher: () => void
  closeVehicleSwitcher: () => void
}

export const useUiStore = create<UiStore>((set) => ({
  vehicleSwitcherOpen: false,
  openVehicleSwitcher: () => set({ vehicleSwitcherOpen: true }),
  closeVehicleSwitcher: () => set({ vehicleSwitcherOpen: false }),
}))
