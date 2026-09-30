/**
 * Does an index path on a query store go stale? (review finding Q6)
 *
 * WF-213 warns on watch paths like 'rows.0.name' because an array changed
 * in place leaves such a watcher on the item that was at that position when
 * it was first observed. A query never changes rows in place: every fetch
 * and write replaces the array. This checks that a 'store:q.rows.0.name'
 * watcher on a LIST query reports the current first row through a refresh,
 * a re-sort, an optimistic edit and an optimistic delete of the first row.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms))

suite('index path watcher on a query store', () => {
  let container

  beforeAll(async () => { await loadFramework() })

  beforeEach(() => {
    resetFramework()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => { container.remove() })

  it('rows.0.name follows the current first row', async () => {
    let server = [{ id: 1, name: 'alpha' }, { id: 2, name: 'beta' }]
    let release = null
    wildflower.query('qip', {
      from: async () => server.map((r) => ({ ...r })),
      key: 'id',
      deleted: 'removed',
      to: (item) => new Promise((resolve) => { release = () => resolve(undefined) }),
    })
    const heard = []
    wildflower.component('qip-c', { state: {}, watch: { 'store:qip.rows.0.name'(v) { heard.push(v) } } })
    container.innerHTML =
      '<div data-component="qip-c"><ul data-query="qip"><template><li class="row" data-bind="name"></li></template></ul></div>'
    wildflower.scan(container)
    await settle(150)
    const store = wildflower.getStore('qip')
    const first = () => store.rows[0] && store.rows[0].name

    expect(first()).toBe('alpha')
    expect(heard.at(-1)).toBe('alpha')

    // Re-sorted by the server, fetched again.
    server = [server[1], server[0]]
    await wildflower.getQuery('qip').refresh()
    await settle()
    expect(first()).toBe('beta')
    expect(heard.at(-1)).toBe('beta')

    // Optimistic edit of the first row, before the server answers.
    wildflower.getQuery('qip').write({ id: 2, name: 'beta-edited' })
    await settle()
    expect(first()).toBe('beta-edited')
    expect(heard.at(-1)).toBe('beta-edited')
    if (release) release()
    await settle()

    // Optimistic delete of the first row: the next row moves to index 0.
    wildflower.getQuery('qip').write({ id: 2, removed: true })
    await settle()
    expect(first()).toBe('alpha')
    expect(heard.at(-1)).toBe('alpha')
    if (release) release()
    await settle()
  })

  // So WF-213 does not apply to a query store; an ordinary store keeps it.
  it.skipIf(isMinifiedBuild())('WF-213 does not warn for a query store, and still warns for a store', async () => {
    const lines = []
    const orig = console.warn
    console.warn = (...a) => lines.push(a.map(String).join(' '))
    try {
      wildflower.query('qip-w', { from: async () => [] })
      wildflower.store('qip-plain', { state: { rows: [] } })
      wildflower.getStore('qip-w').subscribe('rows.0.name', () => {})
      const warned = () => lines.filter((l) => l.includes('[WF WF-213]')).length
      const queryHits = warned()
      wildflower.getStore('qip-plain').subscribe('rows.0.name', () => {})
      expect(queryHits).toBe(0)
      expect(warned()).toBe(1)
    } finally { console.warn = orig }
  })
})
