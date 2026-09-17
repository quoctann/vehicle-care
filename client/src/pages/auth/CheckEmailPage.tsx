import { MailCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import * as api from '@/api/client'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { Button } from '@/components/ui/button'
import { useSessionStore } from '@/stores/useSessionStore'

const RESEND_COOLDOWN_SECONDS = 30

export function CheckEmailPage() {
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
      title="Check your email"
      footer={
        <Link to="/sign-in" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-warn-bg text-warn-fg">
          <MailCheck className="size-6" />
        </div>
        <p className="text-sm text-muted-foreground">
          Đã gửi email xác thực tới <span className="font-medium text-foreground">{email}</span>. Mở email và bấm vào
          liên kết để xác thực tài khoản.
        </p>
        <Button variant="outline" className="mt-2 w-full" disabled={cooldown > 0} onClick={handleResend}>
          {cooldown > 0 ? `Resend email (${cooldown}s)` : 'Resend email'}
        </Button>
        {sent ? <p className="text-xs text-muted-foreground">Đã gửi lại email xác thực.</p> : null}
      </div>
    </AuthLayout>
  )
}
