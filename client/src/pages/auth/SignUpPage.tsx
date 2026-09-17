import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as api from '@/api/client'
import { ENABLE_MSW } from '@/api/config'
import { googleMockSignIn } from '@/api/devGoogleMock'
import { ApiError } from '@/api/errors'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { GoogleButton } from '@/components/auth/GoogleButton'
import { PasswordInput } from '@/components/auth/PasswordInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { mapAccountDto, useSessionStore } from '@/stores/useSessionStore'

const MIN_PASSWORD_LENGTH = 8

export function SignUpPage() {
  const navigate = useNavigate()
  const setAuthenticated = useSessionStore((s) => s.setAuthenticated)
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
      setError(`Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`)
      return
    }
    if (password !== confirmPassword) {
      setError('Mật khẩu xác nhận không khớp.')
      return
    }

    setSubmitting(true)
    try {
      await api.signup({ email, password, name: name || undefined })
      // Signup (theo policy A trong sync-api-contract.md) set cookie session ngay —
      // hydrate lại để useSessionStore biết đã đăng nhập, dùng cho mọi trang sau đó.
      await useSessionStore.getState().hydrate()
      navigate('/sign-up/check-email', { state: { email } })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Đã có lỗi xảy ra, thử lại sau.')
      setSubmitting(false)
    }
  }

  async function handleGoogle() {
    setError(null)
    setSubmitting(true)
    if (!ENABLE_MSW) {
      window.location.href = api.googleStartUrl()
      return
    }
    try {
      const { account } = await googleMockSignIn()
      setAuthenticated(mapAccountDto(account))
      navigate('/', { replace: true })
    } catch {
      setError('Đăng ký qua Google thất bại, thử lại sau.')
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/sign-in" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
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
          <Label htmlFor="password">Password</Label>
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
          <Label htmlFor="confirm-password">Confirm password</Label>
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
          Create account
        </Button>
      </form>

      <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        or
        <div className="h-px flex-1 bg-border" />
      </div>

      <GoogleButton onClick={handleGoogle} loading={submitting} label="Sign up with Google" />
    </AuthLayout>
  )
}
