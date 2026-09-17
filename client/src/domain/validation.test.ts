import { describe, expect, it } from 'vitest'
import { validateOdometerReading, validateReminderInterval } from './validation'

describe('validateOdometerReading', () => {
  it('hợp lệ, không cảnh báo khi >= hiện tại', () => {
    expect(validateOdometerReading(1000, 900)).toEqual({ valid: true, warning: null })
  })

  it('hợp lệ khi chưa có odometer hiện tại (lần đầu nhập)', () => {
    expect(validateOdometerReading(500, null)).toEqual({ valid: true, warning: null })
  })

  it('cho phép nhưng cảnh báo khi thấp hơn hiện tại (D-02, không chặn cứng)', () => {
    expect(validateOdometerReading(800, 900)).toEqual({ valid: true, warning: 'lower_than_current' })
  })

  it('từ chối giá trị âm', () => {
    expect(validateOdometerReading(-1, 900)).toEqual({ valid: false, error: 'negative' })
  })
})

describe('validateReminderInterval', () => {
  it('hợp lệ khi chỉ có interval km', () => {
    expect(validateReminderInterval(5000, null)).toEqual({ valid: true })
  })

  it('hợp lệ khi chỉ có interval ngày', () => {
    expect(validateReminderInterval(null, 180)).toEqual({ valid: true })
  })

  it('hợp lệ khi có cả hai', () => {
    expect(validateReminderInterval(5000, 180)).toEqual({ valid: true })
  })

  it('từ chối khi thiếu cả hai (A3: ít nhất 1 trong 2)', () => {
    expect(validateReminderInterval(null, null)).toEqual({ valid: false, error: 'missing_interval' })
  })

  it('từ chối interval km không dương', () => {
    expect(validateReminderInterval(0, 180)).toEqual({ valid: false, error: 'interval_km_not_positive' })
  })

  it('từ chối interval ngày âm', () => {
    expect(validateReminderInterval(5000, -1)).toEqual({ valid: false, error: 'interval_days_not_positive' })
  })
})
