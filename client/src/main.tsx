import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { toast } from 'sonner';
import { registerSW } from 'virtual:pwa-register';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import App from './App.tsx';
import i18n from './i18n';
import { registerUpdates } from './pwa/registerUpdates';
import './index.css';

// Prompt mode leaves updates waiting. Only this tab's explicit confirmation permits
// reload, even if another tab activates the worker. iOS update timing is not guaranteed.
registerUpdates(registerSW, {
  notify(accept) {
    toast.info(i18n.t('common.updateAvailable'), {
      action: {
        label: i18n.t('common.update'),
        onClick: (event) => {
          // Keep the update available when the confirmation is cancelled.
          event.preventDefault();
          void accept();
        },
      },
      duration: Infinity,
    });
  },
  confirm: () => window.confirm(i18n.t('common.updateConfirm')),
  reload: () => window.location.reload(),
  reportError: (error) => console.warn('Service worker update unavailable', error),
  schedule: (check, interval) => {
    window.setInterval(() => void check(), interval);
  },
  onForeground(check) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void check();
    });
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      storageKey="vehicle.preferences.theme"
    >
      <App />
    </ThemeProvider>
  </StrictMode>,
);
