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
  const partTypes = usePartTypes()
  const editingEntry = useLiveQuery<EditingLogEntry | null>(async () => {
    if (!kind || !entryId) return null
    if (kind === 'fuel') {
      const log = await db.fuelLogs.get(entryId)
      return log ? { kind: 'fuel', log } : null
    }
    const log = await db.serviceLogs.get(entryId)
    return log ? { kind: 'service', log } : null
  }, [kind, entryId])

  if (!vehicleId || !accountId) return <Navigate to="/" replace />
  if (kind && entryId && editingEntry === null) return <Navigate to={`/v/${vehicleId}/history`} replace />

  const isEditing = Boolean(kind && entryId)
  const backPath = isEditing ? `/v/${vehicleId}/history` : `/v/${vehicleId}/home`
  const availablePartTypes: PartType[] = partTypes ?? []
  const activePartTypes = availablePartTypes
    .filter((partType) => partType.active)
    .sort((a, b) => a.displayOrder - b.displayOrder)

  return (
    <LogEntryForm
      accountId={accountId}
      vehicleId={vehicleId}
      currentOdometerKm={currentOdometerKm}
      partTypes={activePartTypes}
      editingEntry={editingEntry ?? null}
      onCancel={() => navigate(backPath)}
      onSaved={() => navigate(backPath, { replace: true })}
    />
  )
}
