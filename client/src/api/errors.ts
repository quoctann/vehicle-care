import type { ApiErrorBody, ApiErrorCode } from './contract.types'

export class ApiError extends Error {
  code: ApiErrorCode
  retryable: boolean
  requestId: string
  status: number

  constructor(body: ApiErrorBody, status: number) {
    super(body.error.message)
    this.name = 'ApiError'
    this.code = body.error.code
    this.retryable = body.error.retryable
    this.requestId = body.error.request_id
    this.status = status
  }
}

/** D6: mọi lỗi 4xx/5xx trả cùng envelope `{ error: {...} }` — parse thống nhất ở đây. */
export async function parseApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody
    return new ApiError(body, response.status)
  } catch {
    return new ApiError(
      {
        error: {
          code: 'internal_error',
          message: response.statusText || 'Unknown error',
          retryable: response.status >= 500,
          request_id: 'unknown',
        },
      },
      response.status,
    )
  }
}
