import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'
import { seedMockServer } from './seedData'

seedMockServer()

export const worker = setupWorker(...handlers)
