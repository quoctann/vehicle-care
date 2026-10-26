import { generateId } from '@/lib/uuid';
import { isValidPartTypeName } from '@/domain/validation';
import type { PartType } from '@/domain/types';
import { db } from '../db';
import { partTypeToPayload } from '../mappers';
import { enqueueMutation } from '../outbox';

/**
 * Tạo hạng mục tuỳ chỉnh với `code === id` (server kiểm tra khi create) để tránh
 * đụng độ `UNIQUE(account_id, code)`. Hạng mục seed vẫn giữ code của template.
 * `displayOrder` dùng
 * hằng số cố định — custom part type luôn hiển thị sau danh mục mặc định, thứ tự giữa
 * các custom type với nhau theo `createdAtClient` (không cần user sắp xếp thủ công).
 */
export async function createPartType(accountId: string, displayName: string): Promise<PartType> {
  const name = displayName.trim();
  if (!isValidPartTypeName(name))
    throw new Error('Part type name must contain 1 to 200 characters and at most 500 UTF-8 bytes.');

  const id = generateId();
  const now = new Date().toISOString();
  const partType: PartType = {
    id,
    code: id,
    displayName: name,
    displayOrder: 999,
    active: true,
    accountId,
    createdAtClient: now,
    serverSyncedAt: null,
    serverSeq: null,
  };
  await db.transaction('rw', [db.partTypes, db.outbox, db.syncMeta], async () => {
    await db.partTypes.add(partType);
    await enqueueMutation({
      accountId,
      entityType: 'part_type',
      operation: 'create',
      entityId: id,
      payload: partTypeToPayload(partType),
    });
  });
  return partType;
}

async function writePartTypePatch(
  accountId: string,
  id: string,
  patch: Partial<PartType>,
): Promise<void> {
  await db.transaction('rw', [db.partTypes, db.outbox, db.syncMeta], async () => {
    const current = await db.partTypes.get(id);
    if (!current || current.accountId !== accountId) throw new Error(`Part type not found: ${id}`);
    const updated: PartType = { ...current, ...patch };
    await db.partTypes.put(updated);
    await enqueueMutation({
      accountId,
      entityType: 'part_type',
      operation: 'update',
      entityId: id,
      payload: partTypeToPayload(updated),
    });
  });
}

/** Chỉ đổi tên — `writePartTypePatch` tự từ chối nếu dòng không thuộc `accountId` này. */
export function updatePartTypeName(
  accountId: string,
  id: string,
  displayName: string,
): Promise<void> {
  const name = displayName.trim();
  if (!isValidPartTypeName(name))
    throw new Error('Part type name must contain 1 to 200 characters and at most 500 UTF-8 bytes.');
  return writePartTypePatch(accountId, id, { displayName: name });
}

/** `active: false` ẩn khỏi picker, giữ nguyên log/reminder đã tham chiếu. */
export function setPartTypeActive(accountId: string, id: string, active: boolean): Promise<void> {
  return writePartTypePatch(accountId, id, { active });
}
