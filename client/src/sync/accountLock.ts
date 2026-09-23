const inProcessLocks = new Map<string, Promise<void>>()

/** Serializes all remote sync/restore work for one account across tabs. */
export async function withAccountSyncLock<T>(accountId: string, work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    return navigator.locks.request(`vehicle-sync:${accountId}`, { mode: 'exclusive' }, work)
  }

  // Tests and non-browser runtimes do not expose Web Locks. This fallback only
  // serializes the current JS runtime; supported browsers use the cross-tab lock.
  const previous = inProcessLocks.get(accountId) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  const queued = previous.catch(() => undefined).then(() => current)
  inProcessLocks.set(accountId, queued)
  await previous.catch(() => undefined)
  try {
    return await work()
  } finally {
    release()
    if (inProcessLocks.get(accountId) === queued) inProcessLocks.delete(accountId)
  }
}
