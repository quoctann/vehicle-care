export type TimezoneChoice = Readonly<{ value: string; label: string; offsetMinutes: number }>;

const OPTIONS: ReadonlyArray<readonly [number, string]> = [
  [-720, 'Baker Island'],
  [-660, 'American Samoa'],
  [-600, 'Hawaii'],
  [-570, 'Marquesas Islands'],
  [-540, 'Gambier Islands'],
  [-480, 'Pitcairn Islands'],
  [-420, 'Phoenix, Hermosillo'],
  [-360, 'Costa Rica, Guatemala'],
  [-300, 'Bogota, Lima'],
  [-240, 'Caracas, Santo Domingo'],
  [-210, 'Newfoundland'],
  [-180, 'Buenos Aires'],
  [-120, 'South Georgia'],
  [-60, 'Cape Verde'],
  [0, 'Accra, Reykjavik'],
  [60, 'Algiers, Lagos'],
  [120, 'Johannesburg, Harare'],
  [180, 'Nairobi, Addis Ababa'],
  [210, 'Tehran'],
  [240, 'Dubai, Baku'],
  [270, 'Kabul'],
  [300, 'Karachi, Tashkent'],
  [330, 'Mumbai, Colombo'],
  [345, 'Kathmandu'],
  [360, 'Dhaka, Almaty'],
  [390, 'Yangon'],
  [420, 'Bangkok, Hanoi, Jakarta'],
  [480, 'Beijing, Singapore, Manila'],
  [525, 'Eucla'],
  [540, 'Tokyo, Seoul'],
  [570, 'Darwin'],
  [600, 'Brisbane, Port Moresby'],
  [630, 'Fixed offset'],
  [660, 'Noumea, Solomon Islands'],
  [720, 'Nauru, Tarawa'],
  [765, 'Fixed offset'],
  [780, 'Tonga'],
  [825, 'Kiritimati'],
  [840, 'Line Islands'],
];

export function formatUtcOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

export const TIMEZONE_CHOICES: readonly TimezoneChoice[] = OPTIONS.map(([minutes, places]) => ({
  value: formatUtcOffset(minutes),
  label: `${formatUtcOffset(minutes)} — ${places}`,
  offsetMinutes: minutes,
}));

export function detectDeviceTimezone(): string | null {
  const offsetMinutes = -new Date().getTimezoneOffset();
  return TIMEZONE_CHOICES.find((choice) => choice.offsetMinutes === offsetMinutes)?.value ?? null;
}
