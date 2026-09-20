import { CSRF_HEADER_NAME, readCsrfToken } from '@/lib/csrf'
import { API_BASE_URL } from './config'
import type {
  ForgotPasswordRequest,
  LoginRequest,
  LoginResponse,
  PartTypesResponse,
  PullResponse,
  PushRequest,
  PushResponse,
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
} from './contract.types'
import { parseApiError } from './errors'

type HttpMethod = 'GET' | 'POST'

/**
 * Fetch wrapper DUY NHẤT của app — mọi gọi API đi qua đây để đảm bảo:
 * - `credentials: 'include'` luôn bật (cookie session httpOnly cần cái này để trình
 *   duyệt tự đính kèm, KHÔNG cần và KHÔNG THỂ đọc token bằng JS).
 * - Header CSRF (double-submit, xem `lib/csrf.ts`) tự đính kèm cho method ghi.
 */
async function request<TResponse>(method: HttpMethod, path: string, body?: unknown): Promise<TResponse> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET') {
    const csrf = readCsrfToken()
    if (csrf) headers[CSRF_HEADER_NAME] = csrf
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) throw await parseApiError(response)
  if (response.status === 204) return undefined as TResponse
  return (await response.json()) as TResponse
}

// ─────────────────────────── Auth & device (D1) ───────────────────────────

export function signup(req: SignupRequest): Promise<SignupResponse> {
  return request('POST', '/auth/signup', req)
}

export function verifyEmail(req: VerifyEmailRequest): Promise<VerifyEmailResponse> {
  return request('POST', '/auth/verify-email', req)
}

export function resendVerificationEmail(req: ResendVerificationRequest): Promise<void> {
  return request('POST', '/auth/verify-email/resend', req)
}

export function login(req: LoginRequest): Promise<LoginResponse> {
  return request('POST', '/auth/login', req)
}

export function forgotPassword(req: ForgotPasswordRequest): Promise<void> {
  return request('POST', '/auth/password/forgot', req)
}

export function resetPassword(req: ResetPasswordRequest): Promise<ResetPasswordResponse> {
  return request('POST', '/auth/password/reset', req)
}

/** Gọi 1 lần lúc app khởi động để biết còn phiên hợp lệ hay không (ném ApiError 401 nếu không). */
export function getSession(): Promise<SessionResponse> {
  return request('GET', '/auth/session')
}

/** Danh mục part_type — nguồn sự thật duy nhất cho UUID, xem `contract.types.ts` mục 2.14. */
export function listPartTypes(): Promise<PartTypesResponse> {
  return request('GET', '/part-types')
}

export function logout(): Promise<void> {
  return request('POST', '/auth/logout')
}

/**
 * Luồng Google OAuth thật là redirect 302 cả trang, KHÔNG phải fetch — vì vậy đây
 * là URL để `window.location.href = googleStartUrl()`, không phải hàm gọi API.
 */
export function googleStartUrl(): string {
  return `${API_BASE_URL}/auth/google/start`
}

export function registerDevice(req: RegisterDeviceRequest): Promise<RegisterDeviceResponse> {
  return request('POST', '/devices/register', req)
}

// ────────────────────────────── Sync (D2, D4) ──────────────────────────────

export function pushMutations(req: PushRequest): Promise<PushResponse> {
  return request('POST', '/sync/push', req)
}

export function pullChanges(params: { afterSeq: number; limit: number; watermark: string }): Promise<PullResponse> {
  const query = new URLSearchParams({
    after_seq: String(params.afterSeq),
    limit: String(params.limit),
    watermark: params.watermark,
  })
  return request('GET', `/sync/pull?${query.toString()}`)
}
