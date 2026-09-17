import { http, HttpResponse } from 'msw'
import type { PushRequest, PushResponse } from '@/api/contract.types'
import { DEFAULT_SYNC_PAGE_SIZE } from '@/domain/constants'
import { applyMutation, isDeviceRegistered } from '../db'
import { errorResponse } from '../errorResponse'
import { requireSession, verifyCsrf } from './auth'

export const pushHandlers = [
  http.post('/sync/push', async ({ request }) => {
    const auth = requireSession(request)
    if (!auth) return errorResponse(401, 'session_expired', 'Session expired or missing.')
    if (!verifyCsrf(request, auth.session)) return errorResponse(403, 'validation_failed', 'Invalid CSRF token.')

    const body = (await request.json()) as PushRequest
    if (!isDeviceRegistered(auth.session.accountId, body.device_id)) {
      return errorResponse(403, 'ownership_invalid', 'Device is not registered to this account.')
    }
    // D-08: batch quá giới hạn — từ chối toàn bộ request để client tự chia nhỏ lại.
    if (body.mutations.length > DEFAULT_SYNC_PAGE_SIZE) {
      return errorResponse(400, 'validation_failed', `Batch exceeds max ${DEFAULT_SYNC_PAGE_SIZE} mutations.`)
    }

    const results = body.mutations.map((mutation) => applyMutation(auth.session.accountId, mutation))
    const response: PushResponse = { results }
    return HttpResponse.json(response)
  }),
]
