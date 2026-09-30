/**
 * A component whose subscribe: names a query that is registered later.
 *
 * A subscribe: declaration counts as observing a query, so it activates the
 * query (the first fetch). When the component set up before the query
 * existed, the subscription was deferred and attached once the query's store
 * arrived, but that path skipped activation: the query never fetched.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms))

suite('query activation through a late subscribe:', () => {
  let container

  beforeAll(async () => { await loadFramework() })

  beforeEach(() => {
    resetFramework()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => { container.remove() })

  it('a query registered after its subscriber fetches, and the subscriber hears the rows', async () => {
    const heard = []
    wildflower.component('qls-c', {
      state: {},
      subscribe: { 'qls-q': ['rows'] },
      onStoreUpdate(store, path, value) { if (path === 'rows') heard.push(value.length) },
    })
    container.innerHTML = '<div data-component="qls-c"></div>'
    wildflower.scan(container)
    await settle()

    let fetches = 0
    wildflower.query('qls-q', { from: async () => { fetches++; return [{ id: 1 }, { id: 2 }] } })
    await settle(150)
    expect(fetches).toBe(1)
    expect(heard).toContain(2)
  })
})
