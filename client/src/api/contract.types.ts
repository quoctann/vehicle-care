/**
 * ĐÂY LÀ HỢP ĐỒNG DÙNG CHUNG FE/BE (nguồn sự thật phía TypeScript).
 *
 * Contract hiện hành được mô tả ở `.docs/decision.md`; thay đổi JSON phải cập nhật
 * cả tài liệu và types. Wire dùng snake_case; domain/Dexie dùng camelCase qua
 * `data/mappers.ts`. TypeScript không thay thế validation JSON tại runtime.
 */

// MARK: Auth & device

export type AccountDto = {
  id: string;
  email: string;
  name: string | null;
  timezone: string;
  email_verified: boolean;
};

export type SignupRequest = {
  email: string;
  password: string;
  name?: string;
};

export type SignupResponse = {
  status: 'verification_required';
  email: string;
};

export type VerifyEmailRequest = {
  token: string;
};

export type VerifyEmailResponse = {
  status: 'verified';
};

export type ResendVerificationRequest = {
  email: string;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type LoginResponse = {
  account: AccountDto;
};

export type ForgotPasswordRequest = {
  email: string;
};

export type ResetPasswordRequest = {
  token: string;
  new_password: string;
};

export type ResetPasswordResponse = {
  status: 'reset';
};

/** 200 = còn phiên hợp lệ; 401 (ApiErrorBody) = chưa đăng nhập/hết hạn. */
export type SessionResponse = {
  account: AccountDto;
};

export type UpdateAccountTimezoneRequest = {
  timezone: string;
  expected_account_id?: string;
};

export type UpdateAccountTimezoneResponse = {
  account: AccountDto;
};

export type RegisterDeviceRequest = {
  device_id: string;
  platform: string;
  app_version: string;
};

export type RegisterDeviceResponse = {
  device_id: string;
  registered_at: string;
};

// MARK: Sync

export const SyncEntityType = {
  Vehicle: 'vehicle',
  ReminderConfig: 'reminder_config',
  OdometerLog: 'odometer_log',
  FuelLog: 'fuel_log',
  ServiceLog: 'service_log',
  PartType: 'part_type',
} as const;
export type SyncEntityType = (typeof SyncEntityType)[keyof typeof SyncEntityType];

export const SyncOperation = { Create: 'create', Update: 'update' } as const;
export type SyncOperation = (typeof SyncOperation)[keyof typeof SyncOperation];

// Full outgoing snake_case snapshots. Incoming JSON still needs runtime checks;
// these types neither validate JSON nor replace the mappers' legacy defaults.
export type VehiclePayload = {
  name: string;
  plate_number: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  due_soon_ratio: number | null;
};

export type ReminderConfigPayload = {
  vehicle_id: string;
  part_type_id: string;
  interval_km: number | null;
  interval_days: number | null;
  baseline_odometer_km: number | null;
  baseline_date: string | null;
  enabled: boolean;
  deleted_at: string | null;
};

export type OdometerLogPayload = {
  vehicle_id: string;
  odometer_km: number;
  recorded_at: string;
  note: string | null;
  source: 'manual' | 'fuel';
};

export type FuelLogPayload = {
  vehicle_id: string;
  recorded_at: string;
  liters: number | null;
  cost: number | null;
  note: string | null;
  odometer_log_id: string | null;
  is_full_tank: boolean;
  deleted_at: string | null;
};

export type ServiceLogPayload = {
  vehicle_id: string;
  part_type_id: string;
  serviced_at: string;
  odometer_km_snapshot: number | null;
  cost: number | null;
  note: string | null;
  deleted_at: string | null;
};

export type PartTypePayload = {
  /** Open vocabulary: server seed codes and user-created UUID codes. */
  code: string;
  name: string;
  display_order: number;
  active: boolean;
};

export type SyncPayloadMap = {
  vehicle: VehiclePayload;
  reminder_config: ReminderConfigPayload;
  odometer_log: OdometerLogPayload;
  fuel_log: FuelLogPayload;
  service_log: ServiceLogPayload;
  part_type: PartTypePayload;
};

export type SyncOperationFor<E extends SyncEntityType> = E extends 'odometer_log'
  ? typeof SyncOperation.Create
  : SyncOperation;

type SyncEntityEnvelope = {
  [E in SyncEntityType]: {
    entity_type: E;
    operation: SyncOperationFor<E>;
    payload: SyncPayloadMap[E];
  };
}[SyncEntityType];

export type PushMutation = SyncEntityEnvelope & {
  mutation_id: string;
  entity_id: string;
};

export type PushRequest = {
  device_id: string;
  mutations: PushMutation[];
};

export const MutationResultStatus = {
  Applied: 'applied',
  Duplicate: 'duplicate',
  Rejected: 'rejected',
  RetryableError: 'retryable_error',
} as const;
export type MutationResultStatus = (typeof MutationResultStatus)[keyof typeof MutationResultStatus];

export type MutationResult = {
  mutation_id: string;
  status: MutationResultStatus;
  server_seq?: number;
  server_synced_at?: string;
  error_code?: ApiErrorCode;
  error_message?: string;
  retryable?: boolean;
};

export type PushResponse = {
  results: MutationResult[];
};

export type PullChange = SyncEntityEnvelope & {
  server_seq: number;
  entity_id: string;
  server_synced_at: string;
};

export type PullResponse = {
  changes: PullChange[];
  next_cursor: number;
  until_seq: number;
  has_more: boolean;
  /** Chỉ để observability — KHÔNG dùng để xử lý conflict phía client. */
  server_time: string;
};

// MARK: Part type catalog

/**
 * Entity mutable thật đi qua push/pull như vehicle. Seed rows cũng có server sequence
 * và changefeed entry; endpoint này chỉ là read-only catalog phụ trợ.
 */
export type PartTypeDto = {
  id: string;
  code: string;
  name: string;
  display_order: number;
  active: boolean;
  account_id: string;
  server_seq: number;
  server_synced_at: string;
};

export type PartTypesResponse = {
  part_types: PartTypeDto[];
};

//
// MARK: Errors
//

export const ApiErrorCode = {
  AuthInvalid: 'auth_invalid',
  SessionExpired: 'session_expired',
  ValidationFailed: 'validation_failed',
  OwnershipInvalid: 'ownership_invalid',
  RateLimited: 'rate_limited',
  InternalError: 'internal_error',
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    retryable: boolean;
    request_id: string;
  };
};
