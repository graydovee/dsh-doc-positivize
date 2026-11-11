import { describe, expect, it } from 'vitest'
import { GUARD_TEXT, composeGuard } from '../src/guard'

/** Negative markers copied verbatim from ox01024/positivize's marker scan. */
const CHINESE_MARKERS = /不要|绝不|严禁|禁止|切勿|避免|请勿|不得|不再支持|不再使用|已移除|已废弃|已删除|千万别|不含|没有使用|而不是/
const ENGLISH_MARKERS = /\b(do not|don't|never|avoid|must not|should not|deprecated|removed|no longer|without|instead of)\b/i

describe('guard contract', () => {
  it('passes the doc-positivize marker scan', () => {
    expect(GUARD_TEXT).not.toMatch(CHINESE_MARKERS)
    expect(GUARD_TEXT).not.toMatch(ENGLISH_MARKERS)
  })

  it('stays in English like every first-party prompt section', () => {
    expect(GUARD_TEXT).not.toMatch(/[\u4e00-\u9fff]/)
  })

  it('keeps literal prompt-variable braces out', () => {
    expect(GUARD_TEXT).not.toContain('{{')
    expect(GUARD_TEXT).not.toContain('}}')
  })

  it('states the three rules', () => {
    expect(GUARD_TEXT).toContain('State the final state only')
    expect(GUARD_TEXT).toContain('Absence is negation')
    expect(GUARD_TEXT).toContain('Affirmative is the standard')
  })
})

describe('composeGuard', () => {
  it('joins a guard and extra guidance with a blank line', () => {
    expect(composeGuard('Rule.', 'Extra.')).toBe('Rule.\n\nExtra.')
  })

  it('returns the guard alone when extra is blank', () => {
    expect(composeGuard('Rule.', '   ')).toBe('Rule.')
  })

  it('append-only config keeps the built-in text intact', () => {
    expect(composeGuard(GUARD_TEXT, 'Extra.')).toBe(`${GUARD_TEXT}\n\nExtra.`)
  })

  it('contributes nothing when both parts are blank', () => {
    expect(composeGuard('', '  ')).toBe('')
  })
})
