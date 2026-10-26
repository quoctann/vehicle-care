import { describe, expect, it } from 'vitest';
import {
  isValidLiters,
  isValidNote,
  isValidPartTypeName,
  parseOptionalNumber,
  validateOdometerReading,
  validateReminderInterval,
} from './validation';

describe('wire contract bounds', () => {
  it.each([0, 123.456, 99999999.99])('accepts KM %s without rounding', (value) => {
    expect(validateOdometerReading(value, null).valid).toBe(true);
  });
  it.each([-1, 99999999.991, NaN, Infinity, -Infinity])('rejects KM %s', (value) => {
    expect(validateOdometerReading(value, null).valid).toBe(false);
  });
  it.each([0.001, 123.456, 9999.99])('accepts liters %s', (value) => {
    expect(isValidLiters(value)).toBe(true);
  });
  it.each([0, -1, 9999.991, NaN, Infinity])('rejects liters %s', (value) => {
    expect(isValidLiters(value)).toBe(false);
  });
  it('accepts exact interval maxima and fractional KM', () => {
    expect(validateReminderInterval(99999999.99, 2147483647).valid).toBe(true);
    expect(validateReminderInterval(123.456, null).valid).toBe(true);
  });
  it.each([0, -1, 99999999.991, NaN, Infinity])(
    'rejects interval KM %s even with valid days',
    (value) => {
      expect(validateReminderInterval(value, 1).valid).toBe(false);
    },
  );
  it.each([0, -1, 1.1, 2147483648, NaN, Infinity])(
    'rejects interval days %s even with valid KM',
    (value) => {
      expect(validateReminderInterval(1, value).valid).toBe(false);
    },
  );
  it('counts note UTF-8 bytes, not characters, and permits null', () => {
    expect(isValidNote(null)).toBe(true);
    expect(isValidNote('')).toBe(true);
    expect(isValidNote('😀'.repeat(500))).toBe(true);
    expect(isValidNote('😀'.repeat(500) + 'a')).toBe(false);
    expect(isValidNote('a'.repeat(2001))).toBe(false);
  });
  it('keeps both the part-name UX limit and UTF-8 byte limit', () => {
    expect(isValidPartTypeName('a'.repeat(200))).toBe(true);
    expect(isValidPartTypeName('a'.repeat(201))).toBe(false);
    expect(isValidPartTypeName('ắ'.repeat(166) + 'ab')).toBe(true);
    expect(isValidPartTypeName('ắ'.repeat(167))).toBe(false);
    expect(isValidPartTypeName('  ')).toBe(false);
  });
  it('only treats blank optional input as null, never invalid nonblank input', () => {
    expect(parseOptionalNumber('  ')).toBeNull();
    expect(parseOptionalNumber('-1')).toBe(-1);
    expect(parseOptionalNumber('invalid')).toBeNaN();
    expect(parseOptionalNumber('123.456')).toBe(123.456);
  });
});

describe('validateOdometerReading', () => {
  it('hợp lệ, không cảnh báo khi >= hiện tại', () => {
    expect(validateOdometerReading(1000, 900)).toEqual({ valid: true, warning: null });
  });

  it('hợp lệ khi chưa có odometer hiện tại (lần đầu nhập)', () => {
    expect(validateOdometerReading(500, null)).toEqual({ valid: true, warning: null });
  });

  it('cho phép nhưng cảnh báo khi thấp hơn hiện tại (D-02, không chặn cứng)', () => {
    expect(validateOdometerReading(800, 900)).toEqual({
      valid: true,
      warning: 'lower_than_current',
    });
  });

  it('từ chối giá trị âm', () => {
    expect(validateOdometerReading(-1, 900)).toEqual({ valid: false, error: 'negative' });
  });
});

describe('validateReminderInterval', () => {
  it('hợp lệ khi chỉ có interval km', () => {
    expect(validateReminderInterval(5000, null)).toEqual({ valid: true });
  });

  it('hợp lệ khi chỉ có interval ngày', () => {
    expect(validateReminderInterval(null, 180)).toEqual({ valid: true });
  });

  it('hợp lệ khi có cả hai', () => {
    expect(validateReminderInterval(5000, 180)).toEqual({ valid: true });
  });

  it('từ chối khi thiếu cả hai (A3: ít nhất 1 trong 2)', () => {
    expect(validateReminderInterval(null, null)).toEqual({
      valid: false,
      error: 'missing_interval',
    });
  });

  it('từ chối interval km không dương', () => {
    expect(validateReminderInterval(0, 180)).toEqual({
      valid: false,
      error: 'interval_km_not_positive',
    });
  });

  it('từ chối interval ngày âm', () => {
    expect(validateReminderInterval(5000, -1)).toEqual({
      valid: false,
      error: 'interval_days_not_positive',
    });
  });
});
