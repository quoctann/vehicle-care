import type { RegisterSWOptions } from 'vite-plugin-pwa/types';

export type UpdateDependencies = {
  notify: (accept: () => Promise<void>) => void;
  confirm: () => boolean;
  reload: () => void;
  reportError: (error: unknown) => void;
  schedule: (check: () => Promise<void>, interval: number) => void;
  onForeground: (check: () => Promise<void>) => void;
};

/** Consent is local to this page, never inherited from another tab's activation. */
export function registerUpdates(
  register: (options: RegisterSWOptions) => (reloadPage?: boolean) => Promise<void>,
  dependencies: UpdateDependencies,
) {
  let reloadConsented = false;
  let reloadPending = false;
  const activate = register({
    onNeedRefresh() {
      dependencies.notify(async () => {
        if (!dependencies.confirm()) return;
        reloadConsented = true;
        if (reloadPending) {
          dependencies.reload();
          return;
        }
        try {
          await activate(true);
        } catch (error) {
          reloadConsented = false;
          dependencies.reportError(error);
        }
      });
    },
    onNeedReload() {
      reloadPending = true;
      if (reloadConsented) dependencies.reload();
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = async () => {
        try {
          await registration.update();
        } catch (error) {
          // Offline/background checks must not become unhandled rejections.
          dependencies.reportError(error);
        }
      };
      dependencies.schedule(check, 60 * 60 * 1000);
      dependencies.onForeground(check);
    },
    onRegisterError: dependencies.reportError,
  });
}
