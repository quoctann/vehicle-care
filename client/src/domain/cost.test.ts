import { describe, expect, it } from 'vitest';
import { isValidCost } from './cost';

describe('numeric(10,2) cost', () => {
  it('accepts zero, integer, cents and the maximum', () => {
    for (const cost of [0, 1, 85000, 1.25, 99999999.99]) expect(isValidCost(cost)).toBe(true);
  });

  it('rejects negatives, excess precision, overflow and non-finite values', () => {
    for (const cost of [-1, 0.001, 0.000000001, 99999999.991, 100000000, NaN, Infinity])
      expect(isValidCost(cost)).toBe(false);
  });
});
