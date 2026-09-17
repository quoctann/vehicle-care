const CSRF_COOKIE_NAME = 'csrf_token'
export const CSRF_HEADER_NAME = 'X-CSRF-Token'

/**
 * Đọc cookie CSRF (double-submit pattern — xem `.docs/sync-api-contract.md`).
 * Đây là cookie KHÔNG httpOnly nên JS đọc được — session thật (`sid`) thì không,
 * trình duyệt tự đính kèm khi `credentials: 'include'`.
 */
export function readCsrfToken(): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE_NAME}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}
