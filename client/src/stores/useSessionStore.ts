import { create } from 'zustand'
import * as api from '@/api/client'
import type { AccountDto } from '@/api/contract.types'
import { db } from '@/data/db'
import { ApiError } from '@/api/errors'

/**
 * `useSessionStore` chỉ giữ TRẠNG THÁI ĐĂNG NHẬP hiện tại (mỏng, đúng nguyên tắc
 * store trong plan) — KHÔNG chứa token: session thật là cookie `httpOnly` do trình
 * duyệt tự quản lý, JS không đọc/lưu được và không cần. Biết "đã đăng nhập chưa"
 * bằng cách gọi `GET /auth/session` (cookie tự đính kèm), không bằng cách soi local storage.
 */
export type SessionAccount = {
  id: string
  email: string
  name: string | null
  timezone: string
  emailVerified: boolean
}

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous'

export function mapAccountDto(dto: AccountDto): SessionAccount {
  return { id: dto.id, email: dto.email, name: dto.name, timezone: dto.timezone, emailVerified: dto.email_verified }
}

type SessionStore = {
  status: SessionStatus
  account: SessionAccount | null
  /** Gọi 1 lần lúc app khởi động (và sau signup/login) để đồng bộ với cookie session hiện có. */
  hydrate: () => Promise<void>
  setAuthenticated: (account: SessionAccount) => void
  clear: () => void
}

export const useSessionStore = create<SessionStore>((set) => ({
  status: 'loading',
  account: null,
  hydrate: async () => {
    try {
      const { account } = await api.getSession()
      set({ status: 'authenticated', account: mapAccountDto(account) })
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.code === 'session_expired' || error.code === 'auth_invalid')) {
        set({ status: 'anonymous', account: null })
        return
      }
      const cached = await db.accountCache.get('current').catch(() => undefined)
      if (cached) {
        set({
          status: 'authenticated',
          account: {
            id: cached.accountId,
            email: cached.email,
            name: cached.name,
            timezone: cached.timezone,
            emailVerified: cached.emailVerified,
          },
        })
        return
      }
      set({ status: 'anonymous', account: null })
    }
  },
  setAuthenticated: (account) => set({ status: 'authenticated', account }),
  clear: () => set({ status: 'anonymous', account: null }),
}))
