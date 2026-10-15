import { describe, expect, it } from 'vitest';
import { formatVnd } from './currency';

describe('formatVnd', () => {
  it('shows fractional costs without rounding them to whole VND', () => {
    expect(formatVnd(12.5)).toBe('12,5₫');
    expect(formatVnd(1234.56)).toBe('1.234,56₫');
    expect(formatVnd(1234)).toBe('1.234₫');
  });
});
