/** PostgreSQL numeric(10,2): no negative values, at most 8 integer and 2 fractional digits. */
export function isValidCost(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 99999999.99 &&
    value === Math.round(value * 100) / 100
  );
}
