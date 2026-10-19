import { defineConfig, mergeConfig } from 'vitest/config';
import vitestConfig from './vitest.config.ts';

/** Coverage gate for the contract/persistence logic changed by this cleanup. */
export default mergeConfig(
  vitestConfig,
  defineConfig({
    test: {
      coverage: {
        provider: 'v8',
        include: [
          'src/api/contract.types.ts',
          'src/data/db.ts',
          'src/data/entityTable.ts',
          'src/data/mappers.ts',
          'src/data/outbox.ts',
          'src/sync/push.ts',
        ],
        thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  }),
);
