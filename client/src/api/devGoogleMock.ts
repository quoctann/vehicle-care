import { API_BASE_URL } from './config'
import type { LoginResponse } from './contract.types'
import { parseApiError } from './errors'

/**
 * DEV-ONLY: đứng thay cho luồng Google OAuth thật (redirect 302 qua Google, xem
 * `googleStartUrl()` trong `client.ts`) khi chưa có backend. Endpoint
 * `/auth/google/mock-signin` KHÔNG có trong `.docs/sync-api-contract.md` — file
 * này tách riêng khỏi `client.ts` để `client.ts` giữ đúng vai trò "mirror hợp đồng
 * thật", không lẫn code chỉ tồn tại vì mock.
 */
export async function googleMockSignIn(): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/google/mock-signin`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!response.ok) throw await parseApiError(response)
  return (await response.json()) as LoginResponse
}
