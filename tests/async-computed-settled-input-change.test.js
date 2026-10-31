/**
 * An async computed whose input changes around the moment its request
 * settles.
 *
 * The framework evaluates every computed once during setup, so an async
 * computed launches its first request without any read from the author. A
 * write to one of the computed's inputs must relaunch the request ("a change
 * to any dependency relaunches the request"), whether it lands while the
 * request runs or after the result arrived and before anything read it, and
 * the result computed from the old input must not be served.
 *
 * Shapes below: a store computed nothing observes, the same on a component,
 * a rejection in place of a resolution, an input that reaches the computed
 * through another computed (changed after the settle, changed before it, and
 * written before it without changing the other computed's value), a view
 * that mounts after the change, a computed a binding observes where the
 * write lands in a microtask between the settle and the binding's flush, and
 * a nudge from outside the graph while the request runs. Controls: a read
 * between the settle and the write, a direct input written before the
 * settle, and a nudge alone.
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
    document.querySelectorAll('.acs-host').forEach((el) => el.remove())
})

function mount(comp, inner = '') {
    const host = document.createElement('div')
    host.className = 'acs-host'
    host.innerHTML = `<div data-component="${comp}">${inner}</div>`
    document.body.appendChild(host)
    wildflower.scan()
    return host
}

describe('an async store computed nothing observes', () => {
    it('relaunches when an input changes after the request settled and before any read', async () => {
        const name = uniq('acsStore'); live.push(name)
        const launched = []
        wildflower.store(name, {
            state: { page: 1 },
            computed: { async label() { const p = this.page; launched.push(p); await null; return 'page ' + p } },
        })
        const s = wildflower.getStore(name)
        await tick()                    // the page-1 request (launched by setup) settles; nothing has read label
        s.page = 2                      // a real input change after the settle, before any read
        void s.label                    // first read
        await tick(50)
        expect(launched).toEqual([1, 2])
        expect(s.label).toBe('page 2')
    })

    it('relaunches after a rejection settled, when the input changes before any read', async () => {
        const name = uniq('acsReject'); live.push(name)
        const launched = []
        wildflower.store(name, {
            state: { page: 1 },
            computed: {
                async label() {
                    const p = this.page; launched.push(p); await null
                    if (p === 1) throw new Error('page 1 failed')
                    return 'page ' + p
                },
            },
            onError() { return true },
        })
        const s = wildflower.getStore(name)
        await tick()
        s.page = 2
        void s.label
        await tick(50)
        expect(launched).toEqual([1, 2])
        expect(s.label).toBe('page 2')
    })

    it('control: a read between the settle and the write relaunches', async () => {
        const name = uniq('acsReadFirst'); live.push(name)
        const launched = []
        wildflower.store(name, {
            state: { page: 1 },
            computed: { async label() { const p = this.page; launched.push(p); await null; return 'page ' + p } },
        })
        const s = wildflower.getStore(name)
        await tick()
        expect(s.label).toBe('page 1')
        s.page = 2
        void s.label
        await tick(50)
        expect(launched).toEqual([1, 2])
        expect(s.label).toBe('page 2')
    })

    it('control: a write before the settle relaunches', async () => {
        const name = uniq('acsWriteFirst'); live.push(name)
        const launched = []
        wildflower.store(name, {
            state: { page: 1 },
            computed: { async label() { const p = this.page; launched.push(p); await null; return 'page ' + p } },
        })
        const s = wildflower.getStore(name)
        s.page = 2                      // same task as the registration: the page-1 request has not settled
        await tick(50)
        void s.label
        await tick(50)
        expect(launched).toEqual([1, 2])
        expect(s.label).toBe('page 2')
    })
})

describe('an async store computed whose input is another computed', () => {
    it('relaunches when the input changes after the settle, before any read', async () => {
        const name = uniq('acsChainAfter'); live.push(name)
        const launched = []
        wildflower.store(name, {
            state: { page: 1 },
            computed: {
                pageKey() { return 'p' + this.page },
                async label() { const k = this.pageKey; launched.push(k); await null; return 'label ' + k },
            },
        })
        const s = wildflower.getStore(name)
        await tick()
        s.page = 2
        void s.label
        await tick(50)
        expect(launched).toEqual(['p1', 'p2'])
        expect(s.label).toBe('label p2')
    })

    it('relaunches when the input changes before the settle', async () => {
        // The input reaches the async computed through another computed, so
        // the write marks it CHECK rather than DIRTY, and the settle has to
        // read it to learn whether the other computed's value changed.
        const name = uniq('acsChainBefore'); live.push(name)
        const launched = []
        wildflower.store(name, {
            state: { page: 1 },
            computed: {
                pageKey() { return 'p' + this.page },
                async label() { const k = this.pageKey; launched.push(k); await null; return 'label ' + k },
            },
        })
        const s = wildflower.getStore(name)
        s.page = 2                      // same task as the registration: before the page-1 settle
        await tick(50)
        void s.label
        await tick(50)
        expect(launched).toEqual(['p1', 'p2'])
        expect(s.label).toBe('label p2')
    })

    it('a watch never sees the result settled for the old input', async () => {
        // The settle's continuation is queued before the write, and the
        // watch's flush after it, so the continuation meets the node at CHECK.
        const name = uniq('acsChainWatch'); live.push(name)
        const launched = [], seen = [], resolvers = []
        wildflower.store(name, {
            state: { page: 1 },
            computed: {
                pageKey() { return 'p' + this.page },
                label() {
                    const k = this.pageKey; launched.push(k)
                    return new Promise((r) => resolvers.push(() => r('label ' + k)))
                },
            },
            watch: { label(v) { seen.push(v) } },
        })
        const s = wildflower.getStore(name)
        await tick()                    // the watch is in place; p1 is in flight
        resolvers[0]()                  // p1 settles
        s.page = 2                      // then the input changes
        await tick()
        expect(launched).toEqual(['p1', 'p2'])
        resolvers[1]()
        await tick()
        expect(s.label).toBe('label p2')
        expect(seen).toEqual(['label p2'])
    })

    it('control: a write that leaves the other computed unchanged does not relaunch', async () => {
        const name = uniq('acsChainSame'); live.push(name)
        const launched = []
        wildflower.store(name, {
            state: { page: 1 },
            computed: {
                sign() { return this.page > 0 ? 'pos' : 'neg' },
                async label() { const s = this.sign; launched.push(s); await null; return 'label ' + s },
            },
        })
        const s = wildflower.getStore(name)
        s.page = 2                      // before the settle; sign stays 'pos'
        await tick(50)
        expect(s.label).toBe('label pos')
        expect(launched).toEqual(['pos'])
    })
})

describe('an async store computed whose consumer mounts later', () => {
    it('a component mounted after the input changed binds to the new result', async () => {
        // The page shape: the store registers and fetches at once, a control
        // elsewhere changes the input, and the view that shows the result
        // (a tab, a route, a data-render block) mounts afterwards.
        const name = uniq('acsLate'); live.push(name)
        const comp = uniq('acs-late-view')
        const launched = []
        wildflower.store(name, {
            state: { query: 'a' },
            computed: { async results() { const q = this.query; launched.push(q); await null; return 'results for ' + q } },
        })
        await tick()
        wildflower.getStore(name).query = 'b'
        wildflower.component(comp, {})
        const host = mount(comp, `<span class="acs-out" data-bind="$${name}.results"></span>`)
        await tick(50)
        expect(launched).toEqual(['a', 'b'])
        expect(host.querySelector('.acs-out').textContent).toBe('results for b')
    })
})

describe('an async component computed nothing observes', () => {
    it('relaunches when an input changes after the request settled and before any read', async () => {
        const comp = uniq('acs-comp')
        const launched = []
        wildflower.component(comp, {
            state: { page: 1 },
            computed: { async label() { const p = this.page; launched.push(p); await null; return 'page ' + p } },
        })
        mount(comp)
        await tick(50)
        const c = wildflower.getComponent(comp)
        c.page = 2
        void c.label
        await tick(50)
        expect(launched).toEqual([1, 2])
        expect(c.label).toBe('page 2')
    })
})

describe('an async computed a binding observes', () => {
    it('relaunches when the write lands in a microtask between the settle and the flush', async () => {
        const comp = uniq('acs-bound')
        const launched = []
        let resolve = null
        wildflower.component(comp, {
            state: { page: 1 },
            computed: {
                label() {
                    const p = this.page; launched.push(p)
                    return new Promise((r) => { resolve = () => r('page ' + p) })
                },
            },
        })
        const host = mount(comp, '<span class="acs-out" data-bind="label"></span>')
        await tick(50)
        expect(launched).toEqual([1])
        const c = wildflower.getComponent(comp)
        // The settle's continuation is queued first, then this write; the
        // binding's flush is queued by the settle, so it runs after the write.
        resolve()
        Promise.resolve().then(() => { c.page = 2 })
        await tick(50)
        expect(launched).toEqual([1, 2])
        resolve()
        await tick(50)
        expect(host.querySelector('.acs-out').textContent).toBe('page 2')
    })
})

describe('an async computed nudged while its request runs', () => {
    // A nudge is the framework re-evaluating a computed from outside the
    // graph (scheduleComputedEvaluation, as its forced re-evaluation paths
    // do). While a request runs it must not re-fire the request, and must
    // not swallow a real input change made after it either. A nudge with no
    // read after it (a computedCache clear) is pinned in entity-handle.test.js.
    const nudge = (comp) => wildflower.getComponentsByType(comp)[0].stateManager.scheduleComputedEvaluation('label')

    it('relaunches for an input written after the nudge, before the settle', async () => {
        const comp = uniq('acs-nudge')
        const launched = []
        let resolve = null
        wildflower.component(comp, {
            state: { page: 1 },
            computed: {
                label() {
                    const p = this.page; launched.push(p)
                    return new Promise((r) => { resolve = () => r('page ' + p) })
                },
            },
        })
        mount(comp)
        await tick(50)
        expect(launched).toEqual([1])          // page 1 is in flight
        nudge(comp)
        expect(launched).toEqual([1])          // the nudge does not re-fire the request
        const c = wildflower.getComponent(comp)
        c.page = 2                             // a real input change while page 1 runs
        resolve()                              // page 1 settles
        await tick(50)
        void c.label
        await tick(50)
        expect(launched).toEqual([1, 2])
        resolve()
        await tick(50)
        expect(c.label).toBe('page 2')
    })

    it('control: a nudge alone holds the value and does not re-fire the request', async () => {
        const comp = uniq('acs-nudge-only')
        const launched = []
        let resolve = null
        wildflower.component(comp, {
            state: { page: 1 },
            computed: {
                label() {
                    const p = this.page; launched.push(p)
                    return new Promise((r) => { resolve = () => r('page ' + p) })
                },
            },
        })
        mount(comp)
        await tick(50)
        expect(nudge(comp)).toBeUndefined()    // first load still in flight
        const c = wildflower.getComponent(comp)
        expect(c.label).toBeUndefined()
        resolve()
        await tick(50)
        expect(c.label).toBe('page 1')
        expect(launched).toEqual([1])
    })
})
