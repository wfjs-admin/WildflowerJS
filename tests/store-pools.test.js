/**
 * Store pools: a `pools: {}` block in a store definition.
 *
 * A store has no DOM, so its pools are data only: the same pool handle a
 * component gets (entity state/computed/methods, props, hooks, swap-with-last
 * storage, reactive length) without the rendering half. Driven entirely
 * through the public surface: wildflower.store, getStore, the store's own
 * methods, tick() on the real frame loop, and wildflower.unregister.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const describeIfPools = hasFeature('pools') ? describe : describe.skip
const describeIfNoPools = hasFeature('pools') ? describe.skip : describe
// Plugins start at the standard tier; lite and mini-pool have pools without them.
const describeIfPluginPools = hasFeature('pools') && hasFeature('plugins') ? describe : describe.skip
const itIfPlugins = hasFeature('plugins') ? it : it.skip

let n = 0
const live = []
const storeName = (base) => base + (++n)
const frames = (k = 2) => new Promise((resolve) => {
  let left = k
  const step = () => { if (--left <= 0) resolve(); else requestAnimationFrame(step) }
  requestAnimationFrame(step)
})

async function captureWarnings(fn) {
  const lines = []
  const orig = console.warn
  console.warn = (...a) => { lines.push(a.map(String).join(' ')) }
  try { await fn() } finally { console.warn = orig }
  return lines
}

beforeAll(async () => { await loadFramework() })
afterEach(() => {
  while (live.length) {
    const x = live.pop()
    if (typeof x === 'string') wildflower.unregister(x)
    else x.remove()
  }
})

describeIfPools('store pools', () => {
  it('a pools block gives the store this.pools.name and getPool(name), the same handle', () => {
    const name = storeName('sim')
    live.push(name)
    let seen = null
    wildflower.store(name, {
      state: { n: 0 },
      pools: { agents: {} },
      init() { seen = { pools: this.pools.agents, getPool: this.getPool('agents') } },
    })
    const s = wildflower.getStore(name)
    expect(s.pools.agents).toBeTruthy()
    expect(s.getPool('agents')).toBe(s.pools.agents)
    expect(seen.pools).toBe(s.pools.agents)
    expect(seen.getPool).toBe(s.pools.agents)
  })

  it('does not warn that pools is an unknown definition key', async () => {
    const name = storeName('sim')
    live.push(name)
    const lines = await captureWarnings(() => {
      wildflower.store(name, { state: { n: 0 }, pools: { agents: {} } })
    })
    expect(lines.filter((l) => l.indexOf('WF-219') !== -1 && l.indexOf('pools') !== -1)).toEqual([])
  })

  it('the pool API works without DOM: push, get, update, remove, clear, length, items, iteration', () => {
    const name = storeName('sim')
    live.push(name)
    wildflower.store(name, { state: {}, pools: { agents: {} } })
    const p = wildflower.getStore(name).pools.agents
    expect(p.push({ id: 1, x: 0 }, { id: 2, x: 5 })).toBe(2)
    p.add({ id: 3, x: 9 })
    expect(p.length).toBe(3)
    expect(p.size).toBe(3)
    expect(p.get(2).x).toBe(5)
    expect(p.update(2, { x: 7 }).x).toBe(7)
    expect(p.items.map((e) => e.id).sort()).toEqual([1, 2, 3])
    expect([...p].length).toBe(3)
    expect(p.filter((e) => e.x > 1).length).toBe(2)
    expect(p.remove(1)).toBe(true)
    expect(p.remove(1)).toBe(false)
    expect(p.length).toBe(2)
    expect(p.get(1)).toBeUndefined()
    p.clear()
    expect(p.length).toBe(0)
    expect(p.items).toEqual([])
  })

  it('the DOM-only methods have headless answers: getElement undefined, at(i) is items[i], swap is a no-op', () => {
    const name = storeName('sim')
    live.push(name)
    wildflower.store(name, { state: {}, pools: { agents: {} } })
    const p = wildflower.getStore(name).pools.agents
    p.push({ id: 1 }, { id: 2 })
    expect(p.getElement(1)).toBeUndefined()
    expect(p.at(0)).toBe(p.items[0])
    expect(p.at(1)).toBe(p.items[1])
    expect(p.swap(1, 2)).toBe(true)
    expect(p.swap(1, 99)).toBe(false)
    expect(p.markDirty(1)).toBeUndefined()
  })

  it('entity state defaults, entity computed, entity methods and props apply as they do on a component pool', () => {
    const name = storeName('sim')
    live.push(name)
    wildflower.store(name, {
      state: {},
      pools: {
        agents: {
          props: { speed: 2 },
          entity: {
            state: { x: 0, hp: 100 },
            computed: { alive() { return this.hp > 0 } },
            hit(dmg) { this.hp -= dmg },
          },
        },
      },
    })
    const p = wildflower.getStore(name).pools.agents
    p.push({ id: 1 })
    p.push({ id: 2, hp: 5 })
    const a = p.get(1)
    expect(a.x).toBe(0)
    expect(a.hp).toBe(100)
    expect(p.get(2).hp).toBe(5)
    expect(a.alive).toBe(true)
    p.get(2).hit(5)
    expect(p.get(2).alive).toBe(false)
    expect(p.props.speed).toBe(2)
  })

  it('onAdd, onRemove and onClear run with this bound to the store', () => {
    const name = storeName('sim')
    live.push(name)
    wildflower.store(name, {
      state: { added: 0, removed: 0, cleared: 0 },
      pools: {
        agents: {
          onAdd() { this.added++ },
          onRemove() { this.removed++ },
          onClear(items) { this.cleared += items.length },
        },
      },
    })
    const s = wildflower.getStore(name)
    s.pools.agents.push({ id: 1 }, { id: 2 }, { id: 3 })
    s.pools.agents.remove(1)
    s.pools.agents.clear()
    expect(s.added).toBe(3)
    expect(s.removed).toBe(1)
    expect(s.cleared).toBe(2)
  })

  it('getPool(name, { onAdd, onRemove, onClear }) installs the hooks, bound to the store, as a component\'s does', () => {
    const name = storeName('hooked')
    live.push(name)
    const calls = []
    wildflower.store(name, {
      state: { tag: 'S' },
      pools: { bees: {} },
      init() {
        this.getPool('bees', {
          onAdd(e) { calls.push(['add', e.id, this.tag]) },
          onRemove(e) { calls.push(['remove', e.id, this.tag]) },
          onClear() { calls.push(['clear', this.tag]) },
        })
      },
    })
    const s = wildflower.getStore(name)
    s.pools.bees.add({ id: 1 })
    s.pools.bees.add({ id: 2 })
    s.pools.bees.remove(1)
    s.pools.bees.clear()
    expect(calls).toEqual([['add', 1, 'S'], ['add', 2, 'S'], ['remove', 1, 'S'], ['clear', 'S']])
  })

  it('init() can populate a pool, and store methods can change it', () => {
    const name = storeName('sim')
    live.push(name)
    wildflower.store(name, {
      state: {},
      pools: { agents: {} },
      init() { for (let i = 0; i < 4; i++) this.pools.agents.push({ id: i }) },
      spawn(id) { this.pools.agents.push({ id }); return this.pools.agents.length },
    })
    const s = wildflower.getStore(name)
    expect(s.pools.agents.length).toBe(4)
    expect(s.spawn(10)).toBe(5)
  })

  it('a store computed over pool length is fresh when read from JavaScript', () => {
    const name = storeName('sim')
    live.push(name)
    wildflower.store(name, {
      state: {},
      pools: { agents: {} },
      computed: { count() { return this.pools.agents.length } },
    })
    const s = wildflower.getStore(name)
    expect(s.count).toBe(0)
    s.pools.agents.push({ id: 1 }, { id: 2 })
    expect(s.count).toBe(2)
    s.pools.agents.remove(1)
    expect(s.count).toBe(1)
  })

  it('tick() on the store steps its pool on the real frame loop', async () => {
    const name = storeName('sim')
    live.push(name)
    wildflower.store(name, {
      state: { ticks: 0 },
      pools: { agents: {} },
      init() { this.pools.agents.push({ id: 1, x: 0 }, { id: 2, x: 0 }) },
      tick() {
        this.ticks++
        for (const a of this.pools.agents) a.x += 1
      },
    })
    const s = wildflower.getStore(name)
    await frames(4)
    expect(s.ticks).toBeGreaterThan(1)
    expect(s.pools.agents.get(1).x).toBe(s.ticks)
    expect(s.pools.agents.get(2).x).toBe(s.ticks)
  })

  it('a component binding to a store computed over the pool updates the DOM', async () => {
    const name = storeName('sim')
    const comp = 'store-pool-reader-' + n
    live.push(name)
    wildflower.store(name, {
      state: {},
      pools: { agents: {} },
      computed: { count() { return this.pools.agents.length } },
      spawn(id) { this.pools.agents.push({ id }) },
    })
    wildflower.component(comp, { state: {} })
    const el = document.createElement('div')
    el.innerHTML = `<div data-component="${comp}"><span id="c" data-bind="$${name}.count"></span></div>`
    document.body.appendChild(el)
    live.push(el)
    wildflower.scan(el)
    await wildflower.whenIdle()
    await frames(2)
    expect(el.querySelector('#c').textContent).toBe('0')
    wildflower.getStore(name).spawn(1)
    wildflower.getStore(name).spawn(2)
    await frames(2)
    expect(el.querySelector('#c').textContent).toBe('2')
  })

  it('a store reads another store\'s pool through this.stores, in methods and in a computed that stays current', async () => {
    const swarm = storeName('swarm')
    const watcher = storeName('watcher')
    live.push(watcher, swarm)
    wildflower.store(swarm, { pools: { bees: {} } })
    wildflower.store(watcher, {
      subscribe: [swarm],
      computed: { n() { return this.stores[swarm].pools.bees.length } },
      count() { return this.stores[swarm].pools.bees.length },
    })
    await frames(2)
    const w = wildflower.getStore(watcher)
    // A method read first: this is what builds the cached cross-store proxy.
    expect(w.count()).toBe(0)
    expect(w.n).toBe(0)
    wildflower.getStore(swarm).pools.bees.push({ id: 1 }, { id: 2 })
    await frames(2)
    expect(w.count()).toBe(2)
    expect(w.n).toBe(2)
  })

  it('pool.length is current inside onAdd, even after a computed has read it', () => {
    const name = storeName('hooks')
    live.push(name)
    const seen = []
    wildflower.store(name, {
      pools: { a: { onAdd() { seen.push(this.pools.a.length) } } },
      computed: { c() { return this.pools.a.length } },
    })
    const s = wildflower.getStore(name)
    void s.c
    s.pools.a.push({ id: 1 })
    s.pools.a.push({ id: 2 })
    expect(seen).toEqual([1, 2])
    expect(s.c).toBe(2)
  })

  it('a bulk push into a data-only pool fires onChange once, with the final size', () => {
    const name = storeName('bulk')
    live.push(name)
    wildflower.store(name, { pools: { a: {} } })
    const p = wildflower.getStore(name).pools.a
    const sizes = []
    p.onChange = (h) => sizes.push(h.size)
    p.push([{ id: 1 }, { id: 2 }, { id: 3 }])
    expect(sizes).toEqual([3])
  })

  it('a store whose setup throws leaves nothing behind, and the name can be registered again', () => {
    const name = storeName('broken')
    live.push(name)
    const errs = []
    const oe = console.error
    console.error = (...a) => errs.push(a.join(' '))
    try {
      // An arrow-function entity method cannot bind `this`: pool setup throws.
      wildflower.store(name, { pools: { a: { entity: { go: () => {} } } } })
    } finally { console.error = oe }
    expect([...wildflower.componentInstances.values()].filter((i) => i.name === 'store-' + name).length).toBe(0)
    expect(wildflower.getStore(name)).toBeFalsy()
    wildflower.store(name, { state: { ok: true }, pools: { a: {} } })
    expect(wildflower.getStore(name).ok).toBe(true)
    expect(wildflower.getStore(name).pools.a.length).toBe(0)
  })

  it('reset() returns the store to its definition: state back, pools emptied, onClear fired', () => {
    const name = storeName('game')
    live.push(name)
    let cleared = 0
    wildflower.store(name, {
      state: { score: 0 },
      pools: { enemies: { onClear() { cleared++ } } },
      init() { this.pools.enemies.push({ id: 1 }, { id: 2 }) },
    })
    const s = wildflower.getStore(name)
    s.score = 40
    s.reset()
    expect(s.score).toBe(0)
    expect(s.pools.enemies.length).toBe(0)
    expect(cleared).toBe(1)
    s.pools.enemies.push({ id: 3 })
    expect(s.pools.enemies.length).toBe(1)
  })

  itIfPlugins('a plugin\'s reset() empties its pools too', () => {
    const name = 'resetPlugin' + (++n)
    let cleared = 0
    wildflower.plugin({
      name,
      state: { lives: 3 },
      pools: { orbs: { onClear() { cleared++ } } },
      spawn() { this.pools.orbs.push({ id: 1 }) },
      size() { return this.pools.orbs.length },
    })
    const p = wildflower['$' + name]
    p.spawn()
    p.lives = 1
    p.reset()
    expect(p.lives).toBe(3)
    expect(p.size()).toBe(0)
    expect(cleared).toBe(1)
  })

  ;(isMinifiedBuild() ? it.skip : it)('WF-911: storageKey with pools warns that pool entities are not persisted', async () => {
    const name = storeName('saved')
    live.push(name)
    const lines = await captureWarnings(() => {
      wildflower.store(name, { storageKey: 'wf-test-' + name, state: { score: 0 }, pools: { enemies: {} } })
    })
    try { localStorage.removeItem('wf-test-' + name) } catch (e) { /* storage unavailable */ }
    const found = lines.filter((l) => l.includes('[WF WF-911]'))
    expect(found.length).toBe(1)
    expect(found[0]).toContain(name)
    const quiet = storeName('unsaved')
    live.push(quiet)
    const none = await captureWarnings(() => {
      wildflower.store(quiet, { state: { score: 0 }, pools: { enemies: {} } })
    })
    expect(none.filter((l) => l.includes('WF-911'))).toEqual([])
  })

  it('unregistering the store clears its pools and stops its tick', async () => {
    const name = storeName('sim')
    let ticks = 0
    const removed = []
    wildflower.store(name, {
      state: {},
      pools: { agents: { onRemove(e) { removed.push(e.id) } } },
      init() { this.pools.agents.push({ id: 1 }, { id: 2 }) },
      tick() { ticks++ },
    })
    const p = wildflower.getStore(name).pools.agents
    await frames(2)
    wildflower.unregister(name)
    expect(p.length).toBe(0)
    expect(removed.sort()).toEqual([1, 2])
    const after = ticks
    await frames(3)
    expect(ticks).toBe(after)
    expect(wildflower.getStore(name)).toBeFalsy()
  })
})

