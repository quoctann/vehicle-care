import { listPartTypes } from '@/api/client'
import type { PartType } from '@/domain/types'
import { partTypeFromDto } from './mappers'
import { db } from './db'

/**
 * C2/C3 (implementation-plan-section-5.md): UUID + `code` CỐ ĐỊNH, không sinh lại
 * mỗi lần chạy seed, không đổi khi phát hành. Đây là danh mục MVP đã chốt ở
 * decision.md mục 6.3 — thêm PartType mới sau này thì thêm dòng mới với
 * `seedVersion` tăng lên, KHÔNG sửa dòng đã có.
 *
 * UUID PHẢI khớp CHÍNH XÁC với `server/internal/adapters/postgres/seed/manifest.go`
 * — đây chỉ là baseline bootstrap cho lần mở app đầu tiên khi CHƯA có mạng (trước khi
 * `refreshPartTypesFromServer()` chạy xong lần đầu); server manifest mới là nguồn sự
 * thật duy nhất (xem `.docs/20260919-feedback.md` mục 1 — trước đây 2 file này có
 * `code` giống nhau nhưng UUID lệch nhau, gây lỗi FK `reminder_configs_part_type_id_fkey`
 * khi push mutation).
 */
export const SEED_VERSION = 1

export const PART_TYPE_SEED: PartType[] = [
  { id: '649e41d9-00f8-4929-b343-407e4896060d', code: 'engine_oil', displayName: 'Dầu nhớt động cơ', displayOrder: 1, active: true, seedVersion: 1 },
  { id: '33c46c84-d96c-4877-9328-a7975c971709', code: 'front_tire', displayName: 'Lốp trước', displayOrder: 2, active: true, seedVersion: 1 },
  { id: '81c815e3-549f-4b20-91aa-d7545ad48b3d', code: 'rear_tire', displayName: 'Lốp sau', displayOrder: 3, active: true, seedVersion: 1 },
  { id: 'c8d6ed6d-ad5b-4134-8e9b-4966d5ece47e', code: 'front_brake_pad', displayName: 'Má phanh trước', displayOrder: 4, active: true, seedVersion: 1 },
  { id: 'e9d790b1-b366-45f1-9ba2-ff8420d35f6a', code: 'rear_brake_pad', displayName: 'Má phanh sau', displayOrder: 5, active: true, seedVersion: 1 },
  { id: 'ba3b91a3-1fe5-48b9-b8fd-3ac489c1b59d', code: 'spark_plug', displayName: 'Bugi', displayOrder: 6, active: true, seedVersion: 1 },
  { id: 'ff10d1fe-0757-4039-8ae2-ea8dae450a11', code: 'air_filter', displayName: 'Lọc gió', displayOrder: 7, active: true, seedVersion: 1 },
  { id: '8e144e49-1dce-46ae-9bab-88435c25eb8d', code: 'drive_belt', displayName: 'Dây curoa', displayOrder: 8, active: true, seedVersion: 1 },
  { id: 'e7e3ca4e-12aa-4e8c-94c2-cfc198e78035', code: 'chain_sprocket_set', displayName: 'Nhông, sên, đĩa', displayOrder: 9, active: true, seedVersion: 1 },
  { id: '16efa96d-4cc8-4b95-bf05-05255e9c49a4', code: 'battery', displayName: 'Ắc quy', displayOrder: 10, active: true, seedVersion: 1 },
]

/** Idempotent: `bulkPut` theo `id` cố định, chạy lại bao nhiêu lần cũng không tạo trùng (C3). */
export async function seedPartTypes(): Promise<void> {
  await db.partTypes.bulkPut(PART_TYPE_SEED)
}

/**
 * Đồng bộ lại `partTypes` local từ server (nguồn sự thật duy nhất, `GET /part-types`).
 * Best-effort: lỗi (chưa đăng nhập/offline) bị nuốt vì `seedPartTypes()` đã đảm bảo có
 * baseline đúng UUID sẵn — xem ghi chú ở `PART_TYPE_SEED`.
 */
export async function refreshPartTypesFromServer(): Promise<void> {
  try {
    const { part_types } = await listPartTypes()
    await db.partTypes.bulkPut(part_types.map(partTypeFromDto))
  } catch {
    // Offline hoặc chưa có session — giữ nguyên baseline cục bộ, thử lại ở lần khởi động sau.
  }
}
