/**
 * Exact Fetch routes for the result card's Stop and Undo actions.
 *
 * Connection admits only the owner Peer on an exact route, so these handlers
 * assume an authenticated human at the Web GUI. The run store is the only
 * source of write targets; a request can select a recorded file but never
 * introduce a new path.
 *
 * @module dsh-doc-positivize/http
 */
import { RunError } from './runs'
import type { RunStore } from './runs'

/** State route for one run's card payload. */
export const STATE_ROUTE = '/api/doc-positivize.state'

/** Stop route for one running scan. */
export const CANCEL_ROUTE = '/api/doc-positivize.cancel'

/** Per-file restore route. */
export const UNDO_ROUTE = '/api/doc-positivize.undo'

/** One exact Fetch route as Connection accepts it. */
export interface FetchRoute {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: 'buffered' | 'streaming'
  readonly fetch: (request: Request) => Promise<Response>
}

/** The Connection surface this module registers into. */
export interface RouteContext {
  readonly connection: {
    readonly fetch: {
      register(route: FetchRoute): () => void
    }
  }
}

/** A request refusal owned by this module. */
class HttpError extends Error {
  readonly status: number
  readonly code: string

  /**
   * @param status - HTTP status.
   * @param code - stable client-facing code.
   * @param message - human-facing detail.
   */
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

/** Render one JSON response with the card's no-store policy. */
function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** Read one JSON object body, refusing malformed or non-object payloads. */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  let value: unknown
  try {
    value = await request.json()
  } catch {
    throw new HttpError(400, 'invalid-body', 'the request body must be JSON')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'invalid-body', 'the request body must be a JSON object')
  }
  return value as Record<string, unknown>
}

/** Read one non-empty string field. */
function stringField(body: Record<string, unknown>, name: string, maxLength: number): string {
  const value = body[name]
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new HttpError(400, 'invalid-body', `${name} must be a non-empty string`)
  }
  return value
}

/** Contain every failure as one JSON response the card can read. */
function handled(handler: (request: Request) => Promise<Response>): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      return await handler(request)
    } catch (error) {
      if (error instanceof HttpError) return jsonResponse({ error: error.message, code: error.code }, error.status)
      if (error instanceof RunError) return jsonResponse({ error: error.message, code: error.code }, error.status)
      return jsonResponse(
        { error: error instanceof Error ? error.message : 'unexpected error', code: 'internal' },
        500,
      )
    }
  }
}

/**
 * Register the three exact routes inside Connection's authentication fence.
 *
 * @param ctx - Host context that reads the Connection service.
 * @param runs - run registry shared with the command.
 * @returns a disposer for the three registrations.
 */
export function registerRunRoutes(ctx: RouteContext, runs: RunStore): () => void {
  const disposers = [
    ctx.connection.fetch.register({
      path: STATE_ROUTE,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: handled(async (request) => {
        const runId = new URL(request.url).searchParams.get('runId')
        if (runId === null || runId.length === 0 || runId.length > 200) {
          throw new HttpError(400, 'invalid-run', 'runId is required')
        }
        const view = runs.view(runId)
        if (view === undefined) throw new HttpError(404, 'run-not-found', 'the scan result is no longer available')
        return jsonResponse(view)
      }),
    }),
    ctx.connection.fetch.register({
      path: CANCEL_ROUTE,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: handled(async (request) => {
        const body = await readBody(request)
        const runId = stringField(body, 'runId', 200)
        return jsonResponse({ run: runs.cancel(runId) })
      }),
    }),
    ctx.connection.fetch.register({
      path: UNDO_ROUTE,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: handled(async (request) => {
        const body = await readBody(request)
        const runId = stringField(body, 'runId', 200)
        const path = stringField(body, 'path', 4096)
        return jsonResponse({ run: runs.undo(runId, path) })
      }),
    }),
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
}
