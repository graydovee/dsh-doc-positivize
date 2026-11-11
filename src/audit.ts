/**
 * Durable audit trail for the sweep's auxiliary model requests.
 *
 * The sweep calls the LLM service directly, so the session log carries no
 * record of what was sent to the model. This harness offers external plugins
 * no public way to append a custom session event (the known event vocabulary
 * is generated in-repo, `Session.append` does not expose the ignorable
 * envelope, and `appendPluginRecord` is limited to in-repo experimental
 * packages). The plugin therefore keeps its own record: one directory per run,
 * an append-only JSONL timeline, and content-addressed blobs for the exact
 * bytes sent and received.
 *
 * Every prompt is reconstructable: the run records the rules text once, each
 * request records the file's path, blob and prompt hash, and
 * {@link reconstructPrompt} rebuilds the exact prompt from those records.
 *
 * @module dsh-doc-positivize/audit
 */
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildFilePrompt, buildPrompt, SWEEP_RULES } from './workflow'

/** Audit record schema version, written on every record. */
export const AUDIT_VERSION = 1

/** Directory (under the resolved harness home) the plugin owns. */
export const AUDIT_DIRECTORY = 'doc-positivize'

const RUNS_DIRECTORY = 'runs'
const BLOBS_DIRECTORY = 'blobs'
const RUN_FILE = 'run.jsonl'
const BLOB_MARKER = `${BLOBS_DIRECTORY}/`

/** One attempt's terminal state. */
export type AuditOutcome = 'ok' | 'error' | 'cancelled'

/** One run's terminal state. */
export type AuditRunStatus = 'done' | 'cancelled' | 'failed'

/** One applied edit, clipped the same way the result card clips it. */
export interface AuditAppliedEdit {
  readonly line: number
  readonly action: string
  readonly original: string
  readonly change: string
}

/** One skipped edit. */
export interface AuditSkippedEdit {
  readonly reason: string
}

/** Run identity and the environment captured before scanning. */
export interface AuditRunStart {
  readonly runId: string
  readonly sessionId: string
  readonly cwd: string
  readonly scope: string
  readonly detached: boolean
  readonly provider: string
  readonly model: string
  readonly limits: {
    readonly maxFiles: number
    readonly maxFileBytes: number
    readonly timeoutMs: number
  }
}

/** One candidate file whose exact bytes were sent to the model. */
export interface AuditFile {
  readonly seq: number
  readonly path: string
  readonly content: string
}

/** One model request, written before dispatch so a crash still leaves evidence. */
export interface AuditRequest {
  readonly seq: number
  readonly attempt: number
  readonly provider: string
  readonly model: string
  readonly maxTokens: number
  readonly reasoningEffort: string | null
}

/** One attempt's result, including the raw output or failure text. */
export interface AuditRequestResult {
  readonly seq: number
  readonly attempt: number
  readonly outcome: AuditOutcome
  readonly durationMs: number
  readonly rawText: string
  readonly finish?: unknown
  readonly usage?: unknown
  readonly error?: string
}

/** What the sweep did with one file after parsing the model's edit plan. */
export interface AuditApply {
  readonly seq: number
  readonly path: string
  readonly wrote: boolean
  readonly applied: readonly AuditAppliedEdit[]
  readonly skipped: readonly AuditSkippedEdit[]
}

/** How one run ended. */
export interface AuditRunEnd {
  readonly status: AuditRunStatus
  readonly changedFiles: number
  readonly edits: number
  readonly skipped: number
  readonly notes: readonly string[]
  readonly error?: string
}

/** The sink the sweep writes to; every method is a no-op when auditing is off. */
export interface AuditSink {
  beginRun(info: AuditRunStart): void
  scan(runId: string, info: { readonly scanned: number; readonly candidates: number }): void
  skip(runId: string, info: { readonly seq: number; readonly path: string; readonly reason: string }): void
  file(runId: string, info: AuditFile): void
  request(runId: string, info: AuditRequest): void
  requestResult(runId: string, info: AuditRequestResult): void
  apply(runId: string, info: AuditApply): void
  endRun(runId: string, info: AuditRunEnd): void
}

/** The store: the shared sink plus the deterministic run directory. */
export interface AuditStore {
  readonly sink: AuditSink
  readonly root: string
  /**
   * Absolute directory of one run.
   *
   * The path is derived from the run id, so it is known before {@link AuditSink.beginRun}
   * creates the directory.
   *
   * @param runId - the run whose directory is wanted.
   * @returns the absolute directory, or null when auditing is disabled.
   */
  runDir(runId: string): string | null
}

/** One parsed audit record, typed loosely so unknown future fields survive. */
export type AuditRecord = Record<string, unknown> & {
  readonly v?: number
  readonly type?: string
}

interface FileFacts {
  readonly path: string
  readonly sha256: string
  readonly blob: string
  readonly promptSha256: string
}

interface RunState {
  readonly dir: string
  readonly file: string
  readonly files: Map<number, FileFacts>
  usable: boolean
}

