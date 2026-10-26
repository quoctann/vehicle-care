import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GoogleStatusResponse } from '@/api/contract.types';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { beginGoogleLink, loadGoogleStatus } from '@/lib/googleAccount';
import { getUserError } from '@/lib/userError';
import { captureSyncSession, isCurrentSyncSession } from '@/sync/sessionGuard';

/** Online-only security action; never writes session caches, entities or the outbox. */
export function GoogleAccountCard({ accountId }: { accountId: string }) {
  const { t } = useTranslation();
  // Settings keys this component by account + generation. Never recapture a newer
  // session from an event handler belonging to an older password form.
  const [context] = useState(() => captureSyncSession(accountId));
  const [online, setOnline] = useState(() => navigator.onLine);
  const [status, setStatus] = useState<GoogleStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const update = () => {
      setOnline(navigator.onLine);
      setPassword('');
      setConfirming(false);
      setStatus(null);
      setError(null);
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      mounted.current = false;
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    if (!online || !isCurrentSyncSession(context)) return;
    let active = true;
    void loadGoogleStatus(context)
      .then((result) => {
        if (active && isCurrentSyncSession(context)) setStatus(result);
      })
      .catch(() => {
        if (active && isCurrentSyncSession(context)) setError(t('google.errors.failed'));
      });
    return () => {
      active = false;
    };
  }, [context, online, attempt, t]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      inFlight.current ||
      !isCurrentSyncSession(context) ||
      !navigator.onLine ||
      !password ||
      !status?.enabled ||
      status.linked ||
      !status.has_password
    )
      return;
    const reauthPassword = password;
    inFlight.current = true;
    setPending(true);
    setPassword('');
    setError(null);
    try {
      const url = await beginGoogleLink(context, reauthPassword);
      if (mounted.current && navigator.onLine && isCurrentSyncSession(context))
        window.location.assign(url);
    } catch (cause) {
      if (mounted.current && isCurrentSyncSession(context)) setError(getUserError(cause, t));
    } finally {
      inFlight.current = false;
      if (mounted.current && isCurrentSyncSession(context)) setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="google-account-title"
      className="space-y-3 rounded-2xl border border-border-subtle bg-card p-4 shadow-sm"
    >
      <h2 id="google-account-title" className="font-semibold">
        {t('google.title')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('google.description')}</p>
      {!online ? (
        <p className="text-sm">{t('google.offline')}</p>
      ) : (
        <>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {!status ? (
            error ? (
              <Button
                variant="outline"
                onClick={() => {
                  setError(null);
                  setAttempt((value) => value + 1);
                }}
              >
                {t('google.retry')}
              </Button>
            ) : (
              <p role="status" className="text-sm">
                {t('google.loading')}
              </p>
            )
          ) : !status.enabled ? (
            <p className="text-sm">{t('google.errors.unavailable')}</p>
          ) : status.linked ? (
            <p className="text-sm font-medium">{t('google.linked')}</p>
          ) : !status.has_password ? (
            <p className="text-sm">{t('google.noPassword')}</p>
          ) : confirming ? (
            <form onSubmit={(event) => void submit(event)} className="space-y-3">
              <p className="text-sm text-muted-foreground">{t('google.reauth')}</p>
              <Label htmlFor="google-link-password">{t('google.password')}</Label>
              <PasswordInput
                id="google-link-password"
                autoComplete="current-password"
                required
                value={password}
                disabled={pending}
                onChange={(event) => setPassword(event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={pending || !password}>
                  {pending ? t('common.working') : t('google.confirm')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    setPassword('');
                    setConfirming(false);
                  }}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="outline" onClick={() => setConfirming(true)}>
              {t('google.link')}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
