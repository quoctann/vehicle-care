import { afterEach, expect, it, vi } from 'vitest'
import { getOrCreateDeviceId } from './deviceId'

afterEach(() => vi.unstubAllGlobals())

it('returns a stable fallback identity when localStorage is unavailable', () => {
  vi.stubGlobal('localStorage', { getItem() { throw new Error('Storage denied') } })
  const id = getOrCreateDeviceId()
  expect(getOrCreateDeviceId()).toBe(id)
  expect(id).toMatch(/^[0-9a-f-]{36}$/)
})
