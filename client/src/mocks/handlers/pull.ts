import { http, HttpResponse } from 'msw'
import type { PullResponse } from '@/api/contract.types'
import { DEFAULT_SYNC_PAGE_SIZE } from '@/domain/constants'
import { pullChangesForAccount } from '../db'
import { errorResponse } from '../errorResponse'
import { requireSession } from './auth'

export const pullHandlers = [
  http.get('/sync/pull', ({ request }) => {
    const auth = requireSession(request)
    if (!auth) return errorResponse(401, 'session_expired', 'Session expired or missing.')

    const url = new URL(request.url)
    const afterSeq = Number(url.searchParams.get('after_seq') ?? '0')
    const limit = Math.min(Number(url.searchParams.get('limit') ?? String(DEFAULT_SYNC_PAGE_SIZE)), DEFAULT_SYNC_PAGE_SIZE)
    // Mock đơn giản hoá: watermark chỉ là 1 token cố định cho phiên, KHÔNG snapshot
    // thật sự trạng thái changefeed tại thời điểm bắt đầu phiên như backend thật nên làm
    // (xem `.docs/sync-api-contract.md` mục 2.13) — đủ để test flow phân trang cơ bản.
    const watermark = url.searchParams.get('watermark') || crypto.randomUUID()

    const { changes, hasMore } = pullChangesForAccount(auth.session.accountId, afterSeq, limit)
    const nextCursor = changes.length > 0 ? changes[changes.length - 1].server_seq : afterSeq

    const response: PullResponse = {
      changes,
      next_cursor: nextCursor,
      watermark,
      has_more: hasMore,
      server_time: new Date().toISOString(),
    }
    return HttpResponse.json(response)
  }),
]
