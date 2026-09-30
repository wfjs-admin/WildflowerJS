/**
 * Query registration against the store namespace, and unregister.
 *
 * A query is a store underneath, so the two share one namespace. query('x')
 * after store('x') must be refused (WF-952 in development) and leave the
 * store alone; the guard looked up the store on the wrong object and never
 * ran. unregister(q) removed only the backing store and left the controller,
 * so its poll kept fetching and a second query(q) was taken for a duplicate.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms))

suite('query registration guards', () => {
  let container, warns, realWarn

  beforeAll(async () => { await loadFramework() })

  beforeEach(() => {
    resetFramework()
    container = document.createElement('div')
    document.body.appendChild(container)
    warns = []
    realWarn = console.warn
    console.warn = (...a) => warns.push(a.map(String).join(' '))
  })

  afterEach(() => {
    console.warn = realWarn
    container.remove()
  })

  it('query() with a store\'s name is refused and leaves the store alone', async () => {
    wildflower.store('qg-taken', { state: { mine: 1 } })
    let fetches = 0
    const handle = wildflower.query('qg-taken', { from: async () => { fetches++; return [{ id: 1 }] } })
    await settle()
    expect(handle).toBe(null)
    expect(wildflower.getStore('qg-taken').mine).toBe(1)
    expect(fetches).toBe(0)
    if (!isMinifiedBuild()) expect(warns.some((w) => w.includes('WF-952'))).toBe(true)
  })

  it('unregister(query) stops its rungs, and the name can be registered again', async () => {
    let first = 0
    wildflower.query('qg-q', { from: async () => { first++; return [{ id: 1, name: 'old' }] }, refresh: 0.05 })
    wildflower.component('qg-c', { state: {} })
    container.innerHTML =
      '<div data-component="qg-c"><ul data-query="qg-q"><template><li class="row" data-bind="name"></li></template></ul></div>'
    wildflower.scan(container)
    await settle(200)
    expect(first).toBeGreaterThan(1)

    wildflower.unregister('qg-q')
    await settle(20)
    const stopped = first
    await settle(250)
    expect(first).toBe(stopped)

    container.innerHTML = ''
    let second = 0
    const handle = wildflower.query('qg-q', { from: async () => { second++; return [{ id: 2, name: 'new' }] } })
    expect(handle).not.toBe(null)
    wildflower.component('qg-c2', { state: {} })
    container.innerHTML =
      '<div data-component="qg-c2"><ul data-query="qg-q"><template><li class="row" data-bind="name"></li></template></ul></div>'
    wildflower.scan(container)
    await settle(200)
    expect(second).toBeGreaterThan(0)
    expect(container.querySelector('.row')?.textContent).toBe('new')
  })
})
