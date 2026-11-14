/**
 * An object-form data-bind-class owns the classes it names from its first
 * write: a false key removes that class even when the markup carried it (a
 * server-rendered class, or a default written into the template). It kept the
 * class on the first write and removed it only after a toggle, so the same
 * false showed two ways. Classes the object does not name stay, as before.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 100) => new Promise(r => setTimeout(r, ms))
let seq = 0

describe('data-bind-class object form owns the classes it names', () => {
    let wildflower
    let container
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })
    afterEach(() => { if (container && container.parentNode) container.parentNode.removeChild(container) })

    const classes = (sel) => [...container.querySelector(sel).classList].sort().join(' ')

    it('a false key removes the class the markup carried, and toggles after', async () => {
        const c = `cbo-${++seq}`
        wildflower.component(c, { state: { on: false } })
        container.innerHTML = `<div data-component="${c}"><div class="x card on" data-bind-class="{ on: on }">c</div></div>`
        wildflower.scan(container)
        await settle()
        expect(classes('.x')).toBe('card x')
        const ctx = wildflower.getComponent(c)
        ctx.on = true; await settle()
        expect(classes('.x')).toBe('card on x')
        ctx.on = false; await settle()
        expect(classes('.x')).toBe('card x')
    })

    it('a true key keeps the class the markup carried', async () => {
        const c = `cbo-${++seq}`
        wildflower.component(c, { state: { on: true } })
        container.innerHTML = `<div data-component="${c}"><div class="x on" data-bind-class="{ on: on }">c</div></div>`
        wildflower.scan(container)
        await settle()
        expect(classes('.x')).toBe('on x')
    })

    it('a class the object does not name stays (control)', async () => {
        const c = `cbo-${++seq}`
        wildflower.component(c, { state: { on: false } })
        container.innerHTML = `<div data-component="${c}"><div class="x card" data-bind-class="{ on: on }">c</div></div>`
        wildflower.scan(container)
        await settle()
        expect(classes('.x')).toBe('card x')
    })

    it.skipIf(!hasFeature('lists'))('a list row: a false key removes the class the template carried', async () => {
        const c = `cbo-${++seq}`
        wildflower.component(c, { state: { items: [{ id: 1, on: false }, { id: 2, on: true }] } })
        container.innerHTML = `<div data-component="${c}"><ul data-list="items" data-key="id"><template><li class="x card on" data-bind-class="{ on: on }">r</li></template></ul></div>`
        wildflower.scan(container)
        await settle()
        const rows = () => [...container.querySelectorAll('li')].map(li => [...li.classList].sort().join(' '))
        expect(rows()).toEqual(['card x', 'card on x'])
        const ctx = wildflower.getComponent(c)
        ctx.items[0].on = true; await settle()
        ctx.items[1].on = false; await settle()
        expect(rows()).toEqual(['card on x', 'card x'])
        ctx.items.push({ id: 3, on: false }); await settle()
        expect(rows()).toEqual(['card on x', 'card x', 'card x'])
    })

    // In a row, an object binding that reads a store or a computed goes
    // through its own evaluator. It handed the writer a class string, so the
    // writer never learned which classes the object names.
    it.skipIf(!hasFeature('lists'))('a list row: a false key over a store, or a computed, removes the class the template carried', async () => {
        const c = `cbo-${++seq}`; const s = `cbostore${seq}`
        wildflower.store(s, { state: { on: false } })
        wildflower.component(c, {
            state: { items: [{ id: 1, hot: false }, { id: 2, hot: true }] },
            computed: { hotRow(item) { return item.hot } },
        })
        container.innerHTML = `<div data-component="${c}"><ul data-list="items" data-key="id"><template><li class="x">` +
            `<i class="st card on" data-bind-class="{ on: $${s}.on }">s</i><b class="cp card on" data-bind-class="{ on: hotRow }">c</b></li></template></ul></div>`
        wildflower.scan(container)
        await settle()
        const of = (sel) => [...container.querySelectorAll(sel)].map(el => [...el.classList].sort().join(' '))
        expect(of('.st')).toEqual(['card st', 'card st'])
        expect(of('.cp')).toEqual(['card cp', 'card cp on'])
        wildflower.getStore(s).on = true; await settle()
        expect(of('.st')).toEqual(['card on st', 'card on st'])
        wildflower.getStore(s).on = false; await settle()
        expect(of('.st')).toEqual(['card st', 'card st'])
    })

    it.skipIf(!hasFeature('ssr'))('server markup: a class the server rendered is removed when the client state says false', async () => {
        const c = `cbo-${++seq}`
        wildflower.component(c, { state: { on: false } })
        container.innerHTML = `<div data-component="${c}" data-ssr="true"><div class="x on" data-bind-class="{ on: on }">c</div></div>`
        wildflower.scan(container)
        await settle()
        expect(classes('.x')).toBe('x')
    })

    // A key may name several classes ({ 'a b': cond }): each is one class.
    // (classList threw on the whole key; with the key false the first write
    // threw, the component's effect stopped, and the bindings after it never
    // ran.)
    it('a key naming two classes toggles both, and the bindings after it keep working', async () => {
        const c = `cbo-${++seq}`
        wildflower.component(c, { state: { on: false, t: 'T1' } })
        container.innerHTML = `<div data-component="${c}"><div class="x card b" data-bind-class="{ 'a b': on }">c</div>` +
            `<i class="t" data-bind-attr="{ title: t }">i</i></div>`
        wildflower.scan(container)
        await settle()
        expect(classes('.x')).toBe('card x')
        expect(container.querySelector('.t').getAttribute('title')).toBe('T1')
        const ctx = wildflower.getComponent(c)
        ctx.on = true; ctx.t = 'T2'; await settle()
        expect(classes('.x')).toBe('a b card x')
        expect(container.querySelector('.t').getAttribute('title')).toBe('T2')
        ctx.on = false; await settle()
        expect(classes('.x')).toBe('card x')
    })

    it.skipIf(!hasFeature('lists'))('list rows: a key naming two classes renders every row', async () => {
        const c = `cbo-${++seq}`
        wildflower.component(c, { state: { items: [{ id: 1, on: false }, { id: 2, on: true }] } })
        container.innerHTML = `<div data-component="${c}"><ul data-list="items" data-key="id"><template><li class="x" data-bind-class="{ 'a b': on }">r</li></template></ul></div>`
        wildflower.scan(container)
        await settle()
        const rows = () => [...container.querySelectorAll('li')].map(li => [...li.classList].sort().join(' '))
        expect(rows()).toEqual(['x', 'a b x'])
        const ctx = wildflower.getComponent(c)
        ctx.items[0].on = true; await settle()
        ctx.items[1].on = false; await settle()
        expect(rows()).toEqual(['a b x', 'x'])
    })
})

describe('new WildflowerJS(root, null)', () => {
    beforeAll(async () => { await loadFramework() })
    it('constructs with null options, as with none', () => {
        const W = window.WildflowerJS
        expect(() => new W(document.createElement('div'), null)).not.toThrow()
        expect(() => new W(document.createElement('div'))).not.toThrow()
    })
})
