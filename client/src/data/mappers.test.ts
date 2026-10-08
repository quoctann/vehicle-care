import { describe, expect, it } from 'vitest';
import {
  fuelLogFieldsFromPayload,
  partTypeFieldsFromPayload,
  serviceLogFieldsFromPayload,
} from './mappers';

describe('sync payload contract', () => {
  it('reads part type name without legacy seed metadata', () => {
    expect(
      partTypeFieldsFromPayload({ code: 'oil', name: 'Dầu nhớt', display_order: 1, active: true }),
    ).toEqual({ code: 'oil', displayName: 'Dầu nhớt', displayOrder: 1, active: true });
  });

  it('reads decimal cost and rejects values beyond numeric(10,2)', () => {
    const fuel = { vehicle_id: 'vehicle', recorded_at: '2026-01-01T00:00:00Z', cost: 12.34 };
    const service = {
      vehicle_id: 'vehicle',
      part_type_id: 'oil',
      serviced_at: '2026-01-01T00:00:00Z',
      cost: 99999999.99,
    };
    expect(fuelLogFieldsFromPayload(fuel).cost).toBe(12.34);
    expect(serviceLogFieldsFromPayload(service).cost).toBe(99999999.99);
    expect(() => fuelLogFieldsFromPayload({ ...fuel, cost: 12.345 })).toThrow('cost');
    expect(() => serviceLogFieldsFromPayload({ ...service, cost: 100000000 })).toThrow('cost');
  });
});