/** SHA-256 hex digest of one string or buffer. */
function sha256Of(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

/** Keep a JSON-safe copy of an optional provider value, or undefined. */
function jsonSafe(value: unknown): unknown {
  if (value === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(value)) as unknown
  } catch {
    return undefined
  }
}

/**
 * Resolve the harness home exactly like `@deepseek-ai/dsh-home-paths`: an
 * explicit `$DSH_HOME` wins, else `~/.dsh`. The plugin resolves it locally so
 * it needs no harness dependency at install time.
 */
export function resolveDshHome(): string {
  const configured = process.env.DSH_HOME
  if (configured !== undefined && configured.trim() !== '') return configured.trim()
  return join(homedir(), '.dsh')
}

/** Default audit root: the plugin's own directory under the harness home. */
export function resolveAuditRoot(): string {
  return join(resolveDshHome(), AUDIT_DIRECTORY)
}

/** Options accepted by {@link createAuditStore}. */
export interface AuditStoreOptions {
  /** Whether any I/O happens; false returns a no-op sink. */
  readonly enabled: boolean
  /** How many completed run directories to keep, including the new one. */
  readonly retainRuns: number
  /** Override the audit root; tests use a temporary directory. */
  readonly root?: string
  /** Called once when auditing degrades after an I/O failure. */
  readonly onError?: (error: unknown) => void
  /** Called once per run after its directory exists, for host-visible logging. */
  readonly onRun?: (info: { readonly runId: string; readonly dir: string }) => void
}

/** A sink that does nothing, used when auditing is disabled. */
function noopSink(): AuditSink {
  return {
    beginRun: () => {},
    scan: () => {},
    skip: () => {},
    file: () => {},
    request: () => {},
    requestResult: () => {},
    apply: () => {},
    endRun: () => {},
  }
}

/**
 * Create the audit store.
 *
 * Writing is synchronous and best-effort: a failure disables auditing for the
 * rest of the process after one callback, and never changes the sweep outcome.
 *
 * @param options - enabled flag, retention, optional root and error callback.
 * @returns the store, exposing the sink and the run directory.
 */
