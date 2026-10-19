import type { IanaTimezone, IsoDate, IsoDateTime } from './types';
import { toRuntimeTimezone } from './timezone';

/**
 * Reminder theo ngày dùng timezone của Account, không phải timezone trình duyệt.
 * Chuyển UTC instant thành ngày lịch "YYYY-MM-DD" bằng Intl; lựa chọn mới của
 * account là fixed UTC offset, không tự đổi theo DST.
 */
export function toCalendarDateInTimezone(instant: IsoDateTime, timezone: IanaTimezone): IsoDate {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: toRuntimeTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date(instant));
}

/** Số ngày lịch giữa 2 ngày "YYYY-MM-DD" (không quan tâm giờ/phút/DST vì đã quy về ngày lịch). */
export function daysBetweenCalendarDates(from: IsoDate, to: IsoDate): number {
  const fromMs = new Date(`${from}T00:00:00Z`).getTime();
  const toMs = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((toMs - fromMs) / 86_400_000);
}
