/**
 * watch: {} on stores and plugins, with the same semantics as a component's.
 *
 * Components, stores and plugins share one watcher implementation
 * (_setupWatchers / _executeWatchers). Handlers fire during the write, as a
 * component's and a subscribe() callback's do.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

let n = 0
const live = []
const uniq = (base) => base + (++n)

beforeAll(async () => { await loadFramework() })
afterEach(() => { while (live.length) wildflower.unregister(live.pop()) })

async function captureWarnings(fn) {
  const lines = []
  const orig = console.warn
  console.warn = (...a) => { lines.push(a.map(String).join(' ')) }
  try { await fn() } finally { console.warn = orig }
  return lines
}

describe('store watch', () => {
  it('a watcher on its own state fires during the write, from outside, from a method and from init()', () => {
    const name = uniq('sw'); live.push(name)
    const calls = []
    wildflower.store(name, {
      state: { size: 1 },
      watch: { size(nv, ov) { calls.push([nv, ov]) } },
      init() { this.size = 2 },
      grow() { this.size++ },
    })
    const s = wildflower.getStore(name)
    s.size = 10
    expect(calls.at(-1)).toEqual([10, 2])
    s.grow()
    expect(calls).toEqual([[2, 1], [10, 2], [11, 10]])
  })

  it('this is the store: state, computed and methods are reachable', () => {
    const name = uniq('swThis'); live.push(name)
    const seen = []
    wildflower.store(name, {
      state: { a: 1, log: 0 },
      computed: { twice() { return this.a * 2 } },
      watch: { a() { seen.push(this.twice); this.bump() } },
      bump() { this.log++ },
    })
    const s = wildflower.getStore(name)
    s.a = 5
    expect(seen).toEqual([10])
    expect(s.log).toBe(1)
  })

  it('a nested path, and a parent watcher that hears a child write', () => {
    const name = uniq('swNested'); live.push(name)
    const child = [], parent = []
    wildflower.store(name, {
      state: { user: { profile: { theme: 'light' } } },
      watch: {
        'user.profile.theme'(nv, ov) { child.push([nv, ov]) },
        user(nv, ov, path) { parent.push(path) },
      },
    })
    const s = wildflower.getStore(name)
    s.user.profile.theme = 'dark'
    expect(child).toEqual([['dark', 'light']])
    expect(parent).toEqual(['user.profile.theme'])
  })

  // A computed's change notifier is installed after registration (as on a
  // component), so the writes below wait for it.
  it('a computed, a wildcard, :immediate, and the { handler } form', async () => {
    const name = uniq('swMore'); live.push(name)
    const computedCalls = [], all = [], immediate = [], objForm = []
    wildflower.store(name, {
      state: { a: 1, b: 1 },
      computed: { sum() { return this.a + this.b } },
      watch: {
        sum(nv) { computedCalls.push(nv) },
        '*'(nv, ov, path) { all.push(path) },
        'a:immediate'(nv) { immediate.push(nv) },
        b: { handler(nv) { objForm.push(nv) } },
      },
    })
    expect(immediate).toEqual([1])
    const s = wildflower.getStore(name)
    await new Promise((r) => setTimeout(r, 10))
    s.a = 3
    s.b = 4
    // A plain path's watcher fires during the write; a computed's change is
    // delivered by its notifier effect, after the write.
    await new Promise((r) => setTimeout(r, 10))
    expect(computedCalls.at(-1)).toBe(7)
    expect(all).toEqual(expect.arrayContaining(['a', 'b']))
    expect(immediate).toEqual([1, 3])
    expect(objForm).toEqual([4])
  })

  it('a store:other.path key watches another store', () => {
    const other = uniq('swOther'), name = uniq('swCross'); live.push(name, other)
    const calls = []
    wildflower.store(other, { state: { level: 1 } })
    wildflower.store(name, { state: {}, watch: { [`store:${other}.level`](nv) { calls.push(nv) } } })
    wildflower.getStore(other).level = 7
    expect(calls).toContain(7)
  })

  it('a wildcard does not hear the store\'s framework-internal state', async () => {
    const name = uniq('swInternal'); live.push(name)
    const paths = []
    wildflower.store(name, { state: { v: 0 }, watch: { '*'(nv, ov, path) { paths.push(path) } } })
    await new Promise((r) => setTimeout(r, 10))
    wildflower.getStore(name).v = 1
    expect(paths).toEqual(['v'])
  })

  it('stops after the store is unregistered', () => {
    const name = uniq('swGone')
    const calls = []
    wildflower.store(name, { state: { v: 0 }, watch: { v(nv) { calls.push(nv) } } })
    const s = wildflower.getStore(name)
    s.v = 1
    wildflower.unregister(name)
    s.v = 2
    expect(calls).toEqual([1])
  })

  ;(isMinifiedBuild() ? it.skip : it)('watch is part of the store contract: no WF-219', async () => {
    const name = uniq('swContract'); live.push(name)
    const lines = await captureWarnings(() => {
      wildflower.store(name, { state: { v: 0 }, watch: { v() {} } })
    })
    expect(lines.filter((l) => l.includes('WF-219'))).toEqual([])
  })
})

describe.skipIf(!hasFeature('plugins'))('plugin watch, shared with components', () => {
  it('a computed, a wildcard, :immediate and the { handler } form', async () => {
    const name = uniq('pw')
    const computedCalls = [], all = [], immediate = [], objForm = []
    wildflower.plugin({
      name,
      state: { a: 1, b: 1 },
      computed: { sum() { return this.a + this.b } },
      watch: {
        sum(nv) { computedCalls.push(nv) },
        '*'(nv, ov, path) { all.push(path) },
        'a:immediate'(nv) { immediate.push(nv) },
        b: { handler(nv) { objForm.push(nv) } },
      },
      setA(v) { this.a = v },
      setB(v) { this.b = v },
    })
    expect(immediate).toEqual([1])
    const p = wildflower['$' + name]
    await new Promise((r) => setTimeout(r, 10))
    p.setA(3)
    p.setB(4)
    await new Promise((r) => setTimeout(r, 10))
    expect(computedCalls.at(-1)).toBe(7)
    expect(all).toEqual(expect.arrayContaining(['a', 'b']))
    expect(immediate).toEqual([1, 3])
    expect(objForm).toEqual([4])
  })

  it('a plugin registered again stops its old store: watcher', () => {
    const store = uniq('pwCart'), name = uniq('pwAgain'); live.push(store)
    wildflower.store(store, { state: { items: 0 } })
    const calls = []
    wildflower.plugin({ name, state: {}, watch: { [`store:${store}.items`](v) { calls.push(['old', v]) } } })
    wildflower.plugin({ name, state: {}, watch: { [`store:${store}.items`](v) { calls.push(['new', v]) } } })
    wildflower.getStore(store).items = 1
    expect(calls).toEqual([['new', 1]])
  })

  it('a plugin whose only block is watch sets it up', () => {
    const store = uniq('pwOnly'), name = uniq('pwWatchOnly'); live.push(store)
    wildflower.store(store, { state: { items: 0 } })
    const calls = []
    wildflower.plugin({ name, watch: { [`store:${store}.items`](v) { calls.push(v) } } })
    wildflower.getStore(store).items = 1
    expect(calls).toEqual([1])
  })

  it('a plugin with methods and watch but no state sets up the watcher', () => {
    const store = uniq('pwMeth'), name = uniq('pwWatchMeth'); live.push(store)
    wildflower.store(store, { state: { items: 0 } })
    const calls = []
    wildflower.plugin({ name, watch: { [`store:${store}.items`](v) { calls.push(v) } }, ping() { return 'pong' } })
    wildflower.getStore(store).items = 2
    expect(calls).toEqual([2])
    expect(wildflower['$' + name].ping()).toBe('pong')
  })

  it.skipIf(!hasFeature('pools'))('a plugin whose pool setup throws leaves no store: watcher behind', () => {
    const store = uniq('pwCart2'), name = uniq('pwFail'); live.push(store)
    wildflower.store(store, { state: { items: 0 } })
    const calls = []
    const err = console.error
    console.error = () => {}
    try {
      // An arrow-function entity method cannot bind `this`: pool setup throws.
      wildflower.plugin({
        name, state: {},
        watch: { [`store:${store}.items`](v) { calls.push(v) } },
        pools: { a: { entity: { go: () => {} } } },
      })
    } finally { console.error = err }
    wildflower.getStore(store).items = 1
    expect(calls).toEqual([])
  })
})

// watch is the watchers block on every entity kind, never a method: a
// function there is ignored, and a development build says so (WF-219).
describe.skipIf(isMinifiedBuild())('a function named watch', () => {
  const wf219Watch = (lines) => lines.filter((l) => l.includes('WF-219') && l.includes('watch'))

  it('on a store', async () => {
    const name = uniq('swFn'); live.push(name)
    const lines = await captureWarnings(() => { wildflower.store(name, { state: {}, watch() { return 1 } }) })
    expect(wf219Watch(lines).length).toBe(1)
  })

  it.skipIf(!hasFeature('plugins'))('on a plugin', async () => {
    const lines = await captureWarnings(() => { wildflower.plugin({ name: uniq('pwFn'), state: {}, watch() { return 1 } }) })
    expect(wf219Watch(lines).length).toBe(1)
  })

  it('on a component', async () => {
    const name = uniq('cw-fn')
    const lines = await captureWarnings(async () => {
      wildflower.component(name, { state: {}, watch() { return 1 } })
      const host = document.createElement('div')
      host.innerHTML = `<div data-component="${name}"></div>`
      document.body.appendChild(host)
      if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection()
      await new Promise((r) => setTimeout(r, 50))
      host.remove()
    })
    expect(wf219Watch(lines).length).toBe(1)
  })
})
