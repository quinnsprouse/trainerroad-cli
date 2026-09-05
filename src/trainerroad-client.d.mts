export class HttpError extends Error {
  readonly status: number
  readonly statusText: string
  readonly path: string
  readonly payload?: unknown
  constructor(
    message: string,
    options: { status: number; statusText: string; path: string; payload?: unknown },
  )
}
export function isHttpStatus(error: unknown, status: number): error is HttpError
