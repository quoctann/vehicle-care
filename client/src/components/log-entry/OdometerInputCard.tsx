import { Gauge } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type OdometerInputCardProps = {
  value: string
  currentOdometerKm: number | null
  error?: string | null
  onChange: (value: string) => void
}

export function OdometerInputCard({ value, currentOdometerKm, error, onChange }: OdometerInputCardProps) {
  return (
    <section className="rounded-2xl border border-border-subtle bg-card p-4 shadow-[0_1px_1px_rgba(44,54,53,0.025)]">
      <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Gauge className="size-4 text-muted-foreground" aria-hidden="true" />
            <Label htmlFor="log-odometer" className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              Odometer
            </Label>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {currentOdometerKm == null ? 'No current reading' : `Current: ${currentOdometerKm.toLocaleString()} km`}
          </p>
        </div>
        <div className="flex items-baseline justify-end gap-2 sm:justify-start">
          <Input
            id="log-odometer"
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            placeholder="Optional"
            aria-invalid={Boolean(error)}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="h-11 w-32 text-right text-lg font-bold tabular-nums"
          />
          <span className="text-sm text-muted-foreground">km</span>
        </div>
      </div>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </section>
  )
}
