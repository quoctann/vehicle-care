// Compiled by tsconfig.app.json (and `npm run build`), never executed.
import type { PullChange, PushMutation, SyncPayloadMap } from './contract.types';
import { enqueueMutation } from '@/data/outbox';
import { vehicleToPayload } from '@/data/mappers';
import type { Vehicle } from '@/domain/types';

export function contractTypeChecks(vehicle: Vehicle, payloads: SyncPayloadMap) {
  const base = { mutation_id: 'm', entity_id: 'e', operation: 'create' as const };
  const valid: PushMutation = {
    ...base,
    entity_type: 'vehicle',
    payload: vehicleToPayload(vehicle),
  };
  // @ts-expect-error vehicle mutations cannot carry fuel snapshots
  const wrongPayload: PushMutation = {
    ...base,
    entity_type: 'vehicle',
    payload: payloads.fuel_log,
  };
  // @ts-expect-error append-only odometer mutations cannot update
  const odometerUpdate: PushMutation = {
    ...base,
    entity_type: 'odometer_log',
    operation: 'update',
    payload: payloads.odometer_log,
  };
  // @ts-expect-error full snapshots require name
  const missingName: PushMutation = { ...base, entity_type: 'vehicle', payload: {} };
  // @ts-expect-error closed entity vocabulary
  const unknownEntity: PushMutation = { ...base, entity_type: 'typo', payload: payloads.vehicle };
  // @ts-expect-error pull discriminant must agree with payload
  const wrongPull: PullChange = {
    server_seq: 1,
    entity_id: 'e',
    server_synced_at: '',
    operation: 'create',
    entity_type: 'part_type',
    payload: payloads.vehicle,
  };
  // @ts-expect-error pull odometers are also create-only
  const wrongPullOperation: PullChange = {
    server_seq: 1,
    entity_id: 'e',
    server_synced_at: '',
    operation: 'update',
    entity_type: 'odometer_log',
    payload: payloads.odometer_log,
  };
  // @ts-expect-error focused enqueue API cannot mismatch entity and payload
  void enqueueMutation({
    accountId: 'a',
    entityId: 'e',
    entityType: 'vehicle',
    operation: 'create',
    payload: payloads.part_type,
  });
  // @ts-expect-error focused enqueue API cannot update append-only odometers
  void enqueueMutation({
    accountId: 'a',
    entityId: 'e',
    entityType: 'odometer_log',
    operation: 'update',
    payload: payloads.odometer_log,
  });
  // Part catalog codes intentionally remain open (seed and custom UUID codes).
  const customCode: SyncPayloadMap['part_type'] = {
    code: '任意-🔧',
    name: 'Custom',
    display_order: 999,
    active: true,
  };
  if (valid.entity_type === 'vehicle') {
    const name: string = valid.payload.name;
    // @ts-expect-error narrowing does not expose fuel fields
    const liters = valid.payload.liters;
    void [name, liters];
  }
  return [
    valid,
    wrongPayload,
    odometerUpdate,
    missingName,
    unknownEntity,
    wrongPull,
    wrongPullOperation,
    customCode,
  ];
}
