/**
 * ĐÂY LÀ HỢP ĐỒNG DÙNG CHUNG FE/BE (nguồn sự thật phía TypeScript).
 *
 * Mirror 1:1 nội dung `.docs/sync-api-contract.md`. Sửa tài liệu đó TRƯỚC, rồi
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

export type SyncEntityType = 'vehicle' | 'reminder_config' | 'odometer_log' | 'fuel_log' | 'service_log'
export type SyncOperation = 'create' | 'update'

export type PushMutation = {
  mutation_id: string
  entity_type: SyncEntityType
  operation: SyncOperation
  entity_id: string
  /** Snapshot đầy đủ entity tại thời điểm mutation — shape khớp domain type tương ứng, field snake_case. */
  payload: Record<string, unknown>
  /**
   * CHỈ áp dụng cho entity mutable (vehicle, reminder_config): `server_seq` gần nhất
   * mà client BIẾT về entity này lúc tạo mutation (null nếu client chưa từng thấy
   * bản nào từ server — entity mới tạo hoàn toàn cục bộ). Server dùng field này để
   * phân biệt `applied` (client đang sửa trên đúng bản mới nhất) với
   * `conflict_resolved` (đã có mutation khác từ thiết bị khác đáp xuống SAU bản
   * client biết nhưng TRƯỚC mutation này — LWW vẫn áp dụng bản mới nhất theo thời
   * điểm server nhận, `conflict_resolved` chỉ là tín hiệu "client nên biết state đã
   * bị người khác đổi", không phải từ chối).
   */
  base_server_seq?: number | null
}

export type PushRequest = {
  device_id: string
  api_version: '1'
  mutations: PushMutation[]
}

export type MutationResultStatus = 'applied' | 'duplicate' | 'rejected' | 'retryable_error' | 'conflict_resolved'

export type MutationResult = {
  mutation_id: string
  status: MutationResultStatus
  server_seq?: number
  received_at_server?: string
  error_code?: ApiErrorCode
  error_message?: string
  retryable?: boolean
  /** Chỉ có khi status = conflict_resolved — snapshot MỚI NHẤT phía server, client phải ghi đè local bằng giá trị này. */
  server_snapshot?: Record<string, unknown>
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
  watermark: string
  has_more: boolean
  /** Chỉ để observability — KHÔNG dùng để xử lý conflict phía client. */
  server_time: string
}

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
