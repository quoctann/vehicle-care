import { type FormEvent, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import * as api from '@/api/client';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getUserError } from '@/lib/userError';

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setSubmitting(true);
    try {
      await api.forgotPassword({ email: email.trim() });
      navigate('/forgot-password/sent', { state: { email: email.trim() } });
    } catch (error) {
      setError(getUserError(error, t));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
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
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={submitting} className="mt-1">
          {submitting ? t('auth.sending') : t('auth.sendResetLink')}
        </Button>
      </form>
    </AuthLayout>
  );
}
