import { daysBetweenCalendarDates, toCalendarDateInTimezone } from '@/domain/datetime'
import type { IanaTimezone, IsoDateTime } from '@/domain/types'

/**
 * Formatting cho UI (locale/copy) — khác `domain/datetime.ts` (tính toán thuần
 * phục vụ business rule). Đặt riêng vì đây là mối quan tâm trình bày, không phải
 * domain logic cần test theo bộ quy tắc nghiệp vụ.
 */
export function daysAgo(instant: IsoDateTime, timezone: IanaTimezone, now: IsoDateTime = new Date().toISOString()): number {
  return daysBetweenCalendarDates(toCalendarDateInTimezone(instant, timezone), toCalendarDateInTimezone(now, timezone))
}

export function formatUpdatedLabel(instant: IsoDateTime | null, timezone: IanaTimezone): string {
  if (!instant) return 'Chưa có dữ liệu'
  const diff = daysAgo(instant, timezone)
  if (diff <= 0) return 'Cập nhật vừa xong'
  if (diff === 1) return 'Cập nhật hôm qua'
  return `Cập nhật ${diff} ngày trước`
}

export function formatShortDate(instant: IsoDateTime, timezone: IanaTimezone): string {
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: 'short', timeZone: timezone }).format(
    new Date(instant),
  )
}
