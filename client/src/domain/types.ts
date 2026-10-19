/**
 * Domain types — nguồn sự thật cho toàn bộ business entity.
 *
 * Data dictionary: `.docs/decision.md`. Timestamp là UTC instant; `createdAtClient`
 * chỉ lưu local để hiển thị/tie-break, không gửi lên server để phân xử conflict.
 *
 * File này KHÔNG import React/Dexie/fetch — domain logic phải test được mà không
 * cần trình duyệt hay database thật.
 */

/** ISO-8601 datetime string, luôn là UTC instant (vd "2026-09-17T10:00:00.000Z"). */
export type IsoDateTime = string;

/** ISO-8601 calendar date string "YYYY-MM-DD", diễn giải theo timezone của Account. */
export type IsoDate = string;

/** Canonical fixed UTC offset selected from the supported timezone list. */
export type IanaTimezone = string;

export type Account = {
  id: string;
  email: string;
  name: string | null;
  timezone: IanaTimezone;
  createdAtClient: IsoDateTime;
};

/**
 * Vehicle — mutable, tombstone qua `deletedAt` (không xóa vật lý).
 * `archivedAt` khác `deletedAt`: archive là ẩn có thể khôi phục, tombstone là xóa logic.
 */
export type Vehicle = {
  id: string;
  accountId: string;
  name: string;
  plateNumber: string | null;
  archivedAt: IsoDateTime | null;
  deletedAt: IsoDateTime | null;
  /** Ngưỡng "sắp đến hạn" riêng cho xe này, tỉ lệ (0,1] — null dùng mặc định hệ thống `DUE_SOON_REMAINING_RATIO`. */
  dueSoonRatio: number | null;
  createdAtClient: IsoDateTime;
  /** Chỉ có giá trị sau khi đã sync — null nghĩa là chưa từng push lên server. */
  serverSyncedAt: IsoDateTime | null;
  serverSeq: number | null;
};

/**
 * PartType — mỗi account có bộ dòng riêng của mình: 10 dòng được seed sẵn lúc tạo
 * account (từ template server, xem `seed/manifest.go`) CỘNG hạng mục tự thêm sau đó.
 * Không còn tầng "mặc định dùng chung không sửa được" — mọi dòng
 * đều thuộc sở hữu và sửa/xoá được bởi chính account, đi qua sync/push+pull như `Vehicle`.
 * Client PHẢI xử lý được code chưa biết một cách graceful (xem `partType.ts`), không
 * hard-code enum đóng cứng.
 */
export type PartType = {
  id: string;
  code: string;
  displayName: string;
  displayOrder: number;
  active: boolean;
  accountId: string;
  createdAtClient: IsoDateTime;
  serverSyncedAt: IsoDateTime | null;
  serverSeq: number | null;
};

/**
 * ReminderConfig — mutable, tombstone qua `deletedAt`, unique theo (vehicleId, partTypeId)
 * khi chưa tombstone (enforce ở repository, Dexie không hỗ trợ partial unique index).
 *
 * Phải có ít nhất 1 trong 2 field interval; baseline dùng khi CHƯA từng có ServiceLog
 * (xem domain/reminder.ts — baseline thật sự ưu tiên ServiceLog mới nhất nếu có).
 */
export type ReminderConfig = {
  id: string;
  accountId: string;
  vehicleId: string;
  partTypeId: string;
  intervalKm: number | null;
  intervalDays: number | null;
  baselineOdometerKm: number | null;
  baselineDate: IsoDate | null;
  enabled: boolean;
  deletedAt: IsoDateTime | null;
  createdAtClient: IsoDateTime;
  serverSyncedAt: IsoDateTime | null;
  serverSeq: number | null;
};

/** OdometerLog — append-only, không sửa/xóa. */
export type OdometerLog = {
  id: string;
  accountId: string;
  vehicleId: string;
  odometerKm: number;
  recordedAt: IsoDateTime;
  note: string | null;
  /** Log tạo thủ công hay đi kèm 1 lần đổ xăng (xem FuelLog.odometerLogId). */
  source: 'manual' | 'fuel';
  createdAtClient: IsoDateTime;
  serverSyncedAt: IsoDateTime | null;
  serverSeq: number | null;
};

/** FuelLog — mutable, xóa mềm. Sửa/xóa không thay đổi OdometerLog tạo kèm. */
export type FuelLog = {
  id: string;
  accountId: string;
  vehicleId: string;
  recordedAt: IsoDateTime;
  liters: number | null;
  /** Hiện hiển thị bằng VND; currency riêng sẽ được thêm ở giai đoạn sau. */
  cost: number | null;
  note: string | null;
  odometerLogId: string | null;
  /** Giữ cho tương lai (fuel efficiency) — KHÔNG dùng để tính toán gì ở MVP này. */
  isFullTank: boolean;
  deletedAt: IsoDateTime | null;
  createdAtClient: IsoDateTime;
  serverSyncedAt: IsoDateTime | null;
  serverSeq: number | null;
};

/** ServiceLog — mutable, xóa mềm; sự kiện hoàn tất thay/bảo dưỡng dùng làm mốc reminder. */
export type ServiceLog = {
  id: string;
  accountId: string;
  vehicleId: string;
  partTypeId: string;
  servicedAt: IsoDateTime;
  /** Snapshot odometer tại thời điểm service, để tính reminder ổn định về sau. */
  odometerKmSnapshot: number | null;
  /** Hiện hiển thị bằng VND; currency riêng sẽ được thêm ở giai đoạn sau. */
  cost: number | null;
  note: string | null;
  deletedAt: IsoDateTime | null;
  createdAtClient: IsoDateTime;
  serverSyncedAt: IsoDateTime | null;
  serverSeq: number | null;
};

/** Trạng thái suy ra từ log, chu kỳ và mốc ban đầu; không lưu như entity riêng. */
export type ReminderStatus = 'insufficient_data' | 'not_due' | 'due_soon' | 'overdue';

export type ReminderProgress = {
  /** Mốc bắt đầu dùng để tính (từ ServiceLog nếu có, else baseline user nhập). */
  baseline: number;
  /** max(0, current - baseline) — clamp để tránh giá trị âm khi log lệch thứ tự. */
  used: number;
  remaining: number;
  /** used / interval, có thể > 1 khi overdue. */
  ratioUsed: number;
};

export type ReminderDayProgress = {
  baseline: IsoDate;
  usedDays: number;
  remainingDays: number;
  ratioUsed: number;
};

export type ReminderCalculationResult = {
  status: ReminderStatus;
  km: ReminderProgress | null;
  days: ReminderDayProgress | null;
  /** Cho debug/giải thích: baseline lấy từ ServiceLog hay từ config gốc. */
  basis: {
    usedServiceLog: boolean;
  };
};
