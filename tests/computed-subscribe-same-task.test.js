/**
 * A subscription to a computed hears a change made in the same task as the
 * subscription.
 *
 * A computed's change notifier is created in a microtask after the first
 * subscription to it, and its first run records the value later runs compare
 * against. A change made between the subscription and that microtask became
 * the recorded value, so it was never reported; a later change was. Every
 * route below rides that one notifier: store.subscribe(), a component's own
 * watch: {}, a component's subscribe() in init(), a 'store:' watch key,
 * subscribe: { store: ['computed'] } with onStoreUpdate(), a store's own
 * watch: {}, and a plugin's subscribe() and watch: {}.
 *
 * Controls: a change in a later task is heard, a change made before the
 * subscription is not, a change reverted in the same task is not, and an
 * async computed is heard when it settles.
 *
 * The last block follows a computed on one store that reads another.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework, hasFeature } from './helpers/load-framework.js'

let n = 0
const live = []
const uniq = (base) => base + (++n)
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => { await loadFramework() })
afterEach(() => {
    while (live.length) { try { wildflower.unregister(live.pop()) } catch (e) { /* already gone */ } }
    document.querySelectorAll('.cst-host').forEach((el) => el.remove())
})

function quizStore() {
    const name = uniq('cstQuiz'); live.push(name)
    wildflower.store(name, {
        state: { choice: null },
        computed: { answered() { return this.choice !== null } },
    })
    return name
}

// Mounts synchronously: wildflower.scan() initializes the component before
// it returns, so the caller's next line runs in the same task as the mount.
function mount(comp) {
    const host = document.createElement('div')
    host.className = 'cst-host'
    host.innerHTML = `<div data-component="${comp}"></div>`
    document.body.appendChild(host)
    wildflower.scan()
    return host
}

describe('store.subscribe() on a computed', () => {
    it('hears a change made in the same task as the subscription', async () => {
        const q = wildflower.getStore(quizStore()), heard = []
        q.subscribe('answered', (v) => heard.push(v))
        q.choice = 270
        await tick()
        expect(heard).toEqual([true])
        q.choice = null
        await tick()
        expect(heard).toEqual([true, false])
    })

    it('passes the value before the change as the old value, on both name forms', async () => {
        const q = wildflower.getStore(quizStore()), bare = [], prefixed = []
        q.subscribe('answered', (nv, ov) => bare.push([nv, ov]))
        q.subscribe('computed:answered', (nv, ov) => prefixed.push([nv, ov]))
        q.choice = 1
        await tick()
        expect(bare).toEqual([[true, false]])
        expect(prefixed).toEqual([[true, false]])
    })

    it('with immediate: the current value, then the change', async () => {
        const q = wildflower.getStore(quizStore()), heard = []
        q.subscribe('answered', (v) => heard.push(v), { immediate: true })
        q.choice = 1
        await tick()
        expect(heard).toEqual([false, true])
    })

    it('with once: the change, and nothing after it', async () => {
        const q = wildflower.getStore(quizStore()), heard = []
        q.subscribe('answered', (v) => heard.push(v), { once: true })
        q.choice = 1
        await tick()
        q.choice = null
        await tick()
        expect(heard).toEqual([true])
    })

    it('a computed with no sources is not reported when only a read happened in the same task', async () => {
        const name = uniq('cstFresh'); live.push(name)
        wildflower.store(name, {
            state: { _a: 1 },
            computed: { cfg() { return { a: this._a } } },
        })
        const s = wildflower.getStore(name), heard = []
        s.subscribe('cfg', (v) => heard.push(v))
        void s.cfg
        await tick()
        expect(heard).toEqual([])
    })

    it("a subscription to every path ('') hears the computed's change", async () => {
        const q = wildflower.getStore(quizStore()), paths = []
        q.subscribe('', (nv, ov, path) => paths.push(path))
        q.choice = 1
        await tick()
        expect(paths).toContain('computed:answered')
    })

    it('an unsubscribe before the notifier exists stops only that subscriber', async () => {
        const q = wildflower.getStore(quizStore()), kept = [], dropped = []
        q.subscribe('answered', (v) => kept.push(v))
        const off = q.subscribe('answered', (v) => dropped.push(v))
        off()
        q.choice = 1
        await tick()
        expect(kept).toEqual([true])
        expect(dropped).toEqual([])
    })

    it('a computed that throws until the change: undefined, then its value', async () => {
        const name = uniq('cstThrow'); live.push(name)
        wildflower.store(name, {
            state: { n: 0 },
            computed: { inverse() { if (this.n === 0) throw new Error('no inverse of 0'); return 1 / this.n } },
            onError() { return true },
        })
        const s = wildflower.getStore(name), heard = []
        s.subscribe('inverse', (nv, ov) => heard.push([nv, ov]))
        s.n = 4
        await tick()
        expect(heard).toEqual([[0.25, undefined]])
    })

    it('control: a change in a later task is heard', async () => {
        const q = wildflower.getStore(quizStore()), heard = []
        q.subscribe('answered', (v) => heard.push(v))
        await tick()
        q.choice = 1
        await tick()
        expect(heard).toEqual([true])
    })

    it('control: a change made before the subscription is not heard', async () => {
        const q = wildflower.getStore(quizStore()), heard = []
        q.choice = 1
        q.subscribe('answered', (v) => heard.push(v))
        await tick()
        expect(heard).toEqual([])
        q.choice = null
        await tick()
        expect(heard).toEqual([false])
    })

    it('control: a change reverted in the same task is not heard', async () => {
        const q = wildflower.getStore(quizStore()), heard = []
        q.subscribe('answered', (v) => heard.push(v))
        q.choice = 1
        q.choice = null
        await tick()
        expect(heard).toEqual([])
        q.choice = 2
        await tick()
        expect(heard).toEqual([true])
    })

    it('control: an async computed changed in the same task is heard when it settles', async () => {
        const name = uniq('cstAsync'); live.push(name)
        wildflower.store(name, {
            state: { page: 1 },
            computed: { async label() { const page = this.page; await null; return 'page ' + page } },
        })
        const s = wildflower.getStore(name), heard = []
        await tick()
        expect(s.label).toBe('page 1')
        s.subscribe('label', (v) => heard.push(v))
        s.page = 2
        await tick(50)
        expect(heard).toEqual(['page 2'])
    })
})

