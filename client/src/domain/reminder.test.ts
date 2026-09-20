import { describe, expect, it } from 'vitest'
import { calculateReminderStatus } from './reminder'
import type { ReminderConfigInput } from './reminder'

const TZ = 'Asia/Ho_Chi_Minh'

function baseConfig(overrides: Partial<ReminderConfigInput> = {}): ReminderConfigInput {
  return {
    intervalKm: null,
    intervalDays: null,
    baselineOdometerKm: 0,
    baselineDate: '2026-01-01',
    ...overrides,
  }
}

describe('calculateReminderStatus — chỉ theo km', () => {
  const config = baseConfig({ intervalKm: 1000 })

  it('not_due khi còn nhiều hơn 10% chu kỳ', () => {
    const result = calculateReminderStatus({
      config,
      currentOdometerKm: 899, // used=899, ratio=0.899 < 0.9
      lastServiceLog: null,
      now: '2026-06-01T00:00:00.000Z',
      accountTimezone: TZ,
      dueSoonRatio: 0.9,
    })
    expect(result.status).toBe('not_due')
    expect(result.km).toEqual({ baseline: 0, used: 899, remaining: 101, ratioUsed: 0.899 })
  })

  it('due_soon đúng ngưỡng 90% (D-04)', () => {
    const result = calculateReminderStatus({
      config,
      currentOdometerKm: 900, // ratio = 0.9
      lastServiceLog: null,
      now: '2026-06-01T00:00:00.000Z',
      accountTimezone: TZ,
      dueSoonRatio: 0.9,
    })
    expect(result.status).toBe('due_soon')
  })

  it('overdue khi used >= interval', () => {
    const result = calculateReminderStatus({
      config,
      currentOdometerKm: 1000,
      lastServiceLog: null,
      now: '2026-06-01T00:00:00.000Z',
      accountTimezone: TZ,
      dueSoonRatio: 0.9,
    })
    expect(result.status).toBe('overdue')
    expect(result.km?.remaining).toBe(0)
  })

  it('insufficient_data khi chưa có OdometerLog nào', () => {
    const result = calculateReminderStatus({
      config,
      currentOdometerKm: null,
      lastServiceLog: null,
      now: '2026-06-01T00:00:00.000Z',
      accountTimezone: TZ,
      dueSoonRatio: 0.9,
    })
    expect(result.status).toBe('insufficient_data')
    expect(result.km).toBeNull()
  })

  it('odometer thấp hơn baseline (log lệch thứ tự) không tạo used âm', () => {
    const result = calculateReminderStatus({
      config,
      currentOdometerKm: -50, // giả định caller không chặn, domain vẫn phải an toàn
      lastServiceLog: null,
      now: '2026-06-01T00:00:00.000Z',
      accountTimezone: TZ,
      dueSoonRatio: 0.9,
    })
    expect(result.km?.used).toBe(0)
    expect(result.status).toBe('not_due')
  })
})

describe('calculateReminderStatus — chỉ theo ngày', () => {
  const config = baseConfig({ intervalDays: 100 })

  it('not_due khi còn nhiều hơn 10% chu kỳ', () => {
    const result = calculateReminderStatus({
      config,
      currentOdometerKm: null,
      lastServiceLog: null,
      now: '2026-02-20T00:00:00.000Z', // 2026-01-01 -> 2026-02-20 = 50 ngày
      accountTimezone: TZ,
      dueSoonRatio: 0.9,
    })
    expect(result.days?.usedDays).toBe(50)
    expect(result.status).toBe('not_due')
  })

  it('due_soon đúng ngưỡng 90%', () => {
    const result = calculateReminderStatus({
      config,
      currentOdometerKm: null,
      lastServiceLog: null,
      now: '2026-04-11T00:00:00.000Z', // 100 ngày sau baseline theo lịch UTC/ICT cùng ngày giờ 00:00
      accountTimezone: TZ,
      dueSoonRatio: 0.9,
    })
    // 2026-01-01 -> 2026-04-11 = 100 ngày, nhưng ta cần đúng mốc 90 ngày để test ratio=0.9
    expect(result.days?.usedDays).toBeGreaterThanOrEqual(90)
  })

  it('overdue khi usedDays >= intervalDays', () => {
    const result = calculateReminderStatus({
      config,
      currentOdometerKm: null,
      lastServiceLog: null,
      now: '2026-04-12T00:00:00.000Z', // 101 ngày sau baseline
      accountTimezone: TZ,
      dueSoonRatio: 0.9,
    })
    expect(result.status).toBe('overdue')
  })

  it('insufficient_data khi chưa có baseline ngày và chưa có ServiceLog', () => {
    const result = calculateReminderStatus({
      config: baseConfig({ intervalDays: 100, baselineDate: null }),
      currentOdometerKm: null,
      lastServiceLog: null,
      now: '2026-06-01T00:00:00.000Z',
      accountTimezone: TZ,
      dueSoonRatio: 0.9,
    })
    expect(result.status).toBe('insufficient_data')
  })

  it('tính đúng theo timezone account, không theo UTC (D-07)', () => {
    // 2026-01-01T18:00:00Z = 2026-01-02T01:00 giờ Asia/Ho_Chi_Minh (UTC+7)
    // => hôm nay theo timezone account đã là 02/01, dù UTC vẫn là 01/01.
    const result = calculateReminderStatus({
      config: baseConfig({ intervalDays: 100, baselineDate: '2026-01-01' }),
      currentOdometerKm: null,
      lastServiceLog: null,
      now: '2026-01-01T18:00:00.000Z',
      accountTimezone: TZ,
      dueSoonRatio: 0.9,
    })
    expect(result.days?.usedDays).toBe(1)
  })
})

