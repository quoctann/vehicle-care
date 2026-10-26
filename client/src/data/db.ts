import Dexie, { type Table } from 'dexie';
import type { SyncEntityType, SyncOperation as WireSyncOperation } from '@/api/contract.types';
import type {
  FuelLog,
  IanaTimezone,
  IsoDateTime,
  OdometerLog,
  PartType,
  ReminderConfig,
  ServiceLog,
  Vehicle,
} from '@/domain/types';

/**
 * Cấu trúc local-only — KHÔNG thuộc domain entity, KHÔNG có trong API contract
 * (đây là sổ sách nội bộ của client để biết mình cần push/pull gì).
 */

export type OutboxEntityType = SyncEntityType;
export type OutboxOperation = WireSyncOperation;
export const OutboxStatus = { Pending: 'pending', Blocked: 'blocked' } as const;
export type OutboxStatus = (typeof OutboxStatus)[keyof typeof OutboxStatus];
export const OutboxFailureKind = { Retryable: 'retryable', Terminal: 'terminal' } as const;
export type OutboxFailureKind = (typeof OutboxFailureKind)[keyof typeof OutboxFailureKind];

/**
 * 1 dòng outbox = 1 lần thao tác cần đẩy lên server (không phải 1 entity — 1 entity
 * mutable có thể có nhiều outbox row theo thời gian). `mutationId` khác `entityId`:
 * `entityId` ổn định suốt vòng đời entity, `mutationId` mới mỗi lần ghi.
 */
export type OutboxItem = {
  mutationId: string;
  accountId: string;
  localSeq: number;
  entityType: OutboxEntityType;
  operation: OutboxOperation;
  entityId: string;
  /** Persisted snapshots include historical/repair data, not necessarily current typed payloads.
   * Keep this boundary unknown; enqueueMutation checks new envelopes at compile time. */
  payload: unknown;
  /** Revision used to build this envelope. It must not be read again during retry. */
  baseServerSeq: number | null;
  status: OutboxStatus;
  retryCount: number;
  lastError: string | null;
  failureKind: OutboxFailureKind | null;
  createdAt: IsoDateTime;
};

export const BootstrapState = {
  Empty: 'empty',
  Bootstrapping: 'bootstrapping',
  Ready: 'ready',
} as const;

export type BootstrapState = (typeof BootstrapState)[keyof typeof BootstrapState];

export const SyncOperation = {
  Idle: 'idle',
  Restoring: 'restoring',
  RestoreFailed: 'restore_failed',
} as const;

export type SyncOperation = (typeof SyncOperation)[keyof typeof SyncOperation];

export const SyncFailureKind = {
  Retryable: 'retryable',
  Blocked: 'blocked',
  Terminal: 'terminal',
} as const;

export type SyncFailureKind = (typeof SyncFailureKind)[keyof typeof SyncFailureKind] | null;

/** 1 dòng mỗi account, sống cùng Dexie DB với entity/outbox để commit cursor atomically. */
export type SyncMeta = {
  accountId: string;
  deviceId: string;
  lastSeenSeq: number;
  nextLocalSeq: number;
  operation: SyncOperation;
  lastSyncedAt: IsoDateTime | null;
  lastSyncError: string | null;
  lastSyncFailureKind: SyncFailureKind;
  bootstrapState: BootstrapState;
};

/**
 * Snapshot profile để hiển thị offline — KHÔNG chứa token/session id. Session thật
 * là cookie httpOnly do trình duyệt quản lý, JS không đọc/lưu được (và không cần).
 */
export type AccountCache = {
  id: 'current';
  accountId: string;
  email: string;
  name: string | null;
  timezone: IanaTimezone;
  emailVerified: boolean;
  deviceId: string;
  cachedAt: IsoDateTime;
};

class VehicleMaintenanceDb extends Dexie {
  vehicles!: Table<Vehicle, string>;
  partTypes!: Table<PartType, string>;
  reminderConfigs!: Table<ReminderConfig, string>;
  odometerLogs!: Table<OdometerLog, string>;
  fuelLogs!: Table<FuelLog, string>;
  serviceLogs!: Table<ServiceLog, string>;
  outbox!: Table<OutboxItem, string>;
  syncMeta!: Table<SyncMeta, string>;
  accountCache!: Table<AccountCache, string>;

  constructor() {
    super('vehicle-maintenance');

    this.version(1).stores({
      vehicles: 'id, accountId, archivedAt, deletedAt',
      partTypes: 'id, &[accountId+code], active, accountId',
      reminderConfigs: 'id, accountId, vehicleId, [vehicleId+partTypeId], deletedAt',
      odometerLogs: 'id, accountId, vehicleId, [vehicleId+recordedAt]',
      fuelLogs: 'id, accountId, vehicleId, deletedAt',
      serviceLogs: 'id, accountId, vehicleId, [vehicleId+partTypeId+servicedAt], deletedAt',
      outbox:
        'mutationId, entityId, accountId, status, localSeq, [accountId+localSeq], [accountId+status+localSeq]',
      syncMeta: 'accountId',
      accountCache: 'id',
    });
  }
}

export const db = new VehicleMaintenanceDb();
