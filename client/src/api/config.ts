/**
 * Đổi backend thật: set `VITE_API_BASE_URL` trỏ domain thật — không cần sửa code.
 *
 * Default là chuỗi rỗng, KHÔNG phải '/': mọi request trong client.ts đều nối
 * `${API_BASE_URL}${path}` với `path` đã có sẵn dấu `/` ở đầu (vd '/auth/signup').
 * Nếu default là '/' thì kết quả thành '//auth/signup' — một protocol-relative
 * URL mà trình duyệt hiểu thành `https://auth/signup` (host "auth", path
 * "/signup") thay vì một đường dẫn same-origin, gây ERR_NAME_NOT_RESOLVED.
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? ''
