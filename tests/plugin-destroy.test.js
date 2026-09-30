/**
 * Plugins run beforeDestroy() and destroy(), as components and stores do.
 *
 * A plugin that opens something outside the framework (an interval, a
 * socket, a window listener) closes it in destroy(). Both hooks run when the
 * plugin is replaced under the same name and when the framework is torn
 * down, with `this` as the plugin. They were dropped without a word.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

let n = 0
const uniq = (base) => base + (++n)

describe.skipIf(!hasFeature('plugins'))('plugin destroy', () => {
  beforeAll(async () => { await loadFramework() })
  beforeEach(() => { resetFramework() })

  it('a replaced plugin runs beforeDestroy then destroy, with this as the plugin', () => {
    const name = uniq('pd')
    const calls = []
    wildflower.plugin({
      name,
      state: { label: 'old' },
      beforeDestroy() { calls.push(['beforeDestroy', this.label]) },
      destroy() { calls.push(['destroy', this.label]) },
    })
    wildflower.plugin({ name, state: { label: 'new' } })
    expect(calls).toEqual([['beforeDestroy', 'old'], ['destroy', 'old']])
  })

  it('a plugin with no state still runs destroy', () => {
    const name = uniq('pdNoState')
    const calls = []
    wildflower.plugin({ name, ping() { return 'pong' }, destroy() { calls.push(this.ping()) } })
    expect(wildflower['$' + name].ping()).toBe('pong')
    wildflower.plugin({ name, ping() {} })
    expect(calls).toEqual(['pong'])
  })

  it('framework teardown runs destroy', () => {
    const name = uniq('pdTeardown')
    const calls = []
    wildflower.plugin({ name, state: {}, destroy() { calls.push('destroy') } })
    resetFramework()
    expect(calls).toEqual(['destroy'])
  })

  it('a throwing destroy is reported and the replacement still installs', () => {
    const name = uniq('pdThrow')
    const errs = []
    const orig = console.error
    console.error = (...a) => errs.push(a.map(String).join(' '))
    try {
      wildflower.plugin({ name, state: {}, destroy() { throw new Error('pd-boom') } })
      wildflower.plugin({ name, state: { v: 2 } })
    } finally { console.error = orig }
    expect(errs.some((e) => e.includes('pd-boom'))).toBe(true)
    expect(wildflower['$' + name].v).toBe(2)
  })
})
