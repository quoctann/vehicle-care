import { useState, type FormEvent } from 'react'
import { CarFront, ChevronLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createVehicle } from '@/data/repositories/vehicleRepository'
import { getLastVehicleId, setLastVehicleId } from '@/lib/lastVehicle'
import { useSessionStore } from '@/stores/useSessionStore'

export function AddVehiclePage() {
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
      setError('Enter a name for your vehicle.')
      return
    }
    if (!accountId) {
      setError('Your account is not available. Sign in again and retry.')
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
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not add this vehicle.')
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
            Back
          </button>
        ) : null}

        <div className="flex size-12 items-center justify-center rounded-2xl border border-warn-border bg-warn-bg text-warn-fg shadow-[0_1px_1px_rgba(44,54,53,.025)]">
          <CarFront className="size-6" />
        </div>
        <h1 className="mt-6 text-[28px] font-bold leading-tight tracking-[-0.035em]">Add a vehicle</h1>
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          Give it a recognizable name. You can add the plate now or leave it blank.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 rounded-2xl border border-border-subtle bg-card p-5 shadow-[0_1px_2px_rgba(2,6,23,.05),inset_0_0_0_2px_#fff]">
          <div className="space-y-2">
            <Label htmlFor="vehicle-name">Vehicle name</Label>
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
              placeholder="e.g. Honda City 2021"
              className="h-11 px-3"
            />
          </div>

          <div className="mt-5 space-y-2">
            <Label htmlFor="plate-number">
              Plate number <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="plate-number"
              value={plateNumber}
              onChange={(event) => setPlateNumber(event.target.value)}
              autoComplete="off"
              maxLength={24}
              placeholder="e.g. 51H-482.19"
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
            className="mt-6 h-12 w-full rounded-xl bg-gradient-to-b from-[#2c2c2c] to-[#141414] font-display text-sm text-white hover:opacity-90"
          >
            {saving ? 'Adding vehicle...' : 'Add vehicle'}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
          The vehicle is saved on this device first and queued for sync.
        </p>
      </div>
    </main>
  )
}