// A varargs add (push(a, b)) returned before the code that updates length's
// reactive value, so a computed over pool.length never saw it. Found through
// store pools, fixed for every pool (2026-09-24).
describeIfPools('pool.length stays reactive for every add form', () => {
  const forms = {
    'one object': (p) => { p.push({ id: 1 }); p.push({ id: 2 }) },
    'an array': (p) => { p.push([{ id: 1 }, { id: 2 }]) },
    'several arguments': (p) => { p.push({ id: 1 }, { id: 2 }) },
  }

  for (const [label, addTwo] of Object.entries(forms)) {
    it(`store pool, ${label}: a computed over length reads 2 from JavaScript`, () => {
      const name = storeName('len')
      live.push(name)
      wildflower.store(name, { state: {}, pools: { items: {} }, computed: { count() { return this.pools.items.length } } })
      const s = wildflower.getStore(name)
      expect(s.count).toBe(0)
      addTwo(s.pools.items)
      expect(s.count).toBe(2)
    })

    it(`component pool, ${label}: a computed over length reads 2 from JavaScript`, async () => {
      const comp = 'len-comp-' + (++n)
      let ctx = null
      wildflower.component(comp, {
        state: {},
        pools: { items: {} },
        computed: { count() { return this.pools.items.length } },
        init() { ctx = this },
      })
      const el = document.createElement('div')
      el.innerHTML = `<div data-component="${comp}"><div data-pool="items"><template><i></i></template></div></div>`
      document.body.appendChild(el)
      live.push(el)
      wildflower.scan(el)
      await wildflower.whenIdle()
      for (let i = 0; i < 20 && !(ctx && ctx.pools && ctx.pools.items); i++) await frames(1)
      expect(ctx.count).toBe(0)
      addTwo(ctx.pools.items)
      expect(ctx.count).toBe(2)
    })
  }
})

