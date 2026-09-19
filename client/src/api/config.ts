/** Đổi backend thật: set `VITE_API_BASE_URL` trỏ domain thật — không cần sửa code. */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/'
