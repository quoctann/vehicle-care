import { http, HttpResponse } from 'msw'
import type {
  ForgotPasswordRequest,
  LoginRequest,
  LoginResponse,
  RegisterDeviceRequest,
  RegisterDeviceResponse,
  ResendVerificationRequest,
  ResetPasswordRequest,
  ResetPasswordResponse,
  SessionResponse,
  SignupRequest,
  SignupResponse,
  VerifyEmailRequest,
  VerifyEmailResponse,
} from '@/api/contract.types'
import { CSRF_HEADER_NAME } from '@/lib/csrf'
import { authCookieHeaders, clearAuthCookieHeaders, readCookie } from '../cookies'
import { errorResponse } from '../errorResponse'
import {
  consumeResetToken,
  consumeVerificationToken,
  createResetToken,
  createSession,
  createUser,
  createVerificationToken,
  deleteSession,
  findUserByEmail,
  findUserById,
  getSession,
  registerDevice,
  revokeAllSessionsForAccount,
} from '../db'

const GOOGLE_DEMO_EMAIL = 'demo.google@gmail.com'

function toAccountDto(user: { id: string; email: string; name: string | null; timezone: string; emailVerified: boolean }) {
  return { id: user.id, email: user.email, name: user.name, timezone: user.timezone, email_verified: user.emailVerified }
}

/** D6/2.9: mọi route ngoại trừ signup/login/google/forgot-password cần session hợp lệ. */
function requireSession(request: Request) {
  const cookieHeader = request.headers.get('cookie')
  const sessionId = readCookie(cookieHeader, 'sid')
  const session = getSession(sessionId)
  if (!session) return null
  return { sessionId: sessionId!, session }
}

/** 2.12/2.13: mọi request state-changing cần header CSRF khớp cookie double-submit. */
function verifyCsrf(request: Request, session: { csrfToken: string }): boolean {
  const cookieHeader = request.headers.get('cookie')
  const cookieCsrf = readCookie(cookieHeader, 'csrf_token')
  const headerCsrf = request.headers.get(CSRF_HEADER_NAME)
  return Boolean(cookieCsrf && headerCsrf && cookieCsrf === session.csrfToken && headerCsrf === session.csrfToken)
}

