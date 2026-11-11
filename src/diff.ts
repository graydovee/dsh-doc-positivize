/**
 * Line diff for the sweep result card and the text report.
 *
 * The result card renders the plugin-owned unified diff; the foreground report
 * carries the same comparison. The implementation is intentionally small: a
 * bounded LCS for ordinary files and a whole-middle replacement when the file
 * is too large to compare line by line.
 *
 * @module dsh-doc-positivize/diff
 */

/** One rendered diff line. */
type DiffKind = ' ' | '-' | '+'

interface DiffOp {
  readonly kind: DiffKind
  readonly text: string
}

/** Maximum lines one file's diff may contribute to the report. */
const MAX_DIFF_LINES = 160

/** Above this many LCS cells the middle becomes one replacement block. */
const MAX_DP_CELLS = 4_000_000

/**
 * Render one unified diff body (hunks only; the caller supplies the file
 * headers).
 *
 * @param before - complete file text before the edits.
 * @param after - complete file text after the edits.
 * @param context - context lines kept around each change.
 * @returns the hunk text, or an empty string when the texts are equal.
 */
export function unifiedDiff(before: string, after: string, context = 3, maxLines = MAX_DIFF_LINES): string {
  if (before === after) return ''

  const oldLines = before.split('\n')
  const newLines = after.split('\n')

  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1

  let suffix = 0
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix)
  const newMiddle = newLines.slice(prefix, newLines.length - suffix)
  const ops: DiffOp[] = []

  for (let index = 0; index < prefix; index += 1) ops.push({ kind: ' ', text: oldLines[index] })

  if (oldMiddle.length * newMiddle.length <= MAX_DP_CELLS) {
    const rows = oldMiddle.length
    const columns = newMiddle.length
    const lengths: Int32Array[] = Array.from({ length: rows + 1 }, () => new Int32Array(columns + 1))
    for (let row = rows - 1; row >= 0; row -= 1) {
      for (let column = columns - 1; column >= 0; column -= 1) {
        lengths[row][column] =
          oldMiddle[row] === newMiddle[column]
            ? lengths[row + 1][column + 1] + 1
            : Math.max(lengths[row + 1][column], lengths[row][column + 1])
      }
    }
    let row = 0
    let column = 0
    while (row < rows && column < columns) {
      if (oldMiddle[row] === newMiddle[column]) {
        ops.push({ kind: ' ', text: oldMiddle[row] })
        row += 1
        column += 1
      } else if (lengths[row + 1][column] >= lengths[row][column + 1]) {
        ops.push({ kind: '-', text: oldMiddle[row] })
        row += 1
      } else {
        ops.push({ kind: '+', text: newMiddle[column] })
        column += 1
      }
    }
    while (row < rows) {
      ops.push({ kind: '-', text: oldMiddle[row] })
      row += 1
    }
    while (column < columns) {
      ops.push({ kind: '+', text: newMiddle[column] })
      column += 1
    }
  } else {
    for (const line of oldMiddle) ops.push({ kind: '-', text: line })
    for (const line of newMiddle) ops.push({ kind: '+', text: line })
  }

  for (let index = oldLines.length - suffix; index < oldLines.length; index += 1) {
    ops.push({ kind: ' ', text: oldLines[index] })
  }

  const ranges: [number, number][] = []
  for (let index = 0; index < ops.length; index += 1) {
    if (ops[index].kind === ' ') continue
    const start = Math.max(0, index - context)
    const end = Math.min(ops.length - 1, index + context)
    const previous = ranges.at(-1)
    if (previous !== undefined && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end)
    else ranges.push([start, end])
  }
  if (ranges.length === 0) return ''

  const oldLineAt: number[] = []
  const newLineAt: number[] = []
  let oldLine = 1
  let newLine = 1
  for (const op of ops) {
    oldLineAt.push(oldLine)
    newLineAt.push(newLine)
    if (op.kind !== '+') oldLine += 1
    if (op.kind !== '-') newLine += 1
  }
  oldLineAt.push(oldLine)
  newLineAt.push(newLine)

  const output: string[] = []
  for (const [start, end] of ranges) {
    const oldCount = ops.slice(start, end + 1).filter((op) => op.kind !== '+').length
    const newCount = ops.slice(start, end + 1).filter((op) => op.kind !== '-').length
    output.push(`@@ -${oldLineAt[start]},${oldCount} +${newLineAt[start]},${newCount} @@`)
    for (let index = start; index <= end; index += 1) {
      if (output.length >= maxLines) {
        output.push('... diff truncated ...')
        return output.join('\n')
      }
      output.push(`${ops[index].kind}${ops[index].text}`)
    }
  }
  return output.join('\n')
}

/** One structured hunk as the result card renders it. */
export interface DiffHunk {
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  readonly lines: readonly string[]
}

/** One file's structured comparison. */
export interface DiffHunks {
  readonly hunks: readonly DiffHunk[]
  readonly added: number
  readonly deleted: number
  readonly coarse: boolean
}

/**
 * Render structured hunks from the same bounded line comparison the report
 * uses. The result card consumes this shape directly.
 *
 * @param before - complete file text before the edits.
 * @param after - complete file text after the edits.
 * @returns hunks and the exact added/deleted line counts.
 */
export function diffHunks(before: string, after: string): DiffHunks {
  const text = unifiedDiff(before, after, 3, Number.MAX_SAFE_INTEGER)
  const hunks: DiffHunk[] = []
  let current: { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] } | undefined
  for (const line of text.split('\n')) {
    const header = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(line)
    if (header !== null) {
      current = {
        oldStart: Number(header[1]),
        oldLines: Number(header[2]),
        newStart: Number(header[3]),
        newLines: Number(header[4]),
        lines: [],
      }
      hunks.push(current)
      continue
    }
    if (current !== undefined && line.length > 0) current.lines.push(line)
  }
  let added = 0
  let deleted = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) added += 1
      else if (line.startsWith('-')) deleted += 1
    }
  }
  return { hunks, added, deleted, coarse: false }
}