describeIfPluginPools('plugin pools', () => {
  it('a plugin pools block is data only, reached from its methods, and stepped by its tick', async () => {
    const name = 'poolPlugin' + (++n)
    wildflower.plugin({
      name,
      pools: { agents: {} },
      spawn(id) { this.pools.agents.push({ id, x: 0 }); return this.pools.agents.length },
      same() { return this.getPool('agents') === this.pools.agents },
      xOf(id) { return this.pools.agents.get(id).x },
      tick() { for (const a of this.pools.agents) a.x += 1 },
    })
    const p = wildflower['$' + name]
    expect(p.spawn(1)).toBe(1)
    expect(p.spawn(2)).toBe(2)
    expect(p.same()).toBe(true)
    await frames(3)
    expect(p.xOf(1)).toBeGreaterThan(0)
    expect(p.xOf(2)).toBe(p.xOf(1))
  })

  it('getPool(name, { onAdd, onRemove, onClear }) installs the hooks, bound to the plugin', () => {
    const name = 'hookPlugin' + (++n)
    const calls = []
    wildflower.plugin({
      name,
      state: { tag: 'P' },
      pools: { orbs: {} },
      run() {
        this.getPool('orbs', {
          onAdd(e) { calls.push(['add', e.id, this.tag]) },
          onRemove(e) { calls.push(['remove', e.id, this.tag]) },
          onClear() { calls.push(['clear', this.tag]) },
        })
        this.pools.orbs.add({ id: 1 })
        this.pools.orbs.remove(1)
        this.pools.orbs.clear()
      },
    })
    wildflower['$' + name].run()
    expect(calls).toEqual([['add', 1, 'P'], ['remove', 1, 'P'], ['clear', 'P']])
  })
})

