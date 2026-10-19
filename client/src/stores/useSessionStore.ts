import { create } from 'zustand';
import * as api from '@/api/client';
import type { AccountDto } from '@/api/contract.types';
import { db } from '@/data/db';
import { ApiError } from '@/api/errors';
import { getOrCreateDeviceId } from '@/lib/deviceId';

/**
 * `useSessionStore` chỉ giữ TRẠNG THÁI ĐĂNG NHẬP hiện tại — KHÔNG chứa token:
 * session thật là cookie `httpOnly` do trình
 * duyệt tự quản lý, JS không đọc/lưu được và không cần. Biết "đã đăng nhập chưa"
 * bằng cách gọi `GET /auth/session` (cookie tự đính kèm), không bằng cách soi local storage.
 */
export type SessionAccount = {
  id: string;
  email: string;
  name: string | null;
  timezone: string;
  emailVerified: boolean;
};

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

export function mapAccountDto(dto: AccountDto): SessionAccount {
  return {
    id: dto.id,
    email: dto.email,
    name: dto.name,
    timezone: dto.timezone,
    emailVerified: dto.email_verified,
  };
}

type SessionStore = {
  status: SessionStatus;
  account: SessionAccount | null;
  /** Changes on login/logout, including a new login for the same account. */
  sessionGeneration: number;
  timezoneSaving: boolean;
  /** Server save succeeded, but the offline profile could not be refreshed. */
  timezoneCacheWarning: string | null;
  updateTimezone: (timezone: string) => Promise<void>;
  /** Gọi 1 lần lúc app khởi động (và sau signup/login) để đồng bộ với cookie session hiện có. */
  hydrate: () => Promise<void>;
  setAuthenticated: (account: SessionAccount) => void;
  clear: () => void;
};

async function cacheSavedAccount(account: SessionAccount, assertCurrent: () => void) {
  await db.transaction('rw', [db.accountCache, db.syncMeta], async () => {
    const cached = await db.accountCache.get('current');
    const meta = await db.syncMeta.get(account.id);
    assertCurrent();
    await db.accountCache.put({
      id: 'current',
      accountId: account.id,
      email: account.email,
      name: account.name,
      timezone: account.timezone,
      emailVerified: account.emailVerified,
      deviceId:
        (cached?.accountId === account.id ? cached.deviceId : undefined) ||
        meta?.deviceId ||
        getOrCreateDeviceId(),
      cachedAt: new Date().toISOString(),
    });
    // Throwing aborts this transaction if the session changed during the write.
    assertCurrent();
  });
}

export const useSessionStore = create<SessionStore>((set, get) => {
  let hydrationRevision = 0;
  // Remains locked until the request settles, even if logout resets UI state.
  let saveInFlight = false;
  let saveGeneration: number | null = null;
  return {
    status: 'loading',
    account: null,
    sessionGeneration: 0,
    timezoneSaving: false,
    timezoneCacheWarning: null,
    updateTimezone: async (timezone) => {
      if (saveInFlight) throw new Error('A timezone save is already in progress.');
      const session = get();
      if (session.status !== 'authenticated' || !session.account)
        throw new Error('Sign in to change your timezone.');
      if (typeof navigator !== 'undefined' && navigator.onLine === false)
        throw new Error('Timezone cannot be changed while offline.');
      if (!timezone.trim()) throw new Error('Choose a valid timezone.');
      const generation = session.sessionGeneration;
      const accountId = session.account.id;
      const assertCurrent = () => {
        if (
          get().sessionGeneration !== generation ||
          get().account?.id !== accountId ||
          get().status !== 'authenticated'
        ) {
          throw new Error('The session changed during the timezone save.');
        }
      };
      saveInFlight = true;
      saveGeneration = generation;
      hydrationRevision += 1;
      set({ timezoneSaving: true, timezoneCacheWarning: null });
      try {
        const { account: dto } = await api.updateAccountTimezone({
          timezone,
          expected_account_id: accountId,
        });
        assertCurrent();
        if (dto.id !== accountId)
          throw new Error('The timezone response does not match the active account.');
        const account = mapAccountDto(dto);
        hydrationRevision += 1;
        set({ account });
        try {
          await cacheSavedAccount(account, assertCurrent);
        } catch {
          assertCurrent();
          set({
            timezoneCacheWarning: 'Timezone saved, but the offline profile could not be updated.',
          });
        }
        assertCurrent();
      } finally {
        saveInFlight = false;
        saveGeneration = null;
        if (get().sessionGeneration === generation) set({ timezoneSaving: false });
      }
    },
    hydrate: async () => {
      if (saveInFlight && get().sessionGeneration === saveGeneration) return;
      const revision = ++hydrationRevision;
      const generation = get().sessionGeneration;
      const isCurrent = () =>
        revision === hydrationRevision && generation === get().sessionGeneration;
      const applyAccount = (account: SessionAccount) => {
        set({
          status: 'authenticated',
          account,
          sessionGeneration: get().sessionGeneration + (get().account?.id === account.id ? 0 : 1),
        });
      };
      try {
        const { account } = await api.getSession();
        if (isCurrent()) applyAccount(mapAccountDto(account));
      } catch (error) {
        if (!isCurrent()) return;
        if (
          error instanceof ApiError &&
          (error.status === 401 ||
            error.code === 'session_expired' ||
            error.code === 'auth_invalid')
        ) {
          get().clear();
          return;
        }
        // An in-memory profile is newer than the offline snapshot, especially
        // after a server save whose cache refresh failed.
        if (get().status === 'authenticated' && get().account) return;
        const cached = await db.accountCache.get('current').catch(() => undefined);
        if (!isCurrent()) return;
        if (cached) {
          applyAccount({
            id: cached.accountId,
            email: cached.email,
            name: cached.name,
            timezone: cached.timezone,
            emailVerified: cached.emailVerified,
          });
          return;
        }
        get().clear();
      }
    },
    setAuthenticated: (account) =>
      set((state) => ({
        status: 'authenticated',
        account,
        sessionGeneration: state.sessionGeneration + 1,
        timezoneSaving: false,
        timezoneCacheWarning: null,
      })),
    clear: () =>
      set((state) => ({
        status: 'anonymous',
        account: null,
        sessionGeneration: state.sessionGeneration + 1,
        timezoneSaving: false,
        timezoneCacheWarning: null,
      })),
  };
});
