import { generateId } from '@/lib/uuid'
import type { PartType } from '@/domain/types'
import { db } from '../db'
import { partTypeToPayload } from '../mappers'
import { enqueueMutation } from '../outbox'

/**
 * Tạo hạng mục bảo dưỡng tuỳ chỉnh (feedback Feature #2). `code` LUÔN bằng chính `id`
 * (server validate + từ chối nếu khác — xem `.docs/sync-api-contract.md` mục 2.14) để
 * tránh đụng độ `UNIQUE(code)` toàn cục mà không cần đổi schema. `displayOrder` dùng
 * hằng số cố định — custom part type luôn hiển thị sau danh mục mặc định, thứ tự giữa
 * các custom type với nhau theo `createdAtClient` (không cần user sắp xếp thủ công).
 */
export async function createPartType(accountId: string, displayName: string): Promise<PartType> {
  const name = displayName.trim()
  if (!name || name.length > 200) throw new Error('Part type name must contain 1 to 200 characters.')

  const id = generateId()
  const now = new Date().toISOString()
  const partType: PartType = {
    id,
    code: id,
    displayName: name,
    displayOrder: 999,
    active: true,
    seedVersion: 0,
    accountId,
    createdAtClient: now,
    receivedAtServer: null,
    serverSeq: null,
  }
  await db.transaction('rw', [db.partTypes, db.outbox, db.syncMeta], async () => {
    await db.partTypes.add(partType)
    await enqueueMutation({
      accountId,
      entityType: 'part_type',
      operation: 'create',
      entityId: id,
      payload: partTypeToPayload(partType),
    })
  })
  return partType
}

async function writePartTypePatch(accountId: string, id: string, patch: Partial<PartType>): Promise<void> {
  await db.transaction('rw', [db.partTypes, db.outbox, db.syncMeta], async () => {
    const current = await db.partTypes.get(id)
    if (!current || current.accountId !== accountId) throw new Error(`Part type not found: ${id}`)
    const updated: PartType = { ...current, ...patch }
    await db.partTypes.put(updated)
    await enqueueMutation({
      accountId,
      entityType: 'part_type',
      operation: 'update',
      entityId: id,
      payload: partTypeToPayload(updated),
    })
  })
}

/** Chỉ đổi tên — `writePartTypePatch` tự từ chối nếu dòng không thuộc `accountId` này. */
export function updatePartTypeName(accountId: string, id: string, displayName: string): Promise<void> {
  const name = displayName.trim()
  if (!name || name.length > 200) throw new Error('Part type name must contain 1 to 200 characters.')
  return writePartTypePatch(accountId, id, { displayName: name })
}

/** Soft-delete = `active: false` (khuyến nghị đã chốt ở Stage 1) — ẩn khỏi picker, giữ nguyên log/reminder đã tham chiếu. */
export function setPartTypeActive(accountId: string, id: string, active: boolean): Promise<void> {
  return writePartTypePatch(accountId, id, { active })
}
