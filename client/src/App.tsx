import { useEffect } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { ThemeColorSync } from '@/components/theme/ThemeColorSync'
import { Toaster } from '@/components/ui/sonner'
import { refreshPartTypesFromServer, seedPartTypes } from '@/data/seed'
import { AppRouter } from '@/routes/router'
import { startAutoSync } from '@/sync/autoSync'
import { useSessionStore } from '@/stores/useSessionStore'

export default function App() {
  const hydrate = useSessionStore((s) => s.hydrate)

  useEffect(() => {
    // Cookie session (nếu có) tự đính kèm — không cần đọc gì từ local storage.
    hydrate()
    // Idempotent (bulkPut theo id cố định) — an toàn gọi lại mỗi lần app khởi động.
    seedPartTypes()
    // Best-effort: đồng bộ lại từ server (nguồn sự thật duy nhất cho UUID part_type).
    void refreshPartTypesFromServer()
  }, [hydrate])

  useEffect(() => startAutoSync(), [])

  return (
    <BrowserRouter>
      <ThemeColorSync />
      <AppRouter />
      <Toaster position="top-center" />
    </BrowserRouter>
  )
}
