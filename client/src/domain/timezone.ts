/** Parse canonical storage offsets; legacy timezone IDs return null unchanged. */
export function parseUtcOffsetMinutes(timezone: string): number | null {
  if (!timezone.startsWith('UTC') || timezone === 'UTC') return null;
  const match = /^UTC([+-])(\d{2}):(\d{2})$/.exec(timezone);
  if (!match) throw new RangeError('Invalid canonical UTC offset');
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  const signedMinutes = match[1] === '-' ? -minutes : minutes;
  if (
    Number(match[3]) > 59 ||
    signedMinutes < -720 ||
    signedMinutes > 840 ||
    (match[1] === '-' && minutes === 0)
  ) {
    throw new RangeError('Invalid canonical UTC offset');
  }
  return signedMinutes;
}

/** Intl and Temporal accept ±HH:MM, not the stored UTC±HH:MM prefix. */
export function toRuntimeTimezone(timezone: string): string {
  return parseUtcOffsetMinutes(timezone) === null ? timezone : timezone.slice(3);
}
