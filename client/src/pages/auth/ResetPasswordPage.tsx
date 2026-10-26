import { type FormEvent, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import * as api from '@/api/client';
import { ApiError } from '@/api/errors';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { getUserError } from '@/lib/userError';
import { isValidPassword, refreshEmailActionSession } from '@/lib/emailActions';
import { useEmailActionToken } from '@/hooks/useEmailActionToken';
import { useSessionStore } from '@/stores/useSessionStore';

export function ResetPasswordPage() {
  const link = useEmailActionToken();
  return <ResetPasswordForm key={link.actionKey} token={link.token} />;
}

function ResetPasswordForm({ token }: { token: string }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [invalid, setInvalid] = useState(!token);
  const inFlight = useRef(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current || complete || invalid) return;
    setError(null);

    if (!isValidPassword(password)) {
      setError(t('auth.passwordBytes'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('auth.passwordMismatch'));
      return;
    }

    inFlight.current = true;
    const context = useSessionStore.getState();
    context.invalidatePendingHydration(context.sessionGeneration);
    setSubmitting(true);
    try {
      await api.resetPassword({ token, new_password: password });
      setComplete(true);
      setPassword('');
      setConfirmPassword('');
      await refreshEmailActionSession(context, true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setInvalid(true);
      else setError(getUserError(err, t));
    } finally {
      // Settle suspended initial hydration even on failure. A live unrelated
      // cookie remains usable, but an older hydration response cannot win.
      if (context.status === 'loading') await refreshEmailActionSession(context, true);
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title={t('auth.resetPassword')}
      footer={
        <Link to="/sign-in" className="font-medium text-primary hover:underline">
          {t('auth.backToSignIn')}
        </Link>
      }
    >
      {complete ? (
        <p role="status">{t('auth.resetSuccess')}</p>
      ) : invalid ? (
        <div className="flex flex-col gap-4">
          <p role="alert" className="text-sm text-destructive">
            {t('auth.invalidResetLink')}
          </p>
          <Link to="/forgot-password" className="text-primary hover:underline">
            {t('auth.sendResetLink')}
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">{t('auth.newPassword')}</Label>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-password">{t('auth.confirmNewPassword')}</Label>
            <PasswordInput
              id="confirm-password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={submitting} className="mt-1">
            {submitting ? t('auth.resetting') : t('auth.resetPassword')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
