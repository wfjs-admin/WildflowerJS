/**
 * Arrival sweep: binding types × the ways a subtree arrives in a component.
 *
 * Companion to the disposal sweep. Each cell states what a binding must do
 * when it arrives by a path other than first-instance init: data-render
 * insertion, SSR adoption, late entity registration, slot expansion, and the
 * compiled fast path a SECOND instance of a component name takes. Where the
 * work is invisible the tests assert by count: requests, inits, copies. Cell
 * ids below follow the arrival-sweep matrix (2026-09-04).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

// Private registries and helpers are mangled in the production bundles, so the
// assertions that look at them run on the dev and raw lanes only; the behaviour
// they explain is asserted on every lane.
const internals = !isMinifiedBuild()

const listsSuite = hasFeature('lists') ? describe : describe.skip
const querySuite = hasFeature('query') ? describe : describe.skip
const poolsSuite = hasFeature('pools') ? describe : describe.skip
const portalsSuite = hasFeature('portals') ? describe : describe.skip
const ssrSuite = hasFeature('ssr') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-arr-${++seq}`

async function settle(ms = 80) {
    await new Promise(r => setTimeout(r, ms))
}
async function frames(n = 2) {
    for (let i = 0; i < n; i++) await new Promise(r => requestAnimationFrame(() => r()))
    await settle(10)
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
let fetchData

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
    fetchData = [{ id: 1, name: 'x', active: true }]
    window.fetch = (url) => {
        calls.push(String(url))
        return Promise.resolve(jsonResponse(fetchData))
    }
})

afterEach(() => {
    console.warn = realWarn
    window.fetch = realFetch
    delete wildflower._queryTeardownGraceMs
    if (container && container.parentNode) container.parentNode.removeChild(container)
    container = null
    document.querySelectorAll('[data-arr-target]').forEach(el => el.remove())
})

const callsTo = (q) => calls.filter(u => u.includes('/api/' + q)).length

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

function portalTarget() {
    const id = uname('tgt')
    const el = document.createElement('div')
    el.id = id
    el.setAttribute('data-arr-target', '')
    document.body.appendChild(el)
    return el
}

// ---------------------------------------------------------------------------
// A: cells expected to pass (guards against the same family)
// ---------------------------------------------------------------------------

describe('A1: data-bind-html under data-render', () => {
    it('paints on reveal and follows state after', async () => {
        const c = uname('c')
        mountToggle(c, `<span class="h" data-bind-html="html"></span>`, { state: { show: false, html: '<b>one</b>' } })
        await settle(100)
        expect(container.querySelector('.h')).toBeNull()

        container.querySelector('.reveal').click()
        await settle(100)
        expect(container.querySelector('.h').innerHTML).toBe('<b>one</b>')

        wildflower.getComponent(c).state.html = '<i>two</i>'
        await settle(80)
        expect(container.querySelector('.h').innerHTML).toBe('<i>two</i>')
    })
})

ssrSuite('A2: non-list bindings in an SSR-adopted component', () => {
    it('server values survive adoption, then every binding type follows state', async () => {
        const c = uname('c'); const dir = uname('dir')
        const dirCalls = { inits: 0, values: [] }
        wildflower.directive(dir, {
            init: (el, value) => { dirCalls.inits++; dirCalls.values.push(value) }
        })
        container.innerHTML = `
            <div data-component="${c}" data-ssr="true">
                <span class="b" data-bind="label">Server</span>
                <span class="h" data-bind-html="html"><b>srv</b></span>
                <span class="cl" data-bind-class="{ on: flag }" class="on">c</span>
                <span class="st" data-bind-style="{ color: color }" style="color: rgb(1, 2, 3);">s</span>
                <span class="at" data-bind-attr="{ title: label }" title="Server">a</span>
                <span class="sh" data-show="flag">v</span>
                <input class="m" data-model="label" value="Server">
                <p class="r" data-render="flag">r</p>
                <span class="d" data-${dir}="label">d</span>
            </div>
        `
        wildflower.component(c, {
            state: { label: 'Client', html: '<i>cli</i>', flag: true, color: 'rgb(1, 2, 3)' }
        })
        wildflower.scan(container)
        await settle(200)

        // Adoption: the server value wins for parsed bindings.
        const comp = wildflower.getComponent(c)
        expect(comp.state.label).toBe('Server')
        expect(container.querySelector('.b').textContent).toBe('Server')
        expect(container.querySelector('.at').getAttribute('title')).toBe('Server')
        expect(container.querySelector('.cl').classList.contains('on')).toBe(true)
        expect(container.querySelector('.sh').style.display).not.toBe('none')
        expect(container.querySelector('.r')).not.toBeNull()
        expect(container.querySelector('.h').innerHTML).toBe('<i>cli</i>')
        expect(dirCalls.inits).toBe(1)

        // Then every binding follows state.
        comp.state.label = 'New'
        comp.state.html = '<u>new</u>'
        comp.state.flag = false
        comp.state.color = 'rgb(4, 5, 6)'
        await settle(120)
        expect(container.querySelector('.b').textContent).toBe('New')
        expect(container.querySelector('.h').innerHTML).toBe('<u>new</u>')
        expect(container.querySelector('.cl').classList.contains('on')).toBe(false)
        expect(container.querySelector('.st').style.color).toBe('rgb(4, 5, 6)')
        expect(container.querySelector('.at').getAttribute('title')).toBe('New')
        expect(container.querySelector('.sh').style.display).toBe('none')
        expect(container.querySelector('.r')).toBeNull()
        expect(container.querySelector('.m').value).toBe('New')

        // Two-way after activation.
        const input = container.querySelector('.m')
        input.value = 'Typed'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await settle(80)
        expect(comp.state.label).toBe('Typed')
    })
})

describe('A3: every binding type reading a store that registers later', () => {
    it('fills in when the store arrives and follows it after', async () => {
        const s = uname('s'); const c = uname('c')
        container.innerHTML = `
            <div data-component="${c}">
                <span class="b" data-bind="$${s}.label"></span>
                <span class="h" data-bind-html="$${s}.html"></span>
                <span class="cl" data-bind-class="{ on: $${s}.flag }">c</span>
                <span class="st" data-bind-style="{ color: $${s}.color }">s</span>
                <span class="at" data-bind-attr="{ title: $${s}.label }">a</span>
                <span class="sh" data-show="$${s}.flag">v</span>
                <p class="r" data-render="$${s}.flag">r</p>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(100)
        expect(container.querySelector('.b').textContent).toBe('')
        expect(container.querySelector('.r')).toBeNull()

        wildflower.store(s, { state: { label: 'late', html: '<b>l</b>', flag: true, color: 'rgb(7, 8, 9)' } })
        await settle(150)
        expect(container.querySelector('.b').textContent).toBe('late')
        expect(container.querySelector('.h').innerHTML).toBe('<b>l</b>')
        expect(container.querySelector('.cl').classList.contains('on')).toBe(true)
        expect(container.querySelector('.st').style.color).toBe('rgb(7, 8, 9)')
        expect(container.querySelector('.at').getAttribute('title')).toBe('late')
        expect(container.querySelector('.sh').style.display).not.toBe('none')
        expect(container.querySelector('.r')).not.toBeNull()

        const store = wildflower.getStore(s)
        store.label = 'later'
        store.flag = false
        await settle(120)
        expect(container.querySelector('.b').textContent).toBe('later')
        expect(container.querySelector('.at').getAttribute('title')).toBe('later')
        expect(container.querySelector('.cl').classList.contains('on')).toBe(false)
        expect(container.querySelector('.sh').style.display).toBe('none')
        expect(container.querySelector('.r')).toBeNull()
    })
})

listsSuite('A4: html, style, attr bindings inside slot content', () => {
    it('resolve against the data-with object and follow a replacement', async () => {
        const p = uname('p'); const c = uname('c')
        container.innerHTML = `
            <div data-component="${p}">
                <template data-item-template="card">
                    <div class="card">
                        <span class="h" data-bind-html="html"></span>
                        <span class="st" data-bind-style="{ color: color }">s</span>
                        <span class="at" data-bind-attr="{ title: title }">a</span>
                    </div>
                </template>
                <div data-component="${c}">
                    <template data-use-template="card" data-with="item"></template>
                </div>
            </div>
        `
        wildflower.component(p, { state: {} })
        wildflower.component(c, { state: { item: { html: '<b>one</b>', color: 'rgb(1, 2, 3)', title: 'one' } } })
        wildflower.scan(container)
        await settle(150)
        const card = container.querySelector('.card')
        expect(card).not.toBeNull()
        expect(card.querySelector('.h').innerHTML).toBe('<b>one</b>')
        expect(card.querySelector('.st').style.color).toBe('rgb(1, 2, 3)')
        expect(card.querySelector('.at').getAttribute('title')).toBe('one')

        wildflower.getComponent(c).state.item = { html: '<i>two</i>', color: 'rgb(4, 5, 6)', title: 'two' }
        await settle(150)
        const card2 = container.querySelector('.card')
        expect(card2.querySelector('.h').innerHTML).toBe('<i>two</i>')
        expect(card2.querySelector('.st').style.color).toBe('rgb(4, 5, 6)')
        expect(card2.querySelector('.at').getAttribute('title')).toBe('two')
    })
})

describe('A5: the compiled fast path (second instance of a component name)', () => {
    function markup(c, dir, inner, tgt) {
        return `
            <div data-component="${c}">
                <span class="b" data-bind="label"></span>
                <span class="h" data-bind-html="html"></span>
                <span class="cl" data-bind-class="{ on: flag }">c</span>
                <span class="st" data-bind-style="{ color: color }">s</span>
                <span class="at" data-bind-attr="{ title: label }">a</span>
                <span class="sh" data-show="flag">v</span>
                <input class="m" data-model="label">
                <p class="r" data-render="flag">r</p>
                <ul class="l" data-list="items" data-key="id"><template><li data-bind="name"></li></template></ul>
                <button class="act" data-action="bump">b</button>
                <span class="n" data-bind="count"></span>
                <span class="d" data-${dir}="label">d</span>
                ${tgt ? `<div data-portal="#${tgt.id}"><span class="tp" data-bind="label"></span></div>` : ''}
                <div data-component="${inner}"></div>
            </div>
        `
    }

    it('takes the compiled path and every binding type works on the second instance, independently', async () => {
        const c = uname('c'); const dir = uname('dir'); const inner = uname('inner')
        const tgt = hasFeature('portals') ? portalTarget() : null
        const counts = { dirInits: 0, innerInits: 0 }
        wildflower.directive(dir, { init: () => { counts.dirInits++ } })
        wildflower.component(inner, { state: {}, init() { counts.innerInits++ } })
        wildflower.component(c, {
            state: { label: 'one', html: '<b>1</b>', flag: true, color: 'rgb(1, 1, 1)', items: [{ id: 1, name: 'a' }], count: 0 },
            bump() { this.count++ }
        })

        // First instance: compiles the snapshot.
        const first = document.createElement('div')
        first.innerHTML = markup(c, dir, inner, tgt)
        container.appendChild(first)
        wildflower.scan(first)
        await settle(150)
        const def = wildflower.componentDefinitions.get(c)
        if (internals) expect(def._compiledBindings).toBeTruthy()

        // Second instance: prove the fingerprint matches BEFORE it initializes,
        // so the compiled path is the one taken.
        const second = document.createElement('div')
        second.innerHTML = markup(c, dir, inner, tgt)
        container.appendChild(second)
        if (internals) expect(wildflower._generateDOMFingerprint(second.firstElementChild)).toBe(def._compiledBindings.fingerprint)
        wildflower.scan(second)
        await settle(200)

        const comps = wildflower.getComponentsByType(c)
        expect(comps.length).toBe(2)
        const c2 = comps[1]
        const q = (sel) => second.querySelector(sel)
        const q1 = (sel) => first.querySelector(sel)

        // Initial paint on the second instance.
        expect(q('.b').textContent).toBe('one')
        expect(q('.h').innerHTML).toBe('<b>1</b>')
        expect(q('.cl').classList.contains('on')).toBe(true)
        expect(q('.at').getAttribute('title')).toBe('one')
        expect(q('.r')).not.toBeNull()
        if (hasFeature('lists')) expect(second.querySelectorAll('.l li').length).toBe(1)
        expect(counts.dirInits).toBe(2)
        expect(counts.innerInits).toBe(2)
        if (tgt) expect(tgt.querySelectorAll('.tp').length).toBe(2)

        // Reactivity on the second instance; the first is untouched.
        c2.state.label = 'two'
        c2.state.html = '<i>2</i>'
        c2.state.flag = false
        c2.state.color = 'rgb(2, 2, 2)'
        if (hasFeature('lists')) c2.state.items = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]
        await settle(150)
        expect(q('.b').textContent).toBe('two')
        expect(q('.h').innerHTML).toBe('<i>2</i>')
        expect(q('.cl').classList.contains('on')).toBe(false)
        expect(q('.st').style.color).toBe('rgb(2, 2, 2)')
        expect(q('.at').getAttribute('title')).toBe('two')
        expect(q('.sh').style.display).toBe('none')
        expect(q('.r')).toBeNull()
        expect(q('.m').value).toBe('two')
        if (hasFeature('lists')) expect(second.querySelectorAll('.l li').length).toBe(2)
        expect(q1('.b').textContent).toBe('one')
        expect(q1('.r')).not.toBeNull()
        if (hasFeature('lists')) expect(first.querySelectorAll('.l li').length).toBe(1)
        if (tgt) {
            const texts = [...tgt.querySelectorAll('.tp')].map(e => e.textContent).sort()
            expect(texts).toEqual(['one', 'two'])
        }

        // Action and model bind to the second instance's own context.
        q('.act').click()
        await settle(60)
        expect(c2.state.count).toBe(1)
        expect(comps[0].state.count).toBe(0)
        expect(q('.n').textContent).toBe('1')
        const input = q('.m')
        input.value = 'typed'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await settle(60)
        expect(c2.state.label).toBe('typed')
        expect(comps[0].state.label).toBe('one')

        // The second instance's data-render section comes back.
        c2.state.flag = true
        await settle(120)
        expect(q('.r')).not.toBeNull()
    })
})

// ---------------------------------------------------------------------------
// B: cells expected to fail (predicted from the code paths)
// ---------------------------------------------------------------------------

describe('B1: nested data-render inside a re-inserted section', () => {
    it('keeps toggling after the outer section is hidden and revealed', async () => {
        const c = uname('c')
        mountToggle(c, `<p class="inner" data-render="inner">inner</p>`, { state: { inner: true } })
        await settle(100)
        expect(container.querySelector('.inner')).not.toBeNull()
        const comp = wildflower.getComponent(c)

        // Control: the nested section toggles before any outer toggle.
        comp.state.inner = false
        await settle(80)
        expect(container.querySelector('.inner')).toBeNull()
        comp.state.inner = true
        await settle(80)
        expect(container.querySelector('.inner')).not.toBeNull()

        container.querySelector('.hide').click()
        await settle(100)
        container.querySelector('.reveal').click()
        await settle(100)
        expect(container.querySelector('.inner')).not.toBeNull()

        comp.state.inner = false
        await settle(100)
        expect(container.querySelector('.inner')).toBeNull()
        comp.state.inner = true
        await settle(100)
        expect(container.querySelector('.inner')).not.toBeNull()
    })

    it('a nested $store condition also keeps toggling after the outer round trip', async () => {
        const c = uname('c'); const s = uname('s')
        wildflower.store(s, { state: { flag: true } })
        mountToggle(c, `<p class="inner" data-render="$${s}.flag">inner</p>`)
        await settle(120)
        expect(container.querySelector('.inner')).not.toBeNull()

        container.querySelector('.hide').click()
        await settle(100)
        container.querySelector('.reveal').click()
        await settle(150)
        expect(container.querySelector('.inner')).not.toBeNull()

        wildflower.getStore(s).flag = false
        await settle(120)
        expect(container.querySelector('.inner')).toBeNull()
        wildflower.getStore(s).flag = true
        await settle(120)
        expect(container.querySelector('.inner')).not.toBeNull()
    })
})

describe('B2: a $store-gated section that is true at init', () => {
    it('is not removed and re-inserted as a clone during init', async () => {
        const c = uname('c'); const s = uname('s'); const inner = uname('inner')
        const counts = { inits: 0, destroys: 0 }
        wildflower.store(s, { state: { page: 'a' } })
        wildflower.component(inner, { state: {}, init() { counts.inits++ }, destroy() { counts.destroys++ } })
        container.innerHTML = `
            <div data-component="${c}">
                <section class="sec" data-render="$${s}.page === 'a'">
                    <div data-component="${inner}"></div>
                </section>
            </div>
        `
        const original = container.querySelector('.sec')
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle(200)

        const sec = container.querySelector('.sec')
        expect(sec).not.toBeNull()
        expect(sec).toBe(original)
        expect(counts.inits).toBe(1)
        expect(counts.destroys).toBe(0)
        // No placeholder comment left behind by an init-time removal.
        const comments = []
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_COMMENT)
        while (walker.nextNode()) comments.push(walker.currentNode.data)
        expect(comments.filter(t => t.includes('data-render')).length).toBe(0)

        // Still driven by the store afterwards.
        wildflower.getStore(s).page = 'b'
        await settle(120)
        expect(container.querySelector('.sec')).toBeNull()
        expect(counts.destroys).toBe(1)
        wildflower.getStore(s).page = 'a'
        await settle(150)
        expect(container.querySelector('.sec')).not.toBeNull()
        expect(counts.inits).toBe(2)
    })
})

listsSuite('B3: slot templates inside data-render sections', () => {
    function mountSlot(p, c, renderExpr, extra = {}) {
        container.innerHTML = `
            <div data-component="${p}">
                <template data-item-template="card">
                    <span class="card" data-bind="title"></span>
                </template>
                <div data-component="${c}">
                    <button class="reveal" data-action="reveal">reveal</button>
                    <div data-render="${renderExpr}">
                        <template data-use-template="card" data-with="item"></template>
                    </div>
                </div>
            </div>
        `
        wildflower.component(p, { state: {} })
        wildflower.component(c, {
            state: { show: false, item: { title: 'one' }, ...(extra.state || {}) },
            reveal() { this.show = true }
        })
        wildflower.scan(container)
    }

    it('B3a: a slot inside a hidden-at-init section renders on reveal and follows its path', async () => {
        const p = uname('p'); const c = uname('c')
        mountSlot(p, c, 'show')
        await settle(120)
        expect(container.querySelector('.card')).toBeNull()

        container.querySelector('.reveal').click()
        await settle(150)
        expect(container.querySelector('.card')).not.toBeNull()
        expect(container.querySelector('.card').textContent).toBe('one')

        wildflower.getComponent(c).state.item = { title: 'two' }
        await settle(120)
        expect(container.querySelector('.card').textContent).toBe('two')
    })

    it('B3b: a slot inside a $store-gated section that is true at init renders', async () => {
        const p = uname('p'); const c = uname('c'); const s = uname('s')
        wildflower.store(s, { state: { page: 'a' } })
        mountSlot(p, c, `$${s}.page === 'a'`)
        await settle(200)
        expect(container.querySelector('.card')).not.toBeNull()
        expect(container.querySelector('.card').textContent).toBe('one')
    })
})

querySuite('B4: a data-query record inside a data-render section', () => {
    // Bare data-bind paths are rewritten to $q.rows.0.x (attributes, so the
    // clone keeps them); everything else in the subtree (expressions, and a
    // bare field in data-show / data-bind-class) relies on the _wfRecordQuery
    // scope marker, which the clone does not carry.
    const record = (q) => `
        <div data-query="${q}">
            <span class="bare" data-bind="name"></span>
            <span class="expr" data-bind="name + '!'"></span>
            <span class="flag" data-show="active">on</span>
            <span class="cls" data-bind-class="{ live: active }">c</span>
        </div>
    `
    const check = () => {
        expect(container.querySelector('.bare').textContent).toBe('x')
        expect(container.querySelector('.expr').textContent).toBe('x!')
        expect(container.querySelector('.flag').style.display).not.toBe('none')
        expect(container.querySelector('.cls').classList.contains('live')).toBe(true)
    }

    it('hidden at init: one fetch on reveal and the subtree resolves against the row', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/' + q, key: 'id' })
        mountToggle(c, record(q), { state: { show: false } })
        await settle(150)
        expect(callsTo(q)).toBe(0)

        container.querySelector('.reveal').click()
        await settle(200)
        expect(callsTo(q)).toBe(1)
        check()
    })

    it('shown, hidden, shown: the subtree still resolves against the row and nothing refetches', async () => {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from: '/api/' + q, key: 'id' })
        mountToggle(c, record(q))
        await settle(200)
        expect(callsTo(q)).toBe(1)
        check()

        container.querySelector('.hide').click()
        await settle(100)
        container.querySelector('.reveal').click()
        await settle(200)
        expect(callsTo(q)).toBe(1)
        check()

        // A new row after the round trip re-renders the re-inserted subtree.
        fetchData = [{ id: 1, name: 'y', active: false }]
        await wildflower.getQuery(q).refresh()
        await settle(150)
        expect(container.querySelector('.bare').textContent).toBe('y')
        expect(container.querySelector('.expr').textContent).toBe('y!')
        expect(container.querySelector('.flag').style.display).toBe('none')
        expect(container.querySelector('.cls').classList.contains('live')).toBe(false)
    })
})

portalsSuite('B5: a portal inside a data-render section', () => {
    it('hidden at init: teleported once on reveal, reactive, nothing left inline', async () => {
        const c = uname('c'); const tgt = portalTarget()
        mountToggle(c, `<div data-portal="#${tgt.id}"><span class="tp" data-bind="v"></span></div>`, { state: { show: false, v: 'one' } })
        await settle(120)
        expect(tgt.querySelectorAll('.tp').length).toBe(0)

        container.querySelector('.reveal').click()
        await settle(150)
        expect(tgt.querySelectorAll('.tp').length).toBe(1)
        expect(tgt.querySelector('.tp').textContent).toBe('one')
        expect(container.querySelectorAll('.tp').length).toBe(0)

        wildflower.getComponent(c).state.v = 'two'
        await settle(100)
        expect(tgt.querySelector('.tp').textContent).toBe('two')
    })

    it('shown, hidden, shown: the copy leaves on hide and exactly one returns on reveal', async () => {
        const c = uname('c'); const tgt = portalTarget()
        mountToggle(c, `<div data-portal="#${tgt.id}"><span class="tp" data-bind="v"></span></div>`, { state: { v: 'one' } })
        await settle(150)
        expect(tgt.querySelectorAll('.tp').length).toBe(1)

        container.querySelector('.hide').click()
        await settle(120)
        expect(tgt.querySelectorAll('.tp').length).toBe(0)

        container.querySelector('.reveal').click()
        await settle(150)
        expect(tgt.querySelectorAll('.tp').length).toBe(1)
        expect(container.querySelectorAll('.tp').length).toBe(0)

        wildflower.getComponent(c).state.v = 'two'
        await settle(100)
        expect(tgt.querySelector('.tp').textContent).toBe('two')
    })
})

// ---------------------------------------------------------------------------
// C: compiled fast path against the two subsystems the snapshot feeds
// ---------------------------------------------------------------------------

poolsSuite('C1: data-pool on the compiled fast path', () => {
    const poolMarkup = (c, pool) => `<div data-component="${c}"><div data-pool="${pool}" data-key="id"><template><i class="e" data-bind="n"></i></template></div></div>`

    // The scanner's MutationObserver initializes appended components on its
    // own, so the second instance is appended only after the first settled
    // and its fingerprint is taken synchronously, before any scan reaches it.
    async function mountTwo(c, poolA, poolB) {
        const one = document.createElement('div')
        one.innerHTML = poolMarkup(c, poolA)
        container.appendChild(one)
        wildflower.component(c, { state: {} })
        wildflower.scan(one)
        await settle(100)
        const def = wildflower.componentDefinitions.get(c)
        const two = document.createElement('div')
        two.innerHTML = poolMarkup(c, poolB)
        container.appendChild(two)
        // Same pool name: the snapshot is reused. A different name must NOT
        // match, since the snapshot registers the container by pool path.
        if (internals) {
            const same = wildflower._generateDOMFingerprint(two.firstElementChild) === def._compiledBindings.fingerprint
            expect(same).toBe(poolA === poolB)
        }
        wildflower.scan(two)
        await settle(100)
        return { one, two }
    }

    it('C1a: same pool name in both instances: each container renders its own entities', async () => {
        const c = uname('c')
        const { one, two } = await mountTwo(c, 'a', 'a')
        const comps = wildflower.getComponentsByType(c)
        comps[1].context.getPool('a').add({ id: 1, n: 'second' })
        await frames()
        expect(two.querySelectorAll('.e').length).toBe(1)
        expect(two.querySelector('.e').textContent).toBe('second')
        expect(one.querySelectorAll('.e').length).toBe(0)
        comps[0].context.getPool('a').add({ id: 1, n: 'first' })
        await frames()
        expect(one.querySelectorAll('.e').length).toBe(1)
        expect(two.querySelectorAll('.e').length).toBe(1)
    })

    it('C1b: a different pool name in the second instance binds the container to the pool its markup names', async () => {
        const c = uname('c')
        // The fingerprint used to omit data-pool, so the compiled path was
        // taken and the second container was registered under pool "a"
        // (mountTwo asserts the fingerprints now differ).
        const { one, two } = await mountTwo(c, 'a', 'b')
        const comps = wildflower.getComponentsByType(c)
        comps[1].context.getPool('b').add({ id: 1, n: 'second' })
        await frames()
        expect(two.querySelectorAll('.e').length).toBe(1)
        expect(two.querySelector('.e').textContent).toBe('second')
        expect(one.querySelectorAll('.e').length).toBe(0)
    })
})

querySuite('C2: data-query list and record on the compiled fast path', () => {
    it('two instances bind one query with one fetch, both render, both follow a refresh', async () => {
        const q = uname('q'); const r = uname('r'); const c = uname('c')
        wildflower.query(q, { from: '/api/' + q, key: 'id' })
        wildflower.query(r, { from: '/api/' + r, key: 'id' })
        const markup = () => `
            <div data-component="${c}">
                <ul data-query="${q}"><template><li data-bind="name"></li></template></ul>
                <div data-query="${r}"><span class="rec" data-bind="name + '!'"></span></div>
            </div>
        `
        const one = document.createElement('div'); one.innerHTML = markup()
        const two = document.createElement('div'); two.innerHTML = markup()
        container.appendChild(one); container.appendChild(two)
        wildflower.component(c, { state: {} })
        wildflower.scan(one)
        await settle(150)
        const def = wildflower.componentDefinitions.get(c)
        if (internals) expect(def._compiledBindings).toBeTruthy()
        // Fingerprints are taken on the transformed markup; the second instance
        // is transformed by its own init before the comparison, so compare the
        // shape the first instance had at compile time.
        wildflower.scan(two)
        await settle(200)

        expect(callsTo(q)).toBe(1)
        expect(callsTo(r)).toBe(1)
        expect(one.querySelectorAll('li').length).toBe(1)
        expect(two.querySelectorAll('li').length).toBe(1)
        expect(one.querySelector('.rec').textContent).toBe('x!')
        expect(two.querySelector('.rec').textContent).toBe('x!')

        fetchData = [{ id: 1, name: 'y', active: true }, { id: 2, name: 'z', active: true }]
        await wildflower.getQuery(q).refresh()
        await wildflower.getQuery(r).refresh()
        await settle(150)
        expect(one.querySelectorAll('li').length).toBe(2)
        expect(two.querySelectorAll('li').length).toBe(2)
        expect(one.querySelector('.rec').textContent).toBe('y!')
        expect(two.querySelector('.rec').textContent).toBe('y!')
    })
})
