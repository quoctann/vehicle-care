import { listPartTypes } from '@/api/client'
import { partTypeFromDto, partTypeToPayload } from './mappers'
import { db } from './db'
import { enqueueMutation, markOutboxApplied } from './outbox'

/**
 * Đồng bộ lại `partTypes` local từ server (nguồn sự thật duy nhất, `GET /part-types`).
 * Server tự tạo 10 dòng mặc định cho account ngay lúc signup (xem
 * `postgres/seed.SeedAccountPartTypes`), nên không còn baseline cứng phía client — hàm
 * này là cách DUY NHẤT để Dexie có dữ liệu `partTypes`. Gọi (và `await`) ngay sau khi
 * xác thực thành công (signup/sign-in — xem `SignUpPage.tsx`/`SignInPage.tsx`) để picker
 * part type không trống trước lần reload tiếp theo; cũng gọi best-effort lúc app khởi
 * động (`App.tsx`) cho phiên đã đăng nhập sẵn.
 *
 * Merge (KHÔNG `bulkPut` đè thẳng): GET /part-types cập nhật metadata server, nhưng
 * giữ `displayName`/`active` nếu entity còn mutation local chưa xử lý. Mutation rejected
 * do client cũ gửi nhầm seed row dưới dạng create được thay bằng một mutation update mới.
 * (Trước đây DTO không có 2 field này, client tự set `null`, khiến `push.ts` coi MỌI hạng
 * mục bootstrap qua đây là "chưa từng thấy từ server" và luôn gửi lại dưới dạng
 * `operation: "create"` — sai, vì `create` bắt buộc `code === id`, không bao giờ đúng với
 * hạng mục seed. Hệ quả: mọi lần sửa/tắt hạng mục seed bị server từ chối vĩnh viễn — bug
 * thật đã xảy ra, không phải rủi ro lý thuyết.)
 */
export async function refreshPartTypesFromServer(): Promise<void> {
  const { part_types } = await listPartTypes()
  await db.transaction('rw', [db.partTypes, db.outbox], async () => {
    const unresolved = (await db.outbox.toArray()).filter(
      (item) => item.entityType === 'part_type' && (item.status === 'pending' || item.status === 'retryable_error' || item.status === 'rejected'),
    )
    const unresolvedByEntity = new Map<string, typeof unresolved>()
    for (const item of unresolved) {
      const items = unresolvedByEntity.get(item.entityId) ?? []
      items.push(item)
      unresolvedByEntity.set(item.entityId, items)
    }

    for (const dto of part_types) {
      const existing = await db.partTypes.get(dto.id)
      const fresh = partTypeFromDto(dto)
      const items = unresolvedByEntity.get(dto.id) ?? []
      if (!existing || items.length === 0) {
        await db.partTypes.put(existing ? { ...fresh, createdAtClient: existing.createdAtClient } : fresh)
        continue
      }

      const merged = {
        ...fresh,
        displayName: existing.displayName,
        active: existing.active,
        createdAtClient: existing.createdAtClient,
      }
      await db.partTypes.put(merged)

      const rejected = items.filter((item) => item.status === 'rejected')
      if (rejected.length === 0) continue
      await Promise.all(rejected.map((item) => markOutboxApplied(item.mutationId)))
      const hasPending = items.some((item) => item.status === 'pending' || item.status === 'retryable_error')
      if (!hasPending) {
        await enqueueMutation({
          entityType: 'part_type',
          operation: 'update',
          entityId: merged.id,
          payload: partTypeToPayload(merged),
        })
      }
    }
  })
}
