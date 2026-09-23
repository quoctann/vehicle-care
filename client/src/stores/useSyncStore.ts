import { create } from 'zustand'

/**
 * Chỉ giữ TRẠNG THÁI hiển thị của sync ("Đang đồng bộ"/"Đã đồng bộ lúc..."/"Chưa
 * đồng bộ" — D-09 decision.md) — KHÔNG giữ `pendingCount` (đọc trực tiếp từ
 * `db.outbox` qua `useLiveQuery`, xem `hooks/useOutboxPendingCount.ts`, để Dexie
 * luôn là nguồn sự thật duy nhất). Việc TRIGGER sync thật (`runSync()`) sống ở
 * `sync/syncOrchestrator.ts` — store này chỉ là nơi orchestrator ghi kết quả vào
 * để UI subscribe, UI không tự gọi setter này.
 */
export type SyncStatus = 'idle' | 'syncing' | 'pending' | 'synced' | 'retryable' | 'blocked' | 'restoring' | 'error'

type SyncStore = {
  status: SyncStatus
  lastSyncedAt: string | null
  lastError: string | null
  setSyncing: () => void
  setSynced: (at: string) => void
  setPending: () => void
  setRetryable: (message: string) => void
  setBlocked: (message: string) => void
  setRestoring: () => void
  setError: (message: string) => void
}

export const useSyncStore = create<SyncStore>((set) => ({
  status: 'idle',
  lastSyncedAt: null,
  lastError: null,
  setSyncing: () => set({ status: 'syncing', lastError: null }),
  setSynced: (at) => set({ status: 'synced', lastSyncedAt: at, lastError: null }),
  setPending: () => set({ status: 'pending', lastError: null }),
  setRetryable: (message) => set({ status: 'retryable', lastError: message }),
  setBlocked: (message) => set({ status: 'blocked', lastError: message }),
  setRestoring: () => set({ status: 'restoring', lastError: null }),
  setError: (message) => set({ status: 'error', lastError: message }),
}))
