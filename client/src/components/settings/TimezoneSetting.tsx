import { Globe } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { detectDeviceTimezone, TIMEZONE_CHOICES } from '@/lib/timezones';
import { useSessionStore } from '@/stores/useSessionStore';

export function TimezoneSetting() {
  const account = useSessionStore((state) => state.account);
  const generation = useSessionStore((state) => state.sessionGeneration);
  return account ? (
    <TimezoneForm key={`${account.id}:${generation}`} timezone={account.timezone} />
  ) : null;
}

function TimezoneForm({ timezone }: { timezone: string }) {
  const { t } = useTranslation();
  const updateTimezone = useSessionStore((state) => state.updateTimezone);
  const storeSaving = useSessionStore((state) => state.timezoneSaving);
  const cacheWarning = useSessionStore((state) => state.timezoneCacheWarning);
  const [selection, setSelection] = useState({ source: timezone, value: timezone });
  const selected = selection.source === timezone ? selection.value : timezone;
  const setSelected = (value: string) => setSelection({ source: timezone, value });
  const [submitting, setSubmitting] = useState(false);
  const saving = submitting || storeSaving;
  const [error, setError] = useState<string | null>(null);
  const selectedChoice = useMemo(
    () => TIMEZONE_CHOICES.find((choice) => choice.value === selected),
    [selected],
  );

  async function save() {
    if (saving || selected === timezone) return;
    const generation = useSessionStore.getState().sessionGeneration;
    setSubmitting(true);
    setError(null);
    try {
      await updateTimezone(selected);
      const current = useSessionStore.getState();
      if (current.sessionGeneration !== generation) return;
      if (current.timezoneCacheWarning) toast.warning(t('settings.timezoneCacheFailed'));
      else toast.success(t('settings.timezoneSaved'));
    } catch {
      if (useSessionStore.getState().sessionGeneration !== generation) return;
      const message = t('settings.timezoneSaveFailed');
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3 px-4 py-3.5">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Globe className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{t('settings.timezone')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('settings.timezoneDescription')}
          </p>
          <p className="mt-1 break-all text-xs text-muted-foreground">
            {t('settings.timezoneCurrent', {
              timezone:
                TIMEZONE_CHOICES.find((choice) => choice.value === timezone)?.label ?? timezone,
            })}
          </p>
        </div>
      </div>
      <div className="space-y-2 sm:ml-11">
        <Label htmlFor="account-timezone">{t('settings.timezoneChoose')}</Label>
        <Select
          value={selected}
          onValueChange={(value) => {
            setSelected(value);
            setError(null);
          }}
          disabled={saving}
        >
          <SelectTrigger
            id="account-timezone"
            data-timezone={selected}
            className="h-10 w-full min-w-0 text-left"
          >
            <SelectValue>
              <span className="truncate">{selectedChoice?.label ?? selected}</span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent
            position="popper"
            align="start"
            className="max-h-[min(18rem,var(--radix-select-content-available-height))]"
          >
            {TIMEZONE_CHOICES.map((choice) => (
              <SelectItem
                key={choice.value}
                value={choice.value}
                data-timezone={choice.value}
                textValue={choice.label}
                aria-label={`${choice.label} — ${choice.value}`}
                className="text-left whitespace-normal"
              >
                <span className="flex min-w-0 flex-col items-start">
                  <span>{choice.label}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => {
              const deviceTimezone = detectDeviceTimezone();
              if (deviceTimezone) {
                setSelected(deviceTimezone);
                setError(null);
              } else {
                setError(t('settings.timezoneDeviceUnsupported'));
              }
            }}
          >
            {t('settings.useDeviceTimezone')}
          </Button>
          <Button size="sm" disabled={saving || selected === timezone} onClick={() => void save()}>
            {t(saving ? 'settings.timezoneSaving' : 'settings.timezoneSave')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t('settings.timezoneOnlineHelp')}</p>
        <p className="text-xs text-muted-foreground">{t('settings.timezoneOffsetHelp')}</p>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {cacheWarning && (
          <p role="alert" className="text-xs text-warn-fg">
            {t('settings.timezoneCacheFailed')}
          </p>
        )}
      </div>
    </div>
  );
}
