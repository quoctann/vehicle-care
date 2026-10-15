import { afterEach, expect, it, vi } from 'vitest';
import { formatDate, formatTime, formatMonth, formatNumber } from './formatters';
import { formatShortDate, daysAgo, formatUpdatedLabel } from './datetime';
import { toCalendarDateInTimezone } from '@/domain/datetime';

afterEach(() => vi.useRealTimers());

it('formats canonical offsets using the account calendar, including fractional offsets', () => {
  const instant = '2026-03-01T00:30:00Z';
  expect(toCalendarDateInTimezone(instant, 'UTC-03:30')).toBe('2026-02-28');
  expect(formatDate(instant, 'UTC+05:45')).toBe(formatDate(instant, '+05:45'));
  expect(formatTime(instant, 'UTC-03:30')).toBe(formatTime(instant, '-03:30'));
  expect(formatMonth(instant, 'long', 'UTC-03:30')).toBe(formatMonth(instant, 'long', '-03:30'));
  expect(formatMonth('2026-03', 'long', 'UTC-03:30')).toBe(formatMonth('2026-03', 'long', 'UTC'));
  expect(formatShortDate(instant, 'UTC-03:30')).toBe(formatShortDate(instant, '-03:30'));
  expect(daysAgo(instant, 'UTC+07:00', '2026-03-01T18:00:00Z')).toBe(1);
});

it('supports default display zones and canonical relative-date labels', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-03T12:00:00Z'));
  const instant = '2026-03-03T00:30:00Z';
  expect(formatTime(instant)).toBeTruthy();
  expect(formatDate(instant)).toBeTruthy();
  expect(formatMonth(instant, 'short')).toBeTruthy();
  expect(formatNumber(1000)).toBe('1.000');
  expect(daysAgo(instant, 'UTC+07:00')).toBe(0);
  expect(formatUpdatedLabel(null, 'UTC+07:00')).toBe('Chưa có dữ liệu');
  expect(formatUpdatedLabel(instant, 'UTC+07:00')).toBe('Cập nhật vừa xong');
  expect(formatUpdatedLabel('2026-03-02T00:00:00Z', 'UTC+07:00')).toBe('Cập nhật hôm qua');
  expect(formatUpdatedLabel('2026-03-01T00:00:00Z', 'UTC+07:00')).toBe('Cập nhật 2 ngày trước');
});
