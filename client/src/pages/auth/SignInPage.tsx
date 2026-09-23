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
import { mapAccountDto, useSessionStore } from '@/stores/useSessionStore'
import { getUserError } from '@/lib/userError'

export function SignInPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const setAuthenticated = useSessionStore((s) => s.setAuthenticated)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const { account } = await api.login({ email, password })
      setAuthenticated(mapAccountDto(account))
      navigate('/', { replace: true })
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
      title={t('auth.signIn')}
      footer={
        <>
          {t('auth.noAccount')}{' '}
          <Link to="/sign-up" className="font-medium text-primary hover:underline">
            {t('auth.signUp')}
          </Link>
        </>
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
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{t('common.password')}</Label>
            <Link to="/forgot-password" className="text-xs font-medium text-primary hover:underline">
              {t('auth.forgotPasswordQuestion')}
            </Link>
          </div>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={submitting} className="mt-1">
          {submitting ? t('auth.signingIn') : t('auth.signIn')}
        </Button>
      </form>

      <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        {t('auth.or')}
        <div className="h-px flex-1 bg-border" />
      </div>

      <GoogleButton onClick={handleGoogle} loading={submitting} />
    </AuthLayout>
  )
}
