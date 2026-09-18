import type { TFunction } from 'i18next'
import { ApiError } from '@/api/errors'

export function getUserError(error: unknown, t: TFunction, fallbackKey = 'common.unknownError'): string {
  if (error instanceof ApiError) {
    const key = `errors.${error.code}`
    return t(key, { defaultValue: t(fallbackKey) })
  }
  return t(fallbackKey)
}
