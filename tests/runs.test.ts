import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunError, RunStore } from '../src/runs'
import type { SweepResult } from '../src/sweep'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function workspace(files: Record<string, string> = { 'README.md': 'Use the shared client.\n' }): string {
  const dir = mkdtempSync(join(tmpdir(), 'positivize-runs-'))
  tempDirs.push(dir)
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  return dir
}

function completedResult(cwd: string, options: Partial<SweepResult> = {}): SweepResult {
  const before = 'Do not use it.\n'
  const after = 'Use the shared client.\n'
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
        before,
        after,
        added: 1,
        deleted: 1,
      },
    ],
    skipped: [],
    remaining: [],
    notes: [],
    ...options,
  }
}

function beginRun(store: RunStore, runId: string, cwd: string): AbortController {
  const controller = new AbortController()
  store.begin({ runId, sessionId: 'session-1', cwd, target: 'README.md', controller })
  return controller
}

function completedRun(store: RunStore, runId: string, cwd: string, result = completedResult(cwd)): void {
  beginRun(store, runId, cwd)
  store.complete(runId, result)
}

function expectRunError(action: () => unknown, code: string, status: number): void {
  try {
    action()
    throw new Error('expected a RunError')
  } catch (error) {
    expect(error).toBeInstanceOf(RunError)
    expect((error as RunError).code).toBe(code)
    expect((error as RunError).status).toBe(status)
  }
}

describe('RunStore', () => {
  it('publishes scanned counts, progress, and the completed diff view', () => {
    const cwd = workspace()
    writeFileSync(join(cwd, 'README.md'), 'Use the shared client.\n')
    const store = new RunStore()
    beginRun(store, 'run-1', cwd)
    store.scan('run-1', { scanned: 3, candidates: 2 })
    store.progress('run-1', { index: 1, total: 2, path: 'README.md' })
    store.complete('run-1', completedResult(cwd, { scanned: 3, candidates: 2 }))

    const view = store.view('run-1')
    expect(view?.status).toBe('done')
    expect(view?.scanned).toBe(3)
    expect(view?.candidates).toBe(2)
    expect(view?.changedFiles).toBe(1)
    expect(view?.added).toBe(1)
    expect(view?.deleted).toBe(1)
    expect(view?.progress).toBeNull()
    expect(view?.files[0].path).toBe('README.md')
    expect(view?.files[0].hunks[0].lines).toContain('-Do not use it.')
    expect(view?.files[0].undone).toBe(false)
  })

  it('restores one file, updates active totals, and is idempotent', () => {
    const cwd = workspace()
    writeFileSync(join(cwd, 'README.md'), 'Use the shared client.\n')
    const store = new RunStore()
    completedRun(store, 'run-1', cwd)

    const first = store.undo('run-1', 'README.md')
    expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('Do not use it.\n')
    expect(first.changedFiles).toBe(0)
    expect(first.added).toBe(0)
    expect(first.deleted).toBe(0)
    expect(first.files[0].undone).toBe(true)

    const second = store.undo('run-1', 'README.md')
    expect(second.files[0].undone).toBe(true)
    expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('Do not use it.\n')
  })

  it('marks an already reverted file undone without writing', () => {
    const cwd = workspace()
    writeFileSync(join(cwd, 'README.md'), 'Do not use it.\n')
    const store = new RunStore()
    completedRun(store, 'run-1', cwd)

    const view = store.undo('run-1', 'README.md')
    expect(view.files[0].undone).toBe(true)
    expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('Do not use it.\n')
  })

  it('refuses to overwrite a file changed after the scan', () => {
    const cwd = workspace()
    writeFileSync(join(cwd, 'README.md'), 'Use the shared client.\n')
    const store = new RunStore()
    completedRun(store, 'run-1', cwd)
    writeFileSync(join(cwd, 'README.md'), 'manual edit\n')

    expectRunError(() => store.undo('run-1', 'README.md'), 'file-changed', 409)
    expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('manual edit\n')
  })

  it('refuses a path that the run did not record', () => {
    const cwd = workspace()
    writeFileSync(join(cwd, 'README.md'), 'Use the shared client.\n')
    const store = new RunStore()
    completedRun(store, 'run-1', cwd)

    expectRunError(() => store.undo('run-1', '../secret.md'), 'file-not-found', 404)
  })

  it('refuses when the recorded file target was re-pointed', () => {
    const cwd = workspace()
    const otherA = join(cwd, 'a.md')
    const otherB = join(cwd, 'b.md')
    writeFileSync(otherA, 'Use the shared client.\n')
    writeFileSync(otherB, 'b content\n')
    const link = join(cwd, 'link.md')
    symlinkSync(otherA, link)
    const store = new RunStore()
    const result = completedResult(cwd, {
      diffs: [
        {
          path: 'link.md',
          absolutePath: link,
          diff: '@@ -1,1 +1,1 @@\n-Do not use it.\n+Use the shared client.',
          before: 'Do not use it.\n',
          after: 'Use the shared client.\n',
          added: 1,
          deleted: 1,
        },
      ],
    })
    completedRun(store, 'run-1', cwd, result)
    unlinkSync(link)
    symlinkSync(otherB, link)

    expectRunError(() => store.undo('run-1', 'link.md'), 'file-changed', 409)
    expect(readFileSync(otherB, 'utf8')).toBe('b content\n')
  })

  it('refuses undo while the scan is still running', () => {
    const cwd = workspace()
    const store = new RunStore()
    beginRun(store, 'run-1', cwd)

    expectRunError(() => store.undo('run-1', 'README.md'), 'still-running', 409)
  })

  it('aborts on cancel and settles as cancelled', () => {
    const cwd = workspace()
    const store = new RunStore()
    const controller = beginRun(store, 'run-1', cwd)

    const cancelling = store.cancel('run-1')
    expect(controller.signal.aborted).toBe(true)
    expect(cancelling.cancelling).toBe(true)
    expect(cancelling.status).toBe('running')

    store.complete('run-1', { ...completedResult(cwd), changedFiles: 0, diffs: [], cancelled: true })
    const view = store.view('run-1')
    expect(view?.status).toBe('cancelled')
    expect(view?.cancelling).toBe(false)
    expect(view?.files).toHaveLength(0)
  })

  it('retains the newest runs and evicts the oldest settled run', () => {
    const cwd = workspace()
    const store = new RunStore()
    for (let index = 1; index <= 13; index += 1) {
      completedRun(store, `run-${index}`, cwd)
    }

    expect(store.view('run-1')).toBeUndefined()
    expect(store.view('run-13')).toBeDefined()
  })

  it('reports a failed run without files', () => {
    const cwd = workspace()
    const store = new RunStore()
    beginRun(store, 'run-1', cwd)
    store.fail('run-1', 'model unavailable')

    const view = store.view('run-1')
    expect(view?.status).toBe('failed')
    expect(view?.error).toBe('model unavailable')
    expect(view?.files).toHaveLength(0)
  })
})
