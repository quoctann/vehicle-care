/**
 * 1 điểm import duy nhất cho việc sinh UUID phía client (3.1 decision.md: ID luôn
 * sinh ở client, ngay khi tạo record) — dễ mock trong test, dễ đổi implementation
 * nếu môi trường không có `crypto.randomUUID` (Safari cũ, v.v.) sau này.
 */
export function generateId(): string {
  return crypto.randomUUID()
}
