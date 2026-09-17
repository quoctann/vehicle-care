import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { LogEntryForm } from '@/components/log-entry/LogEntryForm'
import { usePartTypes } from '@/hooks/usePartTypes'
import { useCurrentOdometer } from '@/hooks/useReminders'
import { useSessionStore } from '@/stores/useSessionStore'
import type { PartType } from '@/domain/types'

export function LogEntryPage() {
  const navigate = useNavigate()
  const { vehicleId } = useParams<{ vehicleId: string }>()
  const accountId = useSessionStore((state) => state.account?.id)
  const currentOdometerKm = useCurrentOdometer(accountId, vehicleId)
  const partTypes = usePartTypes()

  if (!vehicleId || !accountId) return <Navigate to="/" replace />

  const homePath = `/v/${vehicleId}/home`
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
      onCancel={() => navigate(homePath)}
      onSaved={() => navigate(homePath, { replace: true })}
    />
  )
}
