import { describe, expect, it } from 'vitest';
import {
  ApiErrorCode,
  MutationResultStatus,
  SyncEntityType,
  SyncOperation,
} from './contract.types';
import {
  BootstrapState,
  OutboxFailureKind,
  OutboxStatus,
  SyncFailureKind,
  SyncOperation as WorkspaceOperation,
} from '@/data/db';

describe('closed sync vocabulary wire values', () => {
  it('preserves the six entity types, operations, statuses and API errors', () => {
    expect(Object.values(SyncEntityType)).toEqual([
      'vehicle',
      'reminder_config',
      'odometer_log',
      'fuel_log',
      'service_log',
      'part_type',
    ]);
    expect(Object.values(SyncOperation)).toEqual(['create', 'update']);
    expect(Object.values(MutationResultStatus)).toEqual([
      'applied',
      'duplicate',
      'rejected',
      'retryable_error',
    ]);
    expect(Object.values(ApiErrorCode)).toEqual([
      'auth_invalid',
      'session_expired',
      'validation_failed',
      'ownership_invalid',
      'rate_limited',
      'internal_error',
    ]);
  });

  it('preserves local persistence vocabulary including nullable failure classifications', () => {
    expect(Object.values(OutboxStatus)).toEqual(['pending', 'blocked']);
    expect(Object.values(OutboxFailureKind)).toEqual(['retryable', 'terminal']);
    expect(Object.values(BootstrapState)).toEqual(['empty', 'bootstrapping', 'ready']);
    expect(Object.values(WorkspaceOperation)).toEqual(['idle', 'restoring', 'restore_failed']);
    expect(Object.values(SyncFailureKind)).toEqual(['retryable', 'blocked', 'terminal']);
  });
});