export function createAuditStore(options: AuditStoreOptions): AuditStore {
  const enabled = options.enabled
  const retainRuns = Math.max(1, Math.trunc(options.retainRuns))
  const root = options.root ?? resolveAuditRoot()
  const runs = new Map<string, RunState>()
  let warned = false

  const fail = (error: unknown): void => {
    if (warned) return
    warned = true
    try {
      options.onError?.(error)
    } catch {
      // The error reporter must never fail the sweep.
    }
  }

  /** Delete the oldest run directories, keeping room for the new one. */
  const prune = (): void => {
    const base = join(root, RUNS_DIRECTORY)
    let names: string[]
    try {
      names = readdirSync(base)
    } catch {
      return
    }
    const entries: { name: string; mtimeMs: number }[] = []
    for (const name of names) {
      const dir = join(base, name)
      try {
        if (!statSync(dir).isDirectory()) continue
        entries.push({ name, mtimeMs: statSync(dir).mtimeMs })
      } catch {
        // A racing removal is fine.
      }
    }
    // The new run's directory exists by now, so keeping `retainRuns` newest
    // entries keeps the run that is starting plus its predecessors.
    entries.sort((left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name))
    const excess = entries.length - retainRuns
    for (let index = 0; index < excess; index += 1) {
      try {
        rmSync(join(base, entries[index].name), { recursive: true, force: true })
      } catch {
        // Retention is best-effort.
      }
    }
  }

  const stateOf = (runId: string): RunState | undefined => {
    const state = runs.get(runId)
    return state?.usable === true ? state : undefined
  }

  const append = (state: RunState, record: Record<string, unknown>): void => {
    try {
      appendFileSync(state.file, `${JSON.stringify(record)}\n`, { mode: 0o600 })
    } catch (error) {
      state.usable = false
      fail(error)
    }
  }

  /** Write one content-addressed blob and return its relative name. */
  const writeBlob = (state: RunState, content: string): string | undefined => {
    const digest = sha256Of(content)
    const path = join(state.dir, BLOBS_DIRECTORY, digest)
    if (!existsSync(path)) {
      try {
        writeFileSync(path, content, { flag: 'wx', mode: 0o600 })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          state.usable = false
          fail(error)
          return undefined
        }
      }
    }
    return `${BLOB_MARKER}${digest}`
  }

  const sink: AuditSink = {
    beginRun: (info) => {
      if (!enabled) return
      try {
        const dir = join(root, RUNS_DIRECTORY, info.runId)
        mkdirSync(join(dir, BLOBS_DIRECTORY), { recursive: true, mode: 0o700 })
        prune()
        const state: RunState = {
          dir,
          file: join(dir, RUN_FILE),
          files: new Map(),
          usable: true,
        }
        runs.set(info.runId, state)
        append(state, {
          v: AUDIT_VERSION,
          type: 'run-start',
          at: Date.now(),
          ...info,
          rules: { sha256: sha256Of(SWEEP_RULES), text: SWEEP_RULES },
        })
        try {
          options.onRun?.({ runId: info.runId, dir })
        } catch {
          // A host logger callback must never fail the sweep.
        }
      } catch (error) {
        fail(error)
      }
    },

    scan: (runId, info) => {
      const state = stateOf(runId)
      if (state === undefined) return
      append(state, { v: AUDIT_VERSION, type: 'scan', runId, at: Date.now(), ...info })
    },

    skip: (runId, info) => {
      const state = stateOf(runId)
      if (state === undefined) return
      append(state, { v: AUDIT_VERSION, type: 'skip', runId, at: Date.now(), ...info })
    },

    file: (runId, info) => {
      const state = stateOf(runId)
      if (state === undefined) return
      const blob = writeBlob(state, info.content)
      if (blob === undefined) return
      const facts: FileFacts = {
        path: info.path,
        sha256: sha256Of(info.content),
        blob,
        promptSha256: sha256Of(buildFilePrompt(info.path, info.content)),
      }
      state.files.set(info.seq, facts)
      append(state, {
        v: AUDIT_VERSION,
        type: 'file',
        runId,
        seq: info.seq,
        at: Date.now(),
        path: facts.path,
        bytes: Buffer.byteLength(info.content, 'utf8'),
        sha256: facts.sha256,
        blob: facts.blob,
        promptSha256: facts.promptSha256,
      })
    },

    request: (runId, info) => {
      const state = stateOf(runId)
      if (state === undefined) return
      const facts = state.files.get(info.seq)
      if (facts === undefined) return
      append(state, {
        v: AUDIT_VERSION,
        type: 'request',
        runId,
        at: Date.now(),
        ...info,
        path: facts.path,
        sha256: facts.sha256,
        blob: facts.blob,
        promptSha256: facts.promptSha256,
      })
    },

    requestResult: (runId, info) => {
      const state = stateOf(runId)
      if (state === undefined) return
      const blob = writeBlob(state, info.rawText)
      if (blob === undefined) return
      const finish = jsonSafe(info.finish)
      const usage = jsonSafe(info.usage)
      append(state, {
        v: AUDIT_VERSION,
        type: 'request-result',
        runId,
        seq: info.seq,
        attempt: info.attempt,
        outcome: info.outcome,
        durationMs: info.durationMs,
        at: Date.now(),
        ...(finish === undefined ? {} : { finish }),
        ...(usage === undefined ? {} : { usage }),
        ...(info.error === undefined ? {} : { error: info.error }),
        output: {
          sha256: sha256Of(info.rawText),
          bytes: Buffer.byteLength(info.rawText, 'utf8'),
          blob,
        },
      })
    },

    apply: (runId, info) => {
      const state = stateOf(runId)
      if (state === undefined) return
      append(state, {
        v: AUDIT_VERSION,
        type: 'apply',
        runId,
        seq: info.seq,
        at: Date.now(),
        path: info.path,
        wrote: info.wrote,
        applied: info.applied,
        skipped: info.skipped,
      })
    },

    endRun: (runId, info) => {
      const state = stateOf(runId)
      if (state === undefined) return
      append(state, {
        v: AUDIT_VERSION,
        type: 'run-end',
        runId,
        at: Date.now(),
        ...info,
      })
      state.usable = false
      runs.delete(runId)
    },
  }

  return {
    sink: enabled ? sink : noopSink(),
    root,
    runDir: (runId) => (enabled ? join(root, RUNS_DIRECTORY, runId) : null),
  }
}

/**
 * Read one run's JSONL records, skipping torn or unparsable lines.
 *
 * @param runDir - absolute run directory.
 * @returns the parsed records in append order.
 */
export function readAuditRecords(runDir: string): AuditRecord[] {
  const file = join(runDir, RUN_FILE)
  if (!existsSync(file)) return []
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const records: AuditRecord[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      const value: unknown = JSON.parse(line)
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) records.push(value as AuditRecord)
    } catch {
      // A partially written trailing line is not evidence of anything.
    }
  }
  return records
}

/**
 * Rebuild the exact prompt one request sent.
 *
 * @param runDir - absolute run directory.
 * @param seq - the request's candidate sequence number.
 * @returns the reconstructed prompt, or null when the records are incomplete.
 */
export function reconstructPrompt(runDir: string, seq: number): string | null {
  const records = readAuditRecords(runDir)
  const start = records.find((record) => record.type === 'run-start')
  const request = records.find((record) => record.type === 'request' && record.seq === seq)
  if (start === undefined || request === undefined) return null
  const rules = start.rules
  const rulesText =
    typeof rules === 'object' && rules !== null && typeof (rules as { text?: unknown }).text === 'string'
      ? (rules as { text: string }).text
      : undefined
  const path = typeof request.path === 'string' ? request.path : undefined
  const blob = typeof request.blob === 'string' ? request.blob : undefined
  if (rulesText === undefined || path === undefined || blob === undefined) return null
  try {
    const content = readFileSync(join(runDir, blob), 'utf8')
    // buildFilePrompt writes the rules itself; assert the recorded rules are
    // the ones the prompt builder uses for this run.
    return rulesText === SWEEP_RULES
      ? buildFilePrompt(path, content)
      : buildPrompt(rulesText, path, content)
  } catch {
    return null
  }
}
