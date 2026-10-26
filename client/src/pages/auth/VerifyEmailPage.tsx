import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import * as api from '@/api/client';
import { ApiError } from '@/api/errors';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { VerificationResendForm } from '@/components/auth/VerificationResendForm';
import { Button } from '@/components/ui/button';
import { useEmailActionToken } from '@/hooks/useEmailActionToken';
import { refreshEmailActionSession } from '@/lib/emailActions';
import { getUserError } from '@/lib/userError';
import { useSessionStore } from '@/stores/useSessionStore';

export function VerifyEmailPage() {
  const link = useEmailActionToken();
  return <VerifyEmailForm key={link.actionKey} token={link.token} />;
}

function VerifyEmailForm({ token }: { token: string }) {
  const { t } = useTranslation();
  const email = useSessionStore((state) => state.account?.email);
  const [submitting, setSubmitting] = useState(false);
  const [verified, setVerified] = useState(false);
  const [invalid, setInvalid] = useState(!token);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function handleConfirm() {
    if (!token || invalid || verified || inFlight.current) return;
    const context = useSessionStore.getState();
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await api.verifyEmail({ token });
      setVerified(true);
      await refreshEmailActionSession(context, false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) setInvalid(true);
      else setError(getUserError(error, t));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title={t('auth.verifyEmail')}
      footer={
        <Link to="/sign-in" className="font-medium text-primary hover:underline">
          {t('auth.backToSignIn')}
        </Link>
      }
    >
      <div className="flex flex-col gap-4">
        {verified ? (
          <p role="status">{t('auth.verifySuccess')}</p>
        ) : (
          <>
            {invalid ? (
              <p role="alert" className="text-sm text-destructive">
                {t('auth.invalidVerificationLink')}
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{t('auth.verifyPrompt')}</p>
                <Button onClick={handleConfirm} disabled={submitting}>
                  {submitting ? t('common.working') : t('auth.verifyConfirm')}
                </Button>
              </>
            )}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <VerificationResendForm initialEmail={email} />
          </>
        )}
      </div>
    </AuthLayout>
  );
}
