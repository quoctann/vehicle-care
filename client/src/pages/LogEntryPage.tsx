import { useLiveQuery } from 'dexie-react-hooks'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { LogEntryForm, type EditingLogEntry } from '@/components/log-entry/LogEntryForm'
import { db } from '@/data/db'
import { usePartTypes } from '@/hooks/usePartTypes'
import { useCurrentOdometer } from '@/hooks/useReminders'
import { useSessionStore } from '@/stores/useSessionStore'
import type { PartType } from '@/domain/types'

export function LogEntryPage() {
  const navigate = useNavigate()
  const { vehicleId, kind, entryId } = useParams<{ vehicleId: string; kind?: 'fuel' | 'service'; entryId?: string }>()
  const accountId = useSessionStore((state) => state.account?.id)
  const currentOdometerKm = useCurrentOdometer(accountId, vehicleId)
  const partTypes = usePartTypes(accountId)
  const editingEntry = useLiveQuery<EditingLogEntry | null>(async () => {
    if (!kind || !entryId || !accountId) return null
    if (kind === 'fuel') {
      const log = await db.fuelLogs.get(entryId)
      return log?.accountId === accountId && log.vehicleId === vehicleId ? { kind: 'fuel', log } : null
    }
    const log = await db.serviceLogs.get(entryId)
    return log?.accountId === accountId && log.vehicleId === vehicleId ? { kind: 'service', log } : null
  }, [accountId, vehicleId, kind, entryId])

  if (!vehicleId || !accountId) return <Navigate to="/" replace />
  if (kind && entryId && editingEntry === null) return <Navigate to={`/v/${vehicleId}/history`} replace />

  const isEditing = Boolean(kind && entryId)
  const backPath = isEditing ? `/v/${vehicleId}/history` : `/v/${vehicleId}/home`
  const availablePartTypes: PartType[] = partTypes ?? []
  const editingPartTypeId = editingEntry?.kind === 'service' ? editingEntry.log.partTypeId : null
  const selectablePartTypes = availablePartTypes
    .filter((partType) => partType.active || partType.id === editingPartTypeId)
    .sort((a, b) => a.displayOrder - b.displayOrder)

  return (
    <LogEntryForm
      accountId={accountId}
      vehicleId={vehicleId}
      currentOdometerKm={currentOdometerKm}
      partTypes={selectablePartTypes}
      editingEntry={editingEntry ?? null}
      onCancel={() => navigate(backPath)}
      onSaved={() => navigate(backPath, { replace: true })}
    />
  )
}
