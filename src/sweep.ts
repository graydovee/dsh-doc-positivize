/**
 * The host-side sweep engine.
 *
 * The engine walks the scope, scans files with the marker list, asks the
 * session's model for a minimal JSON edit plan per candidate file, applies the
 * edits, and re-scans the result. It runs either in the foreground handler or
 * in a detached background run whose signal the result card's Stop control
 * aborts; a stopped run returns its partial changed-file list. No subagent, no
 * new session, and no conversation message are created.
 *
 * @module dsh-doc-positivize/sweep
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { buildFilePrompt, lineHasMarker } from './workflow'
import { unifiedDiff } from './diff'

/** One streamed chunk from the LLM service. */
export interface LlmChunk {
  readonly type: string
  readonly text?: string
  readonly reason?: {
    readonly kind: string
    readonly failure?: { readonly message?: string }
  }
}

/** The stream request this engine issues. */
export interface LlmStreamOptions {
  readonly provider: string
  readonly model: string
  readonly messages: readonly unknown[]
  readonly maxTokens?: number
  readonly reasoningEffort?: string
  readonly temperature?: number
  readonly sessionId?: string
  readonly purpose?: string
  readonly signal?: AbortSignal
}

/** Reasoning metadata one provider resolves for its model. */
export interface LlmReasoningInfo {
  readonly efforts?: readonly { readonly id: string }[]
}

/** Resolved model metadata used to pick a supported reasoning effort and budget. */
export interface LlmModelInfo {
  readonly defaultMaxTokens?: number
  readonly reasoning?: LlmReasoningInfo
}

/** The LLM service surface used by the sweep. */
export interface LlmService {
  stream(options: LlmStreamOptions): AsyncIterable<LlmChunk>
  /** Optional capability lookup; absent on older hosts and fake services. */
  resolveModelInfo?(provider: string, model: string, signal?: AbortSignal): Promise<LlmModelInfo>
}

/** One resolved model route. */
export interface ModelRoute {
  readonly provider: string
  readonly model: string
}

/** Operational limits, all tunable from the row config. */
export interface SweepLimits {
  readonly ignoredPaths: readonly string[]
  readonly maxFiles: number
  readonly maxFileBytes: number
  readonly timeoutMs: number
}

/** One applied edit. */
export interface SweepChange {
  readonly path: string
  readonly line: number
  readonly action: 'rewrite' | 'delete'
  readonly original: string
  readonly change: string
}

/** One changed file's unified diff body. */
export interface SweepFileDiff {
  readonly path: string
  /** Absolute target captured when the sweep wrote the file. */
  readonly absolutePath?: string
  readonly diff: string
  readonly before: string
  readonly after: string
  readonly added: number
  readonly deleted: number
}

/** One skipped edit or file. */
export interface SweepSkip {
  readonly path: string
  readonly reason: string
}

/** One marker hit left after the edits. */
export interface SweepRemaining {
  readonly path: string
  readonly line: number
  readonly snippet: string
}

/** One running progress step: the candidate currently under review. */
export interface SweepProgress {
  readonly index: number
  readonly total: number
  readonly path: string
}

/** The complete sweep result, rendered by the command. */
export interface SweepResult {
  readonly scope: string
  readonly scanned: number
  readonly candidates: number
  readonly changedFiles: number
  readonly changes: readonly SweepChange[]
  readonly diffs: readonly SweepFileDiff[]
  readonly skipped: readonly SweepSkip[]
  readonly remaining: readonly SweepRemaining[]
  readonly notes: readonly string[]
  /** True when the caller's signal stopped the scan before it finished. */
  readonly cancelled: boolean
}

interface Edit {
  readonly oldText: string
  readonly newText: string
  readonly category?: string
}

interface Candidate {
  readonly path: string
  readonly rel: string
  readonly content: string
}

const MAX_SCAN_FILES = 2000
const MAX_SCAN_BYTES = 512 * 1024
const MAX_CHANGE_TEXT = 300

/** Convert a simple glob (with `*`, `**`, `?`) to a relative-path regex. */
function globToRegExp(pattern: string): RegExp {
  let out = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          // `**/` also matches zero directories, so `**/*.md` includes the root.
          out += '(?:.*/)?'
          index += 2
        } else {
          out += '.*'
          index += 1
        }
      } else {
        out += '[^/]*'
      }
    } else if (char === '?') {
      out += '[^/]'
    } else if ('\\^$+.()|{}[]'.includes(char)) {
      out += `\\${char}`
    } else {
      out += char
    }
  }
  return new RegExp(`${out}$`)
}