describeIfPluginPools('plugin re-registration and setup errors', () => {
  it('re-registering a plugin stops the old tick and clears the old pools', async () => {
    const name = 'replug' + (++n)
    let oldTicks = 0, newTicks = 0, oldCleared = 0
    const warn = console.warn
    console.warn = () => {}
    try {
      wildflower.plugin({ name, pools: { a: { onClear() { oldCleared++ } } }, tick() { oldTicks++ } })
      await frames(3)
      wildflower.plugin({ name, pools: { a: {} }, tick() { newTicks++ } })
    } finally { console.warn = warn }
    const oldAt = oldTicks
    await frames(4)
    expect(oldTicks).toBe(oldAt)
    expect(newTicks).toBeGreaterThan(0)
    expect(oldCleared).toBe(1)
    expect([...wildflower.componentInstances.values()].filter((i) => i.name === 'plugin:' + name).length).toBe(1)
  })

  it('a plugin whose pool setup throws leaves no instance behind', () => {
    const name = 'badplug' + (++n)
    const err = console.error
    console.error = () => {}
    try {
      wildflower.plugin({ name, pools: { a: { entity: { go: () => {} } } } })
    } finally { console.error = err }
    expect([...wildflower.componentInstances.values()].filter((i) => i.name === 'plugin:' + name).length).toBe(0)
  })
})

