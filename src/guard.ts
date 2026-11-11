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
export const GUARD_TEXT = `Write every artefact so it describes the state that ships.

- State the final state only: code, comments, commit and MR/PR titles and descriptions, documentation, and prompts describe the current design and behaviour as if it had been designed that way from the start.
- Absence is negation: when a feature, behaviour, or earlier plan leaves the design, remove its description from the code, prose, comments, commit/MR text, and prompts along with it, keeping only the accepted design (for example, write "Title: tomato and egg stir-fry"; record a decision note only for a major breaking migration or when the user asks for one).
- Affirmative is the standard: when writing rules, prompts, tool schemas, and comments, state the one positive practice and the condition that triggers it; delete superseded tools and old concepts from the code and documentation.`

/**
 * Compose the text this plugin contributes to the prompt section.
 *
 * @param guard - the guard contract; `GUARD_TEXT` unless the row config
 *   replaces it.
 * @param extra - project-specific guidance appended after a blank line; an
 *   empty or whitespace-only value contributes nothing.
 * @returns the section text, or an empty string when both inputs are blank (the
 *   prompt registry drops empty sections).
 */
export function composeGuard(guard: string, extra: string): string {
  return [guard.trim(), extra.trim()].filter((part) => part.length > 0).join('\n\n')
}
