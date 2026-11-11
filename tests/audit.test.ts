import { afterEach, describe, expect, it } from 'vitest'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAuditStore, readAuditRecords, reconstructPrompt, resolveAuditRoot, resolveDshHome } from '../src/audit'
import { buildFilePrompt, SWEEP_RULES } from '../src/workflow'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'doc-positivize-audit-'))
  tempDirs.push(dir)
  return dir
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

const START = {
  sessionId: 'session-1',
  cwd: '/workspace',
  scope: 'the current workspace',
  detached: true,
  provider: 'fake',
  model: 'fake-model',
  limits: { maxFiles: 12, maxFileBytes: 96000, timeoutMs: 180000 },
} as const

describe('createAuditStore', () => {
  it('records one run in order and reconstructs the exact prompt', () => {
    const root = tempRoot()
    const store = createAuditStore({ enabled: true, retainRuns: 5, root })
    const runId = 'run-1'
    const sink = store.sink
    const content = 'Do not use the legacy client.\n'

    sink.beginRun({ runId, ...START })
    sink.scan(runId, { scanned: 3, candidates: 1 })
    sink.file(runId, { seq: 1, path: 'docs/client.md', content })
    sink.request(runId, { seq: 1, attempt: 1, provider: 'fake', model: 'fake-model', maxTokens: 8192, reasoningEffort: 'off' })
    sink.requestResult(runId, {
      seq: 1,
      attempt: 1,
      outcome: 'ok',
      durationMs: 12,
      rawText: '{"edits":[]}',
      finish: { kind: 'stop' },
      usage: { inputTokens: 7, outputTokens: 2 },
    })
    sink.apply(runId, {
      seq: 1,
      path: 'docs/client.md',
      wrote: false,
      applied: [],
      skipped: [{ reason: 'oldText occurs more than once' }],
    })
    sink.endRun(runId, { status: 'done', changedFiles: 0, edits: 0, skipped: 1, notes: [] })

    const dir = store.runDir(runId)
    expect(dir).not.toBeNull()
    const records = readAuditRecords(dir as string)
    expect(records.map((record) => record.type)).toEqual([
      'run-start',
      'scan',
      'file',
      'request',
      'request-result',
      'apply',
      'run-end',
    ])

    const start = records.find((record) => record.type === 'run-start')
    expect(start?.rules).toEqual({ sha256: sha256(SWEEP_RULES), text: SWEEP_RULES })

    const file = records.find((record) => record.type === 'file')
    expect(file?.path).toBe('docs/client.md')
    expect(file?.bytes).toBe(Buffer.byteLength(content, 'utf8'))
    expect(file?.sha256).toBe(sha256(content))
    expect(readFileSync(join(dir as string, String(file?.blob)), 'utf8')).toBe(content)

    const expectedPrompt = buildFilePrompt('docs/client.md', content)
    const request = records.find((record) => record.type === 'request')
    expect(request?.promptSha256).toBe(sha256(expectedPrompt))
    expect(request?.attempt).toBe(1)
    expect(reconstructPrompt(dir as string, 1)).toBe(expectedPrompt)
    expect(reconstructPrompt(dir as string, 99)).toBeNull()

    const result = records.find((record) => record.type === 'request-result')
    expect(result?.outcome).toBe('ok')
    expect(result?.usage).toEqual({ inputTokens: 7, outputTokens: 2 })
    expect(readFileSync(join(dir as string, String((result?.output as { blob: string }).blob)), 'utf8')).toBe(
      '{"edits":[]}',
    )

    const end = records.find((record) => record.type === 'run-end')
    expect(end?.status).toBe('done')
    expect(end?.skipped).toBe(1)
  })

  it('reports each run directory once', () => {
    const root = tempRoot()
    const seen: { runId: string; dir: string }[] = []
    const store = createAuditStore({ enabled: true, retainRuns: 5, root, onRun: (info) => seen.push(info) })
    store.sink.beginRun({ runId: 'run-1', ...START })
    expect(seen).toEqual([{ runId: 'run-1', dir: store.runDir('run-1') }])
  })

  it('keeps only the configured number of runs', async () => {
    const root = tempRoot()
    const store = createAuditStore({ enabled: true, retainRuns: 2, root })
    for (const runId of ['run-a', 'run-b']) {
      store.sink.beginRun({ runId, ...START })
      store.sink.endRun(runId, { status: 'done', changedFiles: 0, edits: 0, skipped: 0, notes: [] })
      await new Promise((resolve) => setTimeout(resolve, 15))
    }
    store.sink.beginRun({ runId: 'run-c', ...START })
    store.sink.endRun('run-c', { status: 'done', changedFiles: 0, edits: 0, skipped: 0, notes: [] })

    const runs = readdirSync(join(root, 'runs')).sort()
    expect(runs).toEqual(['run-b', 'run-c'])
  })

  it('does no I/O when disabled', () => {
    const root = tempRoot()
    const store = createAuditStore({ enabled: false, retainRuns: 5, root })
    expect(store.runDir('run-1')).toBeNull()
    store.sink.beginRun({ runId: 'run-1', ...START })
    store.sink.endRun('run-1', { status: 'done', changedFiles: 0, edits: 0, skipped: 0, notes: [] })
    expect(existsSync(join(root, 'runs'))).toBe(false)
  })

  it('degrades to a no-op after a write failure and reports it once', () => {
    const root = tempRoot()
    const blocked = join(root, 'blocked')
    writeFileSync(blocked, 'not a directory')
    const errors: unknown[] = []
    const store = createAuditStore({
      enabled: true,
      retainRuns: 5,
      root: blocked,
      onError: (error) => errors.push(error),
    })

    expect(() => store.sink.beginRun({ runId: 'run-1', ...START })).not.toThrow()
    expect(() => store.sink.scan('run-1', { scanned: 1, candidates: 1 })).not.toThrow()
    expect(errors).toHaveLength(1)
  })

  it('records failures and keeps optional values JSON-safe', () => {
    const root = tempRoot()
    const store = createAuditStore({ enabled: true, retainRuns: 5, root })
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    store.sink.beginRun({ runId: 'run-1', ...START })
    store.sink.file('run-1', { seq: 1, path: 'a.md', content: 'avoid this\n' })
    store.sink.request('run-1', { seq: 1, attempt: 1, provider: 'fake', model: 'fake-model', maxTokens: 8192, reasoningEffort: null })
    store.sink.requestResult('run-1', {
      seq: 1,
      attempt: 1,
      outcome: 'error',
      durationMs: 3,
      rawText: 'not json',
      usage: cyclic,
      error: 'model did not return the edit-plan JSON',
    })
    store.sink.endRun('run-1', {
      status: 'failed',
      changedFiles: 0,
      edits: 0,
      skipped: 0,
      notes: [],
      error: 'boom',
    })

    const records = readAuditRecords(store.runDir('run-1') as string)
    const result = records.find((record) => record.type === 'request-result')
    expect(result?.outcome).toBe('error')
    expect(result?.error).toBe('model did not return the edit-plan JSON')
    expect(result?.usage).toBeUndefined()
    expect(records.find((record) => record.type === 'run-end')?.status).toBe('failed')
  })

  it('skips torn trailing lines when reading a run', () => {
    const root = tempRoot()
    const store = createAuditStore({ enabled: true, retainRuns: 5, root })
    store.sink.beginRun({ runId: 'run-1', ...START })
    appendFileSync(join(store.runDir('run-1') as string, 'run.jsonl'), '{"type":"scan"')
    expect(readAuditRecords(store.runDir('run-1') as string).map((record) => record.type)).toEqual(['run-start'])
  })

  it.skipIf(process.platform === 'win32')('creates private directories and files', () => {
    const root = tempRoot()
    const store = createAuditStore({ enabled: true, retainRuns: 5, root })
    store.sink.beginRun({ runId: 'run-1', ...START })
    store.sink.file('run-1', { seq: 1, path: 'a.md', content: 'avoid this\n' })
    const dir = store.runDir('run-1') as string
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(join(dir, 'run.jsonl')).mode & 0o777).toBe(0o600)
    const blob = readdirSync(join(dir, 'blobs'))[0]
    expect(statSync(join(dir, 'blobs', blob)).mode & 0o777).toBe(0o600)
    mkdirSync(join(root, 'irrelevant'), { recursive: true })
  })
})

describe('audit path resolution', () => {
  it('prefers DSH_HOME and falls back to the harness home', () => {
    const previous = process.env.DSH_HOME
    try {
      process.env.DSH_HOME = '/tmp/dsh-home-test'
      expect(resolveDshHome()).toBe('/tmp/dsh-home-test')
      expect(resolveAuditRoot()).toBe('/tmp/dsh-home-test/doc-positivize')
      process.env.DSH_HOME = '   '
      expect(resolveDshHome()).not.toBe('/tmp/dsh-home-test')
      expect(resolveDshHome().endsWith('.dsh')).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})
