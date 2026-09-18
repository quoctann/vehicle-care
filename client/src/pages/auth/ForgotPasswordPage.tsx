import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import * as api from '@/api/client'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      await api.forgotPassword({ email })
    } finally {
      // Luôn điều hướng dù thành công hay lỗi mạng — response là generic 200 theo
      // contract, không có nhánh "email không tồn tại" để phân biệt ở UI.
      navigate('/forgot-password/sent', { state: { email } })
    }
  }

  return (
    <AuthLayout
      title={t('auth.forgotPassword')}
      subtitle={t('auth.forgotSubtitle')}
      footer={
        <Link to="/sign-in" className="font-medium text-primary hover:underline">
          {t('auth.backToSignIn')}
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">{t('common.email')}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={submitting} className="mt-1">
          {submitting ? t('auth.sending') : t('auth.sendResetLink')}
        </Button>
      </form>
    </AuthLayout>
  )
}
