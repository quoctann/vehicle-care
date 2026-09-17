import { MailCheck } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { AuthLayout } from '@/components/auth/AuthLayout'

export function ForgotPasswordSentPage() {
  const location = useLocation()
  const email = (location.state as { email?: string } | null)?.email ?? 'email của bạn'

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
          Nếu <span className="font-medium text-foreground">{email}</span> có tồn tại trong hệ thống, chúng tôi đã gửi
          liên kết đặt lại mật khẩu. Liên kết có hiệu lực trong thời gian giới hạn.
        </p>
      </div>
    </AuthLayout>
  )
}
