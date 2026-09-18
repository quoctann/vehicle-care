import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { addOdometerLog } from '@/data/repositories/odometerRepository'
import { validateOdometerReading } from '@/domain/validation'
import { formatNumber } from '@/lib/formatters'

type UpdateOdometerSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId?: string
  vehicleId?: string
  currentOdometerKm: number | null
}

export function UpdateOdometerSheet({
  open,
  onOpenChange,
  accountId,
  vehicleId,
  currentOdometerKm,
}: UpdateOdometerSheetProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState(currentOdometerKm == null ? '' : String(currentOdometerKm))
  const [error, setError] = useState<string | null>(null)
  const [confirmLower, setConfirmLower] = useState(false)
  const [saving, setSaving] = useState(false)

  function updateValue(nextValue: string) {
    setValue(nextValue)
    setError(null)
    setConfirmLower(false)
  }

  function step(amount: number) {
    const parsed = Number(value)
    const base = Number.isFinite(parsed) ? parsed : (currentOdometerKm ?? 0)
    updateValue(String(Math.max(0, base + amount)))
  }

  async function saveReading(forceLower = false) {
    const reading = Number(value)
    if (value.trim() === '' || !Number.isFinite(reading)) {
      setError(t('logEntry.invalidOdometer'))
      return
    }

    const validation = validateOdometerReading(reading, currentOdometerKm)
    if (!validation.valid) {
      setError(t('logEntry.negativeOdometer'))
      return
    }
    if (validation.warning === 'lower_than_current' && !forceLower) {
      setConfirmLower(true)
      return
    }
    if (!accountId || !vehicleId) {
      setError(t('odometer.vehicleUnavailable'))
      return
    }

    setSaving(true)
    setError(null)
    try {
      await addOdometerLog({ accountId, vehicleId, odometerKm: reading, source: 'manual' })
      onOpenChange(false)
      toast.success(t('odometer.saved'))
    } catch {
      setError(t('odometer.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="gap-0 rounded-t-[24px] border-x-0 border-b-0 p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:inset-x-0 md:mx-auto md:max-w-[600px] lg:inset-auto lg:left-1/2 lg:top-1/2 lg:w-[440px] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-[20px] lg:border lg:p-[18px] lg:shadow-lg"
      >
        <div className="mx-auto mb-3.5 h-1 w-9 rounded-full bg-border lg:hidden" />
        <SheetTitle className="mx-0.5 text-[15px] font-semibold tracking-[-0.01em]">{t('odometer.update')}</SheetTitle>
        <SheetDescription className="mx-0.5 mt-0.5 text-xs leading-5">
          {currentOdometerKm == null
            ? t('odometer.firstReading')
            : t('odometer.currentReading', { value: formatNumber(currentOdometerKm) })}
        </SheetDescription>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => step(-10)}
            aria-label={t('odometer.decrease')}
            className="flex size-12 shrink-0 items-center justify-center rounded-[14px] border bg-card shadow-[0_1px_1px_rgba(44,54,53,.025)] transition hover:border-foreground"
          >
            <Minus className="size-5" />
          </button>
          <div className="relative min-w-0 flex-1">
            <input
              value={value}
              onChange={(event) => updateValue(event.target.value)}
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              aria-label={t('odometer.inputLabel')}
              aria-invalid={Boolean(error)}
              className="h-12 w-full rounded-xl border bg-card px-10 text-center text-2xl font-bold tracking-[-0.035em] outline-none transition focus:border-ring focus:ring-3 focus:ring-ring/20"
              placeholder="0"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">km</span>
          </div>
          <button
            type="button"
            onClick={() => step(10)}
            aria-label={t('odometer.increase')}
            className="flex size-12 shrink-0 items-center justify-center rounded-[14px] border bg-card shadow-[0_1px_1px_rgba(44,54,53,.025)] transition hover:border-foreground"
          >
            <Plus className="size-5" />
          </button>
        </div>

        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        {confirmLower ? (
          <div className="mt-4 rounded-xl border border-warn-border bg-warn-bg p-3 text-sm text-warn-fg">
            <p className="font-medium">{t('odometer.lowerWarning')}</p>
            <p className="mt-1 text-xs leading-5">{t('odometer.lowerExplanation')}</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmLower(false)}
                className="h-9 flex-1 rounded-lg border border-warn-border bg-card px-3 text-sm font-medium"
              >
                {t('odometer.goBack')}
              </button>
              <button
                type="button"
                onClick={() => saveReading(true)}
                disabled={saving}
                className="h-9 flex-1 rounded-lg bg-primary px-3 font-display text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {t('logEntry.saveAnyway')}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => saveReading()}
            disabled={saving}
            className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-primary font-display text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? t('common.saving') : t('odometer.saveReading')}
          </button>
        )}
      </SheetContent>
    </Sheet>
  )
}
