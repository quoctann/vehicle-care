import { setupServer } from 'msw/node'
import { handlers } from './handlers'

/** Dùng trong vitest (không phải browser) — xem `vitest.setup.ts`. */
export const server = setupServer(...handlers)
