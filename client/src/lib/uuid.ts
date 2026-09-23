/**
 * 1 điểm import duy nhất cho việc sinh UUID phía client (3.1 decision.md: ID luôn
 * sinh ở client, ngay khi tạo record) — dễ mock trong test, dễ đổi implementation
 * nếu môi trường không có `crypto.randomUUID` (Safari cũ, v.v.) sau này.
 */
export function generateId(): string {
  return crypto.randomUUID()
}

/** Stable RFC 4122 v5-style UUID for entities identified by a natural key. */
export async function generateDeterministicId(key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`vehicle-care:${key}`)))
  const bytes = digest.slice(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
