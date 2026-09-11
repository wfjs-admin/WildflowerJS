/**
 * Work-count sweep: registries and requests across transitions.
 *
 * The suite is strong on what appears in the DOM and weak on invisible work:
 * requests that go out, effects that stay alive, registries that grow by one
 * entry per toggle. Every cell here asserts by count. Registries are measured
 * after the first reveal and again after N toggles; they must not grow.
 * Request counts are exact. Cell ids follow the arrival-sweep matrix
 * (2026-09-04, section "Work-count sweep").
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

// Private registries are mangled in the production bundles, so the counts that
// read them run on the dev and raw lanes only; the visible behaviour and the
// request counts are asserted on every lane.
const internals = !isMinifiedBuild()

const listsSuite = hasFeature('lists') ? describe : describe.skip
const querySuite = hasFeature('query') ? describe : describe.skip
const portalsSuite = hasFeature('portals') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-wc-${++seq}`
const N = 6

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}

function jsonResponse(data) {
    const headers = new Headers()
    headers.set('content-type', 'application/json')
    return new Response(JSON.stringify(data), { status: 200, headers })
}

let container
let wildflower
let realWarn
let realFetch
let calls

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
    realFetch = window.fetch
    calls = []
    window.fetch = (url) => {
        calls.push(String(url))
        return Promise.resolve(jsonResponse([{ id: 1, name: 'x' }]))
    }
})

afterEach(() => {
    console.warn = realWarn
    window.fetch = realFetch
    delete wildflower._queryTeardownGraceMs
    if (container && container.parentNode) container.parentNode.removeChild(container)
    container = null
    document.querySelectorAll('[data-wc-target]').forEach(el => el.remove())
})

const callsTo = (q) => calls.filter(u => u.includes('/api/' + q)).length
const controller = (q) => wildflower._queryControllers.get(q)

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

async function toggle(times = N, ms = 60) {
    for (let i = 0; i < times; i++) {
        container.querySelector('.hide').click()
        await settle(ms)
        container.querySelector('.reveal').click()
        await settle(ms)
    }
}

const instanceOf = (c) => wildflower.getComponentsByType(c)[0]
const effectCount = (inst) => (inst.stateManager && inst.stateManager._effects) ? inst.stateManager._effects.size : null
const handlersOf = (inst) => [...wildflower.eventHandlers.values()].filter(h => h && h.componentId === inst.id).length

function portalTarget() {
    const el = document.createElement('div')
    el.id = uname('tgt')
    el.setAttribute('data-wc-target', '')
    document.body.appendChild(el)
    return el
}

// ---------------------------------------------------------------------------
// Registries across N toggles
// ---------------------------------------------------------------------------

describe('W1: instance._renderContexts', () => {
    it('does not grow across toggles of a section with a nested section, which keeps toggling', async () => {
        const c = uname('c')
        mountToggle(c, `<p class="inner" data-render="inner">i</p><span class="v" data-bind="v"></span>`, { state: { inner: true, v: 'a' } })
        await settle(120)
        const inst = instanceOf(c)
        const base = internals ? inst._renderContexts.length : null
        if (internals) expect(base).toBe(2)
        const effectsBase = effectCount(inst)

        await toggle()
        if (internals) expect(inst._renderContexts.length).toBe(base)
        if (effectsBase !== null) expect(effectCount(inst)).toBeLessThanOrEqual(effectsBase)

        inst.state.inner = false
        await settle(80)
        expect(container.querySelector('.inner')).toBeNull()
        inst.state.inner = true
        await settle(80)
        expect(container.querySelector('.inner')).not.toBeNull()
        inst.state.v = 'b'
        await settle(80)
        expect(container.querySelector('.v').textContent).toBe('b')
    })
})

describe('W2: wildflower.eventHandlers', () => {
    it('holds one entry per live action element after N toggles, and the handler fires once', async () => {
        const c = uname('c')
        mountToggle(c, `<button class="in" data-action="bump">b</button>`, { state: { n: 0 }, bump() { this.n++ } })
        await settle(120)
        const inst = instanceOf(c)
        const base = handlersOf(inst)
        expect(base).toBeGreaterThan(0)

        await toggle()
        expect(handlersOf(inst)).toBe(base)
        container.querySelector('.in').click()
        await settle(60)
        expect(inst.state.n).toBe(1)
    })
})

listsSuite('W3: instance._listContexts and live effects for a list under data-render', () => {
    it('stay bounded across N toggles; the list still renders and follows its source', async () => {
        const c = uname('c')
        mountToggle(c, `<ul data-list="items" data-key="id"><template><li data-bind="name"></li></template></ul>`, { state: { items: [{ id: 1, name: 'a' }] } })
        await settle(150)
        const inst = instanceOf(c)
        expect(container.querySelectorAll('li').length).toBe(1)
        const ctxBase = inst._listContexts ? inst._listContexts.size : 0
        const effectsBase = effectCount(inst)
        const cleanupsBase = (inst._mapArrayCleanups || []).length
        const listsBase = (wildflower.domElements.lists || []).filter(e => e.componentId === inst.id).length

        await toggle(N, 100)
        expect(inst._listContexts ? inst._listContexts.size : 0).toBe(ctxBase)
        expect((inst._mapArrayCleanups || []).length).toBe(cleanupsBase)
        expect((wildflower.domElements.lists || []).filter(e => e.componentId === inst.id).length).toBe(listsBase)
        if (effectsBase !== null) expect(effectCount(inst)).toBeLessThanOrEqual(effectsBase)

        inst.state.items = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]
        await settle(120)
        expect(container.querySelectorAll('li').length).toBe(2)
    })
})

querySuite('W4: controller.elements for queries under data-render', () => {
    it('does not grow across N toggles for a list and a record binding the same query', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/' + q, key: 'id' })
        mountToggle(c, `
            <ul data-query="${q}"><template><li data-bind="name"></li></template></ul>
            <div data-query="${q}"><span class="rec" data-bind="name"></span></div>
        `)
        await settle(200)
        expect(callsTo(q)).toBe(1)
        const ctrl = controller(q)
        const base = ctrl.elements.size

        await toggle()
        expect(ctrl.elements.size).toBe(base)
        expect(callsTo(q)).toBe(1)
        expect(container.querySelectorAll('li').length).toBe(1)
        expect(container.querySelector('.rec').textContent).toBe('x')
    })
})

portalsSuite('W5/W6: portal registries under data-render', () => {
    it('_portalBindingRecords and _deferredEffectMeta do not grow across N toggles', async () => {
        const c = uname('c'); const tgt = portalTarget()
        mountToggle(c, `<div data-portal="#${tgt.id}"><span class="tp" data-bind="v" data-bind-class="{ on: flag }">p</span></div>`, { state: { v: 'one', flag: true } })
        await settle(150)
        const inst = instanceOf(c)
        expect(tgt.querySelectorAll('.tp').length).toBe(1)
        // One toggle first so the measurement baseline is a post-reveal state.
        await toggle(1, 100)
        const recordsBase = (inst._portalBindingRecords || []).length
        const deferredBase = (inst._deferredEffectMeta || []).length
        const activeBase = internals ? (wildflower._activePortals.get(inst.id) || []).length : null
        if (internals) expect(activeBase).toBe(1)

        await toggle(N, 100)
        expect(tgt.querySelectorAll('.tp').length).toBe(1)
        if (internals) {
            expect((wildflower._activePortals.get(inst.id) || []).length).toBe(activeBase)
            expect((inst._portalBindingRecords || []).length).toBeLessThanOrEqual(recordsBase)
            expect((inst._deferredEffectMeta || []).length).toBeLessThanOrEqual(deferredBase)
        }

        inst.state.v = 'two'
        inst.state.flag = false
        await settle(100)
        expect(tgt.querySelector('.tp').textContent).toBe('two')
        expect(tgt.querySelector('.tp').classList.contains('on')).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// Request counts across transitions
// ---------------------------------------------------------------------------

querySuite('R1: cold load with route gating', () => {
    it('fetches only the visible page\'s query', async () => {
        const a = uname('qa'); const b = uname('qb'); const d = uname('qd'); const c = uname('c'); const r = uname('r')
        for (const q of [a, b, d]) wildflower.query(q, { from: '/api/' + q, key: 'id' })
        wildflower.store(r, { state: { page: 'a' } })
        container.innerHTML = `
            <div data-component="${c}">
                <section class="pa" data-render="$${r}.page === 'a'"><ul data-query="${a}"><template><li data-bind="name"></li></template></ul></section>
                <section class="pb" data-render="$${r}.page === 'b'"><ul data-query="${b}"><template><li data-bind="name"></li></template></ul><span data-bind="$${b}.count"></span></section>
                <section class="pd" data-render="$${r}.page === 'd'"><div data-query="${d}"><span data-bind="name"></span></div></section>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(250)
        expect(callsTo(a)).toBe(1)
        expect(callsTo(b)).toBe(0)
        expect(callsTo(d)).toBe(0)
        expect(container.querySelectorAll('.pa li').length).toBe(1)
        expect(container.querySelector('.pb')).toBeNull()
        expect(container.querySelector('.pd')).toBeNull()
    })
})

querySuite('R2: navigation and toggles within the grace window', () => {
    it('a -> b -> a costs one request per query, and N more round trips cost nothing', async () => {
        const a = uname('qa'); const b = uname('qb'); const c = uname('c'); const r = uname('r')
        for (const q of [a, b]) wildflower.query(q, { from: '/api/' + q, key: 'id' })
        wildflower.store(r, { state: { page: 'a' } })
        container.innerHTML = `
            <div data-component="${c}">
                <section class="pa" data-render="$${r}.page === 'a'"><ul data-query="${a}"><template><li data-bind="name"></li></template></ul></section>
                <section class="pb" data-render="$${r}.page === 'b'"><ul data-query="${b}"><template><li data-bind="name"></li></template></ul></section>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(200)
        const route = wildflower.getStore(r)
        route.page = 'b'
        await settle(200)
        route.page = 'a'
        await settle(200)
        expect(callsTo(a)).toBe(1)
        expect(callsTo(b)).toBe(1)
        for (let i = 0; i < N; i++) {
            route.page = 'b'
            await settle(60)
            route.page = 'a'
            await settle(60)
        }
        await settle(150)
        expect(callsTo(a)).toBe(1)
        expect(callsTo(b)).toBe(1)
        expect(container.querySelectorAll('.pa li').length).toBe(1)
    })
})

querySuite('R3: navigation past the grace window', () => {
    it('the left page\'s query tears down, and coming back costs exactly one conditional refetch', async () => {
        const a = uname('qa'); const c = uname('c'); const r = uname('r')
        wildflower.query(a, { from: '/api/' + a, key: 'id', refresh: 0.3 })
        wildflower._queryTeardownGraceMs = 150
        wildflower.store(r, { state: { page: 'a' } })
        container.innerHTML = `
            <div data-component="${c}">
                <section class="pa" data-render="$${r}.page === 'a'"><ul data-query="${a}"><template><li data-bind="name"></li></template></ul></section>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(200)
        expect(callsTo(a)).toBe(1)
        const route = wildflower.getStore(r)
        route.page = 'b'
        await settle(800)
        expect(controller(a).active).toBe(false)
        const atReturn = callsTo(a)
        route.page = 'a'
        await settle(150)
        expect(callsTo(a)).toBe(atReturn + 1)
        expect(container.querySelectorAll('.pa li').length).toBe(1)
    })
})

querySuite('R4/R5: focus flick and reconnect', () => {
    function mountQuery(q, refresh) {
        const c = uname('c')
        wildflower.query(q, { from: '/api/' + q, key: 'id', refresh })
        container.innerHTML = `<div data-component="${c}"><ul data-query="${q}"><template><li data-bind="name"></li></template></ul></div>`
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
    }

    it('a focus flick inside the fresh window costs nothing; without a window it costs one', async () => {
        const fresh = uname('qf'); const bare = uname('qg')
        mountQuery(fresh, ['focus', 'fresh:60'])
        await settle(200)
        expect(callsTo(fresh)).toBe(1)
        window.dispatchEvent(new Event('focus'))
        await settle(150)
        expect(callsTo(fresh)).toBe(1)

        container.innerHTML = ''
        mountQuery(bare, 'focus')
        await settle(200)
        expect(callsTo(bare)).toBe(1)
        window.dispatchEvent(new Event('focus'))
        await settle(150)
        expect(callsTo(bare)).toBe(2)
        window.dispatchEvent(new Event('focus'))
        await settle(150)
        expect(callsTo(bare)).toBe(3)
    })

    it('a reconnect costs exactly one request per event', async () => {
        const q = uname('qr')
        mountQuery(q, 'reconnect')
        await settle(200)
        expect(callsTo(q)).toBe(1)
        window.dispatchEvent(new Event('online'))
        await settle(150)
        expect(callsTo(q)).toBe(2)
    })
})

querySuite('R6: late registration', () => {
    it('a query registered after its markup bound costs exactly one request', async () => {
        const q = uname('q'); const c = uname('c')
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}"><template><li data-bind="name"></li></template></ul>
                <span class="n" data-bind="$${q}.count"></span>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(150)
        expect(callsTo(q)).toBe(0)
        wildflower.query(q, { from: '/api/' + q, key: 'id' })
        await settle(300)
        expect(callsTo(q)).toBe(1)
        expect(container.querySelectorAll('li').length).toBe(1)
        expect(container.querySelector('.n').textContent).toBe('1')
        expect(wildflower._queryLateEls ? wildflower._queryLateEls.has(q) : false).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// Leaving side, found while reading the arrival paths
// ---------------------------------------------------------------------------

querySuite('E2: a removed generation\'s nested conditional must not keep its query alive', () => {
    it('after the section hides, unrelated state changes do not touch the query, which tears down', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/' + q, key: 'id', refresh: 0.3 })
        wildflower._queryTeardownGraceMs = 150
        mountToggle(c, `
            <p class="empty" data-render="$${q}.count === 0">empty</p>
            <ul data-query="${q}"><template><li data-bind="name"></li></template></ul>
        `, { state: { n: 0 } })
        await settle(250)
        expect(callsTo(q)).toBe(1)
        const inst = instanceOf(c)

        container.querySelector('.hide').click()
        await settle(60)
        const atHide = callsTo(q)
        for (let i = 0; i < 16; i++) {
            inst.state.n++
            await settle(45)
        }
        expect(controller(q).active).toBe(false)
        expect(callsTo(q)).toBe(atHide)
    })
})
