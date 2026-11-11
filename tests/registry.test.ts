import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import Commands from '@deepseek-ai/dsh-commands'
import * as plugin from '../src/index'
import type { FetchRoute } from '../src/http'
import { GUARD_TEXT } from '../src/guard'
import type { LlmChunk, LlmStreamOptions } from '../src/sweep'

const HARNESS_IDENTITY = 'You are an AI agent powered by DeepSeek Harness.'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

/** A host LLM service that streams one canned edit plan and records its calls. */
class FakeLlm extends Service {
  readonly calls: LlmStreamOptions[] = []

  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  stream(options: LlmStreamOptions): AsyncIterable<LlmChunk> {
    this.calls.push(options)
    const chunks: LlmChunk[] = [
      {
        type: 'text-delta',
        text: JSON.stringify({
          edits: [{ oldText: 'Do not use it.', newText: 'Use the shared client.', category: 'behavioural-constraint' }],
        }),
      },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    return (async function* generate() {
      for (const chunk of chunks) yield chunk
    })()
  }
}

/** A Connection service stand-in that records the exact routes the plugin adds. */
class FakeConnection extends Service {
  readonly routes = new Map<string, FetchRoute>()

  constructor(ctx: Context) {
    super(ctx, 'connection')
  }

  get fetch(): { register(route: FetchRoute): () => void } {
    return {
      register: (route) => {
        this.routes.set(route.path, route)
        return () => {
          this.routes.delete(route.path)
        }
      },
    }
  }
}

interface FakeAgentEvent {
  readonly type: string
  readonly data: Record<string, unknown>
}

interface FakeAgent {
  readonly session: {
    readonly id: string
    readonly header: { readonly cwd: string }
    readonly requestHeader: () => { readonly config: { readonly provider: string; readonly model: string } }
    append: (...args: unknown[]) => { readonly seq: number }
    readonly appended: string[]
    readonly events: FakeAgentEvent[]
  }
  readonly appended: string[]
}

function fakeAgent(cwd: string): FakeAgent {
  const appended: string[] = []
  const events: FakeAgentEvent[] = []
  return {
    session: {
      id: 'session-1',
      header: { cwd },
      requestHeader: () => ({ config: { provider: 'fake', model: 'fake-model' } }),
      append: (...args: unknown[]) => {
        appended.push(String(args[0]))
        events.push({ type: String(args[0]), data: (args[1] ?? {}) as Record<string, unknown> })
        return { seq: appended.length - 1 }
      },
      appended,
      events,
    },
    appended,
  }
}

function workspace(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'doc-positivize-'))
  tempDirs.push(dir)
  writeFileSync(join(dir, 'README.md'), content)
  return dir
}

async function mount(raw = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(Commands)
  await ctx.plugin(FakeLlm)
  const fiber = ctx.plugin(plugin, raw)
  await fiber
  return { ctx, fiber, llm: (ctx as unknown as { llm: FakeLlm }).llm }
}

async function mountWithConnection(raw = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(Commands)
  await ctx.plugin(FakeLlm)
  await ctx.plugin(FakeConnection)
  const connection = (ctx as unknown as { connection: FakeConnection }).connection
  const fiber = ctx.plugin(plugin, raw)
  await fiber
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline && !connection.routes.has('/api/doc-positivize.state')) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return { ctx, fiber, connection, llm: (ctx as unknown as { llm: FakeLlm }).llm }
}

function asCommandAgent(ctx: Context, agent: FakeAgent) {
  return agent as unknown as Parameters<typeof ctx.commands.execute>[0]
}

async function waitForDone(agent: FakeAgent, count: number): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline && agent.appended.filter((type) => type === 'command/done').length < count) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('prompt registry integration', () => {
  it('renders the guard after the harness identity', async () => {
    const { ctx } = await mount()

    const prompt = renderPrompt(await ctx.systemPrompt.assemble())

    expect(prompt).toContain(GUARD_TEXT)
    expect(prompt.indexOf(GUARD_TEXT)).toBeGreaterThan(prompt.indexOf(HARNESS_IDENTITY))
  })

  it('renders the guard before the deployment persona suffix', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { personaSuffix: 'PERSONA-SUFFIX-MARKER' })
    await ctx.plugin(Commands)
    await ctx.plugin(FakeLlm)
    await ctx.plugin(plugin, {})

    const prompt = renderPrompt(await ctx.systemPrompt.assemble())

    expect(prompt.indexOf(GUARD_TEXT)).toBeGreaterThan(prompt.indexOf(HARNESS_IDENTITY))
    expect(prompt.indexOf('PERSONA-SUFFIX-MARKER')).toBeGreaterThan(prompt.indexOf(GUARD_TEXT))
  })
})