describe("a component's watch: {} on its own computed", () => {
    it('hears a change made in the same task as the mount', async () => {
        const comp = uniq('cst-watch'), heard = []
        wildflower.component(comp, {
            state: { a: 1 },
            computed: { dbl() { return this.a * 2 } },
            watch: { dbl(nv, ov) { heard.push([nv, ov]) } },
        })
        mount(comp)
        wildflower.getComponent(comp).a = 5
        await tick(50)
        expect(heard).toEqual([[10, 2]])
    })

    it('control: a change in a later task is heard', async () => {
        const comp = uniq('cst-watch-later'), heard = []
        wildflower.component(comp, {
            state: { a: 1 },
            computed: { dbl() { return this.a * 2 } },
            watch: { dbl(nv, ov) { heard.push([nv, ov]) } },
        })
        mount(comp)
        await tick(100)
        wildflower.getComponent(comp).a = 5
        await tick()
        expect(heard).toEqual([[10, 2]])
    })
})

describe("a component's subscribe() in init()", () => {
    it('hears a change init() makes right after subscribing', async () => {
        const comp = uniq('cst-init'), heard = []
        wildflower.component(comp, {
            state: { a: 1 },
            computed: { dbl() { return this.a * 2 } },
            init() {
                this.subscribe('dbl', (v) => heard.push(v))
                this.a = 5
            },
        })
        mount(comp)
        await tick(100)
        expect(heard).toEqual([10])
    })
})

describe('a component following a store computed', () => {
    it("a 'store:name.computed' watch hears a store change made in the same task as the mount", async () => {
        const q = quizStore(), comp = uniq('cst-storewatch'), heard = []
        wildflower.component(comp, {
            subscribe: { [q]: [] },
            watch: { ['store:' + q + '.answered'](v) { heard.push(v) } },
        })
        mount(comp)
        wildflower.getStore(q).choice = 1
        await tick(50)
        expect(heard).toEqual([true])
    })

    it("subscribe: { name: ['computed'] } calls onStoreUpdate for a change made in the same task as the mount", async () => {
        const q = quizStore(), comp = uniq('cst-decl'), calls = []
        wildflower.component(comp, {
            subscribe: { [q]: ['answered'] },
            onStoreUpdate(store, path, nv, ov) { if (store === q) calls.push([path, nv, ov]) },
        })
        mount(comp)
        wildflower.getStore(q).choice = 1
        await tick(50)
        expect(calls).toEqual([['answered', true, false]])
    })

    it("control: subscribe: { name: ['computed'] } hears a change in a later task", async () => {
        const q = quizStore(), comp = uniq('cst-decl-later'), calls = []
        wildflower.component(comp, {
            subscribe: { [q]: ['answered'] },
            onStoreUpdate(store, path, nv, ov) { if (store === q) calls.push([path, nv, ov]) },
        })
        mount(comp)
        await tick(100)
        wildflower.getStore(q).choice = 1
        await tick()
        expect(calls).toEqual([['answered', true, false]])
    })
})

