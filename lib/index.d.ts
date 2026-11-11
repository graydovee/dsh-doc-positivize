import Schema from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
/** A resolved volatile field: read the current immutable snapshot for one operation. */
interface VolatileValue<T> {
  get(): T;
}
/**
 * Row config for the plugin.
 *
 * The built-in guard is the default, so a row with no `config` mounts the full
 * documentation-positivize contract and the `/positivize` command. Every key is tunable from
 * `cordis.yml` and from the plugin's configuration card in the Plugins page.
 */
interface Config {
  /** Whether to mount the always-on guard section. */
  guardEnabled: VolatileValue<boolean>;
  /** The complete always-on guard section. */
  guard: string;
  /** Project-specific guidance appended after a blank line; empty contributes nothing. */
  extra: string;
  /** Whether to register the `/positivize` sweep command. */
  command: boolean;
  /** File and directory names or globs the sweep skips. */
  ignoredPaths: VolatileValue<readonly string[]>;
  /** Maximum candidate files swept in one run. */
  maxFiles: number;
  /** Maximum bytes of one file sent to the model. */
  maxFileBytes: number;
  /** Time budget for one run, in milliseconds. */
  timeoutMs: number;
  /** Whether each sweep request is recorded in the plugin's audit trail. */
  auditEnabled: boolean;
  /** How many completed audit run directories to keep. */
  auditRuns: number;
}
/**
 * Validated config: the harness rejects a row whose values fail this schema at
 * load time, so a malformed guard value fails loud.
 */
declare const Config: Schema<Schemastery.ObjectS<NoInfer<{
  guardEnabled: Schema<boolean, boolean, "volatile-defined">;
  guard: Schema<string, string, "defined">;
  extra: Schema<string, string, "defined">;
  command: Schema<boolean, boolean, "defined">;
  ignoredPaths: Schema<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
  maxFiles: Schema<number, number, "defined">;
  maxFileBytes: Schema<number, number, "defined">;
  timeoutMs: Schema<number, number, "defined">;
  auditEnabled: Schema<boolean, boolean, "defined">;
  auditRuns: Schema<number, number, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
  guardEnabled: Schema<boolean, boolean, "volatile-defined">;
  guard: Schema<string, string, "defined">;
  extra: Schema<string, string, "defined">;
  command: Schema<boolean, boolean, "defined">;
  ignoredPaths: Schema<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
  maxFiles: Schema<number, number, "defined">;
  maxFileBytes: Schema<number, number, "defined">;
  timeoutMs: Schema<number, number, "defined">;
  auditEnabled: Schema<boolean, boolean, "defined">;
  auditRuns: Schema<number, number, "defined">;
}>>, "plain">;
/**
 * The always-on documentation-positivize contract contributed to the system prompt.
 *
 * The text is the English rendering of the doc-positivize guard: it states the
 * final-state rule, the absence-is-negation rule, and the affirmative-standard
 * rule in positive form. The default passes the marker-scan test with zero
 * hits and stays in English, like every first-party prompt section.
 *
 * @module dsh-doc-positivize/guard
 */
/** Default guard: write artefacts that describe the state that ships. */
declare const GUARD_TEXT = "Write every artefact so it describes the state that ships.\n\n- State the final state only: code, comments, commit and MR/PR titles and descriptions, documentation, and prompts describe the current design and behaviour as if it had been designed that way from the start.\n- Absence is negation: when a feature, behaviour, or earlier plan leaves the design, remove its description from the code, prose, comments, commit/MR text, and prompts along with it, keeping only the accepted design (for example, write \"Title: tomato and egg stir-fry\"; record a decision note only for a major breaking migration or when the user asks for one).\n- Affirmative is the standard: when writing rules, prompts, tool schemas, and comments, state the one positive practice and the condition that triggers it; delete superseded tools and old concepts from the code and documentation.";
/**
 * Build the prompt for one file's rewrite plan with the current rules.
 *
 * @param relativePath - file path relative to the scanned scope root.
 * @param content - complete file text.
 * @returns rules plus the path and content envelope.
 */
declare function buildFilePrompt(relativePath: string, content: string): string;
/** One parsed audit record, typed loosely so unknown future fields survive. */
type AuditRecord = Record<string, unknown> & {
  readonly v?: number;
  readonly type?: string;
};
/** Default audit root: the plugin's own directory under the harness home. */
declare function resolveAuditRoot(): string;
/**
 * Read one run's JSONL records, skipping torn or unparsable lines.
 *
 * @param runDir - absolute run directory.
 * @returns the parsed records in append order.
 */
declare function readAuditRecords(runDir: string): AuditRecord[];
/**
 * Rebuild the exact prompt one request sent.
 *
 * @param runDir - absolute run directory.
 * @param seq - the request's candidate sequence number.
 * @returns the reconstructed prompt, or null when the records are incomplete.
 */
declare function reconstructPrompt(runDir: string, seq: number): string | null;
/** Stable loader identity. */
declare const name = "dsh-doc-positivize";
/**
 * The prompt registry, the human-command registry, and the LLM service. All
 * three are part of `@deepseek-ai/dsh-base`, so every base-backed profile
 * mounts them before this plugin applies.
 */
declare const inject: string[];
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
declare function apply(ctx: Context, config: Config): void;
export { Config, GUARD_TEXT, apply, buildFilePrompt, inject, name, readAuditRecords, reconstructPrompt, resolveAuditRoot };