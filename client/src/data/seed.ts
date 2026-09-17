import type { PartType } from '@/domain/types'
import { db } from './db'

/**
 * C2/C3 (implementation-plan-section-5.md): UUID + `code` CỐ ĐỊNH, không sinh lại
 * mỗi lần chạy seed, không đổi khi phát hành. Đây là danh mục MVP đã chốt ở
 * decision.md mục 6.3 — thêm PartType mới sau này thì thêm dòng mới với
 * `seedVersion` tăng lên, KHÔNG sửa dòng đã có.
 */
export const SEED_VERSION = 1

export const PART_TYPE_SEED: PartType[] = [
  { id: '8051302c-17fa-4532-bfe9-9b1b2113022c', code: 'engine_oil', displayName: 'Dầu nhớt động cơ', displayOrder: 1, active: true, seedVersion: 1 },
  { id: '416223e9-15e6-4e3f-ab06-e8bdca77e90e', code: 'front_tire', displayName: 'Lốp trước', displayOrder: 2, active: true, seedVersion: 1 },
  { id: '0b82f84d-c0ee-48d0-b09d-53ad33d3dbbb', code: 'rear_tire', displayName: 'Lốp sau', displayOrder: 3, active: true, seedVersion: 1 },
  { id: 'cdc0225c-5c64-449e-843d-4de2f36962b8', code: 'front_brake_pad', displayName: 'Má phanh trước', displayOrder: 4, active: true, seedVersion: 1 },
  { id: 'f79abbae-7ef3-4e6f-80da-f709b884bad7', code: 'rear_brake_pad', displayName: 'Má phanh sau', displayOrder: 5, active: true, seedVersion: 1 },
  { id: '60f02489-40ee-4a0f-b36c-cfa3921ed1eb', code: 'spark_plug', displayName: 'Bugi', displayOrder: 6, active: true, seedVersion: 1 },
  { id: 'c2eccd4c-df30-4014-be63-cc2f13b4e2a1', code: 'air_filter', displayName: 'Lọc gió', displayOrder: 7, active: true, seedVersion: 1 },
  { id: 'dc8d1261-a81d-43b6-b93a-30ff955b80ed', code: 'drive_belt', displayName: 'Dây curoa', displayOrder: 8, active: true, seedVersion: 1 },
  { id: 'b9d42d1b-6afd-432d-b55a-62377a605ec9', code: 'chain_sprocket_set', displayName: 'Nhông, sên, đĩa', displayOrder: 9, active: true, seedVersion: 1 },
  { id: 'afb89f20-951c-4d34-9ad5-35b1f370022c', code: 'battery', displayName: 'Ắc quy', displayOrder: 10, active: true, seedVersion: 1 },
]

/** Idempotent: `bulkPut` theo `id` cố định, chạy lại bao nhiêu lần cũng không tạo trùng (C3). */
export async function seedPartTypes(): Promise<void> {
  await db.partTypes.bulkPut(PART_TYPE_SEED)
}
