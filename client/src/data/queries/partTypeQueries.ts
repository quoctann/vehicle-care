import type { PartType } from '@/domain/types'
import { db } from '../db'

export async function listPartTypes(accountId: string): Promise<PartType[]> {
  const partTypes = await db.partTypes.where('accountId').equals(accountId).toArray()
  return partTypes.sort((a, b) => a.displayOrder - b.displayOrder)
}
