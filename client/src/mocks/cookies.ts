const SESSION_COOKIE_NAME = 'sid'
const CSRF_COOKIE_NAME = 'csrf_token'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30

/**
 * MOCK-ONLY: bỏ `Secure` để cookie vẫn hoạt động khi dev server chạy trên
 * `http://localhost` không qua TLS. Production PHẢI có `Secure` (xem
 * `.docs/sync-api-contract.md` mục 1) — đây chỉ là giả lập ở tầng browser cho dev.
 *
 * `sid` có `HttpOnly` — trình duyệt vẫn tôn trọng flag này dù response đến từ MSW
 * (Service Worker chặn ở network layer, không phải JS tự set document.cookie), nên
 * JS phía app KHÔNG đọc được, đúng hành vi cần test.
 */
export function authCookieHeaders(sessionId: string, csrfToken: string): [string, string][] {
  return [
    ['Set-Cookie', `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax; HttpOnly`],
    ['Set-Cookie', `${CSRF_COOKIE_NAME}=${csrfToken}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax`],
  ]
}

export function clearAuthCookieHeaders(): [string, string][] {
  return [
    ['Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0`],
    ['Set-Cookie', `${CSRF_COOKIE_NAME}=; Path=/; Max-Age=0`],
  ]
}

export function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined
  const match = cookieHeader.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : undefined
}
