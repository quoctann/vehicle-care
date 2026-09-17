import { Navigate } from 'react-router-dom'
import { useVehicles } from '@/hooks/useVehicles'
import { getLastVehicleId } from '@/lib/lastVehicle'
import { useSessionStore } from '@/stores/useSessionStore'

/** "/" không phải 1 trang thật — luôn điều hướng sang xe dùng gần nhất hoặc màn thêm xe. */
export function RootRedirect() {
  const accountId = useSessionStore((state) => state.account?.id)
  const vehicles = useVehicles(accountId)
  if (vehicles === undefined || !accountId) return null

  const lastVehicleId = getLastVehicleId(accountId)
  const vehicleId = vehicles.some((vehicle) => vehicle.id === lastVehicleId) ? lastVehicleId : vehicles[0]?.id
  return <Navigate to={vehicleId ? `/v/${vehicleId}/home` : '/onboarding/add-vehicle'} replace />
}
