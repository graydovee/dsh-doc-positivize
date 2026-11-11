/**
 * The `/positivize` command: parse a human scope and run the sweep in the
 * host process.
 *
 * In the Web GUI the handler starts a detached run and returns immediately so
 * the composer clears; the progress command lifecycle carries the result card,
 * its Stop control and per-file Undo actions. Hosts without Connection run the
 * sweep in the foreground and return the full text report. Neither path creates
 * a model message or a child session.
 *
 * @module dsh-doc-positivize/command
 */
import { runSweep } from './sweep'
import type { LlmService, ModelRoute, SweepLimits, SweepResult } from './sweep'
import type { AuditStore } from './audit'
import type { RunStore } from './runs'

/** Human-facing command name. */
export const COMMAND_NAME = 'positivize'

/**
 * Log-only command name for the detached progress and result lifecycle.
 *
 * The command registry settles its own `positivize` invocation immediately,
 * so the background run records a second, independent lifecycle that the
 * result card keys on. This name never reaches the command catalog.
 */
export const PROGRESS_COMMAND_NAME = 'positivize-run'

/** One-line description shown in the command menu. */
export const COMMAND_DESCRIPTION =
  'Positivize documentation in one pass: rewrite negative or historical phrasing into positive descriptions, verify, and report'

/** Composer hint for the accepted arguments. */
export const COMMAND_HINT = '[target]'

const USAGE = 'Usage: /positivize [target]'

/** The invoking agent fields this command reads. */
export interface CommandAgent {
  readonly id: string
  readonly session: {
    readonly id: string
    readonly header: { readonly cwd?: string }
    requestHeader?: () =>
      | { readonly config?: { readonly provider?: string; readonly model?: string } }
      | undefined
    append?: (type: string, data: unknown) => { readonly seq: number }
  }
  readonly options?: { readonly provider?: string; readonly model?: string }
}

/** The command invocation fields this command reads. */
export interface CommandInvocation {
  readonly agent: CommandAgent
  readonly rawInput: string
  readonly signal: AbortSignal
}

/** The command result shape the command registry validates. */
export type CommandResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** The command registry surface this plugin contributes to. */
export interface CommandRegistration {
  readonly name: string
  readonly description: string
  readonly input: { readonly hint: string }
  readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>
}

/** The command registry surface this plugin uses. */
export interface CommandRegistry {
  register(definition: CommandRegistration): () => void
}

/** A parsed invocation: an optional scope. */
export type CommandInput =
  | { readonly ok: true; readonly target?: string }
  | { readonly ok: false; readonly usage: string }

/**
 * Read the raw command line.
 *
 * The whole line is the scope: a path, a glob, or a description. An empty line
 * sweeps the current workspace; a leading flag is a usage error.
 *
 * @param rawInput - text typed after the command name.
 * @returns the parsed scope, or usage text.
 */
export function parseCommandInput(rawInput: string): CommandInput {
  const trimmed = rawInput.trim()
  if (trimmed.length === 0) return { ok: true }
  if (trimmed.startsWith('-')) return { ok: false, usage: USAGE }
  return { ok: true, target: trimmed }
}

/**
 * Resolve the model the current session is using.
 *
 * @param agent - the invoking agent.
 * @returns the provider and model route.
 */
export function resolveRoute(agent: CommandAgent): ModelRoute {
  const config = agent.session.requestHeader?.()?.config
  if (config?.provider !== undefined && config.model !== undefined) {
    return { provider: config.provider, model: config.model }
  }
  if (agent.options?.provider !== undefined && agent.options.model !== undefined) {
    return { provider: agent.options.provider, model: agent.options.model }
  }
  throw new Error('no provider/model route is available for this session')
}

