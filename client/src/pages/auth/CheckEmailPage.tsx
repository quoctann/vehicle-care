import { MailCheck } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { VerificationResendForm } from '@/components/auth/VerificationResendForm';
import { useSessionStore } from '@/stores/useSessionStore';

export function CheckEmailPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const account = useSessionStore((s) => s.account);
  const email = (location.state as { email?: string } | null)?.email ?? account?.email ?? '';

  return (
    <AuthLayout
      title={t('auth.checkEmail')}
      footer={
        <Link to="/sign-in" className="font-medium text-primary hover:underline">
          {t('auth.backToSignIn')}
        </Link>
      }
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-warn-bg text-warn-fg">
          <MailCheck className="size-6" />
        </div>
        <p className="text-sm text-muted-foreground">
          <Trans
            i18nKey="auth.verificationSent"
            values={{ email: email || t('common.yourEmail') }}
            components={{ 1: <span className="font-medium text-foreground" /> }}
          />
        </p>
        <VerificationResendForm initialEmail={email} />
      </div>
    </AuthLayout>
  );
}
