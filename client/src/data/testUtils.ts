import { db } from './db'

/** Dùng trong `afterEach` của test — Dexie/fake-indexeddb giữ state giữa các test trong cùng file nếu không clear. */
export async function clearAllTables(): Promise<void> {
  await Promise.all(db.tables.map((t) => t.clear()))
}