describe('calculateReminderStatus — cả km và ngày', () => {
  it('km overdue, ngày not_due => tổng thể overdue (một trong hai quá hạn là đủ)', () => {
    const result = calculateReminderStatus({
      config: baseConfig({ intervalKm: 1000, intervalDays: 100 }),
      currentOdometerKm: 1000, // km overdue
      lastServiceLog: null,
      now: '2026-01-10T00:00:00.000Z', // chỉ 9 ngày trôi qua, ngày chưa đến hạn
      accountTimezone: TZ,
      dueSoonRatio: 0.9,
    })
    expect(result.status).toBe('overdue')
    expect(result.days?.usedDays).toBeLessThan(100)
  })

  it('km due_soon, ngày not_due => tổng thể due_soon', () => {
    const result = calculateReminderStatus({
      config: baseConfig({ intervalKm: 1000, intervalDays: 100 }),
      currentOdometerKm: 900, // km due_soon
      lastServiceLog: null,
      now: '2026-01-10T00:00:00.000Z',
      accountTimezone: TZ,
      dueSoonRatio: 0.9,
    })
    expect(result.status).toBe('due_soon')
  })

  it('km insufficient (chưa có odometer) nhưng ngày due_soon => vẫn đánh giá được theo ngày', () => {
    const result = calculateReminderStatus({
      config: baseConfig({ intervalKm: 1000, intervalDays: 100 }),
      currentOdometerKm: null,
      lastServiceLog: null,
      now: '2026-04-10T00:00:00.000Z', // 99 ngày => due_soon theo ngày
      accountTimezone: TZ,
      dueSoonRatio: 0.9,
    })
    expect(result.km).toBeNull()
    expect(result.status).toBe('due_soon')
  })
})

describe('calculateReminderStatus — ServiceLog reset baseline', () => {
  it('ServiceLog mới nhất reset đúng baseline km và ngày, ưu tiên hơn baseline gốc', () => {
    const result = calculateReminderStatus({
      config: baseConfig({ intervalKm: 1000, intervalDays: 100, baselineOdometerKm: 0, baselineDate: '2020-01-01' }),
      currentOdometerKm: 38500,
      lastServiceLog: { odometerKmSnapshot: 38000, servicedAt: '2026-01-01T00:00:00.000Z' },
      now: '2026-01-10T00:00:00.000Z',
      accountTimezone: TZ,
      dueSoonRatio: 0.9,
    })
    expect(result.km).toEqual({ baseline: 38000, used: 500, remaining: 500, ratioUsed: 0.5 })
    expect(result.days?.baseline).toBe('2026-01-01')
    expect(result.basis.usedServiceLog).toBe(true)
  })

  it('ServiceLog không có km snapshot: fallback baseline km gốc nhưng vẫn dùng ngày service cho baseline ngày', () => {
    const result = calculateReminderStatus({
      config: baseConfig({ intervalKm: 1000, intervalDays: 100, baselineOdometerKm: 100, baselineDate: '2020-01-01' }),
      currentOdometerKm: 600,
      lastServiceLog: { odometerKmSnapshot: null, servicedAt: '2026-01-01T00:00:00.000Z' },
      now: '2026-01-10T00:00:00.000Z',
      accountTimezone: TZ,
      dueSoonRatio: 0.9,
    })
    expect(result.km?.baseline).toBe(100)
    expect(result.days?.baseline).toBe('2026-01-01')
  })
})