/**
 * Run one sweep and render its report for a non-Web command surface.
 *
 * The foreground path is used when no Connection service is present (CLI and
 * headless hosts), where there is no result card to carry the diff or the
 * per-file undo actions.
 *
 * @param llm - the host LLM service used for the per-file edit plans.
 * @param invocation - the invoking agent, the raw scope, and the UI signal.
 * @param limits - configured scan and time limits.
 * @returns the report as a human-facing command result.
 */
export async function runDocPositivize(
  llm: LlmService,
  invocation: CommandInvocation,
  limits: SweepLimits,
  audit?: AuditStore,
): Promise<CommandResult> {
  const parsed = parseCommandInput(invocation.rawInput)
  if (!parsed.ok) return { kind: 'error', text: parsed.usage }

  const cwd = invocation.agent.session.header.cwd ?? process.cwd()
  const runId = `fg-positivize-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  try {
    const route = resolveRoute(invocation.agent)
    const result = await runSweep({
      llm,
      cwd,
      target: parsed.target,
      signal: invocation.signal,
      route,
      sessionId: invocation.agent.session.id,
      limits,
      runId,
      detached: false,
      ...(audit === undefined ? {} : { audit: audit.sink }),
    })
    return { kind: 'success', text: renderReport(result) }
  } catch (error) {
    return { kind: 'error', text: `positivize: ${errorText(error)}` }
  }
}

/** One detached sweep handle: the immediate result plus its background settlement. */
export interface DetachedRun {
  readonly result: CommandResult
  readonly settled: Promise<void>
  readonly controller: AbortController
}

/**
 * Start one sweep in the background.
 *
 * The command returns immediately so the Web composer clears its draft. The
 * handler records the run before appending its progress lifecycle, so the
 * result card's first state request already finds it. The card reads the
 * structured diff and drives Stop/Undo through the exact Fetch routes; the
 * command's own done text is a compact fallback for hosts that cannot serve
 * the card.
 *
 * @param llm - host LLM service for the per-file edit plans.
 * @param invocation - invoking agent, raw scope, and submission signal.
 * @param limits - configured scan and time limits.
 * @param runs - in-memory run registry shared with the HTTP routes.
 * @returns the immediate command result and the background settlement.
 */
export function startDetachedDocPositivize(
  llm: LlmService,
  invocation: CommandInvocation,
  limits: SweepLimits,
  runs: RunStore,
  audit?: AuditStore,
): DetachedRun {
  const parsed = parseCommandInput(invocation.rawInput)
  if (!parsed.ok) {
    return {
      result: { kind: 'error', text: parsed.usage },
      settled: Promise.resolve(),
      controller: new AbortController(),
    }
  }

  const session = invocation.agent.session
  const append = session.append?.bind(session)
  if (append === undefined) {
    return {
      result: { kind: 'error', text: 'positivize: this host cannot run detached commands.' },
      settled: Promise.resolve(),
      controller: new AbortController(),
    }
  }

  let route: ModelRoute
  try {
    route = resolveRoute(invocation.agent)
  } catch (error) {
    return {
      result: { kind: 'error', text: `positivize: ${errorText(error)}` },
      settled: Promise.resolve(),
      controller: new AbortController(),
    }
  }

  const cwd = session.header.cwd ?? process.cwd()
  const runId = `cmd-positivize-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const controller = new AbortController()
  runs.begin({ runId, sessionId: session.id, cwd, target: parsed.target, controller, auditPath: audit?.runDir(runId) ?? undefined })
  try {
    append('command/run', {
      commandId: runId,
      name: PROGRESS_COMMAND_NAME,
      args: invocation.rawInput,
      source: { kind: 'user' },
    })
  } catch (error) {
    runs.discard(runId)
    return {
      result: { kind: 'error', text: `positivize: ${errorText(error)}` },
      settled: Promise.resolve(),
      controller,
    }
  }

  const settled = (async () => {
    try {
      const result = await runSweep({
        llm,
        cwd,
        target: parsed.target,
        signal: controller.signal,
        route,
        sessionId: session.id,
        limits,
        runId,
        detached: true,
        ...(audit === undefined ? {} : { audit: audit.sink }),
        onScan: (info) => runs.scan(runId, info),
        onProgress: (progress) => runs.progress(runId, progress),
      })
      runs.complete(runId, result)
      try {
        append('command/done', {
          commandId: runId,
          kind: 'success',
          text: renderSummary(result),
        })
      } catch {
        // The session was disposed before the background sweep settled.
      }
    } catch (error) {
      const message = errorText(error)
      runs.fail(runId, message)
      try {
        append('command/done', { commandId: runId, kind: 'error', text: `positivize: ${message}` })
      } catch {
        // The session was disposed before the background sweep settled.
      }
    }
  })().catch(() => {})

  return { result: { kind: 'success' }, settled, controller }
}

