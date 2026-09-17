import type { IanaTimezone, IsoDate, IsoDateTime } from './types'

/**
 * D-07: reminder theo ngày phải tính theo timezone của Account, không phải UTC
 * hay timezone trình duyệt. Hàm này quy 1 instant UTC về ngày lịch "YYYY-MM-DD"
 * theo đúng timezone account — dùng `Intl` thay vì tự tính offset để đúng cả khi
 * có DST.
 */
export function toCalendarDateInTimezone(instant: IsoDateTime, timezone: IanaTimezone): IsoDate {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(new Date(instant))
}

/** Số ngày lịch giữa 2 ngày "YYYY-MM-DD" (không quan tâm giờ/phút/DST vì đã quy về ngày lịch). */
export function daysBetweenCalendarDates(from: IsoDate, to: IsoDate): number {
  const fromMs = new Date(`${from}T00:00:00Z`).getTime()
  const toMs = new Date(`${to}T00:00:00Z`).getTime()
  return Math.round((toMs - fromMs) / 86_400_000)
}
