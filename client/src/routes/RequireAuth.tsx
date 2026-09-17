import { Navigate, Outlet } from 'react-router-dom'
import { useSessionStore } from '@/stores/useSessionStore'

/**
 * Bọc mọi route cần đăng nhập (`/v/:vehicleId/*`, `/settings`, `/onboarding/*`).
 * `status` được hydrate 1 lần lúc app khởi động (xem `App.tsx`) bằng `GET /auth/session`
 * — cookie session tự đính kèm, component này KHÔNG tự gọi API.
 */
export function RequireAuth() {
  const status = useSessionStore((s) => s.status)

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    )
  }

  if (status === 'anonymous') return <Navigate to="/sign-in" replace />

  return <Outlet />
}