describe("a store's watch: {} on its own computed", () => {
    it('hears a change made in the same task as the registration', async () => {
        const name = uniq('cstStoreWatch'); live.push(name)
        const heard = []
        wildflower.store(name, {
            state: { a: 1 },
            computed: { dbl() { return this.a * 2 } },
            watch: { dbl(nv, ov) { heard.push([nv, ov]) } },
        })
        wildflower.getStore(name).a = 5
        await tick()
        expect(heard).toEqual([[10, 2]])
    })
})

describe.skipIf(!hasFeature('plugins'))('a plugin computed', () => {
    it('subscribe() hears a change made in the same task as the subscription', async () => {
        const name = uniq('cstPlugin'), heard = []
        wildflower.plugin({
            name,
            state: { a: 1 },
            computed: { dbl() { return this.a * 2 } },
            setA(v) { this.a = v },
        })
        const p = wildflower['$' + name]
        p.subscribe('dbl', (v) => heard.push(v))
        p.setA(5)
        await tick()
        expect(heard).toEqual([10])
    })

    it('watch: {} hears a change made in the same task as the registration', async () => {
        const name = uniq('cstPluginWatch'), heard = []
        wildflower.plugin({
            name,
            state: { a: 1 },
            computed: { dbl() { return this.a * 2 } },
            watch: { dbl(nv, ov) { heard.push([nv, ov]) } },
            setA(v) { this.a = v },
        })
        wildflower['$' + name].setA(5)
        await tick()
        expect(heard).toEqual([[10, 2]])
    })
})

describe('a computed on one store that reads another', () => {
    // Store b's computed y reads store a's x, through this.stores (with
    // subscribe: {}) or through wildflower.getStore().
    function pair(viaGetStore) {
        const a = uniq('cstSrc'), b = uniq('cstReader'); live.push(b, a)
        wildflower.store(a, { state: { x: 1 } })
        wildflower.store(b, viaGetStore
            ? { state: {}, computed: { y() { return wildflower.getStore(a).x * 10 } } }
            : { state: {}, subscribe: { [a]: [] }, computed: { y() { return this.stores[a].x * 10 } } })
        return [wildflower.getStore(a), wildflower.getStore(b)]
    }

    it('subscribed in one task and changed in a later one (this.stores)', async () => {
        const [A, B] = pair(false), heard = []
        B.subscribe('y', (v) => heard.push(v))
        await tick()
        A.x = 2
        await tick()
        expect(heard).toEqual([20])
    })

    it('subscribed in one task and changed in a later one (wildflower.getStore())', async () => {
        const [A, B] = pair(true), heard = []
        B.subscribe('y', (v) => heard.push(v))
        await tick()
        A.x = 2
        await tick()
        expect(heard).toEqual([20])
    })

    it('subscribed and changed in the same task', async () => {
        const [A, B] = pair(false), heard = []
        B.subscribe('y', (v) => heard.push(v))
        A.x = 2
        await tick()
        expect(heard).toEqual([20])
    })

    it('the reading store registered before the store it reads', async () => {
        const a = uniq('cstLateSrc'), b = uniq('cstEarlyReader'); live.push(b, a)
        wildflower.store(b, {
            state: {},
            subscribe: { [a]: [] },
            computed: { y() { const s = this.stores[a]; return s ? s.x * 10 : -1 } },
        })
        wildflower.store(a, { state: { x: 1 } })
        const A = wildflower.getStore(a), B = wildflower.getStore(b), heard = []
        await tick()
        B.subscribe('y', (v) => heard.push(v))
        await tick()
        A.x = 2
        await tick()
        expect(heard).toEqual([20])
    })
})
