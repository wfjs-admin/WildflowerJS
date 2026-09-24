/**
 * Platform objects in entity state: Date, Map, Set, RegExp and class
 * instances.
 *
 * The rule: arrays, plain objects and ordinary class instances (type tag
 * [object Object]) are deeply reactive. Anything reporting its own tag (Date,
 * Map, Set, RegExp, ...) is held by reference and reactive by identity:
 * reassign to notify. Declared state is copied per instance, keeping types.
 *
 * Two paths reach state and both used to corrupt these values, differently.
 * The initial `state` literal went through EntityHandle._clone, which rebuilt
 * every object as {} and copied enumerable own properties, so a Date (which
 * has none) became an empty object. A value assigned after init went through
 * the reactive tree, which proxied it: the prototype survived, so
 * `instanceof Date` was true, but the internal slots were not on the proxy
 * and every method threw "called on incompatible receiver". Nothing warned
 * in either case, and the documented store examples used both patterns.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

const wait = (ms = 60) => new Promise(r => setTimeout(r, ms))
let seq = 0
const uname = (p) => `${p}-${++seq}-${Math.random().toString(36).slice(2, 7)}`

class Money {
  constructor(amount) { this.amount = amount }
  formatted() { return `$${this.amount.toFixed(2)}` }
}

describe('platform objects in entity state', () => {
  let container, wf
  beforeAll(async () => { await loadFramework() })
  beforeEach(() => {
    wf = window.wildflower
    resetFramework()
    container = document.createElement('div')
    container.style.position = 'absolute'; container.style.left = '-9999px'
    document.body.appendChild(container)
  })
  afterEach(() => { if (container?.parentNode) container.parentNode.removeChild(container) })

  // ---- stores: the initial state literal --------------------------------

  it('a store keeps a Date from its initial state usable', async () => {
    const name = uname('store-date')
    wf.store(name, { state: { when: new Date('2020-01-02T03:04:05Z') } })
    await wait()
    const s = wf.getStore(name)
    expect(s.when).toBeInstanceOf(Date)
    expect(s.when.getUTCFullYear()).toBe(2020)
    expect(s.when.toISOString()).toBe('2020-01-02T03:04:05.000Z')
  })

  it('a store keeps a Map, a Set and a RegExp from its initial state usable', async () => {
    const name = uname('store-kinds')
    wf.store(name, {
      state: {
        byId: new Map([[1, 'one'], [2, 'two']]),
        tags: new Set(['a', 'b']),
        re: /ab+c/gi
      }
    })
    await wait()
    const s = wf.getStore(name)
    expect(s.byId).toBeInstanceOf(Map)
    expect(s.byId.get(1)).toBe('one')
    expect(s.byId.size).toBe(2)
    expect(s.tags).toBeInstanceOf(Set)
    expect(s.tags.has('a')).toBe(true)
    expect(s.tags.size).toBe(2)
    expect(s.re).toBeInstanceOf(RegExp)
    expect(s.re.source).toBe('ab+c')
    expect(s.re.test('abbc')).toBe(true)
  })

  it('a store keeps a class instance, with its prototype and methods', async () => {
    const name = uname('store-class')
    wf.store(name, { state: { price: new Money(12.5) } })
    await wait()
    const s = wf.getStore(name)
    expect(s.price).toBeInstanceOf(Money)
    expect(typeof s.price.formatted).toBe('function')
    expect(s.price.formatted()).toBe('$12.50')
  })

  // ---- stores: assigned after init --------------------------------------

  it('a Date assigned in a store method stays usable', async () => {
    const name = uname('store-assign')
    wf.store(name, {
      state: { when: null },
      stamp() { this.when = new Date('2021-06-07T08:09:10Z') }
    })
    await wait()
    const s = wf.getStore(name)
    s.stamp()
    await wait()
    expect(s.when).toBeInstanceOf(Date)
    expect(s.when.getUTCFullYear()).toBe(2021)
    expect(s.when.toISOString()).toBe('2021-06-07T08:09:10.000Z')
    expect(() => s.when.toLocaleDateString()).not.toThrow()
  })

  it('a Map and a Set assigned in a store method stay usable', async () => {
    const name = uname('store-assign-kinds')
    wf.store(name, {
      state: { byId: null, tags: null },
      fill() { this.byId = new Map([[7, 'seven']]); this.tags = new Set(['x']) }
    })
    await wait()
    const s = wf.getStore(name)
    s.fill()
    await wait()
    expect(s.byId.get(7)).toBe('seven')
    expect(s.byId.size).toBe(1)
    expect(s.tags.has('x')).toBe(true)
    expect(s.tags.size).toBe(1)
  })

  it('a Date nested inside a pushed array item stays usable', async () => {
    const name = uname('store-nested')
    wf.store(name, {
      state: { events: [] },
      track() { this.events.push({ at: new Date('2022-02-02T00:00:00Z'), what: 'x' }) }
    })
    await wait()
    const s = wf.getStore(name)
    s.track()
    await wait()
    expect(s.events[0].at).toBeInstanceOf(Date)
    expect(s.events[0].at.getUTCFullYear()).toBe(2022)
    expect(s.events[0].what).toBe('x')
  })

  // ---- the documented examples, as regressions --------------------------

  it('the documented analytics store computes a session duration rather than undefined', async () => {
    const name = uname('analytics')
    wf.store(name, {
      state: { sessionId: null, startTime: null },
      computed: {
        sessionDuration() { return Math.round((new Date() - this.startTime) / 1000) }
      },
      init() {
        this.sessionId = 'session_' + Date.now()
        this.startTime = new Date(Date.now() - 5000)
      }
    })
    await wait()
    const s = wf.getStore(name)
    expect(typeof s.sessionDuration).toBe('number')
    expect(Number.isNaN(s.sessionDuration)).toBe(false)
    expect(s.sessionDuration).toBeGreaterThanOrEqual(4)
  })

  it('the documented lastSync pattern formats without throwing', async () => {
    const name = uname('sync')
    wf.store(name, { state: { lastSync: null }, doSync() { this.lastSync = new Date() } })
    await wait()
    const s = wf.getStore(name)
    s.doSync()
    await wait()
    expect(() => s.lastSync.toLocaleDateString()).not.toThrow()
    expect(typeof s.lastSync.toLocaleDateString()).toBe('string')
  })

  // ---- components -------------------------------------------------------

  it('a component keeps a Date in both paths, and a binding renders it', async () => {
    const name = uname('c-date')
    let fromInit = null
    wf.component(name, {
      state: { when: new Date('2020-01-02T00:00:00Z'), later: null },
      computed: { year() { return this.when.getUTCFullYear() } },
      init() {
        fromInit = { isDate: this.when instanceof Date, year: this.when.getUTCFullYear() }
        this.later = new Date('2023-04-05T00:00:00Z')
      }
    })
    container.innerHTML = `<div data-component="${name}"><span id="y" data-bind="year"></span></div>`
    wf.scan()
    await wait(120)
    expect(fromInit).toEqual({ isDate: true, year: 2020 })
    expect(container.querySelector('#y').textContent).toBe('2020')
    const inst = wf.componentInstances.get(container.querySelector(`[data-component="${name}"]`).dataset.componentId)
    expect(inst.context.later).toBeInstanceOf(Date)
    expect(inst.context.later.getUTCFullYear()).toBe(2023)
  })

  // ---- reactivity: by identity ------------------------------------------

  it('reassigning a platform object re-runs a computed that reads it', async () => {
    const name = uname('identity')
    let evals = 0
    wf.store(name, {
      state: { when: new Date('2020-01-01T00:00:00Z') },
      computed: { year() { evals++; return this.when.getUTCFullYear() } },
      bump() { this.when = new Date('2031-01-01T00:00:00Z') }
    })
    await wait()
    const s = wf.getStore(name)
    expect(s.year).toBe(2020)
    const before = evals
    s.bump()
    await wait()
    expect(s.year).toBe(2031)
    expect(evals).toBeGreaterThan(before)
  })

  it('a subscriber fires when a platform object is reassigned', async () => {
    const name = uname('subscribe')
    wf.store(name, { state: { when: new Date('2020-01-01T00:00:00Z') }, bump(d) { this.when = d } })
    await wait()
    const s = wf.getStore(name)
    const seen = []
    s.subscribe('when', (nv) => seen.push(nv))
    s.bump(new Date('2032-01-01T00:00:00Z'))
    await wait()
    expect(seen.length).toBe(1)
    expect(seen[0]).toBeInstanceOf(Date)
    expect(seen[0].getUTCFullYear()).toBe(2032)
  })

  // ---- the guard: plain objects and arrays are untouched ----------------

  it('plain objects and arrays in state are still deeply reactive', async () => {
    const name = uname('plain')
    let evals = 0
    wf.store(name, {
      state: { params: { query: '', page: 1 }, rows: [{ id: 1, n: 1 }] },
      computed: { summary() { evals++; return `${this.params.query}:${this.rows.length}` } },
      typeIt(q) { this.params.query = q },
      addRow() { this.rows.push({ id: 2, n: 2 }) }
    })
    await wait()
    const s = wf.getStore(name)
    expect(s.summary).toBe(':1')
    const before = evals
    s.typeIt('abc')
    await wait()
    expect(s.summary).toBe('abc:1')
    s.addRow()
    await wait()
    expect(s.summary).toBe('abc:2')
    expect(evals).toBeGreaterThan(before)
    // Nested writes still notify, which is the deep-reactivity contract.
    const seen = []
    s.subscribe('params', (nv, ov, p) => seen.push(p))
    s.params.page = 2
    await wait()
    expect(seen).toContain('params.page')
  })

  // ---- class instances are modelled like plain objects -------------------
  // No internal slots, so they proxy with their prototype intact and in-place
  // mutation notifies, as in 1.5.2.

  class Counter {
    constructor() { this.count = 0 }
    label() { return `n=${this.count}` }
  }
  class Todo {
    constructor(id, title) { this.id = id; this.title = title; this.done = false }
  }

  const instOf = (el) => wf.getComponentInstance(el.getAttribute('data-component-id'))

  it('a class instance in declared state re-renders when mutated in place', async () => {
    const name = uname('c-class-inplace')
    wf.component(name, {
      state: { model: new Counter() },
      computed: { shown() { return this.model.label() } },
      bump() { this.model.count++ }
    })
    container.innerHTML = `<div data-component="${name}">
      <span class="n" data-bind="model.count"></span>
      <span class="l" data-bind="shown"></span>
      <button data-action="bump">+</button></div>`
    wf.scan()
    await wait(120)
    expect(container.querySelector('.n').textContent).toBe('0')
    container.querySelector('button').click()
    await wait(120)
    expect(container.querySelector('.n').textContent, 'nested binding stayed stale').toBe('1')
    expect(container.querySelector('.l').textContent, 'computed stayed stale').toBe('n=1')
  })

  it('a class instance assigned after init re-runs a computed when mutated in place', async () => {
    const name = uname('store-class-assign')
    wf.store(name, {
      state: { model: null },
      computed: { count() { return this.model ? this.model.count : -1 } },
      make() { this.model = new Counter() },
      bump() { this.model.count++ }
    })
    await wait()
    const s = wf.getStore(name)
    s.make()
    await wait()
    expect(s.count).toBe(0)
    s.bump()
    await wait()
    expect(s.count).toBe(1)
    expect(s.model).toBeInstanceOf(Counter)
    expect(s.model.label()).toBe('n=1')
  })

  it('a data-list over class instances re-renders a row mutated in place', async () => {
    const name = uname('c-class-list')
    wf.component(name, {
      state: { items: [new Todo(1, 'a'), new Todo(2, 'b')] },
      computed: { doneCount() { return this.items.filter(t => t.done).length } },
      toggleFirst() { this.items[0].done = !this.items[0].done }
    })
    container.innerHTML = `<div data-component="${name}">
      <ul data-list="items" data-key="id"><template><li><span class="d" data-bind="done"></span></li></template></ul>
      <span class="c" data-bind="doneCount"></span>
      <button data-action="toggleFirst">t</button></div>`
    wf.scan()
    await wait(120)
    expect(container.querySelector('li .d').textContent).toBe('false')
    container.querySelector('button').click()
    await wait(120)
    expect(container.querySelector('li .d').textContent, 'row stayed stale').toBe('true')
    expect(container.querySelector('.c').textContent, 'computed stayed stale').toBe('1')
  })

  // ---- per-instance copies of declared state -----------------------------
  // The `state` literal is evaluated once, so each instance needs its own
  // copy, types intact, or one instance's mutation leaks into the others.

  it('two instances of a component each get their own class instance, Date, Map and Set', async () => {
    const name = uname('c-isolation')
    wf.component(name, {
      state: {
        model: new Counter(),
        when: new Date('2020-01-01T00:00:00Z'),
        byId: new Map([[1, 'one']]),
        tags: new Set(['a']),
        out: ''
      },
      mutate() {
        this.model.count++
        this.when.setUTCFullYear(1999)
        this.byId.set(2, 'two')
        this.tags.add('x')
      },
      report() {
        this.out = JSON.stringify({
          count: this.model.count,
          year: this.when.getUTCFullYear(),
          byId: this.byId.size,
          tags: [...this.tags]
        })
      }
    })
    container.innerHTML = `
      <div data-component="${name}" id="iso-a"><button class="m" data-action="mutate">m</button><button class="r" data-action="report">r</button><span class="o" data-bind="out"></span></div>
      <div data-component="${name}" id="iso-b"><button class="m" data-action="mutate">m</button><button class="r" data-action="report">r</button><span class="o" data-bind="out"></span></div>`
    wf.scan()
    await wait(120)
    const a = container.querySelector('#iso-a'), b = container.querySelector('#iso-b')
    a.querySelector('.m').click()
    await wait(60)
    a.querySelector('.r').click(); b.querySelector('.r').click()
    await wait(120)
    expect(JSON.parse(a.querySelector('.o').textContent)).toEqual({ count: 1, year: 1999, byId: 2, tags: ['a', 'x'] })
    expect(JSON.parse(b.querySelector('.o').textContent), 'instance A leaked into instance B')
      .toEqual({ count: 0, year: 2020, byId: 1, tags: ['a'] })
    // The copies keep their type and prototype.
    const ctx = instOf(b).context
    expect(ctx.model).toBeInstanceOf(Counter)
    expect(ctx.model.label()).toBe('n=0')
    expect(ctx.when).toBeInstanceOf(Date)
    expect(ctx.byId).toBeInstanceOf(Map)
    expect(ctx.tags).toBeInstanceOf(Set)
  })

  // ---- an own __proto__ key ------------------------------------------------
  // JSON.parse makes "__proto__" an ordinary own key. Copying it with
  // `out[k] = v` calls the prototype setter instead, so the key vanished and
  // its contents became inherited: `{"__proto__": {"isAdmin": true}}` read
  // `isAdmin` as true after the copy, though own-key validation never saw it.

  it('an own __proto__ key in declared state stays a key and grants nothing', async () => {
    const name = uname('store-proto-key')
    wf.store(name, { state: { user: JSON.parse('{"__proto__": {"isAdmin": true}, "name": "x"}') } })
    await wait()
    const s = wf.getStore(name)
    expect(s.user.isAdmin, 'the hidden field became readable').toBeUndefined()
    expect(Object.keys(s.user).sort()).toEqual(['__proto__', 'name'])
  })

  // ---- the documented edge ------------------------------------------------

  it('a class that reports its own Symbol.toStringTag is held by reference and stays usable', async () => {
    class Tagged {
      constructor() { this.v = 3 }
      get [Symbol.toStringTag]() { return 'Tagged' }
      twice() { return this.v * 2 }
    }
    const name = uname('store-tagged')
    const original = new Tagged()
    wf.store(name, { state: { t: original } })
    await wait()
    const s = wf.getStore(name)
    expect(s.t).toBe(original)
    expect(s.t.twice()).toBe(6)
  })
})
