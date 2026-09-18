import { MailCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import * as api from '@/api/client'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { Button } from '@/components/ui/button'
import { useSessionStore } from '@/stores/useSessionStore'

const RESEND_COOLDOWN_SECONDS = 30

export function CheckEmailPage() {
  const { t } = useTranslation()
  const location = useLocation()
  const account = useSessionStore((s) => s.account)
  const email = (location.state as { email?: string } | null)?.email ?? account?.email ?? ''
  const [cooldown, setCooldown] = useState(0)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  async function handleResend() {
    if (cooldown > 0 || !email) return
    setSent(false)
    try {
      await api.resendVerificationEmail({ email })
      setSent(true)
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } catch {
      // Endpoint luôn trả 200 generic theo contract — lỗi ở đây chỉ là lỗi mạng, im lặng là đủ cho MVP.
    }
  }

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
          <Trans i18nKey="auth.verificationSent" values={{ email }} components={{ 1: <span className="font-medium text-foreground" /> }} />
        </p>
        <Button variant="outline" className="mt-2 w-full" disabled={cooldown > 0} onClick={handleResend}>
          {cooldown > 0 ? t('auth.resendCountdown', { count: cooldown }) : t('auth.resendEmail')}
        </Button>
        {sent ? <p className="text-xs text-muted-foreground">{t('auth.resent')}</p> : null}
      </div>
    </AuthLayout>
  )
}
