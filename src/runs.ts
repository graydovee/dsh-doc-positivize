/**
 * In-memory registry for detached `/positivize` runs.
 *
 * One record carries the scan result the result card renders, the model route
 * and controller the Stop button aborts, and the two file contents each Undo
 * action restores. Records live only in this Host process: a card reopened
 * after a Host restart falls back to the command's compact summary.
 *
 * @module dsh-doc-positivize/runs
 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { diffHunks } from './diff'
import type { DiffHunk } from './diff'
import type { SweepProgress, SweepResult } from './sweep'

/** One run's user-visible lifecycle. */
export type RunStatus = 'running' | 'done' | 'cancelled' | 'failed'

/** One changed file as the result card renders it. */
export interface RunFileView {
  readonly path: string
  readonly added: number
  readonly deleted: number
  readonly undone: boolean
  readonly truncated: boolean
  readonly hunks: readonly DiffHunk[]
}

/** The complete card payload; file contents stay on the Host. */
export interface RunView {
  readonly runId: string
  readonly target: string | null
  readonly status: RunStatus
  readonly cancelling: boolean
  readonly startedAt: number
  readonly finishedAt: number | null
  readonly scanned: number
  readonly candidates: number
  readonly changedFiles: number
  readonly added: number
  readonly deleted: number
  readonly files: readonly RunFileView[]
  readonly skipped: readonly { readonly path: string; readonly reason: string }[]
  readonly remaining: readonly { readonly path: string; readonly line: number; readonly snippet: string }[]
  readonly notes: readonly string[]
  readonly progress: SweepProgress | null
  readonly error: string | null
  /** Absolute audit directory for this run, or null when auditing is off. */
  readonly auditPath: string | null
}

/** Stable failure codes the HTTP layer returns to the card. */
export type RunErrorCode =
  | 'run-not-found'
  | 'file-not-found'
  | 'still-running'
  | 'file-changed'
  | 'file-missing'
  | 'write-failed'

/** A refusal carrying the code and HTTP status the route answers with. */
export class RunError extends Error {
  readonly code: RunErrorCode
  readonly status: number

  /**
   * @param code - stable client-facing failure code.
   * @param status - HTTP status the route returns.
   * @param message - human-facing detail.
   */
  constructor(code: RunErrorCode, status: number, message: string) {
    super(message)
    this.name = 'RunError'
    this.code = code
    this.status = status
  }
}

/** One retained file and the two contents Undo compares. */
interface RunFileRecord {
  readonly path: string
  readonly absolutePath: string
  readonly realPath: string | null
  readonly added: number
  readonly deleted: number
  readonly hunks: readonly DiffHunk[]
  readonly truncated: boolean
  readonly before: string
  readonly after: string
  undone: boolean
}

/** One retained run. */
interface RunRecord {
  readonly runId: string
  readonly sessionId: string
  readonly cwd: string
  readonly target: string | null
  readonly auditPath: string | null
  readonly controller: AbortController
  readonly startedAt: number
  status: RunStatus
  cancelling: boolean
  finishedAt: number | null
  scanned: number
  candidates: number
  progress: SweepProgress | null
  files: RunFileRecord[]
  skipped: { readonly path: string; readonly reason: string }[]
  remaining: { readonly path: string; readonly line: number; readonly snippet: string }[]
  notes: string[]
  error: string | null
}

/** Completed runs retained per plugin instance. */
const MAX_RUNS = 12

/** Diff lines one file may carry in a card response. */
const MAX_RENDERED_HUNK_LINES = 1500

/**
 * Bound one file's hunks for the wire while keeping whole hunks intact.
 *
 * @param hunks - complete comparison.
 * @returns the hunks that fit and whether any hunk was dropped.
 */
function limitHunks(hunks: readonly DiffHunk[]): { hunks: DiffHunk[]; truncated: boolean } {
  const kept: DiffHunk[] = []
  let lines = 0
  for (const hunk of hunks) {
    if (lines + hunk.lines.length > MAX_RENDERED_HUNK_LINES) {
      return { hunks: kept, truncated: true }
    }
    kept.push(hunk)
    lines += hunk.lines.length
  }
  return { hunks: kept, truncated: false }
}

