import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ENABLE_MSW } from '@/api/config'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import App from './App.tsx'
import './i18n'
import './index.css'

async function enableMocking() {
  if (!ENABLE_MSW) return
  // Dynamic import: MSW không bao giờ lọt vào bundle production dù cờ có bị set sai,
  // vì nhánh `if` ở trên đã loại trừ theo `import.meta.env.DEV` (hằng số biên dịch).
  const { worker } = await import('./mocks/browser')
  await worker.start({ onUnhandledRequest: 'bypass' })
}

enableMocking().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange storageKey="vehicle.preferences.theme">
        <App />
      </ThemeProvider>
    </StrictMode>,
  )
})
