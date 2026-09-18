import { useState, type FormEvent } from 'react'
import { CarFront, ChevronLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createVehicle } from '@/data/repositories/vehicleRepository'
import { getLastVehicleId, setLastVehicleId } from '@/lib/lastVehicle'
import { useSessionStore } from '@/stores/useSessionStore'

export function AddVehiclePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const accountId = useSessionStore((state) => state.account?.id)
  const [name, setName] = useState('')
  const [plateNumber, setPlateNumber] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const previousVehicleId = accountId ? getLastVehicleId(accountId) : null

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const vehicleName = name.trim()
    if (!vehicleName) {
      setError(t('vehicle.nameRequired'))
      return
    }
    if (!accountId) {
      setError(t('vehicle.accountUnavailable'))
      return
    }

    setSaving(true)
    setError(null)
    try {
      const vehicle = await createVehicle({
        accountId,
        name: vehicleName,
        plateNumber: plateNumber.trim() || null,
      })
      setLastVehicleId(accountId, vehicle.id)
      navigate(`/v/${vehicle.id}/home`, { replace: true })
    } catch {
      setError(t('vehicle.addFailed'))
      setSaving(false)
    }
  }

  return (
    <main className="min-h-dvh px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:flex sm:items-center sm:justify-center sm:px-6">
      <div className="mx-auto w-full max-w-md">
        {previousVehicleId ? (
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mb-8 flex h-9 items-center gap-1 rounded-lg pr-3 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground sm:absolute sm:left-6 sm:top-6"
          >
            <ChevronLeft className="size-4" />
            {t('common.back')}
          </button>
        ) : null}

        <div className="flex size-12 items-center justify-center rounded-2xl border border-warn-border bg-warn-bg text-warn-fg shadow-[0_1px_1px_rgba(44,54,53,.025)]">
          <CarFront className="size-6" />
        </div>
        <h1 className="mt-6 text-[28px] font-bold leading-tight tracking-[-0.035em]">{t('vehicle.addTitle')}</h1>
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          {t('vehicle.addDescription')}
        </p>

        <form onSubmit={handleSubmit} className="mt-8 rounded-2xl border border-border-subtle bg-card p-5 shadow-sm">
          <div className="space-y-2">
            <Label htmlFor="vehicle-name">{t('vehicle.name')}</Label>
            <Input
              id="vehicle-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setError(null)
              }}
              autoComplete="off"
              autoFocus
              maxLength={80}
              placeholder={t('vehicle.namePlaceholder')}
              className="h-11 px-3"
            />
          </div>

          <div className="mt-5 space-y-2">
            <Label htmlFor="plate-number">
              {t('vehicle.plate')} <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
            </Label>
            <Input
              id="plate-number"
              value={plateNumber}
              onChange={(event) => setPlateNumber(event.target.value)}
              autoComplete="off"
              maxLength={24}
              placeholder={t('vehicle.platePlaceholder')}
              className="h-11 px-3 uppercase"
            />
          </div>

          {error ? (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            disabled={saving}
            className="mt-6 h-12 w-full rounded-xl bg-primary font-display text-sm text-primary-foreground hover:bg-primary/90"
          >
            {saving ? t('vehicle.adding') : t('vehicle.add')}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
          {t('vehicle.savedLocally')}
        </p>
      </div>
    </main>
  )
}
