import Schema from '@deepseek-ai/schemastery'
import { GUARD_TEXT } from './guard'

/** Built-in ignore list for the sweep; every entry is a file name, directory name, or glob. */
export const DEFAULT_IGNORED_PATHS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.pnpm-store',
  '.pnpm-cache',
  '.pack',
  'target',
  'vendor',
  '.venv',
  '__pycache__',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
]

/** A resolved volatile field: read the current immutable snapshot for one operation. */
export interface VolatileValue<T> {
  get(): T
}

/**
 * Row config for the plugin.
 *
 * The built-in guard is the default, so a row with no `config` mounts the full
 * documentation-positivize contract and the `/positivize` command. Every key is tunable from
 * `cordis.yml` and from the plugin's configuration card in the Plugins page.
 */
export interface Config {
  /** Whether to mount the always-on guard section. */
  guardEnabled: VolatileValue<boolean>
  /** The complete always-on guard section. */
  guard: string
  /** Project-specific guidance appended after a blank line; empty contributes nothing. */
  extra: string
  /** Whether to register the `/positivize` sweep command. */
  command: boolean
  /** File and directory names or globs the sweep skips. */
  ignoredPaths: VolatileValue<readonly string[]>
  /** Maximum candidate files swept in one run. */
  maxFiles: number
  /** Maximum bytes of one file sent to the model. */
  maxFileBytes: number
  /** Time budget for one run, in milliseconds. */
  timeoutMs: number
  /** Whether each sweep request is recorded in the plugin's audit trail. */
  auditEnabled: boolean
  /** How many completed audit run directories to keep. */
  auditRuns: number
}

/**
 * Validated config: the harness rejects a row whose values fail this schema at
 * load time, so a malformed guard value fails loud.
 */
export const Config = Schema.object({
  guardEnabled: Schema.boolean()
    .default(true)
    .volatile()
    .description('Mount the always-on doc-positivize guard in the system prompt.'),
  guard: Schema.string()
    .default(GUARD_TEXT)
    .description('System-prompt doc-positivize guard contributed by dsh-doc-positivize.'),
  extra: Schema.string()
    .default('')
    .description('Project-specific guidance appended after the built-in guard.'),
  command: Schema.boolean()
    .default(true)
    .description('Register the /positivize sweep command.'),
  ignoredPaths: Schema.array(Schema.string())
    .default([...DEFAULT_IGNORED_PATHS])
    .volatile()
    .description('File and directory names or globs the /positivize sweep skips.'),
  maxFiles: Schema.natural()
    .min(1)
    .default(12)
    .description('Maximum candidate files swept in one run; at least 1.'),
  maxFileBytes: Schema.natural()
    .min(1)
    .default(96000)
    .description('Maximum bytes of one file sent to the model; at least 1.'),
  timeoutMs: Schema.natural()
    .min(1000)
    .default(180000)
    .description('Time budget for one sweep, in milliseconds; at least 1000.'),
  auditEnabled: Schema.boolean()
    .default(true)
    .description('Record each sweep request and its exact file bytes under the harness home.'),
  auditRuns: Schema.natural()
    .min(1)
    .default(20)
    .description('How many completed audit run directories to keep; at least 1.'),
})
