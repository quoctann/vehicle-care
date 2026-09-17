import { generateId } from '@/lib/uuid'
import type { MutationResult, PullChange, SyncEntityType } from '@/api/contract.types'

/**
 * State "server giả" — ĐỘC LẬP với Dexie của app (mock 1 server thật sự, không phải
 * cache của client). Sống trong bộ nhớ JS của tab (mất khi reload) — đủ để test
 * luồng auth/sync mà không cần backend thật. Xem `.docs/sync-api-contract.md`.
 */

export type MockUser = {
  id: string
  email: string
  /** MOCK-ONLY: lưu plaintext để so khớp login giả lập — KHÔNG BAO GIỜ làm vậy ở backend thật. */
  password: string
  name: string | null
  timezone: string
  emailVerified: boolean
  createdAt: string
}

export type MockSession = {
  accountId: string
  deviceId: string | null
  csrfToken: string
  createdAt: string
}

type EntitySnapshot = { serverSeq: number; payload: Record<string, unknown> }

const users = new Map<string, MockUser>() // key: userId
const sessions = new Map<string, MockSession>() // key: sessionId
const verificationTokens = new Map<string, string>() // token -> email
const resetTokens = new Map<string, string>() // token -> email
const devicesByAccount = new Map<string, Set<string>>() // accountId -> Set<deviceId>
const accountSequence = new Map<string, number>() // accountId -> last server_seq issued
const changefeed: (PullChange & { accountId: string })[] = []
const processedMutations = new Map<string, MutationResult>() // key: `${accountId}:${mutationId}`
const latestEntity = new Map<string, EntitySnapshot>() // key: `${accountId}:${entityType}:${entityId}`

export function findUserByEmail(email: string): MockUser | undefined {
  return [...users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase())
}

export function findUserById(id: string): MockUser | undefined {
  return users.get(id)
}

export function createUser(input: { email: string; password: string; name: string | null; emailVerified?: boolean }): MockUser {
  const user: MockUser = {
    id: generateId(),
    email: input.email,
    password: input.password,
    name: input.name,
    timezone: 'Asia/Ho_Chi_Minh',
    emailVerified: input.emailVerified ?? false,
    createdAt: new Date().toISOString(),
  }
  users.set(user.id, user)
  return user
}

export function createVerificationToken(email: string): string {
  const token = generateId()
  verificationTokens.set(token, email)
  return token
}

export function consumeVerificationToken(token: string): string | undefined {
  const email = verificationTokens.get(token)
  if (email) verificationTokens.delete(token)
  return email
}

export function createResetToken(email: string): string {
  const token = generateId()
  resetTokens.set(token, email)
  return token
}

export function consumeResetToken(token: string): string | undefined {
  const email = resetTokens.get(token)
  if (email) resetTokens.delete(token)
  return email
}

export function createSession(accountId: string): { sessionId: string; csrfToken: string } {
  const sessionId = generateId()
  const csrfToken = generateId()
  sessions.set(sessionId, { accountId, deviceId: null, csrfToken, createdAt: new Date().toISOString() })
  return { sessionId, csrfToken }
}

export function getSession(sessionId: string | undefined): MockSession | undefined {
  if (!sessionId) return undefined
  return sessions.get(sessionId)
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId)
}

export function registerDevice(accountId: string, deviceId: string): void {
  if (!devicesByAccount.has(accountId)) devicesByAccount.set(accountId, new Set())
  devicesByAccount.get(accountId)!.add(deviceId)
}

export function isDeviceRegistered(accountId: string, deviceId: string): boolean {
  return devicesByAccount.get(accountId)?.has(deviceId) ?? false
}

export function revokeAllSessionsForAccount(accountId: string): void {
  for (const [id, session] of sessions.entries()) {
    if (session.accountId === accountId) sessions.delete(id)
  }
}

function nextServerSeq(accountId: string): number {
  const current = accountSequence.get(accountId) ?? 0
  const next = current + 1
  accountSequence.set(accountId, next)
  return next
}

/**
 * Áp dụng 1 mutation: dedupe theo `mutation_id`, cấp `server_seq`, ghi changefeed.
 * Log (append-only) luôn `applied` nếu chưa từng thấy id. Mutable luôn `applied`
 * hoặc `conflict_resolved` tuỳ `base_server_seq` client gửi có khớp bản mới nhất
 * server đang giữ hay không — CẢ HAI trường hợp mutation vẫn được ghi làm bản mới
 * nhất (LWW theo thời điểm server nhận), `conflict_resolved` chỉ là tín hiệu.
 */
export function applyMutation(
  accountId: string,
  mutation: {
    mutation_id: string
    entity_type: SyncEntityType
    operation: 'create' | 'update'
    entity_id: string
    payload: Record<string, unknown>
    base_server_seq?: number | null
  },
): MutationResult {
  const dedupeKey = `${accountId}:${mutation.mutation_id}`
  const existing = processedMutations.get(dedupeKey)
  if (existing) return { ...existing, status: 'duplicate' }

  const entityKey = `${accountId}:${mutation.entity_type}:${mutation.entity_id}`
  const isMutableType = mutation.entity_type === 'vehicle' || mutation.entity_type === 'reminder_config'
  const currentSnapshot = latestEntity.get(entityKey)

  const serverSeq = nextServerSeq(accountId)
  const receivedAtServer = new Date().toISOString()

  latestEntity.set(entityKey, { serverSeq, payload: mutation.payload })
  changefeed.push({
    accountId,
    server_seq: serverSeq,
    entity_type: mutation.entity_type,
    entity_id: mutation.entity_id,
    operation: mutation.operation,
    payload: mutation.payload,
    received_at_server: receivedAtServer,
  })

  const hadNewerServerState =
    isMutableType &&
    currentSnapshot != null &&
    mutation.base_server_seq != null &&
    currentSnapshot.serverSeq > mutation.base_server_seq

  const result: MutationResult = hadNewerServerState
    ? {
        mutation_id: mutation.mutation_id,
        status: 'conflict_resolved',
        server_seq: serverSeq,
        received_at_server: receivedAtServer,
        server_snapshot: mutation.payload,
      }
    : {
        mutation_id: mutation.mutation_id,
        status: 'applied',
        server_seq: serverSeq,
        received_at_server: receivedAtServer,
      }

  processedMutations.set(dedupeKey, result)
  return result
}

export function pullChangesForAccount(
  accountId: string,
  afterSeq: number,
  limit: number,
): { changes: PullChange[]; hasMore: boolean } {
  const scoped = changefeed.filter((c) => c.accountId === accountId && c.server_seq > afterSeq)
  scoped.sort((a, b) => a.server_seq - b.server_seq)
  const page = scoped.slice(0, limit)
  return {
    changes: page.map(({ accountId: _accountId, ...change }) => change),
    hasMore: scoped.length > limit,
  }
}

/** Reset toàn bộ state mock — dùng trong test (vitest + MSW server). */
export function resetMockDb(): void {
  users.clear()
  sessions.clear()
  verificationTokens.clear()
  resetTokens.clear()
  devicesByAccount.clear()
  accountSequence.clear()
  changefeed.length = 0
  processedMutations.clear()
  latestEntity.clear()
}
