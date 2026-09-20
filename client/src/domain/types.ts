/**
 * Domain types — nguồn sự thật cho toàn bộ business entity.
 *
 * Field naming khớp 1:1 với data dictionary ở `.docs/implementation-plan-section-5.md`
 * (mục A1/A2). Mọi datetime là chuỗi ISO-8601 UTC (`created_at_client` phía server,
 * ở đây gọi là `createdAtClient` — KHÔNG dùng để phân xử conflict, chỉ để hiển thị).
 *
 * File này KHÔNG import React/Dexie/fetch — domain logic phải test được mà không
 * cần trình duyệt hay database thật.
 */

/** ISO-8601 datetime string, luôn là UTC instant (vd "2026-09-17T10:00:00.000Z"). */
export type IsoDateTime = string

/** ISO-8601 calendar date string "YYYY-MM-DD", diễn giải theo timezone của Account. */
export type IsoDate = string

/** IANA timezone identifier, vd "Asia/Ho_Chi_Minh". */
export type IanaTimezone = string

export type Account = {
  id: string
  email: string
  name: string | null
  timezone: IanaTimezone
  createdAtClient: IsoDateTime
}

/**
 * Vehicle — mutable, tombstone qua `deletedAt` (không xóa vật lý).
 * `archivedAt` khác `deletedAt`: archive là ẩn có thể khôi phục, tombstone là xóa logic.
 */
export type Vehicle = {
  id: string
  accountId: string
  name: string
  plateNumber: string | null
  archivedAt: IsoDateTime | null
  deletedAt: IsoDateTime | null
  /** Ngưỡng "sắp đến hạn" riêng cho xe này, tỉ lệ (0,1] — null dùng mặc định hệ thống `DUE_SOON_REMAINING_RATIO`. */
  dueSoonRatio: number | null
  createdAtClient: IsoDateTime
  /** Chỉ có giá trị sau khi đã sync — null nghĩa là chưa từng push lên server. */
  receivedAtServer: IsoDateTime | null
  serverSeq: number | null
}

/**
 * PartType — 10 dòng seed cố định UUID (xem `data/seed.ts`, `accountId: null`, không
 * sửa/xoá được) CỘNG hạng mục tuỳ chỉnh do từng account tự tạo (`accountId` = account sở
 * hữu — feedback Feature #2). Từ Stage 2, entity mutable thật (đi qua sync/push+pull như
 * `Vehicle`), không còn read-only cache đơn thuần. Client PHẢI xử lý được code chưa biết
 * một cách graceful (xem `partType.ts`), không hard-code enum đóng cứng.
 */
export type PartType = {
  id: string
  code: string
  displayName: string
  displayOrder: number
  active: boolean
  seedVersion: number
  accountId: string | null
  createdAtClient: IsoDateTime
  receivedAtServer: IsoDateTime | null
  serverSeq: number | null
}

/**
 * ReminderConfig — mutable, tombstone qua `deletedAt`, unique theo (vehicleId, partTypeId)
 * khi chưa tombstone (enforce ở repository, Dexie không hỗ trợ partial unique index).
 *
 * Phải có ít nhất 1 trong 2 field interval; baseline dùng khi CHƯA từng có ServiceLog
 * (xem domain/reminder.ts — baseline thật sự ưu tiên ServiceLog mới nhất nếu có).
 */
export type ReminderConfig = {
  id: string
  accountId: string
  vehicleId: string
  partTypeId: string
  intervalKm: number | null
  intervalDays: number | null
  baselineOdometerKm: number | null
  baselineDate: IsoDate | null
  enabled: boolean
  deletedAt: IsoDateTime | null
  createdAtClient: IsoDateTime
  receivedAtServer: IsoDateTime | null
  serverSeq: number | null
}

/** OdometerLog — append-only, không sửa/xóa. */
export type OdometerLog = {
  id: string
  accountId: string
  vehicleId: string
  odometerKm: number
  recordedAt: IsoDateTime
  note: string | null
  /** Log tạo thủ công hay đi kèm 1 lần đổ xăng (xem FuelLog.odometerLogId). */
  source: 'manual' | 'fuel'
  createdAtClient: IsoDateTime
  receivedAtServer: IsoDateTime | null
  serverSeq: number | null
}

/** FuelLog — append-only. Nếu có nhập KM, `odometerLogId` trỏ tới OdometerLog tạo cùng lúc. */
export type FuelLog = {
  id: string
  accountId: string
  vehicleId: string
  recordedAt: IsoDateTime
  liters: number | null
  costVnd: number | null
  shop: string | null
  note: string | null
  odometerLogId: string | null
  /** Giữ cho tương lai (fuel efficiency) — KHÔNG dùng để tính toán gì ở MVP này. */
  isFullTank: boolean
  deletedAt: IsoDateTime | null
  createdAtClient: IsoDateTime
  receivedAtServer: IsoDateTime | null
  serverSeq: number | null
}

/** ServiceLog — append-only. MVP chỉ có 1 loại sự kiện: hoàn tất thay/bảo dưỡng. */
export type ServiceLog = {
  id: string
  accountId: string
  vehicleId: string
  partTypeId: string
  servicedAt: IsoDateTime
  /** Snapshot odometer tại thời điểm service, để tính reminder ổn định về sau. */
  odometerKmSnapshot: number | null
  /** Không thuộc scope quyết định ở decision.md nhưng cần cho màn Costs — optional, không ảnh hưởng domain reminder logic. */
  costVnd: number | null
  note: string | null
  deletedAt: IsoDateTime | null
  createdAtClient: IsoDateTime
  receivedAtServer: IsoDateTime | null
  serverSeq: number | null
}

/** 4 trạng thái reminder theo B5 của implementation-plan-section-5.md. */
export type ReminderStatus = 'insufficient_data' | 'not_due' | 'due_soon' | 'overdue'

export type ReminderProgress = {
  /** Mốc bắt đầu dùng để tính (từ ServiceLog nếu có, else baseline user nhập). */
  baseline: number
  /** max(0, current - baseline) — clamp để tránh giá trị âm khi log lệch thứ tự. */
  used: number
  remaining: number
  /** used / interval, có thể > 1 khi overdue. */
  ratioUsed: number
}

export type ReminderDayProgress = {
  baseline: IsoDate
  usedDays: number
  remainingDays: number
  ratioUsed: number
}

export type ReminderCalculationResult = {
  status: ReminderStatus
  km: ReminderProgress | null
  days: ReminderDayProgress | null
  /** Cho debug/giải thích: baseline lấy từ ServiceLog hay từ config gốc. */
  basis: {
    usedServiceLog: boolean
  }
}