/** Resolve one path for the undo comparison, or null when it no longer exists. */
function realPathOf(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

/** Registry of detached runs with per-file undo. */
export class RunStore {
  private readonly runs = new Map<string, RunRecord>()

  /**
   * Record a run before its progress command event is appended, so the first
   * card request already finds it.
   *
   * @param input - run identity, workspace, scope, and the controller Stop aborts.
   */
  begin(input: {
    readonly runId: string
    readonly sessionId: string
    readonly cwd: string
    readonly target?: string
    readonly auditPath?: string | null
    readonly controller: AbortController
  }): void {
    this.runs.set(input.runId, {
      runId: input.runId,
      sessionId: input.sessionId,
      cwd: input.cwd,
      target: input.target === undefined || input.target.trim() === '' ? null : input.target,
      auditPath: input.auditPath ?? null,
      controller: input.controller,
      startedAt: Date.now(),
      status: 'running',
      cancelling: false,
      finishedAt: null,
      scanned: 0,
      candidates: 0,
      progress: null,
      files: [],
      skipped: [],
      remaining: [],
      notes: [],
      error: null,
    })
    this.prune()
  }

  /**
   * Publish the scope counts reached after scanning.
   *
   * @param runId - run to update.
   * @param info - scanned and candidate counts.
   */
  scan(runId: string, info: { readonly scanned: number; readonly candidates: number }): void {
    const record = this.runs.get(runId)
    if (record === undefined) return
    record.scanned = info.scanned
    record.candidates = info.candidates
  }

  /**
   * Publish the candidate currently under review.
   *
   * @param runId - run to update.
   * @param progress - one-based candidate position.
   */
  progress(runId: string, progress: SweepProgress): void {
    const record = this.runs.get(runId)
    if (record === undefined || record.status !== 'running') return
    record.progress = progress
  }

  /**
   * Settle a run with its complete or partial result.
   *
   * @param runId - run to settle.
   * @param result - the sweep result, including partial cancellation output.
   */
  complete(runId: string, result: SweepResult): void {
    const record = this.runs.get(runId)
    if (record === undefined) return
    record.status = result.cancelled ? 'cancelled' : 'done'
    record.cancelling = false
    record.finishedAt = Date.now()
    record.progress = null
    record.scanned = result.scanned
    record.candidates = result.candidates
    record.skipped = [...result.skipped]
    record.remaining = [...result.remaining]
    record.notes = [...result.notes]
    record.error = null
    record.files = result.diffs.map((file) => {
      const absolutePath = file.absolutePath ?? resolve(record.cwd, file.path)
      const limited = limitHunks(diffHunks(file.before, file.after).hunks)
      return {
        path: file.path,
        absolutePath,
        realPath: realPathOf(absolutePath),
        added: file.added,
        deleted: file.deleted,
        hunks: limited.hunks,
        truncated: limited.truncated,
        before: file.before,
        after: file.after,
        undone: false,
      }
    })
    this.prune()
  }

  /**
   * Settle a run with a failure that produced no usable result.
   *
   * @param runId - run to settle.
   * @param message - failure detail shown by the card.
   */
  fail(runId: string, message: string): void {
    const record = this.runs.get(runId)
    if (record === undefined) return
    record.status = 'failed'
    record.cancelling = false
    record.finishedAt = Date.now()
    record.progress = null
    record.error = message
    record.notes = []
    this.prune()
  }

  /**
   * Abort one running scan. A settled or already-stopped run is returned as is.
   *
   * @param runId - run to stop.
   * @returns the current view.
   */
  cancel(runId: string): RunView {
    const record = this.require(runId)
    if (record.status === 'running') {
      record.cancelling = true
      record.controller.abort()
    }
    return this.toView(record)
  }

  /**
   * Restore one file to its pre-scan content.
   *
   * The requested path selects a recorded file; the Host never resolves an
   * arbitrary client path. The file target must still be the one recorded at
   * settlement time, and its current content must still be the sweep's output.
   *
   * @param runId - run owning the file.
   * @param path - the recorded relative or absolute path shown by the card.
   * @returns the updated view.
   */
  undo(runId: string, path: string): RunView {
    const record = this.require(runId)
    if (record.status === 'running') {
      throw new RunError('still-running', 409, 'the scan is still running')
    }
    const file = record.files.find((candidate) => candidate.path === path)
    if (file === undefined) {
      throw new RunError('file-not-found', 404, 'that file is not part of this scan')
    }
    if (file.undone) return this.toView(record)
    if (file.realPath === null) {
      throw new RunError('file-missing', 409, 'the file no longer exists')
    }
    const currentRealPath = realPathOf(file.absolutePath)
    if (currentRealPath === null) {
      throw new RunError('file-missing', 409, 'the file no longer exists')
    }
    if (currentRealPath !== file.realPath) {
      throw new RunError('file-changed', 409, 'the file target changed after the scan; refusing to overwrite')
    }

    let current: string
    try {
      current = readFileSync(currentRealPath, 'utf8')
    } catch {
      throw new RunError('file-missing', 409, 'the file no longer exists')
    }
    if (current === file.before) {
      file.undone = true
      return this.toView(record)
    }
    if (current !== file.after) {
      throw new RunError('file-changed', 409, 'the file changed after the scan; refusing to overwrite')
    }
    try {
      writeFileSync(file.absolutePath, file.before)
    } catch (error) {
      throw new RunError(
        'write-failed',
        500,
        `could not restore the file: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    file.undone = true
    return this.toView(record)
  }

  /**
   * Read one run's card payload.
   *
   * @param runId - run to read.
   * @returns the view, or undefined when the Host no longer holds the run.
   */
  view(runId: string): RunView | undefined {
    const record = this.runs.get(runId)
    return record === undefined ? undefined : this.toView(record)
  }

  /** Abort every running scan and forget all records. */
  dispose(): void {
    for (const record of this.runs.values()) record.controller.abort()
    this.runs.clear()
  }

  /**
   * Forget one run that never reached its progress event.
   *
   * @param runId - run to drop.
   */
  discard(runId: string): void {
    this.runs.delete(runId)
  }

  /** Resolve one existing run or raise the route's not-found error. */
  private require(runId: string): RunRecord {
    const record = this.runs.get(runId)
    if (record === undefined) throw new RunError('run-not-found', 404, 'the scan result is no longer available')
    return record
  }

  /** Render the user-visible projection of one record. */
  private toView(record: RunRecord): RunView {
    let changedFiles = 0
    let added = 0
    let deleted = 0
    const files: RunFileView[] = record.files.map((file) => {
      if (!file.undone) {
        changedFiles += 1
        added += file.added
        deleted += file.deleted
      }
      return {
        path: file.path,
        added: file.added,
        deleted: file.deleted,
        undone: file.undone,
        truncated: file.truncated,
        hunks: file.hunks,
      }
    })
    return {
      runId: record.runId,
      target: record.target,
      status: record.status,
      cancelling: record.cancelling,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      scanned: record.scanned,
      candidates: record.candidates,
      changedFiles,
      added,
      deleted,
      files,
      skipped: record.skipped,
      remaining: record.remaining,
      notes: record.notes,
      progress: record.status === 'running' ? record.progress : null,
      error: record.error,
      auditPath: record.auditPath,
    }
  }

  /** Drop the oldest settled runs once the retention bound is exceeded. */
  private prune(): void {
    if (this.runs.size <= MAX_RUNS) return
    const settled = [...this.runs.values()]
      .filter((record) => record.status !== 'running')
      .sort((left, right) => left.startedAt - right.startedAt)
    for (const record of settled) {
      if (this.runs.size <= MAX_RUNS) break
      this.runs.delete(record.runId)
    }
  }
}
