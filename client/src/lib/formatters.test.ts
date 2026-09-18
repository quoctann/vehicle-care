import { describe, expect, it } from 'vitest'
import { formatDate, formatMonth, formatNumber, formatTime } from './formatters'

describe('Vietnamese UI formatters', () => {
  it('formats numbers with Vietnamese separators', () => {
    expect(formatNumber(1234567)).toBe('1.234.567')
  })

  it('formats dates and months in Vietnamese', () => {
    expect(formatDate('2026-09-18T12:30:00Z', 'UTC')).toContain('18')
    expect(formatMonth('2026-09')).toMatch(/tháng 9.*2026/i)
    expect(formatMonth('2026-09', 'long', 'America/Los_Angeles')).toMatch(/tháng 9.*2026/i)
  })

  it('formats time with a stable Vietnamese locale', () => {
    expect(formatTime('2026-09-18T12:30:00Z', 'UTC')).toBe('12:30')
  })
})
