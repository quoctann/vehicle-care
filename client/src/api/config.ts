/** Đổi backend thật: set `VITE_API_BASE_URL` trỏ domain thật và `VITE_ENABLE_MSW=false` — không cần sửa code. */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/'

/**
 * Mặc định BẬT ở mọi môi trường dev (không cần file `.env.development` mới chạy
 * được — harness ở đây chặn ghi file `.env*`, xem README) và LUÔN tắt ở production
 * build vì `import.meta.env.DEV` là hằng số biên dịch. Muốn tắt MSW để trỏ backend
 * thật khi dev, tự tạo `.env.development.local` với `VITE_ENABLE_MSW=false`.
 */
export const ENABLE_MSW: boolean = import.meta.env.DEV && import.meta.env.VITE_ENABLE_MSW !== 'false'
