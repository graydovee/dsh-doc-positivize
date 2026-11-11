import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_IGNORED_PATHS } from '../src/config'
import { runSweep } from '../src/sweep'
import type { LlmChunk, LlmService } from '../src/sweep'

const tempDirs: string[] = []

function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'doc-positivize-scope-'))
  tempDirs.push(dir)
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
  return dir
}

const llm: LlmService = {
  stream() {
    const chunks: LlmChunk[] = [
      { type: 'text-delta', text: '{"edits":[]}' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    return (async function* generate() {
      for (const chunk of chunks) yield chunk
    })()
  },
}

const limits = { ignoredPaths: DEFAULT_IGNORED_PATHS, maxFiles: 12, maxFileBytes: 96000, timeoutMs: 180000 }

async function sweep(cwd: string, target: string) {
  return runSweep({
    llm,
    cwd,
    target,
    signal: new AbortController().signal,
    route: { provider: 'fake', model: 'fake' },
    sessionId: 's',
    limits,
  })
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('scope globs', () => {
  it('matches root and nested files for **/', async () => {
    const cwd = workspace({ 'README.md': 'a\n', 'docs/guide.md': 'b\n', 'src/index.ts': 'c\n' })

    const result = await sweep(cwd, '**/*.md')

    expect(result.scanned).toBe(2)
  })

  it('keeps * within one path segment', async () => {
    const cwd = workspace({ 'README.md': 'a\n', 'README-zh.md': 'b\n', 'docs/guide.md': 'c\n' })

    const result = await sweep(cwd, '*.md')

    expect(result.scanned).toBe(2)
  })

  it('reports the workspace root when nothing matches', async () => {
    const cwd = workspace({ 'README.md': 'a\n' })

    await expect(sweep(cwd, 'READEME*.md')).rejects.toThrow(`no files match READEME*.md under ${cwd}`)
  })
})
