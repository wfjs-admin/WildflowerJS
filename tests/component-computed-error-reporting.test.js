/**
 * A component computed that throws is the author's exception, so it reaches
 * the console in every build when nothing handles it (stores and plugins
 * already do). A computed that throws only while the component is being set
 * up (its first evaluation runs before pools exist and before init()) and
 * works once init() has run is not an error and says nothing.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, waitForCompleteRender } from './helpers/load-framework.js'

describe('component computed errors', () => {
  let container
  let logged
  let origError
  let origWarn

  beforeAll(async () => { await loadFramework() })

  beforeEach(() => {
    resetFramework()
    container = document.createElement('div')
    document.body.appendChild(container)
    logged = []
    origError = console.error
    origWarn = console.warn
    console.error = (...a) => { logged.push(a.map(String).join(' ')) }
    console.warn = (...a) => { logged.push(a.map(String).join(' ')) }
  })

  afterEach(() => {
    console.error = origError
    console.warn = origWarn
    container.remove()
  })

  async function mount(html) {
    container.innerHTML = html
    if (window.wildflower._setupDynamicComponentDetection) window.wildflower._setupDynamicComponentDetection()
    await waitForCompleteRender()
    await window.wildflower.whenSettled()
    await new Promise(r => setTimeout(r, 30))
  }

  it('a computed that only fails before init() sets its state says nothing, and binds the value', async () => {
    window.wildflower.component('cce-init-state', {
      state: { user: null },
      computed: { userName() { return this.user.name } },
      init() { this.user = { name: 'ada' } },
    })
    await mount('<div data-component="cce-init-state"><span id="cce-name" data-bind="userName"></span></div>')

    expect(document.getElementById('cce-name').textContent).toBe('ada')
    expect(logged.filter(l => l.includes('userName'))).toEqual([])
  })

  it.skipIf(!hasFeature('pools'))('a computed over a pool, read before the pool exists, says nothing', async () => {
    window.wildflower.component('cce-pool', {
      state: {},
      pools: { items: {} },
      computed: { itemCount() { return this.pools.items.length } },
      init() { this.pools.items.add({ id: 1 }) },
    })
    await mount('<div data-component="cce-pool"><span id="cce-count" data-bind="itemCount"></span>' +
      '<div data-pool="items"><template><i></i></template></div></div>')

    expect(document.getElementById('cce-count').textContent).toBe('1')
    expect(logged.filter(l => l.includes('itemCount'))).toEqual([])
  })

  it('a computed that still throws after init() reaches the console once, in every build', async () => {
    window.wildflower.component('cce-broken', {
      state: { n: 1 },
      computed: { broken() { throw new Error('cce-boom-1') } },
      init() {},
    })
    await mount('<div data-component="cce-broken"><span data-bind="broken"></span></div>')

    const found = logged.filter(l => l.includes('cce-boom-1'))
    expect(found.length).toBe(1)
    expect(found[0]).toContain('broken')
  })

  it('a component without init() still reports a computed that throws', async () => {
    window.wildflower.component('cce-broken-noinit', {
      state: {},
      computed: { alsoBroken() { throw new Error('cce-boom-2') } },
    })
    await mount('<div data-component="cce-broken-noinit"><span data-bind="alsoBroken"></span></div>')

    expect(logged.filter(l => l.includes('cce-boom-2')).length).toBe(1)
  })

  it('onError receives a computed that still throws after init(), once, and the console stays quiet', async () => {
    const seen = []
    window.wildflower.component('cce-handled', {
      state: {},
      computed: { failing() { throw new Error('cce-boom-3') } },
      init() {},
      onError(error, info) { seen.push([error.message, info.lifecycle, info.computedName]); return true },
    })
    await mount('<div data-component="cce-handled"><span data-bind="failing"></span></div>')

    expect(seen).toEqual([['cce-boom-3', 'computed', 'failing']])
    expect(logged.filter(l => l.includes('cce-boom-3'))).toEqual([])
  })

  it('onError is not called for a computed that only fails before init()', async () => {
    const seen = []
    window.wildflower.component('cce-handled-transient', {
      state: { user: null },
      computed: { who() { return this.user.name } },
      init() { this.user = { name: 'lin' } },
      onError(error) { seen.push(error.message); return true },
    })
    await mount('<div data-component="cce-handled-transient"><span data-bind="who"></span></div>')

    expect(seen).toEqual([])
  })
})
