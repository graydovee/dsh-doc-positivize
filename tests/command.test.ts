import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  COMMAND_DESCRIPTION,
  COMMAND_HINT,
  COMMAND_NAME,
  PROGRESS_COMMAND_NAME,
  parseCommandInput,
  renderReport,
  renderSummary,
  runDocPositivize,
  startDetachedDocPositivize,
} from '../src/command'
import type { CommandInvocation } from '../src/command'
import type { LlmChunk, LlmService, LlmStreamOptions, SweepLimits } from '../src/sweep'
import { DEFAULT_IGNORED_PATHS } from '../src/config'
import { RunStore } from '../src/runs'
import { buildFilePrompt, lineHasMarker } from '../src/workflow'
import { createAuditStore, readAuditRecords, reconstructPrompt } from '../src/audit'

const LIMITS: SweepLimits = {
  ignoredPaths: DEFAULT_IGNORED_PATHS,
  maxFiles: 12,
  maxFileBytes: 96000,
  timeoutMs: 180000,
}
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

/** A temp workspace with the given files. */
function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'doc-positivize-'))
  tempDirs.push(dir)
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
  return dir
}

/** A fake LLM that streams one canned text answer and records its calls. */
function fakeLlm(
  text: string,
  efforts: string[] = ['off', 'low', 'high'],
): { llm: LlmService; calls: LlmStreamOptions[] } {
  const calls: LlmStreamOptions[] = []
  const llm: LlmService = {
    resolveModelInfo() {
      return Promise.resolve({
        defaultMaxTokens: 16384,
        reasoning: { efforts: efforts.map((id) => ({ id })) },
      })
    },
    stream(options) {
      calls.push(options)
      const chunks: LlmChunk[] = [
        { type: 'text-delta', text },
        { type: 'finish', reason: { kind: 'stop' } },
      ]
      return (async function* generate() {
        for (const chunk of chunks) yield chunk
      })()
    },
  }
  return { llm, calls }
}

