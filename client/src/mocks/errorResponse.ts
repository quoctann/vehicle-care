import { HttpResponse } from 'msw'
import type { ApiErrorCode } from '@/api/contract.types'

export function errorResponse(status: number, code: ApiErrorCode, message: string, retryable = false) {
  return HttpResponse.json(
    { error: { code, message, retryable, request_id: crypto.randomUUID() } },
    { status },
  )
}
