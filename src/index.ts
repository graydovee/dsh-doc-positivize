import type { Context } from '@deepseek-ai/cordis'
import { Config } from './config'
import type { Config as ConfigShape } from './config'
import { composeGuard } from './guard'
import {
  COMMAND_DESCRIPTION,
  COMMAND_HINT,
  COMMAND_NAME,
  runDocPositivize,
  startDetachedDocPositivize,
} from './command'
import type { CommandInvocation, CommandRegistry } from './command'
import { registerRunRoutes } from './http'
import type { RouteContext } from './http'
import { RunStore } from './runs'
import { createAuditStore } from './audit'
import type { LlmService, SweepLimits } from './sweep'

/** Stable loader identity. */
export const name = 'dsh-doc-positivize'

/**
 * The prompt registry, the human-command registry, and the LLM service. All
 * three are part of `@deepseek-ai/dsh-base`, so every base-backed profile
 * mounts them before this plugin applies.
 */
export const inject = ['systemPrompt', 'commands', 'llm']

// Re-export the schema so the loader validates this plugin's row config, and
// the guard text plus the file-prompt builder so built-artifact checks can
// assert exactly what the plugin contributes.
export { Config }
export { GUARD_TEXT } from './guard'
export { buildFilePrompt } from './workflow'
// Audit helpers: read one run's records or rebuild an exact request for review.
export { readAuditRecords, reconstructPrompt, resolveAuditRoot } from './audit'

/**
 * Global-layer section name. `<owner>:<topic>` keeps it clear of first-party
 * names (`harness:identity`, `deployment:persona-*`, `ui:deliverable-file-references`).
 */
const SECTION_NAME = 'doc-positivize:guard'

/**
 * Placement inside the empty 5000 (`TOOLS_SDK`) → 9000
 * (`DELIVERABLE_FILE_REFERENCES`) band: after all tool guidance, before the
 * environment/derived block. External contributions may use any finite order;
 * `getSectionOrder()` only accepts the closed first-party name union, so the
 * number is written out here as a layout decision.
 */
const SECTION_ORDER = 6000

/** The system-prompt registry surface this plugin uses (no runtime import needed). */
interface PromptSection {
  readonly name: string
  readonly order: number
  readonly text: string | (() => string)
  readonly interpolate: boolean
}

interface SystemPromptService {
  section(section: PromptSection): () => void
}

/**
 * Read the injected prompt service through a structural type: the registry has
 * no runtime import here, so the plugin adds no peer/type dependency for it.
 *
 * @param ctx - plugin context carrying the injected `systemPrompt` service.
 * @returns the registry's `section()` surface.
 */
function systemPromptOf(ctx: Context): SystemPromptService {
  return (ctx as unknown as { systemPrompt: SystemPromptService }).systemPrompt
}

/**
 * Read the injected command registry through a structural type, for the same
 * reason: the registration surface is stable, and the command definition is
 * validated by the service at runtime.
 *
 * @param ctx - plugin context carrying the injected `commands` service.
 * @returns the registry's `register()` surface.
 */
function commandsOf(ctx: Context): CommandRegistry {
  return (ctx as unknown as { commands: CommandRegistry }).commands
}

/**
 * Read the injected LLM service through a structural type; the sweep calls it
 * directly in the host process, so no child agent or new session is created.
 *
 * @param ctx - plugin context carrying the injected `llm` service.
 * @returns the service's `stream()` surface.
 */
function llmOf(ctx: Context): LlmService {
  return (ctx as unknown as { llm: LlmService }).llm
}

/**
 * Register the always-on guard section and, unless disabled, the
 * `/sweep` command.
 *
 * Both registrations are effects owned by the calling plugin fiber: `section()`
 * and `register()` return the exact Cordis disposers, so unloading or
 * hot-reloading the plugin removes them and emits the registry change events.
 * The rendered prompt is recorded by agent-loop as a `system/message` node, and
 * the command runs its sweep in-process like `/compact`, so no extra session
 * event or projection is needed here.
 *
 * @param ctx - plugin context carrying the injected services.
 * @param config - validated row config (schema defaults already applied).
 */
export function apply(ctx: Context, config: ConfigShape): void {
  systemPromptOf(ctx).section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    // Literal text: the guard and any override may carry quotes, backticks, or
    // braces, and `interpolate: false` keeps `{{…}}` out of the prompt-variable
    // scanner on every model request. The function reads the live volatile
    // config, so the settings switch applies on the next assembly without a
    // plugin restart.
    interpolate: false,
    text: () => (config.guardEnabled.get() ? composeGuard(config.guard, config.extra) : ''),
  })

  if (!config.command) return

  const llm = llmOf(ctx)
  const runs = new RunStore()
  const audit = createAuditStore({
    enabled: config.auditEnabled,
    retainRuns: config.auditRuns,
    onError: (error) => ctx.logger.warn('doc-positivize audit trail disabled after a write failure', error),
    onRun: ({ runId, dir }) => ctx.logger.info(`doc-positivize audit: ${runId} -> ${dir}`),
  })
  let connectionReady = false
  ctx.effect(() => () => runs.dispose(), 'doc-positivize runs')

  // The result card's Stop and Undo actions use exact Fetch routes. They are
  // registered only while a Connection service is mounted; hosts without a Web
  // carrier keep the foreground command path and no card actions.
  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.effect(
      () => {
        const dispose = registerRunRoutes(connectionCtx as unknown as RouteContext, runs)
        connectionReady = true
        return () => {
          connectionReady = false
          dispose()
        }
      },
      'doc-positivize result routes',
    )
  })

  commandsOf(ctx).register({
    name: COMMAND_NAME,
    description: COMMAND_DESCRIPTION,
    input: { hint: COMMAND_HINT },
    handler: (invocation: CommandInvocation) => {
      const limits: SweepLimits = {
        ignoredPaths: config.ignoredPaths.get(),
        maxFiles: config.maxFiles,
        maxFileBytes: config.maxFileBytes,
        timeoutMs: config.timeoutMs,
      }
      if (!connectionReady) return runDocPositivize(llm, invocation, limits, audit)
      return startDetachedDocPositivize(llm, invocation, limits, runs, audit).result
    },
  })
}
