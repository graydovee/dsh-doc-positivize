/**
 * The doc-positivize sweep rules and the per-file rewrite request.
 *
 * The command runs the sweep in the host process, the way `/compact` runs its
 * own work: it scans files with the marker list, asks the session's model for a
 * minimal JSON edit plan one file at a time, applies the edits, verifies, and
 * reports. No child agent and no new session are created, so the calling
 * conversation keeps its context.
 *
 * @module dsh-doc-positivize/workflow
 */

/** Negative markers the sweep searches for, copied verbatim from the reference project. */
export const CHINESE_MARKERS = '不要|绝不|严禁|禁止|切勿|避免|请勿|不得|不再支持|不再使用|已移除|已废弃|已删除|千万别|不含|没有使用|而不是'

/** The English half of the same search, matched case-insensitively. */
export const ENGLISH_MARKERS = "\\b(do not|don't|never|avoid|must not|should not|deprecated|removed|no longer|without|instead of)\\b"

const CHINESE_PATTERN = new RegExp(`(?:${CHINESE_MARKERS})`)
const ENGLISH_PATTERN = new RegExp(ENGLISH_MARKERS, 'i')

/**
 * Whether one line carries a negative or historical marker.
 *
 * @param line - one source or prose line.
 * @returns whether the Chinese or English marker scan hits it.
 */
export function lineHasMarker(line: string): boolean {
  return CHINESE_PATTERN.test(line) || ENGLISH_PATTERN.test(line)
}

/** Per-file rules handed to the model with the file content. */
export const SWEEP_RULES = `You are the doc-positivize sweep engine. Read one file and return only a JSON object of minimal edits.

Principle: absence is negation; affirmative is the standard. State each effective constraint as the one positive practice, and erase the superseded name from the rewritten sentence. Delete retired tools, concepts, rejected plans, and historical correction notes from code, prose, and prompts.

Five categories and their remedy:
1. Iteration residue or reverse declarations -> delete the tail and keep the final state.
2. Retired concepts and historical ghosts -> delete the whole passage.
3. Tombstone comments and change history -> delete; keep one sentence explaining why the current implementation satisfies a non-obvious technical constraint.
4. Effective behavioural constraints -> rewrite as the single positive instruction naming the standard tool, type, or entry point, with the superseded name erased.
5. Tool or schema reverse induction -> state the positive trigger condition.

Exemptions, kept as written:
1. Program logic and test assertions (for example "if not valid:", error text, invalid-input cases).
2. Public SDK Semver deprecation notices and their migration guidance; private modules get cleaned.
3. High-risk boundaries -> state the positive precondition ("run git commit and git push only when the user asks").
4. Literal user-input matches: a quoted trigger that reproduces the user's wording.

Output contract:
Return only this JSON object: {"edits":[{"oldText":"exact substring","newText":"positive replacement or empty string","category":"iteration-residue|retired-concept|tombstone|behavioural-constraint|tool-schema"}]}.
- oldText must be an exact substring of the file content and must occur exactly once; otherwise the edit is skipped.
- newText replaces exactly oldText; use "" to delete it, and include the trailing line break in oldText when the whole line goes.
- Make the smallest edit that replaces the negative or historical wording; keep Markdown, indentation, and code fences intact.
- Return {"edits":[]} when the file needs no change.`

/**
 * Build one prompt from an explicit rules text.
 *
 * The audit rebuilds historical requests with the rules recorded for that run,
 * so this is the single place the envelope format lives.
 *
 * @param rules - the sweep rules, current or recorded.
 * @param relativePath - file path relative to the scanned scope root.
 * @param content - complete file text.
 * @returns rules plus the path and content envelope.
 */
export function buildPrompt(rules: string, relativePath: string, content: string): string {
  return `${rules}

File: ${relativePath}

${content}`
}

/**
 * Build the prompt for one file's rewrite plan with the current rules.
 *
 * @param relativePath - file path relative to the scanned scope root.
 * @param content - complete file text.
 * @returns rules plus the path and content envelope.
 */
export function buildFilePrompt(relativePath: string, content: string): string {
  return buildPrompt(SWEEP_RULES, relativePath, content)
}