/** A fake LLM that waits until its signal aborts. */
function blockingLlm(): { llm: LlmService; calls: LlmStreamOptions[] } {
  const calls: LlmStreamOptions[] = []
  const llm: LlmService = {
    resolveModelInfo() {
      return Promise.resolve({ defaultMaxTokens: 8192, reasoning: { efforts: [{ id: 'off' }] } })
    },
    stream(options) {
      calls.push(options)
      return (async function* generate() {
        await new Promise((_, reject) => {
          const signal = options.signal
          if (signal === undefined) return reject(new Error('no signal'))
          if (signal.aborted) return reject(new Error('aborted'))
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  return { llm, calls }
}

/** The invoking agent surface for one temp workspace. */
function invocation(cwd: string, rawInput: string): CommandInvocation {
  return {
    agent: {
      id: 'session-1',
      session: {
        id: 'session-1',
        header: { cwd },
        requestHeader: () => ({ config: { provider: 'fake', model: 'fake-model' } }),
      },
      options: {},
    },
    rawInput,
    signal: new AbortController().signal,
  }
}

/** The invoking agent plus the append capture of a detached-capable host. */
function detachedInvocation(cwd: string, rawInput: string): {
  invocation: CommandInvocation
  appended: { type: string; data: Record<string, unknown> }[]
} {
  const appended: { type: string; data: Record<string, unknown> }[] = []
  return {
    invocation: {
      agent: {
        id: 'session-1',
        session: {
          id: 'session-1',
          header: { cwd },
          requestHeader: () => ({ config: { provider: 'fake', model: 'fake-model' } }),
          append: (type: string, data: unknown) => {
            appended.push({ type, data: data as Record<string, unknown> })
            return { seq: appended.length - 1 }
          },
        },
        options: {},
      },
      rawInput,
      signal: new AbortController().signal,
    },
    appended,
  }
}

function editPlan(edits: { oldText: string; newText: string; category?: string }[]): string {
  return JSON.stringify({ edits })
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('timed out waiting for the background sweep')
}

describe('command metadata', () => {
  it('keeps the slash-command contract', () => {
    expect(COMMAND_NAME).toBe('positivize')
    expect(PROGRESS_COMMAND_NAME).toBe('positivize-run')
    expect(COMMAND_DESCRIPTION).toContain('Positivize documentation in one pass')
    expect(COMMAND_HINT).toBe('[target]')
  })
})

describe('parseCommandInput', () => {
  it('defaults to the workspace', () => {
    expect(parseCommandInput('')).toEqual({ ok: true })
    expect(parseCommandInput('   ')).toEqual({ ok: true })
  })

  it('takes the whole line as the scope', () => {
    expect(parseCommandInput('README*.md')).toEqual({ ok: true, target: 'README*.md' })
    expect(parseCommandInput(' docs/ src/index.ts ')).toEqual({ ok: true, target: 'docs/ src/index.ts' })
  })

  it('rejects flags with usage text', () => {
    expect(parseCommandInput('--help')).toEqual({ ok: false, usage: 'Usage: /positivize [target]' })
  })
})

describe('workflow helpers', () => {
  it('detects both marker languages', () => {
    expect(lineHasMarker('Do not use the legacy client.')).toBe(true)
    expect(lineHasMarker('不要使用旧客户端。')).toBe(true)
    expect(lineHasMarker('Use the shared client.')).toBe(false)
  })

  it('builds the per-file prompt with rules and content', () => {
    const prompt = buildFilePrompt('README.md', 'Do not use it.')
    expect(prompt).toContain('doc-positivize sweep engine')
    expect(prompt).toContain('File: README.md')
    expect(prompt).toContain('Do not use it.')
  })
})

describe('runDocPositivize', () => {
  it('rewrites a marked line in place and reports it', async () => {
    const cwd = workspace({ 'README.md': '不要使用 requests。\nKeep this.\n' })
    const { llm, calls } = fakeLlm(
      editPlan([
        { oldText: '不要使用 requests。', newText: '使用 httpx 发送请求。', category: 'behavioural-constraint' },
      ]),
    )
    const call = invocation(cwd, 'README.md')

    const result = await runDocPositivize(llm, call, LIMITS)

    expect(result.kind).toBe('success')
    expect(result.text).toContain('positivize — README.md')
    expect(result.text).toContain('[rewrite] README.md:1')
    expect(result.text).toContain('使用 httpx 发送请求。')
    expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('使用 httpx 发送请求。\nKeep this.\n')
    expect(calls).toHaveLength(1)
    expect(calls[0].provider).toBe('fake')
    expect(calls[0].model).toBe('fake-model')
    expect(calls[0].sessionId).toBe('session-1')
    expect(calls[0].purpose).toBe('doc-positivize')
    expect(calls[0].maxTokens).toBe(16384)
    expect(calls[0].reasoningEffort).toBe('off')
    expect(calls[0].signal).toBe(call.signal)
    expect(calls[0].messages).toEqual([
      {
        role: 'user',
        content: [{ type: 'text', text: buildFilePrompt('README.md', '不要使用 requests。\nKeep this.\n') }],
      },
    ])
  })

  it('deletes a tombstone line', async () => {
    const cwd = workspace({ 'app.py': '# 已移除旧逻辑\nprint("hi")\n' })
    const { llm } = fakeLlm(editPlan([{ oldText: '# 已移除旧逻辑\n', newText: '' }]))

    const result = await runDocPositivize(llm, invocation(cwd, 'app.py'), LIMITS)

    expect(result.kind).toBe('success')
    expect(result.text).toContain('[delete] app.py:1')
    expect(readFileSync(join(cwd, 'app.py'), 'utf8')).toBe('print("hi")\n')
  })

  it('keeps the file and reports the skip when the model returns bad JSON', async () => {
    const cwd = workspace({ 'README.md': 'Do not use it.\n' })
    const { llm } = fakeLlm('not json')

    const result = await runDocPositivize(llm, invocation(cwd, 'README.md'), LIMITS)

    expect(result.kind).toBe('success')
    expect(result.text).toContain('Skipped:')
    expect(result.text).toContain('model did not return the edit-plan JSON')
    expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('Do not use it.\n')
  })

  it('skips configured ignore entries', async () => {
    const cwd = workspace({
      'README.md': 'Do not use it.\n',
      'node_modules/pkg/README.md': 'Do not use it.\n',
    })
    const { llm, calls } = fakeLlm(editPlan([{ oldText: 'Do not use it.', newText: 'Use the shared client.' }]))

    const result = await runDocPositivize(llm, invocation(cwd, ''), LIMITS)

    expect(result.kind).toBe('success')
    expect(calls).toHaveLength(1)
    expect(readFileSync(join(cwd, 'node_modules/pkg/README.md'), 'utf8')).toBe('Do not use it.\n')
  })

  it('sweeps an explicitly named file inside an ignored directory', async () => {
    const cwd = workspace({ 'node_modules/pkg/README.md': 'Do not use it.\n' })
    const { llm, calls } = fakeLlm(editPlan([{ oldText: 'Do not use it.', newText: 'Use the shared client.' }]))

    const result = await runDocPositivize(llm, invocation(cwd, 'node_modules/pkg/README.md'), LIMITS)

    expect(result.kind).toBe('success')
    expect(calls).toHaveLength(1)
    expect(readFileSync(join(cwd, 'node_modules/pkg/README.md'), 'utf8')).toBe('Use the shared client.\n')
  })

  it('falls back to a supported reasoning effort when off is unavailable', async () => {
    const cwd = workspace({ 'README.md': 'Do not use it.\n' })
    const { llm, calls } = fakeLlm(editPlan([{ oldText: 'Do not use it.', newText: 'Use the shared client.' }]), [
      'low',
      'high',
    ])

    const result = await runDocPositivize(llm, invocation(cwd, 'README.md'), LIMITS)

    expect(result.kind).toBe('success')
    expect(calls[0].reasoningEffort).toBe('low')
  })

  it('reports a clean scope', async () => {
    const cwd = workspace({ 'README.md': 'Use the shared client.\n' })
    const { llm, calls } = fakeLlm(editPlan([]))

    const result = await runDocPositivize(llm, invocation(cwd, 'README.md'), LIMITS)

    expect(result.kind).toBe('success')
    expect(result.text).toContain('Scanned 1 file(s); 0 carried markers')
    expect(result.text).toContain('No negative phrasing was found in scope.')
    expect(calls).toHaveLength(0)
  })

  it('reports a scope with no matches', async () => {
    const cwd = workspace({ 'README.md': 'nothing\n' })
    const { llm } = fakeLlm(editPlan([]))

    const result = await runDocPositivize(llm, invocation(cwd, 'missing*'), LIMITS)

    expect(result).toEqual({
      kind: 'error',
      text: `positivize: no files match missing* under ${cwd}; glob patterns are case-sensitive`,
    })
  })

  it('reports usage for a flag', async () => {
    const cwd = workspace({ 'README.md': 'nothing\n' })
    const { llm, calls } = fakeLlm(editPlan([]))

    const result = await runDocPositivize(llm, invocation(cwd, '--help'), LIMITS)

    expect(result).toEqual({ kind: 'error', text: 'Usage: /positivize [target]' })
    expect(calls).toHaveLength(0)
  })
})

describe('startDetachedDocPositivize', () => {
  it('returns immediately, keeps the run in the store, and appends a compact summary', async () => {
    const cwd = workspace({ 'README.md': 'Do not use it.\nKeep this.\n' })
    const { llm } = fakeLlm(editPlan([{ oldText: 'Do not use it.', newText: 'Use the shared client.' }]))
    const { invocation: call, appended } = detachedInvocation(cwd, 'README.md')
    const runs = new RunStore()

    const run = startDetachedDocPositivize(llm, call, LIMITS, runs)

    expect(run.result).toEqual({ kind: 'success' })
    const progress = appended.find((event) => event.type === 'command/run')
    expect(progress?.data.name).toBe(PROGRESS_COMMAND_NAME)
    const runId = String(progress?.data.commandId)
    await run.settled

    expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('Use the shared client.\nKeep this.\n')
    const view = runs.view(runId)
    expect(view?.status).toBe('done')
    expect(view?.files).toHaveLength(1)
    expect(view?.files[0].path).toBe('README.md')
    expect(view?.files[0].hunks[0].lines).toContain('-Do not use it.')
    expect(view?.added).toBe(1)
    expect(view?.deleted).toBe(1)
    const done = appended.filter((event) => event.type === 'command/done')
    expect(done).toHaveLength(1)
    expect(done[0].data.kind).toBe('success')
    expect(String(done[0].data.text)).toContain('Finished:')
    expect(String(done[0].data.text)).toContain('[rewrite] README.md:1')
    expect(String(done[0].data.text)).not.toContain('--- a/README.md')
  })

  it('stops a running scan and keeps partial work undoable', async () => {
    const cwd = workspace({ 'README.md': 'Do not use it.\n' })
    const { llm } = blockingLlm()
    const { invocation: call, appended } = detachedInvocation(cwd, 'README.md')
    const runs = new RunStore()

    const run = startDetachedDocPositivize(llm, call, LIMITS, runs)
    await waitFor(() => appended.some((event) => event.type === 'command/run'))
    const runId = String(appended.find((event) => event.type === 'command/run')?.data.commandId)
    expect(runs.view(runId)?.status).toBe('running')

    runs.cancel(runId)
    expect(runs.view(runId)?.cancelling).toBe(true)
    await run.settled

    const view = runs.view(runId)
    expect(view?.status).toBe('cancelled')
    expect(view?.files).toHaveLength(0)
    const done = appended.filter((event) => event.type === 'command/done')
    expect(done).toHaveLength(1)
    expect(String(done[0].data.text)).toContain('Terminated:')
    expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('Do not use it.\n')
  })
})

describe('renderReport', () => {
  it('renders counts, changes, skips, remaining and notes', () => {
    const text = renderReport({
      scope: 'x',
      scanned: 3,
      candidates: 2,
      changedFiles: 1,
      cancelled: false,
      changes: [
        { path: 'a.md', line: 4, action: 'rewrite', original: 'Do not use it.', change: 'Use the client.' },
        { path: 'a.md', line: 9, action: 'delete', original: 'Tombstone.', change: '' },
      ],
      diffs: [
        {
          path: 'a.md',
          diff: '@@ -4,1 +4,1 @@\n-Do not use it.\n+Use the client.\n@@ -9,1 +9,0 @@\n-Tombstone.',
          before: 'Do not use it.\nTombstone.\n',
          after: 'Use the client.\n',
          added: 1,
          deleted: 2,
        },
      ],
      skipped: [{ path: 'b.md', reason: 'oldText not found' }],
      remaining: [{ path: 'a.md', line: 12, snippet: 'Do not lint tests.' }],
      notes: ['one note'],
    })

    expect(text).toContain('Scanned 3 file(s); 2 carried markers; 1 file(s) changed (1 rewrite(s), 1 deletion(s)).')
    expect(text).toContain('[rewrite] a.md:4')
    expect(text).toContain('[delete] a.md:9')
    expect(text).toContain('--- a/a.md')
    expect(text).toContain('+Use the client.')
    expect(text).toContain('Skipped:')
    expect(text).toContain('Remaining markers')
    expect(text).toContain('Notes:')
  })
})

describe('renderSummary', () => {
  it('keeps the compact fallback free of diff bodies', () => {
    const text = renderSummary({
      scope: 'README.md',
      scanned: 1,
      candidates: 1,
      changedFiles: 1,
      cancelled: false,
      changes: [{ path: 'README.md', line: 1, action: 'rewrite', original: 'old', change: 'new' }],
      diffs: [
        {
          path: 'README.md',
          diff: '@@ -1,1 +1,1 @@\n-old\n+new',
          before: 'old\n',
          after: 'new\n',
          added: 1,
          deleted: 1,
        },
      ],
      skipped: [],
      remaining: [],
      notes: [],
    })

    expect(text).toContain('Finished: scanned 1 file(s)')
    expect(text).toContain('[rewrite] README.md:1')
    expect(text).not.toContain('--- a/README.md')
    expect(text).not.toContain('+new')
  })

  it('marks a terminated scan and counts skipped files', () => {
    const text = renderSummary({
      scope: 'x',
      scanned: 2,
      candidates: 1,
      changedFiles: 0,
      cancelled: true,
      changes: [],
      diffs: [],
      skipped: [{ path: 'a.md', reason: 'model error' }],
      remaining: [],
      notes: ['scan stopped'],
    })

    expect(text).toContain('(terminated)')
    expect(text).toContain('Terminated:')
    expect(text).toContain('Skipped 1 file(s).')
  })
})

/** A private audit root under the OS temp directory. */
function auditRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'doc-positivize-audit-'))
  tempDirs.push(dir)
  return dir
}

describe('audit trail wiring', () => {
  it('records every detached request and exposes the run directory', async () => {
    const cwd = workspace({ 'README.md': 'Do not use it.\n' })
    const { llm } = fakeLlm(editPlan([{ oldText: 'Do not use it.', newText: 'Use the shared client.' }]))
    const { invocation: call, appended } = detachedInvocation(cwd, 'README.md')
    const runs = new RunStore()
    const store = createAuditStore({ enabled: true, retainRuns: 5, root: auditRoot() })

    const run = startDetachedDocPositivize(llm, call, LIMITS, runs, store)
    const runId = String(appended.find((event) => event.type === 'command/run')?.data.commandId)
    await run.settled

    const dir = store.runDir(runId)
    expect(dir).not.toBeNull()
    expect(runs.view(runId)?.auditPath).toBe(dir)
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
    const request = records.find((record) => record.type === 'request')
    expect(request?.provider).toBe('fake')
    expect(request?.path).toBe('README.md')
    expect(request?.attempt).toBe(1)
    expect(reconstructPrompt(dir as string, 1)).toBe(buildFilePrompt('README.md', 'Do not use it.\n'))
    expect(records.find((record) => record.type === 'request-result')?.outcome).toBe('ok')
    expect(records.find((record) => record.type === 'run-end')?.status).toBe('done')
  })

  it('records a cancelled request and a cancelled run', async () => {
    const cwd = workspace({ 'README.md': 'Do not use it.\n' })
    const { llm } = blockingLlm()
    const { invocation: call, appended } = detachedInvocation(cwd, 'README.md')
    const runs = new RunStore()
    const store = createAuditStore({ enabled: true, retainRuns: 5, root: auditRoot() })

    const run = startDetachedDocPositivize(llm, call, LIMITS, runs, store)
    await waitFor(() => appended.some((event) => event.type === 'command/run'))
    const runId = String(appended.find((event) => event.type === 'command/run')?.data.commandId)
    runs.cancel(runId)
    await run.settled

    const records = readAuditRecords(store.runDir(runId) as string)
    expect(records.find((record) => record.type === 'request-result')?.outcome).toBe('cancelled')
    expect(records.find((record) => record.type === 'run-end')?.status).toBe('cancelled')
  })

  it('records a run that fails before any request', async () => {
    const cwd = workspace({ 'README.md': 'nothing to change\n' })
    const { llm } = fakeLlm(editPlan([]))
    const { invocation: call, appended } = detachedInvocation(cwd, 'missing*')
    const runs = new RunStore()
    const store = createAuditStore({ enabled: true, retainRuns: 5, root: auditRoot() })

    const run = startDetachedDocPositivize(llm, call, LIMITS, runs, store)
    const runId = String(appended.find((event) => event.type === 'command/run')?.data.commandId)
    await run.settled

    const records = readAuditRecords(store.runDir(runId) as string)
    expect(records.map((record) => record.type)).toEqual(['run-start', 'run-end'])
    const end = records.find((record) => record.type === 'run-end')
    expect(end?.status).toBe('failed')
    expect(String(end?.error)).toContain('no files match')
  })

  it('records the foreground path under its own run id', async () => {
    const cwd = workspace({ 'README.md': 'Do not use it.\n' })
    const { llm } = fakeLlm(editPlan([{ oldText: 'Do not use it.', newText: 'Use the shared client.' }]))
    const root = auditRoot()
    const store = createAuditStore({ enabled: true, retainRuns: 5, root })

    const result = await runDocPositivize(llm, invocation(cwd, 'README.md'), LIMITS, store)
    expect(result.kind).toBe('success')
    const runIds = readdirSync(join(root, 'runs'))
    expect(runIds).toHaveLength(1)
    const records = readAuditRecords(join(root, 'runs', runIds[0]))
    expect(records.find((record) => record.type === 'run-start')?.detached).toBe(false)
    expect(records.find((record) => record.type === 'run-end')?.status).toBe('done')
  })
})