describe('guard switch', () => {
  it('mounts no guard section when the guard is disabled', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(Commands)
    await ctx.plugin(FakeLlm)
    await ctx.plugin(plugin, { guardEnabled: false })

    const prompt = renderPrompt(await ctx.systemPrompt.assemble())

    expect(prompt).not.toContain(GUARD_TEXT)
    expect(prompt).toContain(HARNESS_IDENTITY)
  })
})

describe('command registry integration', () => {
  it('runs the foreground path without a Connection service', async () => {
    const { ctx, llm } = await mount()
    const cwd = workspace('Do not use it.\nKeep this.\n')
    const agent = fakeAgent(cwd)

    const execution = await ctx.commands.execute(
      asCommandAgent(ctx, agent),
      '/positivize README.md',
      [],
      new AbortController().signal,
    )

    expect(execution?.result.kind).toBe('success')
    expect(execution?.result.text).toContain('[rewrite] README.md:1')
    expect(agent.appended.filter((type) => type === 'command/run')).toHaveLength(1)
    expect(agent.appended.filter((type) => type === 'command/done')).toHaveLength(1)
    expect(llm.calls).toHaveLength(1)
    expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('Use the shared client.\nKeep this.\n')
  })

  it('detaches through the progress lifecycle and serves state/undo routes', async () => {
    const { ctx, connection, llm } = await mountWithConnection()
    const cwd = workspace('Do not use it.\nKeep this.\n')
    const agent = fakeAgent(cwd)

    const execution = await ctx.commands.execute(
      asCommandAgent(ctx, agent),
      '/positivize README.md',
      [],
      new AbortController().signal,
    )

    expect(execution?.result.kind).toBe('success')
    expect(execution?.result.text).toBeUndefined()
    expect(agent.appended.filter((type) => type === 'command/run')).toHaveLength(2)
    await waitForDone(agent, 2)
    expect(agent.appended.filter((type) => type === 'command/done')).toHaveLength(2)
    expect(llm.calls).toHaveLength(1)
    expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('Use the shared client.\nKeep this.\n')

    const progressRun = agent.session.events.find(
      (event) => event.type === 'command/run' && event.data.name === 'positivize-run',
    )
    expect(progressRun).toBeDefined()
    const runId = String(progressRun?.data.commandId)

    const stateRoute = connection.routes.get('/api/doc-positivize.state')
    expect(stateRoute).toBeDefined()
    const stateResponse = await stateRoute!.fetch(
      new Request(`http://localhost/api/doc-positivize.state?runId=${encodeURIComponent(runId)}`),
    )
    expect(stateResponse.status).toBe(200)
    const state = (await stateResponse.json()) as {
      status: string
      files: { path: string; hunks: { lines: string[] }[] }[]
    }
    expect(state.status).toBe('done')
    expect(state.files[0].path).toBe('README.md')
    expect(state.files[0].hunks[0].lines).toContain('-Do not use it.')

    const undoRoute = connection.routes.get('/api/doc-positivize.undo')
    expect(undoRoute).toBeDefined()
    const undoResponse = await undoRoute!.fetch(
      new Request('http://localhost/api/doc-positivize.undo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId, path: 'README.md' }),
      }),
    )
    expect(undoResponse.status).toBe(200)
    expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('Do not use it.\nKeep this.\n')
  })

  it('returns a usage error without calling the model', async () => {
    const { ctx, llm } = await mount()
    const cwd = workspace('Do not use it.\n')

    const execution = await ctx.commands.execute(
      asCommandAgent(ctx, fakeAgent(cwd)),
      '/positivize --help',
      [],
      new AbortController().signal,
    )

    expect(execution?.result.kind).toBe('error')
    expect(llm.calls).toHaveLength(0)
  })

  it('stays out of the command registry when disabled', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(Commands)
    await ctx.plugin(FakeLlm)
    await ctx.plugin(plugin, { command: false })
    const cwd = workspace('Do not use it.\n')

    expect(ctx.commands.find(asCommandAgent(ctx, fakeAgent(cwd)), 'positivize')).toBeUndefined()
  })
})

describe('lifecycle', () => {
  it('removes the section and the command when the plugin unloads', async () => {
    const { ctx, fiber } = await mount()
    const cwd = workspace('Do not use it.\n')
    expect(ctx.commands.find(asCommandAgent(ctx, fakeAgent(cwd)), 'positivize')).toBeDefined()

    await fiber.dispose()

    const prompt = renderPrompt(await ctx.systemPrompt.assemble())
    expect(prompt).not.toContain(GUARD_TEXT)
    expect(prompt).toContain(HARNESS_IDENTITY)
    expect(ctx.commands.find(asCommandAgent(ctx, fakeAgent(cwd)), 'positivize')).toBeUndefined()
  })
})