describeIfPools('the pools block key option', () => {
  it('a store pool keys on the block key, and a duplicate is refused', async () => {
    const name = storeName('sim')
    live.push(name)
    wildflower.store(name, { state: {}, pools: { agents: { key: 'uid' } } })
    const p = wildflower.getStore(name).pools.agents
    p.push({ uid: 'a', v: 1 }, { uid: 'b', v: 2 })
    expect(p.get('a').v).toBe(1)
    expect(p.remove('b')).toBe(true)
    await captureWarnings(() => { p.push({ uid: 'a', v: 9 }) })
    expect(p.length).toBe(1)
    expect(p.get('a').v).toBe(1)
  })

  itIfPlugins('a plugin pool keys on the block key', () => {
    const name = 'keyPlugin' + (++n)
    wildflower.plugin({
      name,
      pools: { rows: { key: 'code' } },
      put(code) { this.pools.rows.push({ code }) },
      has(code) { return !!this.pools.rows.get(code) },
    })
    wildflower['$' + name].put('x1')
    expect(wildflower['$' + name].has('x1')).toBe(true)
  })

  it('a component pool without data-key uses the block key; data-key on the container wins when both are given', async () => {
    const comp = 'key-comp-' + (++n)
    let ctx = null
    wildflower.component(comp, {
      state: {},
      pools: { byBlock: { key: 'uid' }, byAttr: { key: 'uid' } },
      init() { ctx = this },
    })
    const el = document.createElement('div')
    el.innerHTML = `<div data-component="${comp}">
      <div data-pool="byBlock"><template><i data-bind="label"></i></template></div>
      <div data-pool="byAttr" data-key="sku"><template><i data-bind="label"></i></template></div>
    </div>`
    document.body.appendChild(el)
    live.push(el)
    wildflower.scan(el)
    await wildflower.whenIdle()
    for (let i = 0; i < 20 && !(ctx && ctx.pools && ctx.pools.byBlock); i++) await frames(1)
    ctx.pools.byBlock.push({ uid: 7, label: 'block' })
    expect(ctx.pools.byBlock.get(7).label).toBe('block')
    ctx.pools.byAttr.push({ sku: 'k1', uid: 1, label: 'attr' })
    expect(ctx.pools.byAttr.get('k1').label).toBe('attr')
    expect(ctx.pools.byAttr.get(1)).toBeUndefined()
  })
})

describeIfNoPools('store pools in a tier without pools', () => {
  it('the store still registers; this.pools has no handle, and a development build says why', async () => {
    const name = storeName('sim')
    live.push(name)
    const lines = await captureWarnings(() => {
      wildflower.store(name, { state: { a: 1 }, pools: { agents: {} } })
    })
    const s = wildflower.getStore(name)
    expect(s).toBeTruthy()
    expect(s.a).toBe(1)
    expect(s.pools && s.pools.agents).toBeFalsy()
    if (!isMinifiedBuild()) {
      expect(lines.some((l) => l.indexOf('pools') !== -1)).toBe(true)
    }
  })
})
