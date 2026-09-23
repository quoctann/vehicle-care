/**
 * ĐÂY LÀ HỢP ĐỒNG DÙNG CHUNG FE/BE (nguồn sự thật phía TypeScript).
 *
 * Mirror nội dung current implementation ở `.docs/sync-api-contract.md`. Sửa tài liệu đó TRƯỚC, rồi
 * đồng bộ tay các type ở file này SAU — không tự ý đổi shape ở đây mà không cập
 * nhật doc. Field trên "wire" (JSON thật sự trao đổi qua HTTP) dùng snake_case
 * đúng như response server trả về; việc map sang domain type (camelCase, ở
 * `src/domain/types.ts`) diễn ra ở `src/api/client.ts` và `src/sync/applyChange.ts`,
 * KHÔNG lẫn lộn 2 tầng field-naming này ở nơi khác.
 */

// ─────────────────────────── Auth & device (D1) ───────────────────────────

export type AccountDto = {
  id: string
  email: string
  name: string | null
  timezone: string
  email_verified: boolean
}

export type SignupRequest = { email: string; password: string; name?: string }
export type SignupResponse = { status: 'verification_required'; email: string }

export type VerifyEmailRequest = { token: string }
export type VerifyEmailResponse = { status: 'verified' }

export type ResendVerificationRequest = { email: string }

export type LoginRequest = { email: string; password: string }
export type LoginResponse = { account: AccountDto }

export type ForgotPasswordRequest = { email: string }

export type ResetPasswordRequest = { token: string; new_password: string }
export type ResetPasswordResponse = { status: 'reset' }

/** 200 = còn phiên hợp lệ; 401 (ApiErrorBody) = chưa đăng nhập/hết hạn. */
export type SessionResponse = { account: AccountDto }

export type RegisterDeviceRequest = { device_id: string; platform: string; app_version: string }
export type RegisterDeviceResponse = { device_id: string; registered_at: string }

// ────────────────────────────── Sync (D2, D4) ──────────────────────────────

export type SyncEntityType = 'vehicle' | 'reminder_config' | 'odometer_log' | 'fuel_log' | 'service_log' | 'part_type'
export type SyncOperation = 'create' | 'update'

export type PushMutation = {
  mutation_id: string
  entity_type: SyncEntityType
  operation: SyncOperation
  entity_id: string
  /** Snapshot đầy đủ entity tại thời điểm mutation — shape khớp domain type tương ứng, field snake_case. */
  payload: Record<string, unknown>
}

export type PushRequest = {
  device_id: string
  api_version: '1'
  mutations: PushMutation[]
}

export type MutationResultStatus = 'applied' | 'duplicate' | 'rejected' | 'retryable_error'

export type MutationResult = {
  mutation_id: string
  status: MutationResultStatus
  server_seq?: number
  received_at_server?: string
  error_code?: ApiErrorCode
  error_message?: string
  retryable?: boolean
}

export type PushResponse = { results: MutationResult[] }

export type PullChange = {
  server_seq: number
  entity_type: SyncEntityType
  entity_id: string
  operation: SyncOperation
  payload: Record<string, unknown>
  received_at_server: string
}

export type PullResponse = {
  changes: PullChange[]
  next_cursor: number
  until_seq: number
  has_more: boolean
  /** Chỉ để observability — KHÔNG dùng để xử lý conflict phía client. */
  server_time: string
}

// ────────────────────────── Part type catalog (2.14) ──────────────────────────

/**
 * Entity mutable thật đi qua push/pull như vehicle. Seed rows cũng có server sequence
 * và changefeed entry; endpoint này chỉ là read-only catalog phụ trợ.
 */
export type PartTypeDto = {
  id: string
  code: string
  name_vi: string
  display_order: number
  active: boolean
  seed_version: string
  account_id: string
  server_seq: number
  received_at_server: string
}

export type PartTypesResponse = { part_types: PartTypeDto[] }

// ──────────────────────────────── Errors (D6) ────────────────────────────────

export type ApiErrorCode =
  | 'auth_invalid'
  | 'session_expired'
  | 'validation_failed'
  | 'ownership_invalid'
  | 'unsupported_version'
  | 'rate_limited'
  | 'internal_error'

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode
    message: string
    retryable: boolean
    request_id: string
  }
}
