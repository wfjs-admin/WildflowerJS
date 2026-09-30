/**
 * update() on a query store gets the same WF-950 check as an assignment.
 *
 * Query stores are engine-owned; an application write warns once (WF-950).
 * An assignment went through the context proxy and warned; update() wrote
 * through the state manager directly and said nothing.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') && !isMinifiedBuild() ? describe : describe.skip

suite('update() on a query store', () => {
  let lines, origWarn

  beforeAll(async () => { await loadFramework() })

  beforeEach(() => {
    resetFramework()
    lines = []
    origWarn = console.warn
    console.warn = (...a) => lines.push(a.map(String).join(' '))
  })

  afterEach(() => { console.warn = origWarn })

  it('warns WF-950, and the write still lands', () => {
    wildflower.query('quwc-a', { from: async () => [] })
    const store = wildflower.getStore('quwc-a')
    store.update('rows', [{ id: 9 }])
    expect(store.rows).toEqual([{ id: 9 }])
    expect(lines.some((l) => l.includes('WF-950'))).toBe(true)
  })

  it('the object form warns as well', () => {
    wildflower.query('quwc-b', { from: async () => [] })
    wildflower.getStore('quwc-b').update({ rows: [{ id: 1 }] })
    expect(lines.some((l) => l.includes('WF-950'))).toBe(true)
  })
})
