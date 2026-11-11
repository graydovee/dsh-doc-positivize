#!/usr/bin/env node
/**
 * Smoke-test the built artifact (`lib/index.js`).
 *
 * Mounts the real SystemPrompt registry, the real command registry, a fake
 * host LLM service, and a fake Connection service, then asserts that the guard
 * renders, that `/positivize` detaches through the progress lifecycle,
 * writes a temp file, serves the state route, restores the file through the
 * undo route, and that unloading removes all contributions.
 *
 * Run with `pnpm smoke:built`, which builds first. Exits non-zero on the first
 * failed assertion.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import Commands from '@deepseek-ai/dsh-commands'
import * as plugin from '../lib/index.js'
import { GUARD_TEXT } from '../lib/index.js'

const HARNESS_IDENTITY = 'You are an AI agent powered by DeepSeek Harness.'

class FakeLlm extends Service {
  constructor(ctx) {
    super(ctx, 'llm')
    this.calls = []
  }

  stream(options) {
    this.calls.push(options)
    const chunks = [
      {
        type: 'text-delta',
        text: JSON.stringify({ edits: [{ oldText: 'Do not use it.', newText: 'Use the shared client.' }] }),
      },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    return (async function* generate() {
      for (const chunk of chunks) yield chunk
    })()
  }
}

class FakeConnection extends Service {
  constructor(ctx) {
    super(ctx, 'connection')
    this.routes = new Map()
  }

  get fetch() {
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

const dir = mkdtempSync(join(tmpdir(), 'doc-positivize-smoke-'))
try {
  writeFileSync(join(dir, 'README.md'), 'Do not use it.\nKeep this.\n')
  const appended = []
  const agent = {
    session: {
      id: 'session-1',
      header: { cwd: dir },
      requestHeader: () => ({ config: { provider: 'fake', model: 'fake-model' } }),
      append: (type, data) => {
        appended.push({ type, data })
        return { seq: appended.length - 1 }
      },
    },
  }

  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Commands)
  await ctx.plugin(FakeLlm)
  await ctx.plugin(FakeConnection)
  const connection = ctx.connection
  const fiber = ctx.plugin(plugin, {})
  await fiber

  const deadline = Date.now() + 2_000
  while (Date.now() < deadline && !connection.routes.has('/api/doc-positivize.state')) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.ok(connection.routes.has('/api/doc-positivize.state'), 'the result routes must register')

  const prompt = renderPrompt(await ctx.systemPrompt.assemble())
  assert.ok(prompt.includes(HARNESS_IDENTITY), 'the registry identity must render')
  assert.ok(prompt.includes(GUARD_TEXT), 'the built plugin must inject its guard section')

  const execution = await ctx.commands.execute(agent, '/positivize README.md', [], new AbortController().signal)
  assert.equal(execution?.result.kind, 'success', 'the sweep command must succeed')
  assert.equal(execution.result.text, undefined, 'the command must return before the sweep settles')

  const doneEvents = () => appended.filter((event) => event.type === 'command/done')
  while (Date.now() < deadline && doneEvents().length < 2) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), 'Use the shared client.\nKeep this.\n', 'the file must be rewritten in place')
  const report = doneEvents().at(-1)?.data?.text
  assert.ok(typeof report === 'string' && report.includes('[rewrite] README.md:1'), 'the report must list the rewrite')

  const progressRun = appended.find((event) => event.type === 'command/run' && event.data?.name === 'positivize-run')
  assert.ok(progressRun, 'the background run must append its progress lifecycle')
  const runId = String(progressRun.data.commandId)
  const stateResponse = await connection.routes
    .get('/api/doc-positivize.state')
    .fetch(new Request(`http://localhost/api/doc-positivize.state?runId=${encodeURIComponent(runId)}`))
  assert.equal(stateResponse.status, 200, 'the state route must serve the run')
  const state = await stateResponse.json()
  assert.equal(state.status, 'done', 'the run must be settled')
  assert.equal(state.files[0].path, 'README.md', 'the state must list the changed file')

  const undoResponse = await connection.routes.get('/api/doc-positivize.undo').fetch(
    new Request('http://localhost/api/doc-positivize.undo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId, path: 'README.md' }),
    }),
  )
  assert.equal(undoResponse.status, 200, 'the undo route must restore the file')
  assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), 'Do not use it.\nKeep this.\n', 'undo must restore the pre-scan content')

  assert.equal(ctx.llm.calls.length, 1, 'the sweep must make one model call for the candidate file')
  assert.equal(ctx.llm.calls[0].sessionId, 'session-1', 'the call must carry the session id')
  assert.ok(ctx.llm.calls[0].messages[0].content[0].text.includes('doc-positivize sweep engine'), 'the call must carry the sweep rules')
  assert.equal(appended.filter((event) => event.type === 'command/run').length, 2, 'the command must announce its progress card')
  assert.equal(doneEvents().length, 2, 'both the user command and the progress card must settle')

  await fiber.dispose()

  const afterUnload = renderPrompt(await ctx.systemPrompt.assemble())
  assert.ok(!afterUnload.includes(GUARD_TEXT), 'unloading must remove the guard section')
  assert.equal(ctx.commands.find(agent, 'positivize'), undefined, 'unloading must remove the command')
  assert.equal(connection.routes.size, 0, 'unloading must remove the result routes')

  console.log('smoke: built artifact detaches, serves state, restores a file, and removes all contributions')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
