/**
 * WF-942: a query config key the query system does not read is ignored, so a
 * development build says so. The common cases: a typo (`refersh`), or a key
 * from another entity kind (`pools`, `state`), which queries do not take: a
 * query's collection is its `rows`.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

describe.skipIf(!hasFeature('query') || isMinifiedBuild())('WF-942: unknown query config keys', () => {
  let wf
  let n = 0
  let warnings
  let originalWarn
  beforeAll(async () => { await loadFramework(); wf = window.wildflower })
  function capture() {
    warnings = []
    originalWarn = console.warn
    console.warn = (...a) => warnings.push(a.join(' '))
  }
  afterEach(() => { if (originalWarn) console.warn = originalWarn; originalWarn = null })

  it('warns once, naming the key, for pools on a query', () => {
    capture()
    const name = 'qUnknown' + (++n)
    wf.query(name, { from: () => [], pools: { a: {} } })
    const found = warnings.filter((w) => w.includes('[WF WF-942]'))
    expect(found.length).toBe(1)
    expect(found[0]).toContain(`"${name}"`)
    expect(found[0]).toContain('pools')
  })

  it('suggests the nearest real key for a typo', () => {
    capture()
    wf.query('qTypo' + (++n), { from: () => [], refersh: 'poll:1000' })
    const all = warnings.join('\n')
    expect(all).toContain('WF-942')
    expect(all).toContain('refresh')
  })

  it('stays silent for every key the query system reads', () => {
    capture()
    wf.query('qKnown' + (++n), {
      from: '/api/items', key: 'id', refresh: 'manual', params: {}, initial: [], stream: '/api/items',
      deleted: 'deleted', retry: 0, to: '/api/items/:id', persist: false, select: (b) => b,
      create: '/api/items', headers: {}, body: (i) => i, confirmation: (b) => b,
    })
    expect(warnings.filter((w) => w.includes('WF-942'))).toEqual([])
  })
})
