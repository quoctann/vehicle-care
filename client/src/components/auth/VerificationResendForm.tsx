import * as api from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getUserError } from '@/lib/userError';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const RESEND_COOLDOWN_SECONDS = 30;

export function VerificationResendForm({ initialEmail = '' }: { initialEmail?: string }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(initialEmail);
  const [cooldown, setCooldown] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || cooldown > 0 || !email.trim()) return;
    inFlight.current = true;
    setSubmitting(true);
    setSent(false);
    setError(null);
    try {
      await api.resendVerificationEmail({ email: email.trim() });
      setSent(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      setError(getUserError(error, t));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3 text-left">
      <Label htmlFor="resend-email">{t('common.email')}</Label>
      <Input
        id="resend-email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <Button variant="outline" type="submit" disabled={submitting || cooldown > 0}>
        {submitting
          ? t('auth.sending')
          : cooldown > 0
            ? t('auth.resendCountdown', { count: cooldown })
            : t('auth.resendEmail')}
      </Button>
      {sent ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('auth.resent')}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
