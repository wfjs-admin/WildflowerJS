/**
 * A store's this.stores.<name> after <name> is unregistered, and after it is
 * registered again.
 *
 * A store's this.stores getter replaces itself with a lean proxy over the
 * subscribed store's state on its first read outside a computed evaluation's
 * tracking context: in production builds every first read, since they never
 * set that context, and in dev builds a read from a method, init() or a
 * watcher. The cached proxy outlived the store it was made for, so after an
 * unregister the waiting store still read the discarded instance, and after
 * a re-register it never reached the new one.
 *
 * Shapes below: a computed followed by subscribe(), the same computed read
 * directly, a method, init(), a watcher, and an unregister with no
 * re-register. Controls: a component's this.stores (it never caches), and a
 * store that reads the subscribed store before it first registers.
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
    document.querySelectorAll('.ssr-host').forEach((el) => el.remove())
})

function mount(comp) {
    const host = document.createElement('div')
    host.className = 'ssr-host'
    host.innerHTML = `<div data-component="${comp}"></div>`
    document.body.appendChild(host)
    wildflower.scan()
    return host
}

describe("a store's this.stores across an unregister and a re-register", () => {
    it('subscribe() on a computed reading this.stores follows the store registered again', async () => {
        const src = uniq('ssrSource'), rdr = uniq('ssrReader'); live.push(rdr, src)
        wildflower.store(src, { state: { x: 1 } })
        wildflower.store(rdr, {
            state: {},
            subscribe: { [src]: [] },
            computed: { y() { const s = this.stores[src]; return s ? s.x * 10 : -1 } },
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

    it('a direct read of a computed reading this.stores reaches the store registered again', async () => {
        const src = uniq('ssrPullSource'), rdr = uniq('ssrPullReader'); live.push(rdr, src)
        wildflower.store(src, { state: { x: 1 } })
        wildflower.store(rdr, {
            state: {},
            subscribe: { [src]: [] },
            computed: { y() { const s = this.stores[src]; return s ? s.x * 10 : -1 } },
        })
        const B = wildflower.getStore(rdr)
        expect(B.y).toBe(10)
        wildflower.unregister(src)
        wildflower.store(src, { state: { x: 3 } })
        expect(B.y).toBe(30)
        wildflower.getStore(src).x = 4
        expect(B.y).toBe(40)
    })

    it('a method reading this.stores reaches the store registered again', async () => {
        const src = uniq('ssrMethodSource'), rdr = uniq('ssrMethodReader'); live.push(rdr, src)
        wildflower.store(src, { state: { x: 1 } })
        wildflower.store(rdr, {
            state: {},
            subscribe: { [src]: [] },
            readX() { return this.stores[src].x },
        })
        const B = wildflower.getStore(rdr)
        expect(B.readX()).toBe(1)
        wildflower.unregister(src)
        wildflower.store(src, { state: { x: 3 } })
        expect(B.readX()).toBe(3)
    })

    it('a read in init() does not tie later reads to the instance it saw', async () => {
        const src = uniq('ssrInitSource'), rdr = uniq('ssrInitReader'); live.push(rdr, src)
        wildflower.store(src, { state: { x: 1 } })
        wildflower.store(rdr, {
            state: { firstX: null },
            subscribe: { [src]: [] },
            init() { this.firstX = this.stores[src].x },
            readX() { return this.stores[src].x },
        })
        const B = wildflower.getStore(rdr)
        expect(B.firstX).toBe(1)
        wildflower.unregister(src)
        wildflower.store(src, { state: { x: 3 } })
        expect(B.readX()).toBe(3)
    })

    it('a watcher reading this.stores reaches the store registered again', async () => {
        const src = uniq('ssrWatchSource'), rdr = uniq('ssrWatchReader'); live.push(rdr, src)
        const seen = []
        wildflower.store(src, { state: { x: 1 } })
        wildflower.store(rdr, {
            state: { k: 0 },
            subscribe: { [src]: [] },
            watch: { k() { seen.push(this.stores[src].x) } },
        })
        const B = wildflower.getStore(rdr)
        B.k = 1
        await tick()
        wildflower.unregister(src)
        wildflower.store(src, { state: { x: 3 } })
        B.k = 2
        await tick()
        expect(seen).toEqual([1, 3])
    })

    it('after an unregister with no re-register, this.stores gives what a missing store gives', async () => {
        const src = uniq('ssrGoneSource'), rdr = uniq('ssrGoneReader'); live.push(rdr, src)
        const never = uniq('ssrNeverSource')
        wildflower.store(src, { state: { x: 1 } })
        wildflower.store(rdr, {
            state: {},
            subscribe: { [src]: [], [never]: [] },
            ref(name) { return this.stores[name] },
        })
        const B = wildflower.getStore(rdr)
        expect(B.ref(src).x).toBe(1)
        wildflower.unregister(src)
        // Compared by identity: a failing toBe would try to print a store proxy.
        expect(B.ref(src) === B.ref(never)).toBe(true)
    })
})

describe('controls', () => {
    it("a component's this.stores reaches the store registered again", async () => {
        const src = uniq('ssrCompSource'), comp = uniq('ssr-comp'); live.push(src)
        wildflower.store(src, { state: { x: 1 } })
        wildflower.component(comp, {
            subscribe: { [src]: [] },
            readX() { return this.stores[src].x },
        })
        mount(comp)
        await tick(50)
        const c = wildflower.getComponent(comp)
        expect(c.readX()).toBe(1)
        wildflower.unregister(src)
        wildflower.store(src, { state: { x: 3 } })
        expect(c.readX()).toBe(3)
    })

    it('a store that read the subscribed store before it first registered reaches it, then follows a re-register', async () => {
        const src = uniq('ssrFirstSource'), rdr = uniq('ssrFirstReader'); live.push(rdr, src)
        wildflower.store(rdr, {
            state: {},
            subscribe: { [src]: [] },
            readX() { const s = this.stores[src]; return s ? s.x : null },
        })
        const B = wildflower.getStore(rdr)
        expect(B.readX()).toBe(null)
        wildflower.store(src, { state: { x: 1 } })
        expect(B.readX()).toBe(1)
        wildflower.unregister(src)
        wildflower.store(src, { state: { x: 3 } })
        expect(B.readX()).toBe(3)
    })
})
