/**
 * WF-942 points at the query's own form of a store key it ignores.
 *
 * A key a query does not read is ignored with WF-942. The suggestion named
 * the query form only for `pools`; storageKey / autoSave (persist) and
 * watch (a consumer's store: watcher) now get one too.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') && !isMinifiedBuild() ? describe : describe.skip

suite('WF-942 hints', () => {
  let lines, origWarn

  beforeAll(async () => { await loadFramework() })

  beforeEach(() => {
    resetFramework()
    lines = []
    origWarn = console.warn
    console.warn = (...a) => lines.push(a.map(String).join(' '))
  })

  afterEach(() => { console.warn = origWarn })

  it('storageKey and autoSave point at persist', () => {
    wildflower.query('quk-a', { from: async () => [], storageKey: 'x', autoSave: true })
    // The suggestion always lists `persist` among the keys a query reads, so
    // look for the hint itself.
    expect(lines.filter((l) => l.includes('persist: true')).length).toBe(2)
  })

  it('watch points at a store: watcher in the consumer', () => {
    wildflower.query('quk-b', { from: async () => [], watch: { rows() {} } })
    expect(lines.some((l) => l.includes('store:quk-b.rows'))).toBe(true)
  })
})
