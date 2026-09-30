/**
 * Listeners are passive observers of a query (data-query-freshness.html,
 * "What starts a query, and what only listens").
 *
 * A 'store:q.rows' watcher and a store subscribe() hear every result, but
 * never start a fetch and never keep a query active. An element, a
 * subscribe: {} declaration or a getQuery() read starts it.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms))

suite('query listeners are passive', () => {
  let container

  beforeAll(async () => { await loadFramework() })

  beforeEach(() => {
    resetFramework()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => { container.remove() })

  it('a store: watcher alone never starts a fetch', async () => {
    let fetches = 0
    wildflower.query('qpl-a', { from: async () => { fetches++; return [{ id: 1 }] } })
    wildflower.component('qpl-w', { state: {}, watch: { 'store:qpl-a.rows'() {} } })
    container.innerHTML = '<div data-component="qpl-w"></div>'
    wildflower.scan(container)
    await settle(150)
    expect(fetches).toBe(0)
  })

  it('a subscribe() alone never starts a fetch', async () => {
    let fetches = 0
    wildflower.query('qpl-b', { from: async () => { fetches++; return [{ id: 1 }] } })
    wildflower.getStore('qpl-b').subscribe('rows', () => {})
    await settle(150)
    expect(fetches).toBe(0)
  })

  it('a watcher hears the rows once something starts the query', async () => {
    const heard = []
    wildflower.query('qpl-c', { from: async () => [{ id: 1 }, { id: 2 }] })
    wildflower.component('qpl-w2', { state: {}, watch: { 'store:qpl-c.rows'(rows) { heard.push(rows.length) } } })
    container.innerHTML = '<div data-component="qpl-w2"></div>'
    wildflower.scan(container)
    await settle()
    expect(heard).toEqual([])
    wildflower.getQuery('qpl-c')
    await settle(150)
    expect(heard).toContain(2)
  })
})
