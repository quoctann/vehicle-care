/**
 * Cho phép lưu KM thấp hơn hiện tại (không âm thầm loại bỏ dữ liệu nhập
 * offline), nhưng phải cảnh báo trước khi xác nhận — validation ở đây KHÔNG BAO
 * GIỜ chặn cứng vì lý do "thấp hơn hiện tại", chỉ chặn số âm hoặc không hữu hạn.
 */
export type OdometerValidationResult =
  | { valid: true; warning: null }
  | { valid: true; warning: 'lower_than_current' }
  | { valid: false; error: 'negative' };

export function validateOdometerReading(
  newReadingKm: number,
  currentOdometerKm: number | null,
): OdometerValidationResult {
  if (!Number.isFinite(newReadingKm) || newReadingKm < 0)
    return { valid: false, error: 'negative' };
  if (currentOdometerKm != null && newReadingKm < currentOdometerKm) {
    return { valid: true, warning: 'lower_than_current' };
  }
  return { valid: true, warning: null };
}

/**
 * Interval phải dương nếu có; số ngày phải là số nguyên an toàn. Mỗi cấu hình
 * phải có ít nhất một chu kỳ, kể cả khi tắt nhắc nhở.
 */
export type ReminderIntervalValidationResult =
  | { valid: true }
  | {
      valid: false;
      error: 'missing_interval' | 'interval_km_not_positive' | 'interval_days_not_positive';
    };

export function validateReminderInterval(
  intervalKm: number | null,
  intervalDays: number | null,
): ReminderIntervalValidationResult {
  if (intervalKm != null && (!Number.isFinite(intervalKm) || intervalKm <= 0))
    return { valid: false, error: 'interval_km_not_positive' };
  if (intervalDays != null && (!Number.isSafeInteger(intervalDays) || intervalDays <= 0))
    return { valid: false, error: 'interval_days_not_positive' };
  if (intervalKm == null && intervalDays == null)
    return { valid: false, error: 'missing_interval' };
  return { valid: true };
}
