/**
 * A subscription to a computed that reads a store which registers after the
 * subscription was made.
 *
 * Before the store exists, the computed reads nothing reactive (the
 * this.stores getter returns null), so its graph node has no sources and
 * nothing can wake it. A direct read re-runs such a computed every time
 * (zero-source computeds are never trusted from cache), and once the store
 * exists that re-run reads it and links the edge. A subscription, a watch:
 * or a binding follows the computed through its change notifier or render
 * effect instead, and must hear the store arriving and changing too.
 *
 * Shapes below: a store's subscribe() and own watch: {} on a computed that
 * reads this.stores.<late>, a store's onStoreUpdate for a path on the late
 * store, a component's $store binding on such a computed, and a component's
 * watch: {} on a computed that reads the late store (through this.stores,
 * also with its own state, and through external()). Then a store whose
 * subscribed store is unregistered and registered again, and a store whose
 * registration fails after recording its wait. Controls: a subscription made
 * after the store exists, and a component binding on the computed.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework } from './helpers/load-framework.js'

let n = 0
const live = []
const uniq = (base) => base + (++n)
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => { await loadFramework() })
afterEach(() => {
    while (live.length) { try { wildflower.unregister(live.pop()) } catch (e) { /* already gone */ } }
    document.querySelectorAll('.cls-host').forEach((el) => el.remove())
})

function mount(comp, inner = '') {
    const host = document.createElement('div')
    host.className = 'cls-host'
    host.innerHTML = `<div data-component="${comp}">${inner}</div>`
    document.body.appendChild(host)
    wildflower.scan()
    return host
}

describe('a store computed that reads a store registered later', () => {
    it("subscribe() hears the late store's change", async () => {
        const src = uniq('clsSource'), rdr = uniq('clsReader'); live.push(rdr, src)
        wildflower.store(rdr, {
            state: {},
            subscribe: { [src]: [] },
            computed: { y() { const s = this.stores[src]; return s ? s.x * 10 : -1 } },
        })
        const B = wildflower.getStore(rdr), heard = []
        B.subscribe('y', (v) => heard.push(v))      // before the source exists
        await tick()
        wildflower.store(src, { state: { x: 1 } })
        await tick()
        wildflower.getStore(src).x = 2
        await tick()
        expect(heard.at(-1)).toBe(20)
        expect(B.y).toBe(20)
    })

    it('a direct read follows the late store (pins today\'s pull semantics)', async () => {
        const src = uniq('clsPullSource'), rdr = uniq('clsPullReader'); live.push(rdr, src)
        wildflower.store(rdr, {
            state: {},
            subscribe: { [src]: [] },
            computed: { y() { const s = this.stores[src]; return s ? s.x * 10 : -1 } },
        })
        const B = wildflower.getStore(rdr)
        expect(B.y).toBe(-1)
        wildflower.store(src, { state: { x: 1 } })
        expect(B.y).toBe(10)
        wildflower.getStore(src).x = 2
        expect(B.y).toBe(20)
    })

    it("the store's own watch: {} hears the late store's change", async () => {
        const src = uniq('clsWatchSource'), rdr = uniq('clsWatchReader'); live.push(rdr, src)
        const heard = []
        wildflower.store(rdr, {
            state: {},
            subscribe: { [src]: [] },
            computed: { y() { const s = this.stores[src]; return s ? s.x * 10 : -1 } },
            watch: { y(nv) { heard.push(nv) } },
        })
        await tick()
        wildflower.store(src, { state: { x: 1 } })
        await tick()
        wildflower.getStore(src).x = 2
        await tick()
        expect(heard.at(-1)).toBe(20)
    })

    it("onStoreUpdate hears a subscribed path on the late store", async () => {
        const src = uniq('clsPathSource'), rdr = uniq('clsPathReader'); live.push(rdr, src)
        const calls = []
        wildflower.store(rdr, {
            state: {},
            subscribe: { [src]: ['x'] },
            onStoreUpdate(store, path, nv) { calls.push([store, path, nv]) },
        })
        await tick()
        wildflower.store(src, { state: { x: 1 } })
        await tick()
        wildflower.getStore(src).x = 2
        await tick()
        expect(calls).toEqual([[src, 'x', 2]])
    })

    it("a component's $store binding on the computed follows the late store's change", async () => {
        const src = uniq('clsDollarSource'), rdr = uniq('clsDollarReader'), comp = uniq('cls-dollar')
        live.push(rdr, src)
        wildflower.store(rdr, {
            state: {},
            subscribe: { [src]: [] },
            computed: { y() { const s = this.stores[src]; return s ? s.x * 10 : -1 } },
        })
        wildflower.component(comp, {})
        const host = mount(comp, `<span class="cls-out" data-bind="$${rdr}.y"></span>`)
        await tick(50)
        expect(host.querySelector('.cls-out').textContent).toBe('-1')
        wildflower.store(src, { state: { x: 1 } })
        await tick(50)
        wildflower.getStore(src).x = 2
        await tick(50)
        expect(host.querySelector('.cls-out').textContent).toBe('20')
    })

    it('control: subscribe() made after the source registered hears its change', async () => {
        const src = uniq('clsCtlSource'), rdr = uniq('clsCtlReader'); live.push(rdr, src)
        wildflower.store(rdr, {
            state: {},
            subscribe: { [src]: [] },
            computed: { y() { const s = this.stores[src]; return s ? s.x * 10 : -1 } },
        })
        wildflower.store(src, { state: { x: 1 } })
        const B = wildflower.getStore(rdr), heard = []
        await tick()
        B.subscribe('y', (v) => heard.push(v))
        await tick()
        wildflower.getStore(src).x = 2
        await tick()
        expect(heard).toEqual([20])
    })
})

