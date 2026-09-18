import { MailCheck } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { AuthLayout } from '@/components/auth/AuthLayout'

export function ForgotPasswordSentPage() {
  const { t } = useTranslation()
  const location = useLocation()
  const email = (location.state as { email?: string } | null)?.email ?? t('common.yourEmail')

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
          <Trans i18nKey="auth.resetSent" values={{ email }} components={{ 1: <span className="font-medium text-foreground" /> }} />
        </p>
      </div>
    </AuthLayout>
  )
}
