import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import { registerSW } from 'virtual:pwa-register'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import App from './App.tsx'
import i18n from './i18n'
import './index.css'

/**
 * `registerType: 'autoUpdate'` (vite.config.ts) cài service worker mới (skipWaiting +
 * clientsClaim) nhưng KHÔNG tự báo/reload tab đang mở — đặc biệt app đã pin ra
 * homescreen (standalone) có thể không đóng hẳn trong nhiều ngày, nên không bao giờ
 * biết có bản mới. `onRegisteredSW` chủ động `registration.update()` định kỳ + mỗi lần
 * app quay lại foreground; `onNeedRefresh` báo qua toast thay vì tự reload đột ngột
 * giữa lúc user đang nhập liệu (xem .docs/20260919-feedback.md mục 5).
 */
const updateSW = registerSW({
  onNeedRefresh() {
    toast.info(i18n.t('common.updateAvailable'), {
      action: { label: i18n.t('common.update'), onClick: () => void updateSW(true) },
      duration: Infinity,
    })
  },
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return
    setInterval(() => void registration.update(), 60 * 60 * 1000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void registration.update()
    })
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange storageKey="vehicle.preferences.theme">
      <App />
    </ThemeProvider>
  </StrictMode>,
)