describe('a component computed that reads a store registered later', () => {
    it("watch: {} hears the late store's change", async () => {
        const src = uniq('clsCompSource'), comp = uniq('cls-comp-watch'), heard = []
        live.push(src)
        wildflower.component(comp, {
            subscribe: { [src]: [] },
            computed: { y() { const s = this.stores[src]; return s ? s.x * 10 : -1 } },
            watch: { y(nv) { heard.push(nv) } },
        })
        mount(comp)
        await tick(50)
        wildflower.store(src, { state: { x: 1 } })
        await tick(50)
        wildflower.getStore(src).x = 2
        await tick(50)
        expect(heard.at(-1)).toBe(20)
    })

    it("watch: {} still hears the component's own state after the late store arrived", async () => {
        // The computed also reads own state, so it has a source and is not
        // the zero-source case: this isolates the late-store wake itself.
        const src = uniq('clsOwnSource'), comp = uniq('cls-comp-own'), heard = []
        live.push(src)
        wildflower.component(comp, {
            state: { k: 0 },
            subscribe: { [src]: [] },
            computed: { y() { const s = this.stores[src]; return (s ? s.x * 10 : -1) + this.k } },
            watch: { y(nv) { heard.push(nv) } },
        })
        mount(comp)
        await tick(50)
        wildflower.store(src, { state: { x: 1 } })
        await tick(50)
        wildflower.getComponent(comp).k = 1
        await tick(50)
        expect(heard.at(-1)).toBe(11)
    })

    it("watch: {} on a computed that reads the late store through external() hears its change", async () => {
        // No subscribe: here. The miss inside the computed registers a
        // pending dependency named after the computed (dev builds, where the
        // evaluation records which computed is running) or a pending binding
        // (production), and the store's arrival resolves it.
        const src = uniq('clsExtSource'), comp = uniq('cls-comp-ext'), heard = []
        live.push(src)
        wildflower.component(comp, {
            computed: { y() { const x = this.external(src, 'x'); return x == null ? -1 : x * 10 } },
            watch: { y(nv) { heard.push(nv) } },
        })
        mount(comp)
        await tick(50)
        wildflower.store(src, { state: { x: 1 } })
        await tick(50)
        wildflower.getStore(src).x = 2
        await tick(50)
        expect(heard.at(-1)).toBe(20)
    })

    it("control: a binding on the computed follows the late store's change", async () => {
        const src = uniq('clsBindSource'), comp = uniq('cls-comp-bind')
        live.push(src)
        wildflower.component(comp, {
            subscribe: { [src]: [] },
            computed: { y() { const s = this.stores[src]; return s ? s.x * 10 : -1 } },
        })
        const host = mount(comp, '<span class="cls-out" data-bind="y"></span>')
        await tick(50)
        wildflower.store(src, { state: { x: 1 } })
        await tick(50)
        wildflower.getStore(src).x = 2
        await tick(50)
        expect(host.querySelector('.cls-out').textContent).toBe('20')
    })
})

describe('a store that subscribes to a store which is unregistered and registered again', () => {
    // The computed reads the store through wildflower.getStore(): a store's
    // this.stores.<name> keeps the instance it first returned in production
    // builds (see store-subscribe-reregistered-source.test.js).
    it('subscribe() on its computed follows the store registered again', async () => {
        const src = uniq('clsReSource'), rdr = uniq('clsReReader'); live.push(rdr, src)
        wildflower.store(src, { state: { x: 1 } })
        wildflower.store(rdr, {
            state: {},
            subscribe: { [src]: [] },
            computed: { y() { const s = wildflower.getStore(src); return s ? s.x * 10 : -1 } },
        })
        const B = wildflower.getStore(rdr), heard = []
        B.subscribe('y', (v) => heard.push(v))
        await tick()
        wildflower.getStore(src).x = 2
        await tick()
        expect(heard).toEqual([20])
        wildflower.unregister(src)
        await tick()
        wildflower.store(src, { state: { x: 3 } })
        await tick()
        wildflower.getStore(src).x = 4
        await tick()
        expect(heard.at(-1)).toBe(40)
        expect(B.y).toBe(40)
    })

    it('onStoreUpdate hears a subscribed path on the store registered again', async () => {
        const src = uniq('clsRePathSource'), rdr = uniq('clsRePathReader'); live.push(rdr, src)
        const calls = []
        wildflower.store(src, { state: { x: 1 } })
        wildflower.store(rdr, {
            state: {},
            subscribe: { [src]: ['x'] },
            onStoreUpdate(store, path, nv) { calls.push([path, nv]) },
        })
        await tick()
        wildflower.unregister(src)
        await tick()
        wildflower.store(src, { state: { x: 3 } })
        await tick()
        wildflower.getStore(src).x = 4
        await tick()
        expect(calls).toEqual([['x', 4]])
    })
})

describe('a store whose registration fails', () => {
    it('leaves no wait behind for a store its subscribe: names that is not registered yet', async () => {
        const late = uniq('clsFailLate'), other = uniq('clsFailOther'), bad = uniq('clsFailReader')
        live.push(other, late)
        wildflower.store(other, { state: { a: 1 } })
        // A path that is not a string throws part way through the setup,
        // after the wait for `late` was recorded.
        try {
            wildflower.store(bad, { state: {}, subscribe: { [late]: [], [other]: [42] } })
        } catch (e) { /* the create error may surface as a throw */ }
        expect(wildflower.getStore(bad)).toBeFalsy()
        expect(wildflower.storeManager._pendingStoreDependencies.has(late)).toBe(false)
    })
})
