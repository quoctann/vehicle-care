import { describe, expect, it } from 'vitest'
import i18n from './index'

describe('i18n', () => {
  it('uses Vietnamese as the only supported locale', () => {
    expect(i18n.language).toBe('vi')
    expect(i18n.options.supportedLngs).toContain('vi')
  })

  it('interpolates dynamic Vietnamese messages', () => {
    expect(i18n.t('home.remainingKm', { value: '1.000' })).toBe('Còn 1.000 km')
    expect(i18n.t('settings.archivedToast', { name: 'Honda Wave' })).toBe('Đã lưu trữ Honda Wave.')
  })
})