/** Render the compact result the progress command carries for fallback hosts. */
export function renderSummary(result: SweepResult): string {
  const rewrites = result.changes.filter((change) => change.action === 'rewrite').length
  const deletions = result.changes.length - rewrites
  const lines = [
    `positivize — ${result.scope}${result.cancelled ? ' (terminated)' : ''}`,
    '',
    `${result.cancelled ? 'Terminated' : 'Finished'}: scanned ${result.scanned} file(s); ${result.candidates} carried markers; ${result.changedFiles} file(s) changed (${rewrites} rewrite(s), ${deletions} deletion(s)).`,
  ]

  if (result.changes.length > 0) {
    lines.push('', 'Changed:')
    for (const change of result.changes) lines.push(`[${change.action}] ${change.path}:${change.line}`)
  }

  if (result.skipped.length > 0) lines.push('', `Skipped ${result.skipped.length} file(s).`)
  if (result.remaining.length > 0) lines.push('', `Remaining marker hits: ${result.remaining.length}.`)
  if (result.notes.length > 0) {
    lines.push('', 'Notes:')
    for (const note of result.notes) lines.push(`- ${note}`)
  }

  if (result.changedFiles === 0 && result.remaining.length === 0 && result.notes.length === 0) {
    lines.push('', 'No negative phrasing was found in scope.')
  }

  return lines.join('\n')
}

/** Render one sweep result as the command report. */
export function renderReport(result: SweepResult): string {
  const rewrites = result.changes.filter((change) => change.action === 'rewrite').length
  const deletions = result.changes.length - rewrites
  const lines = [
    `positivize — ${result.scope}${result.cancelled ? ' (terminated)' : ''}`,
    '',
    `Scanned ${result.scanned} file(s); ${result.candidates} carried markers; ${result.changedFiles} file(s) changed (${rewrites} rewrite(s), ${deletions} deletion(s)).`,
  ]

  if (result.changes.length > 0) {
    lines.push('', 'Changed:')
    for (const change of result.changes) lines.push(`[${change.action}] ${change.path}:${change.line}`)
  }

  if (result.diffs.length > 0) {
    lines.push('', 'Diff:')
    for (const file of result.diffs) {
      lines.push(`--- a/${file.path}`, `+++ b/${file.path}`, file.diff)
    }
  }

  if (result.skipped.length > 0) {
    lines.push('', 'Skipped:')
    for (const skip of result.skipped) lines.push(`- ${skip.path}: ${skip.reason}`)
  }

  if (result.remaining.length > 0) {
    lines.push('', 'Remaining markers (reviewed as exemptions):')
    for (const remaining of result.remaining) {
      lines.push(`- ${remaining.path}:${remaining.line} ${JSON.stringify(remaining.snippet)}`)
    }
  }

  if (result.notes.length > 0) {
    lines.push('', 'Notes:')
    for (const note of result.notes) lines.push(`- ${note}`)
  }

  if (result.candidates === 0 && result.remaining.length === 0 && result.notes.length === 0) {
    lines.push('', 'No negative phrasing was found in scope.')
  }

  return lines.join('\n')
}

/** Render a thrown value from its message or a safe string conversion. */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    return 'unrenderable error'
  }
}