/** Compile the configured ignore entries into one predicate. */
function createIgnoreMatcher(patterns: readonly string[]): (rel: string, name: string) => boolean {
  const names = new Set<string>()
  const paths = new Set<string>()
  const globs: ((value: string) => boolean)[] = []

  for (const raw of patterns) {
    const pattern = raw.trim()
    if (pattern.length === 0) continue
    if (/[*?]/.test(pattern)) {
      const regex = globToRegExp(pattern)
      globs.push((value) => regex.test(value))
    } else if (pattern.includes('/')) {
      paths.add(pattern.replace(/^\.\//, ''))
    } else {
      names.add(pattern)
    }
  }

  return (rel, name) => names.has(name) || paths.has(rel) || globs.some((test) => test(rel) || test(name))
}

/** Walk one directory into files, skipping the configured ignore entries. */
function walk(dir: string, out: string[], root: string, isIgnored: (rel: string, name: string) => boolean): void {
  if (out.length >= MAX_SCAN_FILES) return
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= MAX_SCAN_FILES) return
    const path = join(dir, entry.name)
    const rel = relative(root, path) || entry.name
    if (isIgnored(rel, entry.name)) continue
    if (entry.isDirectory()) walk(path, out, root, isIgnored)
    else if (entry.isFile()) out.push(path)
  }
}

/** Expand the target tokens into concrete files under the workspace. */
function expandScope(cwd: string, target: string | undefined, ignoredPaths: readonly string[]): string[] {
  const isIgnored = createIgnoreMatcher(ignoredPaths)
  const tokens = target === undefined || target.trim().length === 0 ? ['.'] : target.trim().split(/\s+/)
  const files: string[] = []
  let walked: string[] | undefined

  for (const token of tokens) {
    if (isAbsolute(token) || !/[*?]/.test(token)) {
      const absolute = resolve(cwd, token)
      if (!existsSync(absolute)) continue
      const stats = statSync(absolute)
      if (stats.isFile()) {
        // An explicitly named file is swept even when its directory is ignored.
        files.push(absolute)
      } else if (stats.isDirectory()) {
        walk(absolute, files, cwd, isIgnored)
      }
      continue
    }

    walked ??= (() => {
      const all: string[] = []
      walk(cwd, all, cwd, isIgnored)
      return all
    })()
    const matcher = globToRegExp(token)
    for (const file of walked) {
      const rel = relative(cwd, file)
      if (matcher.test(rel) && !isIgnored(rel, file.split('/').at(-1) ?? rel)) files.push(file)
    }
  }

  return [...new Set(files)]
}

/** Scan files once and keep the candidates that carry a marker. */
function scan(files: readonly string[], cwd: string): {
  candidates: Candidate[]
  scanned: number
  skippedLarge: number
} {
  const candidates: Candidate[] = []
  let scanned = 0
  let skippedLarge = 0

  for (const file of files) {
    let stats
    try {
      stats = statSync(file)
    } catch {
      continue
    }
    if (stats.size > MAX_SCAN_BYTES) {
      skippedLarge += 1
      continue
    }
    let buffer
    try {
      buffer = readFileSync(file)
    } catch {
      continue
    }
    if (buffer.includes(0)) continue
    const content = buffer.toString('utf8')
    scanned += 1
    const hit = content.split('\n').some((line) => lineHasMarker(line))
    if (!hit) continue
    candidates.push({ path: file, rel: relative(cwd, file) || file, content })
  }

  return { candidates, scanned, skippedLarge }
}

