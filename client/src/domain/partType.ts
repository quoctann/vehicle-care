import type { PartType } from './types'

export type PartTypeDisplay = {
  displayName: string
  icon: PartTypeIconKey
  isKnown: boolean
}

/**
 * Icon key UI-only (map sang lucide-react ở `components/`) — KHÔNG phải domain
 * enum đóng cứng, chỉ dùng để chọn hình minh hoạ hợp lý cho part type đã biết.
 */
export type PartTypeIconKey =
  | 'engine_oil'
  | 'front_tire'
  | 'rear_tire'
  | 'front_brake_pad'
  | 'rear_brake_pad'
  | 'spark_plug'
  | 'air_filter'
  | 'drive_belt'
  | 'chain_sprocket_set'
  | 'battery'
  | 'unknown'

/**
 * C3: client phải xử lý được PartType "lạ" (chưa biết, do server thêm sau) một
 * cách graceful — dùng code + tên hiển thị nhận được, không throw/crash vì thiếu
 * trong enum đóng cứng.
 */
export function resolvePartTypeDisplay(code: string, knownPartTypes: PartType[]): PartTypeDisplay {
  const found = knownPartTypes.find((p) => p.code === code)
  if (!found) {
    return { displayName: code, icon: 'unknown', isKnown: false }
  }
  const icon: PartTypeIconKey = isKnownIconKey(found.code) ? found.code : 'unknown'
  return { displayName: found.displayName, icon, isKnown: true }
}

function isKnownIconKey(code: string): code is PartTypeIconKey {
  return (
    code === 'engine_oil' ||
    code === 'front_tire' ||
    code === 'rear_tire' ||
    code === 'front_brake_pad' ||
    code === 'rear_brake_pad' ||
    code === 'spark_plug' ||
    code === 'air_filter' ||
    code === 'drive_belt' ||
    code === 'chain_sprocket_set' ||
    code === 'battery'
  )
}
