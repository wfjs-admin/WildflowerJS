/**
 * Lifecycle disposal sweep: resources × removal paths.
 *
 * Every cell asserts quiescence by count (mutate the source after removal and
 * require no work on the detached nodes, no further fetches) and a fresh render
 * on re-insert. Cell ids below follow the lifecycle-disposal sweep matrix
 * (2026-09-04).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const listsSuite = hasFeature('lists') ? describe : describe.skip
const querySuite = hasFeature('query') ? describe : describe.skip
const poolsSuite = hasFeature('pools') ? describe : describe.skip
const pluginsSuite = hasFeature('plugins') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-sweep-${++seq}`

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}
async function frames(n = 2) {
    for (let i = 0; i < n; i++) await new Promise(r => requestAnimationFrame(() => r()))
    await settle(10)
}

let container
let wildflower
let realWarn

beforeAll(async () => {
    await loadFramework()
})

beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()
    container = document.createElement('div')
    document.body.appendChild(container)
    realWarn = console.warn
    console.warn = () => {}
})

afterEach(() => {
    console.warn = realWarn
    delete wildflower._queryTeardownGraceMs
    if (container && container.parentNode) container.parentNode.removeChild(container)
    container = null
})

function mountToggle(cname, inner, extra = {}) {
    container.innerHTML = `
        <div data-component="${cname}">
            <button class="hide" data-action="hide">hide</button>
            <button class="reveal" data-action="reveal">reveal</button>
            <div data-render="show">${inner}</div>
        </div>
    `
    wildflower.component(cname, {
        ...extra,
        state: { show: true, ...(extra.state || {}) },
        hide() { this.show = false },
        reveal() { this.show = true }
    })
    wildflower.scan(container)
}

function pollingQuery(q) {
    const counter = { calls: 0 }
    wildflower.query(q, {
        from: async () => { counter.calls++; return [{ id: 1, name: 'x' }] },
        key: 'id',
        refresh: 0.1
    })
    wildflower._queryTeardownGraceMs = 150
    return counter
}

poolsSuite('B4: pool container under data-render', () => {
    it('entities added while hidden render in the fresh container on reveal', async () => {
        const c = uname('c')
        mountToggle(c, `
            <div data-pool="sprites" data-key="id">
                <template><div class="sprite" data-bind="name"></div></template>
            </div>
        `)
        await settle(100)
        const comp = wildflower.getComponent(c)
        const pool = comp.getPool('sprites')
        pool.add({ id: 1, name: 'a' })
        await frames()
        expect(container.querySelectorAll('.sprite').length).toBe(1)

        container.querySelector('.hide').click()
        await settle(100)
        pool.add({ id: 2, name: 'b' })
        await frames()

        container.querySelector('.reveal').click()
        await settle(100)
        await frames()
        const sprites = container.querySelectorAll('.sprite')
        expect(sprites.length).toBe(2)
        expect(container.textContent).toContain('b')
    })
})

describe('B5: render-effect bindings across a data-render generation', () => {
    it('after reveal, the previous generation is not written; the new one is', async () => {
        const c = uname('c')
        mountToggle(c, `<span class="v" data-bind="value"></span>`, { state: { value: 'one' } })
        await settle(100)
        const gen1 = container.querySelector('.v')
        expect(gen1.textContent).toBe('one')
        const comp = wildflower.getComponent(c)

        container.querySelector('.hide').click()
        await settle(100)
        comp.state.value = 'hidden-write'
        await settle(100)
        const writtenWhileHidden = gen1.textContent === 'hidden-write'

        container.querySelector('.reveal').click()
        await settle(100)
        const gen2 = container.querySelector('.v')
        expect(gen2).not.toBe(gen1)
        expect(gen2.textContent).toBe('hidden-write')

        comp.state.value = 'after-reveal'
        await settle(100)
        expect(gen2.textContent).toBe('after-reveal')
        expect(gen1.textContent).not.toBe('after-reveal')
        // Measured, not asserted: whether the detached node was written while hidden.
        console.log('B5 writtenWhileHidden=' + writtenWhileHidden)
    })
})

describe('B8: nested component under data-render', () => {
    it('destroy on hide stops its timer, init on reveal, one instance across toggles', async () => {
        const c = uname('c'); const inner = uname('inner')
        const counts = { inits: 0, destroys: 0, ticks: 0 }
        wildflower.component(inner, {
            state: { n: 0 },
            init() { counts.inits++; this._t = setInterval(() => { counts.ticks++ }, 20) },
            destroy() { counts.destroys++; clearInterval(this._t) }
        })
        mountToggle(c, `<div data-component="${inner}"><span data-bind="n"></span></div>`)
        await settle(250)
        expect(counts.inits).toBe(1)

        container.querySelector('.hide').click()
        await settle(150)
        expect(counts.destroys).toBe(1)
        const ticksAtHide = counts.ticks
        await settle(150)
        expect(counts.ticks).toBe(ticksAtHide)

        for (let i = 0; i < 3; i++) {
            container.querySelector('.reveal').click()
            await settle(200)
            container.querySelector('.hide').click()
            await settle(150)
        }
        container.querySelector('.reveal').click()
        await settle(250)
        expect(counts.inits).toBe(5)
        expect(counts.destroys).toBe(4)
        let live = 0
        wildflower.componentInstances.forEach(inst => { if (inst.name === inner) live++ })
        expect(live).toBe(1)
    })
})

pluginsSuite('B9: directive under data-render', () => {
    it('destroy hook on hide, init again on reveal', async () => {
        const c = uname('c'); const dir = uname('dir')
        const counts = { inits: 0, destroys: 0 }
        wildflower.directive(dir, {
            init: () => { counts.inits++ },
            destroy: () => { counts.destroys++ }
        })
        mountToggle(c, `<span data-${dir}="value">x</span>`, { state: { value: 1 } })
        await settle(150)
        expect(counts.inits).toBe(1)

        container.querySelector('.hide').click()
        await settle(150)
        expect(counts.destroys).toBe(1)

        container.querySelector('.reveal').click()
        await settle(150)
        expect(counts.inits).toBe(2)
    })
})

listsSuite('B11: nested list under a row-level data-render', () => {
    it('inner list stops reconciling on hide and renders fresh on reveal', async () => {
        const s = uname('s'); const c = uname('c')
        wildflower.store(s, { state: { rows: [{ id: 1, show: true, items: [{ id: 1, n: 'a' }] }] } })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-list="$${s}.rows" data-key="id">
                    <template>
                        <li>
                            <div data-render="show">
                                <ul class="inner" data-list="items" data-key="id">
                                    <template><li data-bind="n"></li></template>
                                </ul>
                            </div>
                        </li>
                    </template>
                </ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(150)
        const inner1 = container.querySelector('.inner')
        expect(inner1).not.toBeNull()
        expect(inner1.querySelectorAll('li').length).toBe(1)

        const store = wildflower.getStore(s)
        store.rows[0].show = false
        await settle(150)
        expect(inner1.isConnected).toBe(false)

        store.rows[0].items = store.rows[0].items.concat({ id: 2, n: 'b' })
        await settle(150)
        expect(inner1.querySelectorAll('li').length).toBe(1)

        store.rows[0].show = true
        await settle(200)
        const inner2 = container.querySelector('.inner')
        expect(inner2).not.toBeNull()
        expect(inner2).not.toBe(inner1)
        expect(inner2.querySelectorAll('li').length).toBe(2)
    })
})

listsSuite('B12/B13: per-toggle registrations do not grow', () => {
    it('B12: instance._mapArrayCleanups is bounded across toggles (dev builds)', async () => {
        if (isMinifiedBuild()) return
        const s = uname('s'); const c = uname('c')
        wildflower.store(s, { state: { items: [{ id: 1, name: 'a' }] } })
        mountToggle(c, `<ul data-list="$${s}.items" data-key="id"><template><li data-bind="name"></li></template></ul>`)
        await settle(100)
        let inst = null
        wildflower.componentInstances.forEach(i => { if (i.name === c) inst = i })
        expect(inst).not.toBeNull()
        const before = inst._mapArrayCleanups ? inst._mapArrayCleanups.length : 0
        for (let i = 0; i < 6; i++) {
            container.querySelector('.hide').click()
            await settle(60)
            container.querySelector('.reveal').click()
            await settle(80)
        }
        const after = inst._mapArrayCleanups ? inst._mapArrayCleanups.length : 0
        console.log(`B12 cleanups before=${before} after=${after}`)
        expect(after - before).toBeLessThanOrEqual(1)
    })

    it('B13: wildflower.domElements.lists is bounded across toggles', async () => {
        const s = uname('s'); const c = uname('c')
        wildflower.store(s, { state: { items: [{ id: 1, name: 'a' }] } })
        mountToggle(c, `<ul data-list="$${s}.items" data-key="id"><template><li data-bind="name"></li></template></ul>`)
        await settle(100)
        const lists = wildflower.domElements && wildflower.domElements.lists
        if (!lists) return
        const before = lists.length
        for (let i = 0; i < 6; i++) {
            container.querySelector('.hide').click()
            await settle(60)
            container.querySelector('.reveal').click()
            await settle(80)
        }
        const after = wildflower.domElements.lists.length
        console.log(`B13 domElements.lists before=${before} after=${after}`)

        // Symptom check first: a later scan re-mounts every registered entry,
        // stale ones included. The connected list must still follow its source.
        wildflower.scan(container)
        await settle(100)
        const store = wildflower.getStore(s)
        store.items = store.items.concat({ id: 2, name: 'b' })
        await settle(150)
        const live = container.querySelector('ul')
        expect(live.isConnected).toBe(true)
        expect(live.querySelectorAll('li').length).toBe(2)

        expect(after - before).toBeLessThanOrEqual(1)
    })
})

listsSuite('C2: nested component in a list row', () => {
    it('is destroyed when its row is removed', async () => {
        const s = uname('s'); const c = uname('c'); const inner = uname('inner')
        const counts = { inits: 0, destroys: 0 }
        wildflower.component(inner, {
            state: {},
            init() { counts.inits++ },
            destroy() { counts.destroys++ }
        })
        wildflower.store(s, { state: { rows: [{ id: 1 }, { id: 2 }] } })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-list="$${s}.rows" data-key="id">
                    <template><li><div data-component="${inner}">row</div></li></template>
                </ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(300)
        expect(counts.inits).toBe(2)

        const store = wildflower.getStore(s)
        store.rows = store.rows.filter(r => r.id !== 1)
        await settle(400)
        expect(counts.destroys).toBe(1)
        expect(container.querySelectorAll('li').length).toBe(1)
    })
})

querySuite('D1 / F1: query observation across removal paths', () => {
    // C3 (a $query.rows list nested in a row) is not in this file: neither a
    // $store path nor data-query mounts on a list inside a row template today
    // (probe 2026-09-04, renders nothing and warns nothing). See the sweep
    // document's findings; the shape needs a support-or-warn decision first.

    it('D1: a component subtree removed by hand is garbage collected; its query idles', async () => {
        const q = uname('q'); const c = uname('c'); const inner = uname('inner')
        const counter = pollingQuery(q)
        const counts = { destroys: 0 }
        wildflower.component(inner, { state: {}, destroy() { counts.destroys++ } })
        container.innerHTML = `
            <div data-component="${c}">
                <div class="box">
                    <div data-component="${inner}">
                        <ul data-query="${q}"><template><li data-bind="name"></li></template></ul>
                    </div>
                </div>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(300)
        const controller = wildflower._queryControllers.get(q)
        expect(controller.active).toBe(true)

        container.querySelector('.box').remove()
        await settle(700)
        expect(counts.destroys).toBe(1)
        expect(controller.active).toBe(false)
        const idleCalls = counter.calls
        await settle(300)
        expect(counter.calls).toBe(idleCalls)
    })

    it('F1: a data-query list under data-show false stays active', async () => {
        const q = uname('q'); const c = uname('c')
        const counter = pollingQuery(q)
        container.innerHTML = `
            <div data-component="${c}">
                <button class="hide" data-action="hide">hide</button>
                <div data-show="visible">
                    <ul data-query="${q}"><template><li data-bind="name"></li></template></ul>
                </div>
            </div>
        `
        wildflower.component(c, { state: { visible: true }, hide() { this.visible = false } })
        wildflower.scan(container)
        await settle(250)
        const controller = wildflower._queryControllers.get(q)
        expect(controller.active).toBe(true)

        container.querySelector('.hide').click()
        await settle(150)
        const callsAtHide = counter.calls
        await settle(700)
        expect(controller.active).toBe(true)
        expect(counter.calls).toBeGreaterThan(callsAtHide)
    })
})