/** Parse the model's edit-plan JSON, tolerating a fenced block. */
function parseEdits(text: string): Edit[] | undefined {
  const trimmed = text.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let value: unknown
  try {
    value = JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  const edits = (value as { edits?: unknown }).edits
  if (!Array.isArray(edits)) return undefined

  const parsed: Edit[] = []
  for (const raw of edits) {
    if (raw === null || typeof raw !== 'object') continue
    const oldText = (raw as { oldText?: unknown }).oldText
    const newText = (raw as { newText?: unknown }).newText
    if (typeof oldText !== 'string' || oldText.length === 0 || typeof newText !== 'string') continue
    const category = (raw as { category?: unknown }).category
    parsed.push({
      oldText,
      newText,
      ...(typeof category === 'string' ? { category } : {}),
    })
    if (parsed.length >= 50) break
  }
  return parsed
}

/** Ask the model for one file's edit plan. */
async function planEdits(
  llm: LlmService,
  route: ModelRoute,
  sessionId: string,
  signal: AbortSignal,
  relativePath: string,
  content: string,
): Promise<Edit[]> {
  const messages = [
    {
      role: 'user',
      content: [{ type: 'text', text: buildFilePrompt(relativePath, content) }],
    },
  ] as LlmStreamOptions['messages']

  let info: LlmModelInfo | undefined
  try {
    info = await llm.resolveModelInfo?.(route.provider, route.model, signal)
  } catch {
    info = undefined
  }
  const efforts = (info?.reasoning?.efforts ?? []).map((effort) => effort.id)
  const reasoningEffort =
    efforts.length === 0 ? undefined : efforts.includes('off') ? 'off' : efforts.includes('low') ? 'low' : efforts[0]
  const maxTokens = Math.max(8192, Math.min(16384, info?.defaultMaxTokens ?? 8192))

  const run = async (effort: string | undefined): Promise<Edit[]> => {
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      messages,
      maxTokens,
      ...(effort === undefined ? {} : { reasoningEffort: effort }),
      sessionId,
      purpose: 'doc-positivize',
      signal,
    })

    let text = ''
    let finish: LlmChunk['reason']
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      else if (chunk.type === 'finish') finish = chunk.reason
    }
    if (finish !== undefined && finish.kind !== 'stop') {
      const detail = finish.failure?.message === undefined ? '' : `: ${finish.failure.message}`
      throw new Error(`model finished with ${finish.kind}${detail}`)
    }
    const edits = parseEdits(text)
    if (edits === undefined) throw new Error('model did not return the edit-plan JSON')
    return edits
  }

  try {
    return await run(reasoningEffort)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (reasoningEffort !== undefined && /reasoning effort/i.test(message)) return run(undefined)
    throw error
  }
}

/** Replace one exact substring once, reporting the line and action. */
function applyEdits(candidate: Candidate, edits: readonly Edit[]): {
  content: string
  changes: SweepChange[]
  skipped: SweepSkip[]
  diff?: string
  before?: string
  after?: string
  added?: number
  deleted?: number
} {
  let content = candidate.content
  const changes: SweepChange[] = []
  const skipped: SweepSkip[] = []

  for (const edit of edits) {
    const first = content.indexOf(edit.oldText)
    if (first < 0) {
      skipped.push({ path: candidate.rel, reason: 'oldText does not occur in the file' })
      continue
    }
    if (content.indexOf(edit.oldText, first + edit.oldText.length) >= 0) {
      skipped.push({ path: candidate.rel, reason: 'oldText occurs more than once' })
      continue
    }
    const line = content.slice(0, first).split('\n').length
    content = content.slice(0, first) + edit.newText + content.slice(first + edit.oldText.length)
    changes.push({
      path: candidate.rel,
      line,
      action: edit.newText.length === 0 ? 'delete' : 'rewrite',
      original: clip(edit.oldText),
      change: clip(edit.newText),
    })
  }

  if (changes.length === 0) return { content, changes, skipped }

  const diff = unifiedDiff(candidate.content, content)
  let added = 0
  let deleted = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added += 1
    else if (line.startsWith('-') && !line.startsWith('---')) deleted += 1
  }
  return {
    content,
    changes,
    skipped,
    diff,
    before: candidate.content,
    after: content,
    added,
    deleted,
  }
}

/** Marker hits left in an edited file. */
function remainingHits(relativePath: string, content: string): SweepRemaining[] {
  const remaining: SweepRemaining[] = []
  content.split('\n').forEach((line, index) => {
    if (!lineHasMarker(line)) return
    remaining.push({ path: relativePath, line: index + 1, snippet: clip(line.trim()) })
  })
  return remaining
}

/** Bound one report string. */
function clip(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_CHANGE_TEXT ? `${flat.slice(0, MAX_CHANGE_TEXT)}…` : flat
}

/** Render a thrown value without trusting its string coercion. */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    return 'unrenderable error'
  }
}

/**
 * Run one bounded sweep: scan, plan, apply, and re-verify.
 *
 * @param input - LLM route, workspace, scope, signal, and limits.
 * @returns the changed files, skipped edits, remaining hits, and notes.
 */
