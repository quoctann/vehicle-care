import { DUE_SOON_REMAINING_RATIO } from './constants'
import { daysBetweenCalendarDates, toCalendarDateInTimezone } from './datetime'
import type {
  IanaTimezone,
  IsoDate,
  IsoDateTime,
  ReminderCalculationResult,
  ReminderConfig,
  ReminderDayProgress,
  ReminderProgress,
} from './types'

export type ReminderConfigInput = Pick<
  ReminderConfig,
  'intervalKm' | 'intervalDays' | 'baselineOdometerKm' | 'baselineDate'
>

export type LastServiceLogInput = {
  odometerKmSnapshot: number | null
  servicedAt: IsoDateTime
} | null

export type CalculateReminderStatusInput = {
  config: ReminderConfigInput
  /** null = chưa từng có OdometerLog nào cho xe này. */
  currentOdometerKm: number | null
  lastServiceLog: LastServiceLogInput
  now: IsoDateTime
  accountTimezone: IanaTimezone
}

/**
 * B5 — tính trạng thái reminder. Function THUẦN: không đọc DB/đồng hồ hệ thống,
 * mọi input đến từ tham số để test được deterministic.
 *
 * Quy tắc cốt lõi (xem decision.md mục 6.1, implementation-plan-section-5.md D-01..D-07):
 * - Baseline (mốc bắt đầu) ưu tiên lấy từ ServiceLog gần nhất nếu có, fallback về
 *   baseline user nhập lúc tạo reminder (D-05).
 * - `used = max(0, current - baseline)`: clamp về 0 để tránh giá trị âm vô nghĩa
 *   khi odometer bị nhập lệch thứ tự hoặc thấp hơn baseline (D-01/D-02).
 * - `overdue` nếu MỘT TRONG HAI điều kiện (km/ngày) đã cấu hình vượt chu kỳ.
 * - `due_soon` nếu không overdue và MỘT TRONG HAI điều kiện còn lại ≤10% chu kỳ
 *   (hằng số hệ thống `DUE_SOON_REMAINING_RATIO`, KHÔNG cấu hình theo từng reminder — D-04).
 * - `insufficient_data` CHỈ khi MỌI điều kiện đã cấu hình đều thiếu dữ liệu cần thiết
 *   — 1 điều kiện thiếu dữ liệu không chặn việc đánh giá điều kiện còn lại.
 * - `enabled=false` KHÔNG phải 1 giá trị của status này — đó là filter ở tầng
 *   query/UI (ẩn reminder đã tắt), không phải kết quả domain.
 */
export function calculateReminderStatus(
  input: CalculateReminderStatusInput,
): ReminderCalculationResult {
  const { config, currentOdometerKm, lastServiceLog, now, accountTimezone } = input

  const hasKmCondition = config.intervalKm != null && config.intervalKm > 0
  const hasDayCondition = config.intervalDays != null && config.intervalDays > 0

  const usedServiceLogForKm = lastServiceLog != null && lastServiceLog.odometerKmSnapshot != null
  const baselineKm = usedServiceLogForKm
    ? (lastServiceLog!.odometerKmSnapshot as number)
    : config.baselineOdometerKm

  const usedServiceLogForDays = lastServiceLog != null
  const baselineDate: IsoDate | null = usedServiceLogForDays
    ? toCalendarDateInTimezone(lastServiceLog!.servicedAt, accountTimezone)
    : config.baselineDate

  let km: ReminderProgress | null = null
  let kmInsufficient = false
  if (hasKmCondition) {
    if (currentOdometerKm == null || baselineKm == null) {
      kmInsufficient = true
    } else {
      const used = Math.max(0, currentOdometerKm - baselineKm)
      const intervalKm = config.intervalKm as number
      km = {
        baseline: baselineKm,
        used,
        remaining: intervalKm - used,
        ratioUsed: used / intervalKm,
      }
    }
  }

  let days: ReminderDayProgress | null = null
  let daysInsufficient = false
  if (hasDayCondition) {
    if (baselineDate == null) {
      daysInsufficient = true
    } else {
      const today = toCalendarDateInTimezone(now, accountTimezone)
      const usedDays = Math.max(0, daysBetweenCalendarDates(baselineDate, today))
      const intervalDays = config.intervalDays as number
      days = {
        baseline: baselineDate,
        usedDays,
        remainingDays: intervalDays - usedDays,
        ratioUsed: usedDays / intervalDays,
      }
    }
  }

  const configuredCount = Number(hasKmCondition) + Number(hasDayCondition)
  const insufficientCount = Number(hasKmCondition && kmInsufficient) + Number(hasDayCondition && daysInsufficient)

  const status =
    configuredCount === 0 || insufficientCount === configuredCount
      ? 'insufficient_data'
      : (km && km.remaining <= 0) || (days && days.remainingDays <= 0)
        ? 'overdue'
        : (km && km.ratioUsed >= DUE_SOON_REMAINING_RATIO) || (days && days.ratioUsed >= DUE_SOON_REMAINING_RATIO)
          ? 'due_soon'
          : 'not_due'

  return {
    status,
    km,
    days,
    basis: { usedServiceLog: usedServiceLogForKm || usedServiceLogForDays },
  }
}
