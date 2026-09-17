import { authHandlers } from './auth'
import { pullHandlers } from './pull'
import { pushHandlers } from './push'

export const handlers = [...authHandlers, ...pushHandlers, ...pullHandlers]