export async function runSweep(input: {
  readonly llm: LlmService
  readonly cwd: string
  readonly target?: string
  readonly signal: AbortSignal
  readonly route: ModelRoute
  readonly sessionId: string
  readonly limits: SweepLimits
  /** Called once after the scope is scanned, before the first model request. */
  readonly onScan?: (info: { readonly scanned: number; readonly candidates: number }) => void
  /** Called before each candidate is sent to the model. */
  readonly onProgress?: (progress: SweepProgress) => void
}): Promise<SweepResult> {
  const started = Date.now()
  const scope = input.target ?? 'the current workspace'
  if (input.signal.aborted) {
    return {
      scope,
      scanned: 0,
      candidates: 0,
      changedFiles: 0,
      changes: [],
      diffs: [],
      skipped: [],
      remaining: [],
      notes: ['scan stopped before it started'],
      cancelled: true,
    }
  }

  const files = expandScope(input.cwd, input.target, input.limits.ignoredPaths)
  if (files.length === 0) {
    throw new Error(
      `no files match ${input.target ?? 'the current workspace'} under ${input.cwd}; glob patterns are case-sensitive`,
    )
  }

  const { candidates, scanned, skippedLarge } = scan(files, input.cwd)
  const notes: string[] = []
  if (skippedLarge > 0) notes.push(`${skippedLarge} file(s) larger than ${MAX_SCAN_BYTES} bytes were skipped`)
  try {
    input.onScan?.({ scanned, candidates: candidates.length })
  } catch {
    // A host progress callback must never fail the sweep.
  }

  const changes: SweepChange[] = []
  const diffs: SweepFileDiff[] = []
  const skipped: SweepSkip[] = []
  const remaining: SweepRemaining[] = []
  const budget = Math.min(input.limits.maxFiles, candidates.length)
  let changedFiles = 0
  let cancelled = false

  if (input.signal.aborted) {
    return {
      scope,
      scanned,
      candidates: candidates.length,
      changedFiles,
      changes,
      diffs,
      skipped,
      remaining,
      notes: [...notes, 'scan stopped after scanning the scope; no file was changed'],
      cancelled: true,
    }
  }

  for (let index = 0; index < budget; index += 1) {
    const candidate = candidates[index]
    if (input.signal.aborted) {
      cancelled = true
      notes.push(`scan stopped while reviewing ${candidate.rel}`)
      break
    }
    if (Date.now() - started > input.limits.timeoutMs) {
      notes.push('time budget reached; remaining candidate files were left untouched')
      break
    }
    try {
      input.onProgress?.({ index: index + 1, total: budget, path: candidate.rel })
    } catch {
      // A host progress callback must never fail the sweep.
    }
    if (Buffer.byteLength(candidate.content, 'utf8') > input.limits.maxFileBytes) {
      skipped.push({ path: candidate.rel, reason: 'file exceeds maxFileBytes' })
      continue
    }

    let edits: Edit[]
    try {
      edits = await planEdits(input.llm, input.route, input.sessionId, input.signal, candidate.rel, candidate.content)
    } catch (error) {
      if (input.signal.aborted) {
        cancelled = true
        notes.push(`scan stopped while reviewing ${candidate.rel}`)
        break
      }
      skipped.push({ path: candidate.rel, reason: `model error: ${errorText(error)}` })
      continue
    }
    if (input.signal.aborted) {
      cancelled = true
      notes.push(`scan stopped before writing ${candidate.rel}`)
      break
    }

    const applied = applyEdits(candidate, edits)
    if (applied.changes.length > 0) {
      try {
        writeFileSync(candidate.path, applied.content)
        changedFiles += 1
        if (
          applied.diff !== undefined &&
          applied.before !== undefined &&
          applied.after !== undefined &&
          applied.added !== undefined &&
          applied.deleted !== undefined
        ) {
          diffs.push({
            path: candidate.rel,
            absolutePath: candidate.path,
            diff: applied.diff,
            before: applied.before,
            after: applied.after,
            added: applied.added,
            deleted: applied.deleted,
          })
        }
      } catch (error) {
        skipped.push({ path: candidate.rel, reason: `write failed: ${errorText(error)}` })
        continue
      }
    }
    changes.push(...applied.changes)
    skipped.push(...applied.skipped)
    remaining.push(...remainingHits(candidate.rel, applied.content))
  }

  if (cancelled) {
    notes.push(`scan stopped; ${changedFiles} file(s) had already been changed`)
  }
  if (candidates.length > budget) {
    notes.push(`${candidates.length - budget} candidate file(s) were left for a later run (maxFiles=${budget})`)
  }

  return {
    scope,
    scanned,
    candidates: candidates.length,
    changedFiles,
    changes,
    diffs,
    skipped,
    remaining,
    notes,
    cancelled,
  }
}
