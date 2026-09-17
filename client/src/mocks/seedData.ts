import { createUser, findUserByEmail } from './db'

/** Tài khoản có sẵn để login thử nhanh khi demo — xem `RequireAuth`/`SignInPage`. */
export const DEMO_EMAIL = 'demo@vehicle.app'
export const DEMO_PASSWORD = 'demo12345'

/**
 * Chỉ seed account demo ở đây (auth-focused, M2/M3). Vehicle/ReminderConfig/log mẫu
 * sẽ sinh ra tự nhiên qua chính UI khi demo (tạo local trước, sync sau ở M7/M8) —
 * không cần giả lập sẵn "dữ liệu đã có trên server" cho tới khi luồng push/pull được nối.
 */
export function seedMockServer(): void {
  if (findUserByEmail(DEMO_EMAIL)) return // đã seed (HMR reload giữ nguyên module state)
  createUser({ email: DEMO_EMAIL, password: DEMO_PASSWORD, name: 'Người dùng Demo', emailVerified: true })
}
