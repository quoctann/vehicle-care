import type { PartType } from '@/domain/types'
import { db } from '../db'

export async function listPartTypes(): Promise<PartType[]> {
  const partTypes = await db.partTypes.toArray()
  return partTypes.sort((a, b) => a.displayOrder - b.displayOrder)
}
