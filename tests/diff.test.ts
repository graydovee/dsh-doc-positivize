import { describe, expect, it } from 'vitest'
import { unifiedDiff } from '../src/diff'

describe('unifiedDiff', () => {
  it('renders a one-line replacement with context', () => {
    const diff = unifiedDiff('a\nb\nc\n', 'a\nB\nc\n')

    expect(diff).toContain('@@ -1,4 +1,4 @@')
    expect(diff).toContain('-b')
    expect(diff).toContain('+B')
  })

  it('renders a deletion', () => {
    const diff = unifiedDiff('keep\nremove\nkeep\n', 'keep\nkeep\n')

    expect(diff).toContain('-remove')
    expect(diff).not.toContain('+remove')
  })

  it('returns an empty body for equal text', () => {
    expect(unifiedDiff('same\n', 'same\n')).toBe('')
  })

  it('splits distant changes into separate hunks', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].join('\n') + '\n'
    const after = before.replace('b', 'B').replace('k', 'K')

    const diff = unifiedDiff(before, after)

    expect(diff.match(/^@@/gm)).toHaveLength(2)
  })
})
