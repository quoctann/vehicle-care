import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { updateVehicleDetails } from '@/data/repositories/vehicleRepository'
import { DUE_SOON_REMAINING_RATIO } from '@/domain/constants'
import type { Vehicle } from '@/domain/types'

type EditVehicleSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: string
  vehicle: Vehicle | null
}

const MIN_PERCENT = 50
const MAX_PERCENT = 99
const DEFAULT_PERCENT = Math.round(DUE_SOON_REMAINING_RATIO * 100)

export function EditVehicleSheet({ open, onOpenChange, accountId, vehicle }: EditVehicleSheetProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(vehicle?.name ?? '')
  const [plateNumber, setPlateNumber] = useState(vehicle?.plateNumber ?? '')
  const [customThreshold, setCustomThreshold] = useState(vehicle?.dueSoonRatio != null)
  const [percent, setPercent] = useState(
    vehicle?.dueSoonRatio != null ? Math.round(vehicle.dueSoonRatio * 100) : DEFAULT_PERCENT,
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    const trimmedName = name.trim()
    if (!trimmedName || trimmedName.length > 80) {
      setError(t('vehicle.invalidName'))
      return
    }
    const trimmedPlate = plateNumber.trim()
    if (trimmedPlate.length > 24) {
      setError(t('vehicle.invalidPlate'))
      return
    }
    if (!vehicle) return

    setSaving(true)
    setError(null)
    try {
      await updateVehicleDetails(accountId, vehicle.id, {
        name: trimmedName,
        plateNumber: trimmedPlate || null,
        dueSoonRatio: customThreshold ? percent / 100 : null,
      })
      onOpenChange(false)
      toast.success(t('vehicle.settingsSaved'))
    } catch {
      setError(t('vehicle.settingsSaveFailed'))
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
        <SheetTitle className="mx-0.5 text-[15px] font-semibold tracking-[-0.01em]">{t('vehicle.settingsTitle')}</SheetTitle>
        <SheetDescription className="mx-0.5 mt-0.5 text-xs leading-5">{t('vehicle.settingsDescription')}</SheetDescription>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vehicle-name">{t('vehicle.name')}</Label>
            <Input id="vehicle-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vehicle-plate">{t('vehicle.plate')}</Label>
            <Input id="vehicle-plate" value={plateNumber} onChange={(event) => setPlateNumber(event.target.value)} maxLength={24} />
          </div>

          <div className="mt-1 rounded-xl border border-border-subtle bg-card p-3.5">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t('vehicle.customThreshold')}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {customThreshold ? t('vehicle.customThresholdOn') : t('settings.remainingPercent', { value: DEFAULT_PERCENT })}
                </p>
              </div>
              <Switch checked={customThreshold} onCheckedChange={setCustomThreshold} aria-label={t('vehicle.customThreshold')} />
            </div>

            {customThreshold ? (
              <div className="mt-3">
                <div className="text-center text-xl font-bold tracking-[-0.02em]">{percent}%</div>
                <Slider
                  className="mt-3"
                  min={MIN_PERCENT}
                  max={MAX_PERCENT}
                  step={1}
                  value={[percent]}
                  onValueChange={([value]) => setPercent(value)}
                  aria-label={t('vehicle.customThreshold')}
                />
                <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
                  <span>{MIN_PERCENT}%</span>
                  <span>{MAX_PERCENT}%</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-primary font-display text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </SheetContent>
    </Sheet>
  )
}
