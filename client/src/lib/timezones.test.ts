import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectDeviceTimezone, TIMEZONE_CHOICES } from './timezones';

describe('fixed timezone choices', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses canonical values and informative fixed-offset labels', () => {
    expect(TIMEZONE_CHOICES.find((choice) => choice.value === 'UTC+07:00')).toMatchObject({
      label: 'UTC+07:00 — Bangkok, Hanoi, Jakarta',
      offsetMinutes: 420,
    });
    expect(TIMEZONE_CHOICES.every(({ value }) => /^UTC[+-]\d{2}:\d{2}$/.test(value))).toBe(true);
    expect(new Set(TIMEZONE_CHOICES.map(({ value }) => value)).size).toBe(TIMEZONE_CHOICES.length);
  });

  it('maps the device current offset to a listed value, including fractional offsets', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-345);
    expect(detectDeviceTimezone()).toBe('UTC+05:45');
  });

  it('does not round unsupported device offsets', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-317);
    expect(detectDeviceTimezone()).toBeNull();
  });
});
