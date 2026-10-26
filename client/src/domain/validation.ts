export const MAX_ODOMETER_KM = 99999999.99;
export const MAX_INTERVAL_DAYS = 2147483647;
export const MAX_LITERS = 9999.99;
export const MAX_NOTE_BYTES = 2000;
export const MAX_PART_TYPE_NAME_BYTES = 500;
export const MAX_PART_TYPE_NAME_LENGTH = 200;

export function isValidOdometerKm(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= MAX_ODOMETER_KM;
}

export function isValidLiters(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= MAX_LITERS;
}

export function isValidNote(value: string | null | undefined): boolean {
  return value == null || new TextEncoder().encode(value).byteLength <= MAX_NOTE_BYTES;
}

export function isValidPartTypeName(value: string): boolean {
  const name = value.trim();
  return (
    name.length > 0 &&
    name.length <= MAX_PART_TYPE_NAME_LENGTH &&
    new TextEncoder().encode(name).byteLength <= MAX_PART_TYPE_NAME_BYTES
  );
}

/** Nonblank invalid input must reach validation, never silently become null. */
export function parseOptionalNumber(value: string): number | null {
  return value.trim() === '' ? null : Number(value);
}

/**
 * Cho phép lưu KM thấp hơn hiện tại (không âm thầm loại bỏ dữ liệu nhập
 * offline), nhưng phải cảnh báo trước khi xác nhận — validation ở đây KHÔNG BAO
 * GIỜ chặn cứng vì lý do "thấp hơn hiện tại", chỉ chặn giá trị ngoài contract.
 */
export type OdometerValidationResult =
  | { valid: true; warning: null }
  | { valid: true; warning: 'lower_than_current' }
  | { valid: false; error: 'negative' | 'out_of_range' };

export function validateOdometerReading(
  newReadingKm: number,
  currentOdometerKm: number | null,
): OdometerValidationResult {
  if (!Number.isFinite(newReadingKm) || newReadingKm < 0)
    return { valid: false, error: 'negative' };
  if (newReadingKm > MAX_ODOMETER_KM) return { valid: false, error: 'out_of_range' };
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
  if (intervalKm != null && (!isValidOdometerKm(intervalKm) || intervalKm <= 0))
    return { valid: false, error: 'interval_km_not_positive' };
  if (
    intervalDays != null &&
    (!Number.isInteger(intervalDays) || intervalDays <= 0 || intervalDays > MAX_INTERVAL_DAYS)
  )
    return { valid: false, error: 'interval_days_not_positive' };
  if (intervalKm == null && intervalDays == null)
    return { valid: false, error: 'missing_interval' };
  return { valid: true };
}
