import { Temporal } from '@js-temporal/polyfill';
import { toRuntimeTimezone } from '@/domain/timezone';

/** Keep the account's minute-only date control separate from the precise event timestamp. */
export function toLocalDateTimeInput(date: Date, timezone: string = 'UTC'): string {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime())
    .toZonedDateTimeISO(toRuntimeTimezone(timezone))
    .toPlainDateTime()
    .toString({ smallestUnit: 'minute' });
}

/** Unchanged minutes retain precision; edits reject DST gaps and choose the earlier overlap. */
export function resolveLogEntryTimestamp(
  input: string,
  originalTimestamp: string,
  timezone: string = 'UTC',
): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) {
    throw new RangeError('Invalid datetime-local input');
  }
  const wallclock = Temporal.PlainDateTime.from(input, { overflow: 'reject' });
  if (input === toLocalDateTimeInput(new Date(originalTimestamp), timezone)) {
    return originalTimestamp;
  }
  const zoned = wallclock.toZonedDateTime(toRuntimeTimezone(timezone), {
    disambiguation: 'earlier',
  });
  if (!zoned.toPlainDateTime().equals(wallclock)) {
    throw new RangeError('The selected wallclock does not exist in this timezone');
  }
  return zoned.toInstant().toString({ fractionalSecondDigits: 3 });
}