export const authHandlers = [
  http.post('/auth/signup', async ({ request }) => {
    const body = (await request.json()) as SignupRequest
    if (!body.email || !body.password || body.password.length < 8) {
      return errorResponse(400, 'validation_failed', 'Email hoặc mật khẩu không hợp lệ (mật khẩu tối thiểu 8 ký tự).')
    }
    if (findUserByEmail(body.email)) {
      return errorResponse(400, 'validation_failed', 'Email đã được đăng ký.')
    }
    const user = createUser({ email: body.email, password: body.password, name: body.name ?? null })
    const token = createVerificationToken(user.email)
    // eslint-disable-next-line no-console
    console.info(`[MSW] Verification link (mock): /auth/verify-email?token=${token}`)

    const { sessionId, csrfToken } = createSession(user.id)
    const response: SignupResponse = { status: 'verification_required', email: user.email }
    return HttpResponse.json(response, { status: 201, headers: authCookieHeaders(sessionId, csrfToken) })
  }),

  http.post('/auth/verify-email', async ({ request }) => {
    const body = (await request.json()) as VerifyEmailRequest
    const email = consumeVerificationToken(body.token)
    if (!email) return errorResponse(400, 'validation_failed', 'Token xác thực không hợp lệ hoặc đã hết hạn.')
    const user = findUserByEmail(email)
    if (user) user.emailVerified = true
    const response: VerifyEmailResponse = { status: 'verified' }
    return HttpResponse.json(response)
  }),

  http.post('/auth/verify-email/resend', async ({ request }) => {
    const body = (await request.json()) as ResendVerificationRequest
    const user = findUserByEmail(body.email)
    if (user) {
      const token = createVerificationToken(user.email)
      // eslint-disable-next-line no-console
      console.info(`[MSW] Verification link (mock): /auth/verify-email?token=${token}`)
    }
    return HttpResponse.json({}) // generic — không lộ email có tồn tại hay không
  }),

  http.post('/auth/login', async ({ request }) => {
    const body = (await request.json()) as LoginRequest
    const user = findUserByEmail(body.email)
    if (!user || user.password !== body.password) {
      return errorResponse(401, 'auth_invalid', 'Email hoặc mật khẩu không đúng.')
    }
    const { sessionId, csrfToken } = createSession(user.id)
    const response: LoginResponse = { account: toAccountDto(user) }
    return HttpResponse.json(response, { headers: authCookieHeaders(sessionId, csrfToken) })
  }),

  /**
   * Dev-only stand-in cho Google OAuth thật (302 redirect qua Google) — xem
   * `.docs/sync-api-contract.md` mục 2.6. KHÔNG tồn tại trong contract thật.
   */
  http.post('/auth/google/mock-signin', () => {
    let user = findUserByEmail(GOOGLE_DEMO_EMAIL)
    if (!user) user = createUser({ email: GOOGLE_DEMO_EMAIL, password: '', name: 'Google Demo', emailVerified: true })
    const { sessionId, csrfToken } = createSession(user.id)
    const response: LoginResponse = { account: toAccountDto(user) }
    return HttpResponse.json(response, { headers: authCookieHeaders(sessionId, csrfToken) })
  }),

  http.post('/auth/password/forgot', async ({ request }) => {
    const body = (await request.json()) as ForgotPasswordRequest
    const user = findUserByEmail(body.email)
    if (user) {
      const token = createResetToken(user.email)
      // eslint-disable-next-line no-console
      console.info(`[MSW] Reset password link (mock): /reset-password?token=${token}`)
    }
    return HttpResponse.json({}) // generic — không lộ email có tồn tại hay không
  }),

  http.post('/auth/password/reset', async ({ request }) => {
    const body = (await request.json()) as ResetPasswordRequest
    const email = consumeResetToken(body.token)
    if (!email) return errorResponse(400, 'validation_failed', 'Token đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.')
    const user = findUserByEmail(email)
    if (!user) return errorResponse(400, 'validation_failed', 'Token đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.')
    user.password = body.new_password
    revokeAllSessionsForAccount(user.id)
    const response: ResetPasswordResponse = { status: 'reset' }
    return HttpResponse.json(response)
  }),

  http.get('/auth/session', ({ request }) => {
    const auth = requireSession(request)
    if (!auth) return errorResponse(401, 'session_expired', 'Session expired or missing.')
    const user = findUserById(auth.session.accountId)
    if (!user) return errorResponse(401, 'session_expired', 'Session expired or missing.')
    const response: SessionResponse = { account: toAccountDto(user) }
    return HttpResponse.json(response)
  }),

  http.post('/auth/logout', ({ request }) => {
    const auth = requireSession(request)
    if (!auth) return errorResponse(401, 'session_expired', 'Session expired or missing.')
    if (!verifyCsrf(request, auth.session)) return errorResponse(403, 'validation_failed', 'Invalid CSRF token.')
    deleteSession(auth.sessionId)
    return new HttpResponse(null, { status: 204, headers: clearAuthCookieHeaders() })
  }),

  http.post('/devices/register', async ({ request }) => {
    const auth = requireSession(request)
    if (!auth) return errorResponse(401, 'session_expired', 'Session expired or missing.')
    if (!verifyCsrf(request, auth.session)) return errorResponse(403, 'validation_failed', 'Invalid CSRF token.')
    const body = (await request.json()) as RegisterDeviceRequest
    registerDevice(auth.session.accountId, body.device_id)
    const response: RegisterDeviceResponse = { device_id: body.device_id, registered_at: new Date().toISOString() }
    return HttpResponse.json(response)
  }),
]

export { requireSession, verifyCsrf }
