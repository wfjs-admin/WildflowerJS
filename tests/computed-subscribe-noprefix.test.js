/**
 * A store computed can be followed by its bare name on every route, as
 * bindings and a component's own watch: {} already allow. The computed:
 * prefix is optional everywhere.
 *
 * Routes: store.subscribe(), a component's watch: { 'store:name.x' }, and
 * the declarative subscribe: { name: ['x'] } with onStoreUpdate().
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework } from './helpers/load-framework.js'

let n = 0
const live = []
const uniq = (base) => base + (++n)
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => { await loadFramework() })
afterEach(() => {
    while (live.length) wildflower.unregister(live.pop())
    document.querySelectorAll('.csn-host').forEach((el) => el.remove())
})

function makeStore() {
    const name = uniq('csn'); live.push(name)
    wildflower.store(name, {
        state: { a: 1 },
        computed: { dbl() { return this.a * 2 } },
    })
    return name
}

describe('store.subscribe() on a computed', () => {
    it('the bare name fires as the computed: form does, with the same values', async () => {
        const name = makeStore(), s = wildflower.getStore(name)
        const bare = [], prefixed = []
        s.subscribe('dbl', (nv, ov) => bare.push([nv, ov]))
        s.subscribe('computed:dbl', (nv, ov) => prefixed.push([nv, ov]))
        await tick()
        s.a = 2
        await tick()
        s.a = 3
        await tick()
        expect(prefixed.length).toBe(2)
        expect(bare).toEqual(prefixed)
        expect(bare.at(-1)[0]).toBe(6)
    })

    it('immediate and once work with the bare name', async () => {
        const name = makeStore(), s = wildflower.getStore(name)
        const imm = [], once = []
        s.subscribe('dbl', (nv) => imm.push(nv), { immediate: true })
        s.subscribe('dbl', (nv) => once.push(nv), { once: true })
        expect(imm).toEqual([2])
        await tick()
        s.a = 5
        await tick()
        s.a = 6
        await tick()
        expect(imm).toEqual([2, 10, 12])
        expect(once).toEqual([10])
    })

    it('unsubscribing a bare-name subscription stops it', async () => {
        const name = makeStore(), s = wildflower.getStore(name)
        const calls = []
        const off = s.subscribe('dbl', (nv) => calls.push(nv))
        await tick()
        s.a = 2
        await tick()
        off()
        s.a = 3
        await tick()
        expect(calls).toEqual([4])
    })
})

describe('components following a store computed by its bare name', () => {
    it("watch: { 'store:name.computed' } fires", async () => {
        const name = makeStore(), comp = uniq('csn-watch')
        const calls = []
        wildflower.component(comp, {
            subscribe: { [name]: [] },
            watch: { ['store:' + name + '.dbl'](nv) { calls.push(nv) } },
        })
        const host = document.createElement('div')
        host.className = 'csn-host'
        host.innerHTML = `<div data-component="${comp}"></div>`
        document.body.appendChild(host)
        wildflower.scan()
        await tick(100)
        wildflower.getStore(name).a = 4
        await tick()
        expect(calls).toEqual([8])
    })

    it("subscribe: { name: ['computed'] } calls onStoreUpdate", async () => {
        const name = makeStore(), comp = uniq('csn-decl')
        const calls = []
        wildflower.component(comp, {
            subscribe: { [name]: ['dbl'] },
            onStoreUpdate(store, path, nv) { if (store === name) calls.push([path, nv]) },
        })
        const host = document.createElement('div')
        host.className = 'csn-host'
        host.innerHTML = `<div data-component="${comp}"></div>`
        document.body.appendChild(host)
        wildflower.scan()
        await tick(100)
        wildflower.getStore(name).a = 7
        await tick()
        expect(calls.map((c) => c[1])).toContain(14)
    })
})
