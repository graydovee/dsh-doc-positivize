import { describe, expect, it } from 'vitest'
import { Config } from '../src/config'
import { GUARD_TEXT } from '../src/guard'

/**
 * The Loader validates a row's `config` with this schema at activation, so an
 * invalid budget must throw here instead of reaching the sweep and aborting it.
 */
describe('Config', () => {
  it('fills the documented defaults for an empty row', () => {
    const config = Config({})
    // `.volatile()` fields arrive as live getters, exactly as the Host passes them.
    expect(config.guardEnabled.get()).toBe(true)
    expect(config.command).toBe(true)
    expect(config.guard).toBe(GUARD_TEXT)
    expect(config.extra).toBe('')
    expect(config.maxFiles).toBe(12)
    expect(config.maxFileBytes).toBe(96000)
    expect(config.timeoutMs).toBe(180000)
    expect(config.auditEnabled).toBe(true)
    expect(config.auditRuns).toBe(20)
    expect(config.ignoredPaths.get()).toContain('node_modules')
  })

  it('rejects budgets that would make every sweep abort', () => {
    expect(() => Config({ maxFiles: 0 })).toThrow()
    expect(() => Config({ maxFileBytes: -1 })).toThrow()
    expect(() => Config({ timeoutMs: 0 })).toThrow()
    expect(() => Config({ timeoutMs: 999 })).toThrow()
  })

  it('rejects a fractional budget', () => {
    expect(() => Config({ maxFiles: 1.5 })).toThrow()
  })

  it('rejects an audit retention below one run', () => {
    expect(() => Config({ auditRuns: 0 })).toThrow()
    expect(() => Config({ auditRuns: 1.5 })).toThrow()
  })

  it('accepts audit overrides', () => {
    const config = Config({ auditEnabled: false, auditRuns: 1 })
    expect(config.auditEnabled).toBe(false)
    expect(config.auditRuns).toBe(1)
  })

  it('keeps a valid override', () => {
    const config = Config({ maxFiles: 1, maxFileBytes: 1, timeoutMs: 1000, ignoredPaths: ['docs'] })
    expect(config.maxFiles).toBe(1)
    expect(config.maxFileBytes).toBe(1)
    expect(config.timeoutMs).toBe(1000)
    expect(config.ignoredPaths.get()).toEqual(['docs'])
  })
})
