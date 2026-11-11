import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CANCEL_ROUTE, registerRunRoutes, STATE_ROUTE, UNDO_ROUTE } from '../src/http'
import type { FetchRoute, RouteContext } from '../src/http'
import { RunStore } from '../src/runs'
import type { SweepResult } from '../src/sweep'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'doc-positivize-http-'))
  tempDirs.push(dir)
  writeFileSync(join(dir, 'README.md'), 'Use the shared client.\n')
  return dir
}

function result(cwd: string): SweepResult {
  return {
    scope: 'README.md',
    scanned: 1,
    candidates: 1,
    changedFiles: 1,
    cancelled: false,
    changes: [{ path: 'README.md', line: 1, action: 'rewrite', original: 'Do not use it.', change: 'Use the shared client.' }],
    diffs: [
      {
        path: 'README.md',
        absolutePath: join(cwd, 'README.md'),
        diff: '@@ -1,1 +1,1 @@\n-Do not use it.\n+Use the shared client.',
        before: 'Do not use it.\n',
        after: 'Use the shared client.\n',
        added: 1,
        deleted: 1,
      },
    ],
    skipped: [],
    remaining: [],
    notes: [],
  }
}

function setup(): {
  store: RunStore
  routes: Map<string, FetchRoute>
  dispose: () => void
  cwd: string
} {
  const cwd = workspace()
  const routes = new Map<string, FetchRoute>()
  const ctx: RouteContext = {
    connection: {
      fetch: {
        register(route) {
          routes.set(route.path, route)
          return () => {
            routes.delete(route.path)
          }
        },
      },
    },
  }
  const store = new RunStore()
  const dispose = registerRunRoutes(ctx, store)
  return { store, routes, dispose, cwd }
}

function stateRequest(runId: string): Request {
  return new Request(`http://localhost${STATE_ROUTE}?runId=${encodeURIComponent(runId)}`)
}

function postRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

describe('registerRunRoutes', () => {
  it('registers the three exact routes and disposes them', () => {
    const { routes, dispose } = setup()
    expect([...routes.keys()].sort()).toEqual([CANCEL_ROUTE, STATE_ROUTE, UNDO_ROUTE].sort())
    expect(routes.get(STATE_ROUTE)?.methods).toEqual(['GET'])
    expect(routes.get(CANCEL_ROUTE)?.methods).toEqual(['POST'])
    expect(routes.get(UNDO_ROUTE)?.methods).toEqual(['POST'])
    expect(routes.get(UNDO_ROUTE)?.requestBody).toBe('buffered')

    dispose()
    expect(routes.size).toBe(0)
  })

  it('serves one run and refuses an unknown id', async () => {
    const { store, routes, cwd } = setup()
    store.begin({ runId: 'run-1', sessionId: 'session-1', cwd, target: 'README.md', controller: new AbortController() })
    store.complete('run-1', result(cwd))

    const response = await routes.get(STATE_ROUTE)!.fetch(stateRequest('run-1'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const view = await bodyOf(response)
    expect(view.status).toBe('done')
    expect((view.files as { path: string }[])[0].path).toBe('README.md')

    const missing = await routes.get(STATE_ROUTE)!.fetch(stateRequest('missing'))
    expect(missing.status).toBe(404)
    expect(await bodyOf(missing)).toMatchObject({ code: 'run-not-found' })
  })

  it('returns 400 for a missing state run id', async () => {
    const { routes } = setup()
    const response = await routes.get(STATE_ROUTE)!.fetch(new Request(`http://localhost${STATE_ROUTE}`))
    expect(response.status).toBe(400)
    expect(await bodyOf(response)).toMatchObject({ code: 'invalid-run' })
  })

  it('cancels a running scan and is idempotent after settlement', async () => {
    const { store, routes, cwd } = setup()
    const controller = new AbortController()
    store.begin({ runId: 'run-1', sessionId: 'session-1', cwd, target: 'README.md', controller })
    const response = await routes.get(CANCEL_ROUTE)!.fetch(postRequest(CANCEL_ROUTE, { runId: 'run-1' }))
    expect(response.status).toBe(200)
    expect(controller.signal.aborted).toBe(true)
    expect((await bodyOf(response)).run).toMatchObject({ cancelling: true })

    store.complete('run-1', { ...result(cwd), cancelled: true, changedFiles: 0, diffs: [] })
    const settled = await routes.get(CANCEL_ROUTE)!.fetch(postRequest(CANCEL_ROUTE, { runId: 'run-1' }))
    expect(settled.status).toBe(200)
    expect((await bodyOf(settled)).run).toMatchObject({ status: 'cancelled' })
  })

  it('restores a file and refuses malformed or conflicting requests', async () => {
    const { store, routes, cwd } = setup()
    store.begin({ runId: 'run-1', sessionId: 'session-1', cwd, target: 'README.md', controller: new AbortController() })
    store.complete('run-1', result(cwd))

    const restored = await routes.get(UNDO_ROUTE)!.fetch(postRequest(UNDO_ROUTE, { runId: 'run-1', path: 'README.md' }))
    expect(restored.status).toBe(200)
    expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('Do not use it.\n')
    expect((await bodyOf(restored)).run).toMatchObject({ changedFiles: 0 })

    const malformed = await routes.get(UNDO_ROUTE)!.fetch(
      new Request(`http://localhost${UNDO_ROUTE}`, { method: 'POST', body: 'not json' }),
    )
    expect(malformed.status).toBe(400)
    expect(await bodyOf(malformed)).toMatchObject({ code: 'invalid-body' })

    const unknownFile = await routes.get(UNDO_ROUTE)!.fetch(
      postRequest(UNDO_ROUTE, { runId: 'run-1', path: 'other.md' }),
    )
    expect(unknownFile.status).toBe(404)
    expect(await bodyOf(unknownFile)).toMatchObject({ code: 'file-not-found' })

    const unknownRun = await routes.get(UNDO_ROUTE)!.fetch(
      postRequest(UNDO_ROUTE, { runId: 'missing', path: 'README.md' }),
    )
    expect(unknownRun.status).toBe(404)
    expect(await bodyOf(unknownRun)).toMatchObject({ code: 'run-not-found' })
  })

  it('returns 409 when the file changed after the scan', async () => {
    const { store, routes, cwd } = setup()
    store.begin({ runId: 'run-1', sessionId: 'session-1', cwd, target: 'README.md', controller: new AbortController() })
    store.complete('run-1', result(cwd))
    writeFileSync(join(cwd, 'README.md'), 'manual edit\n')

    const response = await routes.get(UNDO_ROUTE)!.fetch(
      postRequest(UNDO_ROUTE, { runId: 'run-1', path: 'README.md' }),
    )
    expect(response.status).toBe(409)
    expect(await bodyOf(response)).toMatchObject({ code: 'file-changed' })
    expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('manual edit\n')
  })
})
