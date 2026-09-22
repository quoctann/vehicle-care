import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import * as api from '@/api/client'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { GoogleButton } from '@/components/auth/GoogleButton'
import { PasswordInput } from '@/components/auth/PasswordInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { refreshPartTypesFromServer } from '@/data/seed'
import { useSessionStore } from '@/stores/useSessionStore'
import { getUserError } from '@/lib/userError'

const MIN_PASSWORD_LENGTH = 8

export function SignUpPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('auth.passwordMin', { count: MIN_PASSWORD_LENGTH }))
      return
    }
    if (password !== confirmPassword) {
      setError(t('auth.passwordMismatch'))
      return
    }

    setSubmitting(true)
    try {
      await api.signup({ email, password, name: name || undefined })
      // Signup (theo policy A trong sync-api-contract.md) set cookie session ngay —
      // hydrate lại để useSessionStore biết đã đăng nhập, dùng cho mọi trang sau đó.
      await useSessionStore.getState().hydrate()
      // Server đã seed sẵn 10 part type mặc định cho account này trong lúc signup — kéo
      // về Dexie ngay để picker part type có dữ liệu trước khi user vào app.
      await refreshPartTypesFromServer()
      navigate('/sign-up/check-email', { state: { email } })
    } catch (err) {
      setError(getUserError(err, t))
      setSubmitting(false)
    }
  }

  function handleGoogle() {
    setError(null)
    setSubmitting(true)
    window.location.href = api.googleStartUrl()
  }

  return (
    <AuthLayout
      title={t('auth.createAccount')}
      footer={
        <>
          {t('auth.hasAccount')}{' '}
          <Link to="/sign-in" className="font-medium text-primary hover:underline">
            {t('auth.signIn')}
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">{t('auth.name')}</Label>
          <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">{t('common.password')}</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm-password">{t('auth.confirmPassword')}</Label>
          <PasswordInput
            id="confirm-password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={submitting} className="mt-1">
          {submitting ? t('auth.creatingAccount') : t('auth.createAccount')}
        </Button>
      </form>

      <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        {t('auth.or')}
        <div className="h-px flex-1 bg-border" />
      </div>

      <GoogleButton onClick={handleGoogle} loading={submitting} label={t('auth.signUpGoogle')} />
    </AuthLayout>
  )
}
