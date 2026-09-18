export const UI_LOCALE = 'vi-VN'

const numberFormatter = new Intl.NumberFormat(UI_LOCALE)

export function formatNumber(value: number): string {
  return numberFormatter.format(value)
}

export function formatTime(value: string | Date, timezone?: string): string {
  return new Intl.DateTimeFormat(UI_LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(value))
}

export function formatDate(value: string | Date, timezone?: string): string {
  return new Intl.DateTimeFormat(UI_LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: timezone,
  }).format(new Date(value))
}

export function formatMonth(value: string | Date, style: 'long' | 'short' = 'long', timezone?: string): string {
  const isMonthKey = typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)
  const date = isMonthKey
    ? new Date(`${value}-01T00:00:00Z`)
    : new Date(value)
  return new Intl.DateTimeFormat(UI_LOCALE, {
    month: style,
    year: style === 'long' ? 'numeric' : undefined,
    timeZone: isMonthKey ? 'UTC' : timezone,
  }).format(date)
}
