import { type FormEvent, useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { SyncStatusBadge } from '@/components/layout/SyncStatusBadge'
import { addFuelLog } from '@/data/repositories/fuelRepository'
import { addServiceLog } from '@/data/repositories/serviceRepository'
import { validateOdometerReading } from '@/domain/validation'
import type { PartType } from '@/domain/types'
import { formatNumber } from '@/lib/formatters'
import { EntryTypeSelector, type LogEntryType } from './EntryTypeSelector'
import { LogEntryDetailsCard } from './LogEntryDetailsCard'
import { OdometerInputCard } from './OdometerInputCard'
import { PartTypeSelector } from './PartTypeSelector'

type LogEntryFormProps = {
  accountId: string
  vehicleId: string
  currentOdometerKm: number | null
  partTypes: PartType[]
  onCancel: () => void
  onSaved: () => void
}

type FormErrors = Record<string, string | undefined>

export function LogEntryForm({
  accountId,
  vehicleId,
  currentOdometerKm,
  partTypes,
  onCancel,
  onSaved,
}: LogEntryFormProps) {
  const { t } = useTranslation()
  const [entryType, setEntryType] = useState<LogEntryType>('fuel')
  const [partTypeId, setPartTypeId] = useState<string | null>(null)
  const [occurredAt, setOccurredAt] = useState(toLocalDateTimeInput(new Date()))
  const [liters, setLiters] = useState('')
  const [costVnd, setCostVnd] = useState('')
  const [shop, setShop] = useState('')
  const [note, setNote] = useState('')
  const [odometerKm, setOdometerKm] = useState<string | null>(null)
  const [isFullTank, setIsFullTank] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [confirmLowerOdometer, setConfirmLowerOdometer] = useState(false)

  const displayedOdometerKm =
    odometerKm ?? (entryType === 'service' && currentOdometerKm != null ? String(currentOdometerKm) : '')

  function handleTypeChange(nextType: LogEntryType) {
    setEntryType(nextType)
    setErrors({})
    if (nextType === 'service' && partTypeId == null && partTypes.length === 1) {
      setPartTypeId(partTypes[0].id)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await prepareSave(false)
  }

  async function prepareSave(lowerOdometerConfirmed: boolean) {
    const nextErrors = validateForm()
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    const parsedOdometer = optionalNumber(displayedOdometerKm)
    if (parsedOdometer != null) {
      const validation = validateOdometerReading(parsedOdometer, currentOdometerKm)
      if (!validation.valid) {
        setErrors({ odometerKm: t('logEntry.negativeOdometer') })
        return
      }
      if (validation.warning === 'lower_than_current' && !lowerOdometerConfirmed) {
        setConfirmLowerOdometer(true)
        return
      }
    }

    await saveEntry(parsedOdometer)
  }

  function validateForm(): FormErrors {
    const nextErrors: FormErrors = {}
    if (!occurredAt || Number.isNaN(new Date(occurredAt).getTime())) nextErrors.occurredAt = t('logEntry.invalidDate')

    const parsedOdometer = optionalNumber(displayedOdometerKm)
    if (displayedOdometerKm !== '' && (parsedOdometer == null || !Number.isFinite(parsedOdometer))) {
      nextErrors.odometerKm = t('logEntry.invalidOdometer')
    } else if (parsedOdometer != null && !validateOdometerReading(parsedOdometer, currentOdometerKm).valid) {
      nextErrors.odometerKm = t('logEntry.negativeOdometer')
    }

    const parsedCost = optionalNumber(costVnd)
    if (costVnd !== '' && (parsedCost == null || !Number.isFinite(parsedCost) || parsedCost < 0)) {
      nextErrors.costVnd = t('logEntry.invalidCost')
    }

    if (entryType === 'fuel') {
      const parsedLiters = optionalNumber(liters)
      if (liters !== '' && (parsedLiters == null || !Number.isFinite(parsedLiters) || parsedLiters <= 0)) {
        nextErrors.liters = t('logEntry.invalidLiters')
      }
    } else if (!partTypeId) {
      nextErrors.partTypeId = t('logEntry.choosePart')
    }

    return nextErrors
  }

  async function saveEntry(parsedOdometer: number | null) {
    const selectedPartTypeId = partTypeId
    if (entryType === 'service' && !selectedPartTypeId) return

    setSubmitting(true)
    try {
      const timestamp = new Date(occurredAt).toISOString()
      if (entryType === 'fuel') {
        await addFuelLog({
          accountId,
          vehicleId,
          recordedAt: timestamp,
          liters: optionalNumber(liters),
          costVnd: optionalNumber(costVnd),
          shop: optionalText(shop),
          note: optionalText(note),
          odometerKm: parsedOdometer,
          isFullTank,
        })
        toast.success(t('logEntry.fuelSaved'))
      } else {
        if (!selectedPartTypeId) return
        await addServiceLog({
          accountId,
          vehicleId,
          partTypeId: selectedPartTypeId,
          servicedAt: timestamp,
          odometerKmSnapshot: parsedOdometer,
          costVnd: optionalNumber(costVnd),
          note: optionalText(note),
        })
        toast.success(t('logEntry.serviceSaved'))
      }
      onSaved()
    } catch {
      toast.error(t('logEntry.saveFailed'))
      setSubmitting(false)
    }
  }

  const selectedPartType = partTypes.find((partType) => partType.id === partTypeId)

  return (
    <>
      <form onSubmit={handleSubmit} className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-10 border-b border-border-subtle bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-2xl items-center justify-between">
            <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting} className="-ml-2 text-muted-foreground">
              {t('common.cancel')}
            </Button>
            <h1 className="text-[15px] font-semibold tracking-tight">{t('logEntry.title')}</h1>
            <Button
              type="submit"
              variant="ghost"
              disabled={submitting || (entryType === 'service' && partTypes.length === 0)}
              className="-mr-2 text-primary hover:text-primary"
            >
              {t('common.save')}
            </Button>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-5 sm:px-6 sm:py-7">
          <div className="flex justify-end">
            <SyncStatusBadge />
          </div>

          <EntryTypeSelector value={entryType} onChange={handleTypeChange} />

          {entryType === 'service' ? (
            <div>
              <PartTypeSelector partTypes={partTypes} value={partTypeId} onChange={setPartTypeId} />
              {errors.partTypeId ? <p className="mt-2 px-0.5 text-xs text-destructive">{errors.partTypeId}</p> : null}
            </div>
          ) : null}

          <OdometerInputCard
            value={displayedOdometerKm}
            currentOdometerKm={currentOdometerKm}
            error={errors.odometerKm}
            onChange={setOdometerKm}
          />

          <LogEntryDetailsCard
            entryType={entryType}
            occurredAt={occurredAt}
            liters={liters}
            costVnd={costVnd}
            shop={shop}
            note={note}
            errors={errors}
            onOccurredAtChange={setOccurredAt}
            onLitersChange={setLiters}
            onCostVndChange={setCostVnd}
            onShopChange={setShop}
            onNoteChange={setNote}
          />

          {entryType === 'fuel' ? (
            <div className="flex items-center gap-3 rounded-2xl border border-border-subtle bg-card px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <label htmlFor="full-tank" className="text-sm font-medium">{t('logEntry.fullTank')}</label>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('logEntry.fullTankDescription')}</p>
              </div>
              <Switch id="full-tank" checked={isFullTank} onCheckedChange={setIsFullTank} />
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-2xl border border-primary/15 bg-primary/[0.04] px-4 py-3.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                <Check className="size-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-medium">
                  {selectedPartType
                    ? t('logEntry.resetPartReminder', { part: selectedPartType.displayName })
                    : t('logEntry.resetServiceReminders')}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('logEntry.resetDescription')}</p>
              </div>
            </div>
          )}
        </main>

        <footer className="sticky bottom-0 border-t border-border-subtle bg-background/95 px-4 py-3 backdrop-blur sm:px-6 sm:py-4">
          <Button
            type="submit"
            disabled={submitting || (entryType === 'service' && partTypes.length === 0)}
            className="mx-auto h-12 w-full max-w-2xl rounded-xl bg-primary font-display text-sm text-primary-foreground hover:bg-primary/90"
          >
            {submitting ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
            {submitting ? t('common.saving') : t('logEntry.saveEntry')}
          </Button>
        </footer>
      </form>

      <Dialog open={confirmLowerOdometer} onOpenChange={setConfirmLowerOdometer}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('logEntry.lowerTitle')}</DialogTitle>
            <DialogDescription>
              {t('logEntry.lowerDescription', { value: formatNumber(currentOdometerKm ?? 0) })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmLowerOdometer(false)}>
              {t('logEntry.review')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setConfirmLowerOdometer(false)
                void prepareSave(true)
              }}
            >
              {t('logEntry.saveAnyway')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function optionalNumber(value: string): number | null {
  if (value.trim() === '') return null
  return Number(value)
}

function optionalText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function toLocalDateTimeInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}
