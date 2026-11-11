import Schema from "@deepseek-ai/schemastery";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
// src/guard.ts
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
const GUARD_TEXT = `Write every artefact so it describes the state that ships.

- State the final state only: code, comments, commit and MR/PR titles and descriptions, documentation, and prompts describe the current design and behaviour as if it had been designed that way from the start.
- Absence is negation: when a feature, behaviour, or earlier plan leaves the design, remove its description from the code, prose, comments, commit/MR text, and prompts along with it, keeping only the accepted design (for example, write "Title: tomato and egg stir-fry"; record a decision note only for a major breaking migration or when the user asks for one).
- Affirmative is the standard: when writing rules, prompts, tool schemas, and comments, state the one positive practice and the condition that triggers it; delete superseded tools and old concepts from the code and documentation.`;
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
function composeGuard(guard, extra) {
	return [guard.trim(), extra.trim()].filter((part) => part.length > 0).join("\n\n");
}
/**
* Validated config: the harness rejects a row whose values fail this schema at
* load time, so a malformed guard value fails loud.
*/
const Config = Schema.object({
	guardEnabled: Schema.boolean().default(true).volatile().description("Mount the always-on doc-positivize guard in the system prompt."),
	guard: Schema.string().default(GUARD_TEXT).description("System-prompt doc-positivize guard contributed by dsh-doc-positivize."),
	extra: Schema.string().default("").description("Project-specific guidance appended after the built-in guard."),
	command: Schema.boolean().default(true).description("Register the /positivize sweep command."),
	ignoredPaths: Schema.array(Schema.string()).default([...[
		"node_modules",
		".git",
		"dist",
		"build",
		"out",
		"coverage",
		".next",
		".nuxt",
		".turbo",
		".cache",
		".pnpm-store",
		".pnpm-cache",
		".pack",
		"target",
		"vendor",
		".venv",
		"__pycache__",
		"pnpm-lock.yaml",
		"package-lock.json",
		"yarn.lock",
		"bun.lockb"
	]]).volatile().description("File and directory names or globs the /positivize sweep skips."),
	maxFiles: Schema.natural().min(1).default(12).description("Maximum candidate files swept in one run; at least 1."),
	maxFileBytes: Schema.natural().min(1).default(96e3).description("Maximum bytes of one file sent to the model; at least 1."),
	timeoutMs: Schema.natural().min(1e3).default(18e4).description("Time budget for one sweep, in milliseconds; at least 1000."),
	auditEnabled: Schema.boolean().default(true).description("Record each sweep request and its exact file bytes under the harness home."),
	auditRuns: Schema.natural().min(1).default(20).description("How many completed audit run directories to keep; at least 1.")
});
// src/workflow.ts
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
const CHINESE_MARKERS = "不要|绝不|严禁|禁止|切勿|避免|请勿|不得|不再支持|不再使用|已移除|已废弃|已删除|千万别|不含|没有使用|而不是";
/** The English half of the same search, matched case-insensitively. */
const ENGLISH_MARKERS = "\\b(do not|don't|never|avoid|must not|should not|deprecated|removed|no longer|without|instead of)\\b";
const CHINESE_PATTERN = new RegExp(`(?:${CHINESE_MARKERS})`);
const ENGLISH_PATTERN = new RegExp(ENGLISH_MARKERS, "i");
/**
* Whether one line carries a negative or historical marker.
*
* @param line - one source or prose line.
* @returns whether the Chinese or English marker scan hits it.
*/
function lineHasMarker(line) {
	return CHINESE_PATTERN.test(line) || ENGLISH_PATTERN.test(line);
}
/** Per-file rules handed to the model with the file content. */
const SWEEP_RULES = `You are the doc-positivize sweep engine. Read one file and return only a JSON object of minimal edits.

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
- Return {"edits":[]} when the file needs no change.`;
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
function buildPrompt(rules, relativePath, content) {
	return `${rules}

File: ${relativePath}

${content}`;
}
/**
* Build the prompt for one file's rewrite plan with the current rules.
*
* @param relativePath - file path relative to the scanned scope root.
* @param content - complete file text.
* @returns rules plus the path and content envelope.
*/
function buildFilePrompt(relativePath, content) {
	return buildPrompt(SWEEP_RULES, relativePath, content);
}
// src/diff.ts
/** Maximum lines one file's diff may contribute to the report. */
const MAX_DIFF_LINES = 160;
/** Above this many LCS cells the middle becomes one replacement block. */
const MAX_DP_CELLS = 4e6;
/**
* Render one unified diff body (hunks only; the caller supplies the file
* headers).
*
* @param before - complete file text before the edits.
* @param after - complete file text after the edits.
* @param context - context lines kept around each change.
* @returns the hunk text, or an empty string when the texts are equal.
*/
function unifiedDiff(before, after, context = 3, maxLines = MAX_DIFF_LINES) {
	if (before === after) return "";
	const oldLines = before.split("\n");
	const newLines = after.split("\n");
	let prefix = 0;
	while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
	let suffix = 0;
	while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix += 1;
	const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix);
	const newMiddle = newLines.slice(prefix, newLines.length - suffix);
	const ops = [];
	for (let index = 0; index < prefix; index += 1) ops.push({
		kind: " ",
		text: oldLines[index]
	});
	if (oldMiddle.length * newMiddle.length <= MAX_DP_CELLS) {
		const rows = oldMiddle.length;
		const columns = newMiddle.length;
		const lengths = Array.from({ length: rows + 1 }, () => new Int32Array(columns + 1));
		for (let row = rows - 1; row >= 0; row -= 1) for (let column = columns - 1; column >= 0; column -= 1) lengths[row][column] = oldMiddle[row] === newMiddle[column] ? lengths[row + 1][column + 1] + 1 : Math.max(lengths[row + 1][column], lengths[row][column + 1]);
		let row = 0;
		let column = 0;
		while (row < rows && column < columns) if (oldMiddle[row] === newMiddle[column]) {
			ops.push({
				kind: " ",
				text: oldMiddle[row]
			});
			row += 1;
			column += 1;
		} else if (lengths[row + 1][column] >= lengths[row][column + 1]) {
			ops.push({
				kind: "-",
				text: oldMiddle[row]
			});
			row += 1;
		} else {
			ops.push({
				kind: "+",
				text: newMiddle[column]
			});
			column += 1;
		}
		while (row < rows) {
			ops.push({
				kind: "-",
				text: oldMiddle[row]
			});
			row += 1;
		}
		while (column < columns) {
			ops.push({
				kind: "+",
				text: newMiddle[column]
			});
			column += 1;
		}
	} else {
		for (const line of oldMiddle) ops.push({
			kind: "-",
			text: line
		});
		for (const line of newMiddle) ops.push({
			kind: "+",
			text: line
		});
	}
	for (let index = oldLines.length - suffix; index < oldLines.length; index += 1) ops.push({
		kind: " ",
		text: oldLines[index]
	});
	const ranges = [];
	for (let index = 0; index < ops.length; index += 1) {
		if (ops[index].kind === " ") continue;
		const start = Math.max(0, index - context);
		const end = Math.min(ops.length - 1, index + context);
		const previous = ranges.at(-1);
		if (previous !== void 0 && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end);
		else ranges.push([start, end]);
	}
	if (ranges.length === 0) return "";
	const oldLineAt = [];
	const newLineAt = [];
	let oldLine = 1;
	let newLine = 1;
	for (const op of ops) {
		oldLineAt.push(oldLine);
		newLineAt.push(newLine);
		if (op.kind !== "+") oldLine += 1;
		if (op.kind !== "-") newLine += 1;
	}
	oldLineAt.push(oldLine);
	newLineAt.push(newLine);
	const output = [];
	for (const [start, end] of ranges) {
		const oldCount = ops.slice(start, end + 1).filter((op) => op.kind !== "+").length;
		const newCount = ops.slice(start, end + 1).filter((op) => op.kind !== "-").length;
		output.push(`@@ -${oldLineAt[start]},${oldCount} +${newLineAt[start]},${newCount} @@`);
		for (let index = start; index <= end; index += 1) {
			if (output.length >= maxLines) {
				output.push("... diff truncated ...");
				return output.join("\n");
			}
			output.push(`${ops[index].kind}${ops[index].text}`);
		}
	}
	return output.join("\n");
}
/**
* Render structured hunks from the same bounded line comparison the report
* uses. The result card consumes this shape directly.
*
* @param before - complete file text before the edits.
* @param after - complete file text after the edits.
* @returns hunks and the exact added/deleted line counts.
*/
function diffHunks(before, after) {
	const text = unifiedDiff(before, after, 3, Number.MAX_SAFE_INTEGER);
	const hunks = [];
	let current;
	for (const line of text.split("\n")) {
		const header = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(line);
		if (header !== null) {
			current = {
				oldStart: Number(header[1]),
				oldLines: Number(header[2]),
				newStart: Number(header[3]),
				newLines: Number(header[4]),
				lines: []
			};
			hunks.push(current);
			continue;
		}
		if (current !== void 0 && line.length > 0) current.lines.push(line);
	}
	let added = 0;
	let deleted = 0;
	for (const hunk of hunks) for (const line of hunk.lines) if (line.startsWith("+")) added += 1;
	else if (line.startsWith("-")) deleted += 1;
	return {
		hunks,
		added,
		deleted,
		coarse: false
	};
}
// src/sweep.ts
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
const MAX_SCAN_FILES = 2e3;
const MAX_SCAN_BYTES = 524288;
const MAX_CHANGE_TEXT = 300;
/** Convert a simple glob (with `*`, `**`, `?`) to a relative-path regex. */
function globToRegExp(pattern) {
	let out = "^";
	for (let index = 0; index < pattern.length; index += 1) {
		const char = pattern[index];
		if (char === "*") {
			if (pattern[index + 1] === "*") {
				if (pattern[index + 2] === "/") {
					out += "(?:.*/)?";
					index += 2;
				} else {
					out += ".*";
					index += 1;
				}
			} else out += "[^/]*";
		} else if (char === "?") out += "[^/]";
		else if ("\\^$+.()|{}[]".includes(char)) out += `\\${char}`;
		else out += char;
	}
	return new RegExp(`${out}$`);
}
/** Compile the configured ignore entries into one predicate. */
function createIgnoreMatcher(patterns) {
	const names = /* @__PURE__ */ new Set();
	const paths = /* @__PURE__ */ new Set();
	const globs = [];
	for (const raw of patterns) {
		const pattern = raw.trim();
		if (pattern.length === 0) continue;
		if (/[*?]/.test(pattern)) {
			const regex = globToRegExp(pattern);
			globs.push((value) => regex.test(value));
		} else if (pattern.includes("/")) paths.add(pattern.replace(/^\.\//, ""));
		else names.add(pattern);
	}
	return (rel, name) => names.has(name) || paths.has(rel) || globs.some((test) => test(rel) || test(name));
}
/** Walk one directory into files, skipping the configured ignore entries. */
function walk(dir, out, root, isIgnored) {
	if (out.length >= MAX_SCAN_FILES) return;
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (out.length >= MAX_SCAN_FILES) return;
		const path = join(dir, entry.name);
		if (isIgnored(relative(root, path) || entry.name, entry.name)) continue;
		if (entry.isDirectory()) walk(path, out, root, isIgnored);
		else if (entry.isFile()) out.push(path);
	}
}
/** Expand the target tokens into concrete files under the workspace. */
function expandScope(cwd, target, ignoredPaths) {
	const isIgnored = createIgnoreMatcher(ignoredPaths);
	const tokens = target === void 0 || target.trim().length === 0 ? ["."] : target.trim().split(/\s+/);
	const files = [];
	let walked;
	for (const token of tokens) {
		if (isAbsolute(token) || !/[*?]/.test(token)) {
			const absolute = resolve(cwd, token);
			if (!existsSync(absolute)) continue;
			const stats = statSync(absolute);
			if (stats.isFile()) files.push(absolute);
			else if (stats.isDirectory()) walk(absolute, files, cwd, isIgnored);
			continue;
		}
		walked ??= (() => {
			const all = [];
			walk(cwd, all, cwd, isIgnored);
			return all;
		})();
		const matcher = globToRegExp(token);
		for (const file of walked) {
			const rel = relative(cwd, file);
			if (matcher.test(rel) && !isIgnored(rel, file.split("/").at(-1) ?? rel)) files.push(file);
		}
	}
	return [...new Set(files)];
}
/** Scan files once and keep the candidates that carry a marker. */
function scan(files, cwd) {
	const candidates = [];
	let scanned = 0;
	let skippedLarge = 0;
	for (const file of files) {
		let stats;
		try {
			stats = statSync(file);
		} catch {
			continue;
		}
		if (stats.size > MAX_SCAN_BYTES) {
			skippedLarge += 1;
			continue;
		}
		let buffer;
		try {
			buffer = readFileSync(file);
		} catch {
			continue;
		}
		if (buffer.includes(0)) continue;
		const content = buffer.toString("utf8");
		scanned += 1;
		if (!content.split("\n").some((line) => lineHasMarker(line))) continue;
		candidates.push({
			path: file,
			rel: relative(cwd, file) || file,
			content
		});
	}
	return {
		candidates,
		scanned,
		skippedLarge
	};
}
/** Parse the model's edit-plan JSON, tolerating a fenced block. */
function parseEdits(text) {
	const trimmed = text.trim();
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start < 0 || end <= start) return void 0;
	let value;
	try {
		value = JSON.parse(trimmed.slice(start, end + 1));
	} catch {
		return;
	}
	if (value === null || typeof value !== "object") return void 0;
	const edits = value.edits;
	if (!Array.isArray(edits)) return void 0;
	const parsed = [];
	for (const raw of edits) {
		if (raw === null || typeof raw !== "object") continue;
		const oldText = raw.oldText;
		const newText = raw.newText;
		if (typeof oldText !== "string" || oldText.length === 0 || typeof newText !== "string") continue;
		const category = raw.category;
		parsed.push({
			oldText,
			newText,
			...typeof category === "string" ? { category } : {}
		});
		if (parsed.length >= 50) break;
	}
	return parsed;
}
async function planEdits(llm, route, sessionId, signal, relativePath, content, observers) {
	const messages = [{
		role: "user",
		content: [{
			type: "text",
			text: buildFilePrompt(relativePath, content)
		}]
	}];
	let info;
	try {
		info = await llm.resolveModelInfo?.(route.provider, route.model, signal);
	} catch {
		info = void 0;
	}
	const efforts = (info?.reasoning?.efforts ?? []).map((effort) => effort.id);
	const reasoningEffort = efforts.length === 0 ? void 0 : efforts.includes("off") ? "off" : efforts.includes("low") ? "low" : efforts[0];
	const maxTokens = Math.max(8192, Math.min(16384, info?.defaultMaxTokens ?? 8192));
	const run = async (effort, attempt) => {
		observers?.onStart?.({
			attempt,
			maxTokens,
			...effort === void 0 ? {} : { reasoningEffort: effort }
		});
		const startedAt = Date.now();
		let text = "";
		let finish;
		let usage;
		try {
			const stream = llm.stream({
				provider: route.provider,
				model: route.model,
				messages,
				maxTokens,
				...effort === void 0 ? {} : { reasoningEffort: effort },
				sessionId,
				purpose: "doc-positivize",
				signal
			});
			for await (const chunk of stream) if (chunk.type === "text-delta" && typeof chunk.text === "string") text += chunk.text;
			else if (chunk.type === "usage") usage = chunk.usage;
			else if (chunk.type === "finish") finish = chunk.reason;
			if (finish !== void 0 && finish.kind !== "stop") {
				const detail = finish.failure?.message === void 0 ? "" : `: ${finish.failure.message}`;
				throw new Error(`model finished with ${finish.kind}${detail}`);
			}
			const edits = parseEdits(text);
			if (edits === void 0) throw new Error("model did not return the edit-plan JSON");
			observers?.onEnd?.({
				attempt,
				outcome: "ok",
				durationMs: Date.now() - startedAt,
				rawText: text,
				...finish === void 0 ? {} : { finish },
				...usage === void 0 ? {} : { usage }
			});
			return edits;
		} catch (error) {
			observers?.onEnd?.({
				attempt,
				outcome: signal.aborted ? "cancelled" : "error",
				durationMs: Date.now() - startedAt,
				rawText: text,
				...finish === void 0 ? {} : { finish },
				...usage === void 0 ? {} : { usage },
				error: error instanceof Error ? error.message : String(error)
			});
			throw error;
		}
	};
	try {
		return await run(reasoningEffort, 1);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (reasoningEffort !== void 0 && /reasoning effort/i.test(message)) return run(void 0, 2);
		throw error;
	}
}
/** Replace one exact substring once, reporting the line and action. */
function applyEdits(candidate, edits) {
	let content = candidate.content;
	const changes = [];
	const skipped = [];
	for (const edit of edits) {
		const first = content.indexOf(edit.oldText);
		if (first < 0) {
			skipped.push({
				path: candidate.rel,
				reason: "oldText does not occur in the file"
			});
			continue;
		}
		if (content.indexOf(edit.oldText, first + edit.oldText.length) >= 0) {
			skipped.push({
				path: candidate.rel,
				reason: "oldText occurs more than once"
			});
			continue;
		}
		const line = content.slice(0, first).split("\n").length;
		content = content.slice(0, first) + edit.newText + content.slice(first + edit.oldText.length);
		changes.push({
			path: candidate.rel,
			line,
			action: edit.newText.length === 0 ? "delete" : "rewrite",
			original: clip(edit.oldText),
			change: clip(edit.newText)
		});
	}
	if (changes.length === 0) return {
		content,
		changes,
		skipped
	};
	const diff = unifiedDiff(candidate.content, content);
	let added = 0;
	let deleted = 0;
	for (const line of diff.split("\n")) if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
	else if (line.startsWith("-") && !line.startsWith("---")) deleted += 1;
	return {
		content,
		changes,
		skipped,
		diff,
		before: candidate.content,
		after: content,
		added,
		deleted
	};
}
/** Marker hits left in an edited file. */
function remainingHits(relativePath, content) {
	const remaining = [];
	content.split("\n").forEach((line, index) => {
		if (!lineHasMarker(line)) return;
		remaining.push({
			path: relativePath,
			line: index + 1,
			snippet: clip(line.trim())
		});
	});
	return remaining;
}
/** Bound one report string. */
function clip(value) {
	const flat = value.replace(/\s+/g, " ").trim();
	return flat.length > MAX_CHANGE_TEXT ? `${flat.slice(0, MAX_CHANGE_TEXT)}…` : flat;
}
/** Render a thrown value without trusting its string coercion. */
function errorText$1(error) {
	if (error instanceof Error) return error.message;
	try {
		return String(error);
	} catch {
		return "unrenderable error";
	}
}
/**
* Run one sweep and bracket it with audit records.
*
* @param input - host services, scope, limits, and the optional audit sink.
* @returns the complete or partial sweep result.
*/
async function runSweep(input) {
	const sink = input.audit;
	const runId = input.runId;
	if (sink !== void 0 && runId !== void 0) sink.beginRun({
		runId,
		sessionId: input.sessionId,
		cwd: input.cwd,
		scope: input.target ?? "the current workspace",
		detached: input.detached === true,
		provider: input.route.provider,
		model: input.route.model,
		limits: {
			maxFiles: input.limits.maxFiles,
			maxFileBytes: input.limits.maxFileBytes,
			timeoutMs: input.limits.timeoutMs
		}
	});
	try {
		const result = await sweepDocPositivize(input, sink, runId);
		if (sink !== void 0 && runId !== void 0) sink.endRun(runId, {
			status: result.cancelled ? "cancelled" : "done",
			changedFiles: result.changedFiles,
			edits: result.changes.length,
			skipped: result.skipped.length,
			notes: result.notes
		});
		return result;
	} catch (error) {
		if (sink !== void 0 && runId !== void 0) sink.endRun(runId, {
			status: "failed",
			changedFiles: 0,
			edits: 0,
			skipped: 0,
			notes: [],
			error: errorText$1(error)
		});
		throw error;
	}
}
/** The sweep proper; audit bracketing lives in {@link runSweep}. */
async function sweepDocPositivize(input, sink, runId) {
	const started = Date.now();
	const scope = input.target ?? "the current workspace";
	if (input.signal.aborted) return {
		scope,
		scanned: 0,
		candidates: 0,
		changedFiles: 0,
		changes: [],
		diffs: [],
		skipped: [],
		remaining: [],
		notes: ["scan stopped before it started"],
		cancelled: true
	};
	const files = expandScope(input.cwd, input.target, input.limits.ignoredPaths);
	if (files.length === 0) throw new Error(`no files match ${input.target ?? "the current workspace"} under ${input.cwd}; glob patterns are case-sensitive`);
	const { candidates, scanned, skippedLarge } = scan(files, input.cwd);
	const notes = [];
	if (skippedLarge > 0) notes.push(`${skippedLarge} file(s) larger than ${MAX_SCAN_BYTES} bytes were skipped`);
	if (sink !== void 0 && runId !== void 0) sink.scan(runId, {
		scanned,
		candidates: candidates.length
	});
	try {
		input.onScan?.({
			scanned,
			candidates: candidates.length
		});
	} catch {}
	const changes = [];
	const diffs = [];
	const skipped = [];
	const remaining = [];
	const budget = Math.min(input.limits.maxFiles, candidates.length);
	let changedFiles = 0;
	let cancelled = false;
	if (input.signal.aborted) return {
		scope,
		scanned,
		candidates: candidates.length,
		changedFiles,
		changes,
		diffs,
		skipped,
		remaining,
		notes: [...notes, "scan stopped after scanning the scope; no file was changed"],
		cancelled: true
	};
	for (let index = 0; index < budget; index += 1) {
		const candidate = candidates[index];
		if (input.signal.aborted) {
			cancelled = true;
			notes.push(`scan stopped while reviewing ${candidate.rel}`);
			break;
		}
		if (Date.now() - started > input.limits.timeoutMs) {
			notes.push("time budget reached; remaining candidate files were left untouched");
			break;
		}
		try {
			input.onProgress?.({
				index: index + 1,
				total: budget,
				path: candidate.rel
			});
		} catch {}
		if (Buffer.byteLength(candidate.content, "utf8") > input.limits.maxFileBytes) {
			skipped.push({
				path: candidate.rel,
				reason: "file exceeds maxFileBytes"
			});
			if (sink !== void 0 && runId !== void 0) sink.skip(runId, {
				seq: index + 1,
				path: candidate.rel,
				reason: "file exceeds maxFileBytes"
			});
			continue;
		}
		const seq = index + 1;
		if (sink !== void 0 && runId !== void 0) sink.file(runId, {
			seq,
			path: candidate.rel,
			content: candidate.content
		});
		let edits;
		try {
			edits = await planEdits(input.llm, input.route, input.sessionId, input.signal, candidate.rel, candidate.content, {
				onStart: (start) => {
					if (sink === void 0 || runId === void 0) return;
					sink.request(runId, {
						seq,
						attempt: start.attempt,
						provider: input.route.provider,
						model: input.route.model,
						maxTokens: start.maxTokens,
						reasoningEffort: start.reasoningEffort ?? null
					});
				},
				onEnd: (end) => {
					if (sink === void 0 || runId === void 0) return;
					sink.requestResult(runId, {
						seq,
						attempt: end.attempt,
						outcome: end.outcome,
						durationMs: end.durationMs,
						rawText: end.rawText,
						...end.finish === void 0 ? {} : { finish: end.finish },
						...end.usage === void 0 ? {} : { usage: end.usage },
						...end.error === void 0 ? {} : { error: end.error }
					});
				}
			});
		} catch (error) {
			if (input.signal.aborted) {
				cancelled = true;
				notes.push(`scan stopped while reviewing ${candidate.rel}`);
				break;
			}
			skipped.push({
				path: candidate.rel,
				reason: `model error: ${errorText$1(error)}`
			});
			continue;
		}
		if (input.signal.aborted) {
			cancelled = true;
			notes.push(`scan stopped before writing ${candidate.rel}`);
			break;
		}
		const applied = applyEdits(candidate, edits);
		if (applied.changes.length > 0) try {
			writeFileSync(candidate.path, applied.content);
			changedFiles += 1;
			if (applied.diff !== void 0 && applied.before !== void 0 && applied.after !== void 0 && applied.added !== void 0 && applied.deleted !== void 0) diffs.push({
				path: candidate.rel,
				absolutePath: candidate.path,
				diff: applied.diff,
				before: applied.before,
				after: applied.after,
				added: applied.added,
				deleted: applied.deleted
			});
		} catch (error) {
			skipped.push({
				path: candidate.rel,
				reason: `write failed: ${errorText$1(error)}`
			});
			if (sink !== void 0 && runId !== void 0) sink.skip(runId, {
				seq,
				path: candidate.rel,
				reason: `write failed: ${errorText$1(error)}`
			});
			continue;
		}
		changes.push(...applied.changes);
		skipped.push(...applied.skipped);
		remaining.push(...remainingHits(candidate.rel, applied.content));
		if (sink !== void 0 && runId !== void 0) sink.apply(runId, {
			seq,
			path: candidate.rel,
			wrote: applied.changes.length > 0,
			applied: applied.changes.map((change) => ({
				line: change.line,
				action: change.action,
				original: change.original,
				change: change.change
			})),
			skipped: applied.skipped.map((item) => ({ reason: item.reason }))
		});
	}
	if (cancelled) notes.push(`scan stopped; ${changedFiles} file(s) had already been changed`);
	if (candidates.length > budget) notes.push(`${candidates.length - budget} candidate file(s) were left for a later run (maxFiles=${budget})`);
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
		cancelled
	};
}
// src/command.ts
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
/** Human-facing command name. */
const COMMAND_NAME = "positivize";
/**
* Log-only command name for the detached progress and result lifecycle.
*
* The command registry settles its own `positivize` invocation immediately,
* so the background run records a second, independent lifecycle that the
* result card keys on. This name never reaches the command catalog.
*/
const PROGRESS_COMMAND_NAME = "positivize-run";
/** One-line description shown in the command menu. */
const COMMAND_DESCRIPTION = "Positivize documentation in one pass: rewrite negative or historical phrasing into positive descriptions, verify, and report";
/** Composer hint for the accepted arguments. */
const COMMAND_HINT = "[target]";
const USAGE = "Usage: /positivize [target]";
/**
* Read the raw command line.
*
* The whole line is the scope: a path, a glob, or a description. An empty line
* sweeps the current workspace; a leading flag is a usage error.
*
* @param rawInput - text typed after the command name.
* @returns the parsed scope, or usage text.
*/
function parseCommandInput(rawInput) {
	const trimmed = rawInput.trim();
	if (trimmed.length === 0) return { ok: true };
	if (trimmed.startsWith("-")) return {
		ok: false,
		usage: USAGE
	};
	return {
		ok: true,
		target: trimmed
	};
}
/**
* Resolve the model the current session is using.
*
* @param agent - the invoking agent.
* @returns the provider and model route.
*/
function resolveRoute(agent) {
	const config = agent.session.requestHeader?.()?.config;
	if (config?.provider !== void 0 && config.model !== void 0) return {
		provider: config.provider,
		model: config.model
	};
	if (agent.options?.provider !== void 0 && agent.options.model !== void 0) return {
		provider: agent.options.provider,
		model: agent.options.model
	};
	throw new Error("no provider/model route is available for this session");
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
async function runDocPositivize(llm, invocation, limits, audit) {
	const parsed = parseCommandInput(invocation.rawInput);
	if (!parsed.ok) return {
		kind: "error",
		text: parsed.usage
	};
	const cwd = invocation.agent.session.header.cwd ?? process.cwd();
	const runId = `fg-positivize-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	try {
		const route = resolveRoute(invocation.agent);
		return {
			kind: "success",
			text: renderReport(await runSweep({
				llm,
				cwd,
				target: parsed.target,
				signal: invocation.signal,
				route,
				sessionId: invocation.agent.session.id,
				limits,
				runId,
				detached: false,
				...audit === void 0 ? {} : { audit: audit.sink }
			}))
		};
	} catch (error) {
		return {
			kind: "error",
			text: `positivize: ${errorText(error)}`
		};
	}
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
function startDetachedDocPositivize(llm, invocation, limits, runs, audit) {
	const parsed = parseCommandInput(invocation.rawInput);
	if (!parsed.ok) return {
		result: {
			kind: "error",
			text: parsed.usage
		},
		settled: Promise.resolve(),
		controller: new AbortController()
	};
	const session = invocation.agent.session;
	const append = session.append?.bind(session);
	if (append === void 0) return {
		result: {
			kind: "error",
			text: "positivize: this host cannot run detached commands."
		},
		settled: Promise.resolve(),
		controller: new AbortController()
	};
	let route;
	try {
		route = resolveRoute(invocation.agent);
	} catch (error) {
		return {
			result: {
				kind: "error",
				text: `positivize: ${errorText(error)}`
			},
			settled: Promise.resolve(),
			controller: new AbortController()
		};
	}
	const cwd = session.header.cwd ?? process.cwd();
	const runId = `cmd-positivize-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	const controller = new AbortController();
	runs.begin({
		runId,
		sessionId: session.id,
		cwd,
		target: parsed.target,
		controller,
		auditPath: audit?.runDir(runId) ?? void 0
	});
	try {
		append("command/run", {
			commandId: runId,
			name: PROGRESS_COMMAND_NAME,
			args: invocation.rawInput,
			source: { kind: "user" }
		});
	} catch (error) {
		runs.discard(runId);
		return {
			result: {
				kind: "error",
				text: `positivize: ${errorText(error)}`
			},
			settled: Promise.resolve(),
			controller
		};
	}
	return {
		result: { kind: "success" },
		settled: (async () => {
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
					...audit === void 0 ? {} : { audit: audit.sink },
					onScan: (info) => runs.scan(runId, info),
					onProgress: (progress) => runs.progress(runId, progress)
				});
				runs.complete(runId, result);
				try {
					append("command/done", {
						commandId: runId,
						kind: "success",
						text: renderSummary(result)
					});
				} catch {}
			} catch (error) {
				const message = errorText(error);
				runs.fail(runId, message);
				try {
					append("command/done", {
						commandId: runId,
						kind: "error",
						text: `positivize: ${message}`
					});
				} catch {}
			}
		})().catch(() => {}),
		controller
	};
}
/** Render the compact result the progress command carries for fallback hosts. */
function renderSummary(result) {
	const rewrites = result.changes.filter((change) => change.action === "rewrite").length;
	const deletions = result.changes.length - rewrites;
	const lines = [
		`positivize — ${result.scope}${result.cancelled ? " (terminated)" : ""}`,
		"",
		`${result.cancelled ? "Terminated" : "Finished"}: scanned ${result.scanned} file(s); ${result.candidates} carried markers; ${result.changedFiles} file(s) changed (${rewrites} rewrite(s), ${deletions} deletion(s)).`
	];
	if (result.changes.length > 0) {
		lines.push("", "Changed:");
		for (const change of result.changes) lines.push(`[${change.action}] ${change.path}:${change.line}`);
	}
	if (result.skipped.length > 0) lines.push("", `Skipped ${result.skipped.length} file(s).`);
	if (result.remaining.length > 0) lines.push("", `Remaining marker hits: ${result.remaining.length}.`);
	if (result.notes.length > 0) {
		lines.push("", "Notes:");
		for (const note of result.notes) lines.push(`- ${note}`);
	}
	if (result.changedFiles === 0 && result.remaining.length === 0 && result.notes.length === 0) lines.push("", "No negative phrasing was found in scope.");
	return lines.join("\n");
}
/** Render one sweep result as the command report. */
function renderReport(result) {
	const rewrites = result.changes.filter((change) => change.action === "rewrite").length;
	const deletions = result.changes.length - rewrites;
	const lines = [
		`positivize — ${result.scope}${result.cancelled ? " (terminated)" : ""}`,
		"",
		`Scanned ${result.scanned} file(s); ${result.candidates} carried markers; ${result.changedFiles} file(s) changed (${rewrites} rewrite(s), ${deletions} deletion(s)).`
	];
	if (result.changes.length > 0) {
		lines.push("", "Changed:");
		for (const change of result.changes) lines.push(`[${change.action}] ${change.path}:${change.line}`);
	}
	if (result.diffs.length > 0) {
		lines.push("", "Diff:");
		for (const file of result.diffs) lines.push(`--- a/${file.path}`, `+++ b/${file.path}`, file.diff);
	}
	if (result.skipped.length > 0) {
		lines.push("", "Skipped:");
		for (const skip of result.skipped) lines.push(`- ${skip.path}: ${skip.reason}`);
	}
	if (result.remaining.length > 0) {
		lines.push("", "Remaining markers (reviewed as exemptions):");
		for (const remaining of result.remaining) lines.push(`- ${remaining.path}:${remaining.line} ${JSON.stringify(remaining.snippet)}`);
	}
	if (result.notes.length > 0) {
		lines.push("", "Notes:");
		for (const note of result.notes) lines.push(`- ${note}`);
	}
	if (result.candidates === 0 && result.remaining.length === 0 && result.notes.length === 0) lines.push("", "No negative phrasing was found in scope.");
	return lines.join("\n");
}
/** Render a thrown value from its message or a safe string conversion. */
function errorText(error) {
	if (error instanceof Error) return error.message;
	try {
		return String(error);
	} catch {
		return "unrenderable error";
	}
}
// src/runs.ts
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
/** A refusal carrying the code and HTTP status the route answers with. */
var RunError = class extends Error {
	code;
	status;
	/**
	* @param code - stable client-facing failure code.
	* @param status - HTTP status the route returns.
	* @param message - human-facing detail.
	*/
	constructor(code, status, message) {
		super(message);
		this.name = "RunError";
		this.code = code;
		this.status = status;
	}
};
/** Completed runs retained per plugin instance. */
const MAX_RUNS = 12;
/** Diff lines one file may carry in a card response. */
const MAX_RENDERED_HUNK_LINES = 1500;
/**
* Bound one file's hunks for the wire while keeping whole hunks intact.
*
* @param hunks - complete comparison.
* @returns the hunks that fit and whether any hunk was dropped.
*/
function limitHunks(hunks) {
	const kept = [];
	let lines = 0;
	for (const hunk of hunks) {
		if (lines + hunk.lines.length > MAX_RENDERED_HUNK_LINES) return {
			hunks: kept,
			truncated: true
		};
		kept.push(hunk);
		lines += hunk.lines.length;
	}
	return {
		hunks: kept,
		truncated: false
	};
}
/** Resolve one path for the undo comparison, or null when it no longer exists. */
function realPathOf(path) {
	try {
		return realpathSync(path);
	} catch {
		return null;
	}
}
/** Registry of detached runs with per-file undo. */
var RunStore = class {
	runs = /* @__PURE__ */ new Map();
	/**
	* Record a run before its progress command event is appended, so the first
	* card request already finds it.
	*
	* @param input - run identity, workspace, scope, and the controller Stop aborts.
	*/
	begin(input) {
		this.runs.set(input.runId, {
			runId: input.runId,
			sessionId: input.sessionId,
			cwd: input.cwd,
			target: input.target === void 0 || input.target.trim() === "" ? null : input.target,
			auditPath: input.auditPath ?? null,
			controller: input.controller,
			startedAt: Date.now(),
			status: "running",
			cancelling: false,
			finishedAt: null,
			scanned: 0,
			candidates: 0,
			progress: null,
			files: [],
			skipped: [],
			remaining: [],
			notes: [],
			error: null
		});
		this.prune();
	}
	/**
	* Publish the scope counts reached after scanning.
	*
	* @param runId - run to update.
	* @param info - scanned and candidate counts.
	*/
	scan(runId, info) {
		const record = this.runs.get(runId);
		if (record === void 0) return;
		record.scanned = info.scanned;
		record.candidates = info.candidates;
	}
	/**
	* Publish the candidate currently under review.
	*
	* @param runId - run to update.
	* @param progress - one-based candidate position.
	*/
	progress(runId, progress) {
		const record = this.runs.get(runId);
		if (record === void 0 || record.status !== "running") return;
		record.progress = progress;
	}
	/**
	* Settle a run with its complete or partial result.
	*
	* @param runId - run to settle.
	* @param result - the sweep result, including partial cancellation output.
	*/
	complete(runId, result) {
		const record = this.runs.get(runId);
		if (record === void 0) return;
		record.status = result.cancelled ? "cancelled" : "done";
		record.cancelling = false;
		record.finishedAt = Date.now();
		record.progress = null;
		record.scanned = result.scanned;
		record.candidates = result.candidates;
		record.skipped = [...result.skipped];
		record.remaining = [...result.remaining];
		record.notes = [...result.notes];
		record.error = null;
		record.files = result.diffs.map((file) => {
			const absolutePath = file.absolutePath ?? resolve(record.cwd, file.path);
			const limited = limitHunks(diffHunks(file.before, file.after).hunks);
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
				undone: false
			};
		});
		this.prune();
	}
	/**
	* Settle a run with a failure that produced no usable result.
	*
	* @param runId - run to settle.
	* @param message - failure detail shown by the card.
	*/
	fail(runId, message) {
		const record = this.runs.get(runId);
		if (record === void 0) return;
		record.status = "failed";
		record.cancelling = false;
		record.finishedAt = Date.now();
		record.progress = null;
		record.error = message;
		record.notes = [];
		this.prune();
	}
	/**
	* Abort one running scan. A settled or already-stopped run is returned as is.
	*
	* @param runId - run to stop.
	* @returns the current view.
	*/
	cancel(runId) {
		const record = this.require(runId);
		if (record.status === "running") {
			record.cancelling = true;
			record.controller.abort();
		}
		return this.toView(record);
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
	undo(runId, path) {
		const record = this.require(runId);
		if (record.status === "running") throw new RunError("still-running", 409, "the scan is still running");
		const file = record.files.find((candidate) => candidate.path === path);
		if (file === void 0) throw new RunError("file-not-found", 404, "that file is not part of this scan");
		if (file.undone) return this.toView(record);
		if (file.realPath === null) throw new RunError("file-missing", 409, "the file no longer exists");
		const currentRealPath = realPathOf(file.absolutePath);
		if (currentRealPath === null) throw new RunError("file-missing", 409, "the file no longer exists");
		if (currentRealPath !== file.realPath) throw new RunError("file-changed", 409, "the file target changed after the scan; refusing to overwrite");
		let current;
		try {
			current = readFileSync(currentRealPath, "utf8");
		} catch {
			throw new RunError("file-missing", 409, "the file no longer exists");
		}
		if (current === file.before) {
			file.undone = true;
			return this.toView(record);
		}
		if (current !== file.after) throw new RunError("file-changed", 409, "the file changed after the scan; refusing to overwrite");
		try {
			writeFileSync(file.absolutePath, file.before);
		} catch (error) {
			throw new RunError("write-failed", 500, `could not restore the file: ${error instanceof Error ? error.message : String(error)}`);
		}
		file.undone = true;
		return this.toView(record);
	}
	/**
	* Read one run's card payload.
	*
	* @param runId - run to read.
	* @returns the view, or undefined when the Host no longer holds the run.
	*/
	view(runId) {
		const record = this.runs.get(runId);
		return record === void 0 ? void 0 : this.toView(record);
	}
	/** Abort every running scan and forget all records. */
	dispose() {
		for (const record of this.runs.values()) record.controller.abort();
		this.runs.clear();
	}
	/**
	* Forget one run that never reached its progress event.
	*
	* @param runId - run to drop.
	*/
	discard(runId) {
		this.runs.delete(runId);
	}
	/** Resolve one existing run or raise the route's not-found error. */
	require(runId) {
		const record = this.runs.get(runId);
		if (record === void 0) throw new RunError("run-not-found", 404, "the scan result is no longer available");
		return record;
	}
	/** Render the user-visible projection of one record. */
	toView(record) {
		let changedFiles = 0;
		let added = 0;
		let deleted = 0;
		const files = record.files.map((file) => {
			if (!file.undone) {
				changedFiles += 1;
				added += file.added;
				deleted += file.deleted;
			}
			return {
				path: file.path,
				added: file.added,
				deleted: file.deleted,
				undone: file.undone,
				truncated: file.truncated,
				hunks: file.hunks
			};
		});
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
			progress: record.status === "running" ? record.progress : null,
			error: record.error,
			auditPath: record.auditPath
		};
	}
	/** Drop the oldest settled runs once the retention bound is exceeded. */
	prune() {
		if (this.runs.size <= MAX_RUNS) return;
		const settled = [...this.runs.values()].filter((record) => record.status !== "running").sort((left, right) => left.startedAt - right.startedAt);
		for (const record of settled) {
			if (this.runs.size <= MAX_RUNS) break;
			this.runs.delete(record.runId);
		}
	}
};
// src/http.ts
/**
* Exact Fetch routes for the result card's Stop and Undo actions.
*
* Connection admits only the owner Peer on an exact route, so these handlers
* assume an authenticated human at the Web GUI. The run store is the only
* source of write targets; a request can select a recorded file but never
* introduce a new path.
*
* @module dsh-doc-positivize/http
*/
/** State route for one run's card payload. */
const STATE_ROUTE = "/api/doc-positivize.state";
/** Stop route for one running scan. */
const CANCEL_ROUTE = "/api/doc-positivize.cancel";
/** Per-file restore route. */
const UNDO_ROUTE = "/api/doc-positivize.undo";
/** A request refusal owned by this module. */
var HttpError = class extends Error {
	status;
	code;
	/**
	* @param status - HTTP status.
	* @param code - stable client-facing code.
	* @param message - human-facing detail.
	*/
	constructor(status, code, message) {
		super(message);
		this.name = "HttpError";
		this.status = status;
		this.code = code;
	}
};
/** Render one JSON response with the card's no-store policy. */
function jsonResponse(value, status = 200) {
	return new Response(JSON.stringify(value), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store"
		}
	});
}
/** Read one JSON object body, refusing malformed or non-object payloads. */
async function readBody(request) {
	let value;
	try {
		value = await request.json();
	} catch {
		throw new HttpError(400, "invalid-body", "the request body must be JSON");
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "invalid-body", "the request body must be a JSON object");
	return value;
}
/** Read one non-empty string field. */
function stringField(body, name, maxLength) {
	const value = body[name];
	if (typeof value !== "string" || value.length === 0 || value.length > maxLength) throw new HttpError(400, "invalid-body", `${name} must be a non-empty string`);
	return value;
}
/** Contain every failure as one JSON response the card can read. */
function handled(handler) {
	return async (request) => {
		try {
			return await handler(request);
		} catch (error) {
			if (error instanceof HttpError) return jsonResponse({
				error: error.message,
				code: error.code
			}, error.status);
			if (error instanceof RunError) return jsonResponse({
				error: error.message,
				code: error.code
			}, error.status);
			return jsonResponse({
				error: error instanceof Error ? error.message : "unexpected error",
				code: "internal"
			}, 500);
		}
	};
}
/**
* Register the three exact routes inside Connection's authentication fence.
*
* @param ctx - Host context that reads the Connection service.
* @param runs - run registry shared with the command.
* @returns a disposer for the three registrations.
*/
function registerRunRoutes(ctx, runs) {
	const disposers = [
		ctx.connection.fetch.register({
			path: STATE_ROUTE,
			methods: ["GET"],
			requestBody: "buffered",
			fetch: handled(async (request) => {
				const runId = new URL(request.url).searchParams.get("runId");
				if (runId === null || runId.length === 0 || runId.length > 200) throw new HttpError(400, "invalid-run", "runId is required");
				const view = runs.view(runId);
				if (view === void 0) throw new HttpError(404, "run-not-found", "the scan result is no longer available");
				return jsonResponse(view);
			})
		}),
		ctx.connection.fetch.register({
			path: CANCEL_ROUTE,
			methods: ["POST"],
			requestBody: "buffered",
			fetch: handled(async (request) => {
				const runId = stringField(await readBody(request), "runId", 200);
				return jsonResponse({ run: runs.cancel(runId) });
			})
		}),
		ctx.connection.fetch.register({
			path: UNDO_ROUTE,
			methods: ["POST"],
			requestBody: "buffered",
			fetch: handled(async (request) => {
				const body = await readBody(request);
				const runId = stringField(body, "runId", 200);
				const path = stringField(body, "path", 4096);
				return jsonResponse({ run: runs.undo(runId, path) });
			})
		})
	];
	return () => {
		for (const dispose of disposers) dispose();
	};
}
/** Directory (under the resolved harness home) the plugin owns. */
const AUDIT_DIRECTORY = "doc-positivize";
const RUNS_DIRECTORY = "runs";
const BLOBS_DIRECTORY = "blobs";
const RUN_FILE = "run.jsonl";
const BLOB_MARKER = `${BLOBS_DIRECTORY}/`;
/** SHA-256 hex digest of one string or buffer. */
function sha256Of(content) {
	return createHash("sha256").update(content).digest("hex");
}
/** Keep a JSON-safe copy of an optional provider value, or undefined. */
function jsonSafe(value) {
	if (value === void 0) return void 0;
	try {
		return JSON.parse(JSON.stringify(value));
	} catch {
		return;
	}
}
/**
* Resolve the harness home exactly like `@deepseek-ai/dsh-home-paths`: an
* explicit `$DSH_HOME` wins, else `~/.dsh`. The plugin resolves it locally so
* it needs no harness dependency at install time.
*/
function resolveDshHome() {
	const configured = process.env.DSH_HOME;
	if (configured !== void 0 && configured.trim() !== "") return configured.trim();
	return join(homedir(), ".dsh");
}
/** Default audit root: the plugin's own directory under the harness home. */
function resolveAuditRoot() {
	return join(resolveDshHome(), AUDIT_DIRECTORY);
}
/** A sink that does nothing, used when auditing is disabled. */
function noopSink() {
	return {
		beginRun: () => {},
		scan: () => {},
		skip: () => {},
		file: () => {},
		request: () => {},
		requestResult: () => {},
		apply: () => {},
		endRun: () => {}
	};
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
function createAuditStore(options) {
	const enabled = options.enabled;
	const retainRuns = Math.max(1, Math.trunc(options.retainRuns));
	const root = options.root ?? resolveAuditRoot();
	const runs = /* @__PURE__ */ new Map();
	let warned = false;
	const fail = (error) => {
		if (warned) return;
		warned = true;
		try {
			options.onError?.(error);
		} catch {}
	};
	/** Delete the oldest run directories, keeping room for the new one. */
	const prune = () => {
		const base = join(root, RUNS_DIRECTORY);
		let names;
		try {
			names = readdirSync(base);
		} catch {
			return;
		}
		const entries = [];
		for (const name of names) {
			const dir = join(base, name);
			try {
				if (!statSync(dir).isDirectory()) continue;
				entries.push({
					name,
					mtimeMs: statSync(dir).mtimeMs
				});
			} catch {}
		}
		entries.sort((left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name));
		const excess = entries.length - retainRuns;
		for (let index = 0; index < excess; index += 1) try {
			rmSync(join(base, entries[index].name), {
				recursive: true,
				force: true
			});
		} catch {}
	};
	const stateOf = (runId) => {
		const state = runs.get(runId);
		return state?.usable === true ? state : void 0;
	};
	const append = (state, record) => {
		try {
			appendFileSync(state.file, `${JSON.stringify(record)}\n`, { mode: 384 });
		} catch (error) {
			state.usable = false;
			fail(error);
		}
	};
	/** Write one content-addressed blob and return its relative name. */
	const writeBlob = (state, content) => {
		const digest = sha256Of(content);
		const path = join(state.dir, BLOBS_DIRECTORY, digest);
		if (!existsSync(path)) try {
			writeFileSync(path, content, {
				flag: "wx",
				mode: 384
			});
		} catch (error) {
			if (error.code !== "EEXIST") {
				state.usable = false;
				fail(error);
				return;
			}
		}
		return `${BLOB_MARKER}${digest}`;
	};
	return {
		sink: enabled ? {
			beginRun: (info) => {
				if (!enabled) return;
				try {
					const dir = join(root, RUNS_DIRECTORY, info.runId);
					mkdirSync(join(dir, BLOBS_DIRECTORY), {
						recursive: true,
						mode: 448
					});
					prune();
					const state = {
						dir,
						file: join(dir, RUN_FILE),
						files: /* @__PURE__ */ new Map(),
						usable: true
					};
					runs.set(info.runId, state);
					append(state, {
						v: 1,
						type: "run-start",
						at: Date.now(),
						...info,
						rules: {
							sha256: sha256Of(SWEEP_RULES),
							text: SWEEP_RULES
						}
					});
					try {
						options.onRun?.({
							runId: info.runId,
							dir
						});
					} catch {}
				} catch (error) {
					fail(error);
				}
			},
			scan: (runId, info) => {
				const state = stateOf(runId);
				if (state === void 0) return;
				append(state, {
					v: 1,
					type: "scan",
					runId,
					at: Date.now(),
					...info
				});
			},
			skip: (runId, info) => {
				const state = stateOf(runId);
				if (state === void 0) return;
				append(state, {
					v: 1,
					type: "skip",
					runId,
					at: Date.now(),
					...info
				});
			},
			file: (runId, info) => {
				const state = stateOf(runId);
				if (state === void 0) return;
				const blob = writeBlob(state, info.content);
				if (blob === void 0) return;
				const facts = {
					path: info.path,
					sha256: sha256Of(info.content),
					blob,
					promptSha256: sha256Of(buildFilePrompt(info.path, info.content))
				};
				state.files.set(info.seq, facts);
				append(state, {
					v: 1,
					type: "file",
					runId,
					seq: info.seq,
					at: Date.now(),
					path: facts.path,
					bytes: Buffer.byteLength(info.content, "utf8"),
					sha256: facts.sha256,
					blob: facts.blob,
					promptSha256: facts.promptSha256
				});
			},
			request: (runId, info) => {
				const state = stateOf(runId);
				if (state === void 0) return;
				const facts = state.files.get(info.seq);
				if (facts === void 0) return;
				append(state, {
					v: 1,
					type: "request",
					runId,
					at: Date.now(),
					...info,
					path: facts.path,
					sha256: facts.sha256,
					blob: facts.blob,
					promptSha256: facts.promptSha256
				});
			},
			requestResult: (runId, info) => {
				const state = stateOf(runId);
				if (state === void 0) return;
				const blob = writeBlob(state, info.rawText);
				if (blob === void 0) return;
				const finish = jsonSafe(info.finish);
				const usage = jsonSafe(info.usage);
				append(state, {
					v: 1,
					type: "request-result",
					runId,
					seq: info.seq,
					attempt: info.attempt,
					outcome: info.outcome,
					durationMs: info.durationMs,
					at: Date.now(),
					...finish === void 0 ? {} : { finish },
					...usage === void 0 ? {} : { usage },
					...info.error === void 0 ? {} : { error: info.error },
					output: {
						sha256: sha256Of(info.rawText),
						bytes: Buffer.byteLength(info.rawText, "utf8"),
						blob
					}
				});
			},
			apply: (runId, info) => {
				const state = stateOf(runId);
				if (state === void 0) return;
				append(state, {
					v: 1,
					type: "apply",
					runId,
					seq: info.seq,
					at: Date.now(),
					path: info.path,
					wrote: info.wrote,
					applied: info.applied,
					skipped: info.skipped
				});
			},
			endRun: (runId, info) => {
				const state = stateOf(runId);
				if (state === void 0) return;
				append(state, {
					v: 1,
					type: "run-end",
					runId,
					at: Date.now(),
					...info
				});
				state.usable = false;
				runs.delete(runId);
			}
		} : noopSink(),
		root,
		runDir: (runId) => enabled ? join(root, RUNS_DIRECTORY, runId) : null
	};
}
/**
* Read one run's JSONL records, skipping torn or unparsable lines.
*
* @param runDir - absolute run directory.
* @returns the parsed records in append order.
*/
function readAuditRecords(runDir) {
	const file = join(runDir, RUN_FILE);
	if (!existsSync(file)) return [];
	let text;
	try {
		text = readFileSync(file, "utf8");
	} catch {
		return [];
	}
	const records = [];
	for (const line of text.split("\n")) {
		if (line.trim() === "") continue;
		try {
			const value = JSON.parse(line);
			if (typeof value === "object" && value !== null && !Array.isArray(value)) records.push(value);
		} catch {}
	}
	return records;
}
/**
* Rebuild the exact prompt one request sent.
*
* @param runDir - absolute run directory.
* @param seq - the request's candidate sequence number.
* @returns the reconstructed prompt, or null when the records are incomplete.
*/
function reconstructPrompt(runDir, seq) {
	const records = readAuditRecords(runDir);
	const start = records.find((record) => record.type === "run-start");
	const request = records.find((record) => record.type === "request" && record.seq === seq);
	if (start === void 0 || request === void 0) return null;
	const rules = start.rules;
	const rulesText = typeof rules === "object" && rules !== null && typeof rules.text === "string" ? rules.text : void 0;
	const path = typeof request.path === "string" ? request.path : void 0;
	const blob = typeof request.blob === "string" ? request.blob : void 0;
	if (rulesText === void 0 || path === void 0 || blob === void 0) return null;
	try {
		const content = readFileSync(join(runDir, blob), "utf8");
		return rulesText === "You are the doc-positivize sweep engine. Read one file and return only a JSON object of minimal edits.\n\nPrinciple: absence is negation; affirmative is the standard. State each effective constraint as the one positive practice, and erase the superseded name from the rewritten sentence. Delete retired tools, concepts, rejected plans, and historical correction notes from code, prose, and prompts.\n\nFive categories and their remedy:\n1. Iteration residue or reverse declarations -> delete the tail and keep the final state.\n2. Retired concepts and historical ghosts -> delete the whole passage.\n3. Tombstone comments and change history -> delete; keep one sentence explaining why the current implementation satisfies a non-obvious technical constraint.\n4. Effective behavioural constraints -> rewrite as the single positive instruction naming the standard tool, type, or entry point, with the superseded name erased.\n5. Tool or schema reverse induction -> state the positive trigger condition.\n\nExemptions, kept as written:\n1. Program logic and test assertions (for example \"if not valid:\", error text, invalid-input cases).\n2. Public SDK Semver deprecation notices and their migration guidance; private modules get cleaned.\n3. High-risk boundaries -> state the positive precondition (\"run git commit and git push only when the user asks\").\n4. Literal user-input matches: a quoted trigger that reproduces the user's wording.\n\nOutput contract:\nReturn only this JSON object: {\"edits\":[{\"oldText\":\"exact substring\",\"newText\":\"positive replacement or empty string\",\"category\":\"iteration-residue|retired-concept|tombstone|behavioural-constraint|tool-schema\"}]}.\n- oldText must be an exact substring of the file content and must occur exactly once; otherwise the edit is skipped.\n- newText replaces exactly oldText; use \"\" to delete it, and include the trailing line break in oldText when the whole line goes.\n- Make the smallest edit that replaces the negative or historical wording; keep Markdown, indentation, and code fences intact.\n- Return {\"edits\":[]} when the file needs no change." ? buildFilePrompt(path, content) : buildPrompt(rulesText, path, content);
	} catch {
		return null;
	}
}
// src/index.ts
/** Stable loader identity. */
const name = "dsh-doc-positivize";
/**
* The prompt registry, the human-command registry, and the LLM service. All
* three are part of `@deepseek-ai/dsh-base`, so every base-backed profile
* mounts them before this plugin applies.
*/
const inject = [
	"systemPrompt",
	"commands",
	"llm"
];
/**
* Global-layer section name. `<owner>:<topic>` keeps it clear of first-party
* names (`harness:identity`, `deployment:persona-*`, `ui:deliverable-file-references`).
*/
const SECTION_NAME = "doc-positivize:guard";
/**
* Placement inside the empty 5000 (`TOOLS_SDK`) → 9000
* (`DELIVERABLE_FILE_REFERENCES`) band: after all tool guidance, before the
* environment/derived block. External contributions may use any finite order;
* `getSectionOrder()` only accepts the closed first-party name union, so the
* number is written out here as a layout decision.
*/
const SECTION_ORDER = 6e3;
/**
* Read the injected prompt service through a structural type: the registry has
* no runtime import here, so the plugin adds no peer/type dependency for it.
*
* @param ctx - plugin context carrying the injected `systemPrompt` service.
* @returns the registry's `section()` surface.
*/
function systemPromptOf(ctx) {
	return ctx.systemPrompt;
}
/**
* Read the injected command registry through a structural type, for the same
* reason: the registration surface is stable, and the command definition is
* validated by the service at runtime.
*
* @param ctx - plugin context carrying the injected `commands` service.
* @returns the registry's `register()` surface.
*/
function commandsOf(ctx) {
	return ctx.commands;
}
/**
* Read the injected LLM service through a structural type; the sweep calls it
* directly in the host process, so no child agent or new session is created.
*
* @param ctx - plugin context carrying the injected `llm` service.
* @returns the service's `stream()` surface.
*/
function llmOf(ctx) {
	return ctx.llm;
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
function apply(ctx, config) {
	systemPromptOf(ctx).section({
		name: SECTION_NAME,
		order: SECTION_ORDER,
		interpolate: false,
		text: () => config.guardEnabled.get() ? composeGuard(config.guard, config.extra) : ""
	});
	if (!config.command) return;
	const llm = llmOf(ctx);
	const runs = new RunStore();
	const audit = createAuditStore({
		enabled: config.auditEnabled,
		retainRuns: config.auditRuns,
		onError: (error) => ctx.logger.warn("doc-positivize audit trail disabled after a write failure", error),
		onRun: ({ runId, dir }) => ctx.logger.info(`doc-positivize audit: ${runId} -> ${dir}`)
	});
	let connectionReady = false;
	ctx.effect(() => () => runs.dispose(), "doc-positivize runs");
	ctx.inject(["connection"], (connectionCtx) => {
		connectionCtx.effect(() => {
			const dispose = registerRunRoutes(connectionCtx, runs);
			connectionReady = true;
			return () => {
				connectionReady = false;
				dispose();
			};
		}, "doc-positivize result routes");
	});
	commandsOf(ctx).register({
		name: COMMAND_NAME,
		description: COMMAND_DESCRIPTION,
		input: { hint: COMMAND_HINT },
		handler: (invocation) => {
			const limits = {
				ignoredPaths: config.ignoredPaths.get(),
				maxFiles: config.maxFiles,
				maxFileBytes: config.maxFileBytes,
				timeoutMs: config.timeoutMs
			};
			if (!connectionReady) return runDocPositivize(llm, invocation, limits, audit);
			return startDetachedDocPositivize(llm, invocation, limits, runs, audit).result;
		}
	});
}
export { Config, GUARD_TEXT, apply, buildFilePrompt, inject, name, readAuditRecords, reconstructPrompt, resolveAuditRoot };
