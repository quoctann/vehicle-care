import { useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createReminderConfig } from '@/data/repositories/reminderRepository'
import type { PartType } from '@/domain/types'

type ReminderEditorProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: string
  vehicleId: string
  currentOdometerKm: number | null
  partTypes: PartType[]
  configuredPartTypeIds: Set<string>
}

function positiveNumber(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function nonNegativeNumber(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function ReminderEditor({
  open,
  onOpenChange,
  accountId,
  vehicleId,
  currentOdometerKm,
  partTypes,
  configuredPartTypeIds,
}: ReminderEditorProps) {
  const availablePartTypes = partTypes.filter((partType) => partType.active && !configuredPartTypeIds.has(partType.id))
  const [partTypeId, setPartTypeId] = useState(availablePartTypes[0]?.id ?? '')
  const [intervalKm, setIntervalKm] = useState('')
  const [intervalDays, setIntervalDays] = useState('')
  const [baselineKm, setBaselineKm] = useState(currentOdometerKm == null ? '' : String(currentOdometerKm))
  const [baselineDate, setBaselineDate] = useState(new Date().toISOString().slice(0, 10))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    const km = positiveNumber(intervalKm)
    const days = positiveNumber(intervalDays)
    const startKm = nonNegativeNumber(baselineKm)

    if (!partTypeId) return setError('Choose a part to maintain.')
    if (km == null && days == null) return setError('Enter a positive distance or day interval.')
    if (km != null && startKm == null) return setError('A starting odometer is required for a distance reminder.')
    if (days != null && !baselineDate) return setError('A starting date is required for a time reminder.')

    setSaving(true)
    setError(null)
    try {
      await createReminderConfig({
        accountId,
        vehicleId,
        partTypeId,
        intervalKm: km,
        intervalDays: days,
        baselineOdometerKm: km == null ? null : startKm,
        baselineDate: days == null ? null : baselineDate,
      })
      toast.success('Reminder added.')
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add reminder.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add maintenance reminder</DialogTitle>
          <DialogDescription>Set a distance interval, a time interval, or both. No manufacturer value is filled automatically.</DialogDescription>
        </DialogHeader>

        {availablePartTypes.length === 0 ? (
          <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">Every available part already has a reminder.</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-reminder-part">Part</Label>
              <Select value={partTypeId} onValueChange={setPartTypeId}>
                <SelectTrigger id="new-reminder-part" className="w-full"><SelectValue placeholder="Choose a part" /></SelectTrigger>
                <SelectContent>
                  {availablePartTypes.map((partType) => <SelectItem key={partType.id} value={partType.id}>{partType.displayName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-reminder-km">Every kilometres</Label>
                <Input id="new-reminder-km" type="number" min="1" inputMode="numeric" value={intervalKm} onChange={(event) => setIntervalKm(event.target.value)} placeholder="e.g. 5000" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-reminder-days">Every days</Label>
                <Input id="new-reminder-days" type="number" min="1" inputMode="numeric" value={intervalDays} onChange={(event) => setIntervalDays(event.target.value)} placeholder="e.g. 180" />
              </div>
              {intervalKm ? (
                <div className="space-y-2">
                  <Label htmlFor="new-reminder-baseline-km">Starting odometer</Label>
                  <Input id="new-reminder-baseline-km" type="number" min="0" inputMode="numeric" value={baselineKm} onChange={(event) => setBaselineKm(event.target.value)} />
                </div>
              ) : null}
              {intervalDays ? (
                <div className="space-y-2">
                  <Label htmlFor="new-reminder-baseline-date">Starting date</Label>
                  <Input id="new-reminder-baseline-date" type="date" value={baselineDate} onChange={(event) => setBaselineDate(event.target.value)} />
                </div>
              ) : null}
            </div>
          </div>
        )}

        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving || availablePartTypes.length === 0}>{saving ? 'Adding...' : 'Add reminder'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
