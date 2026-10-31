/**
 * data-model inside the rows of a list nested in a row writes to the item the
 * nested row renders: the store's item for data-list="$store.path", the
 * component's for a dotted path whose head the component declares
 * (data-list="settings.options", "computed:cfg.options"), and the row item's
 * own field for every other path (the pin). Text, checkbox and select inputs;
 * the data-bind beside the input follows, and a later write to the source
 * repaints the inputs.
 *
 * Before 2026-10-03 the write rebuilt a path through the outer row
 * (groups.0.$store.items.1), so a shared or component-read nested row wrote
 * nothing, or wrote a same-named field of the outer row item.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const listsSuite = hasFeature('lists') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-nlm-${++seq}`
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms))

let container
let wildflower

beforeAll(async () => {
    await loadFramework()
})

beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()
    container = document.createElement('div')
    document.body.appendChild(container)
})

afterEach(() => {
    if (container && container.parentNode) container.parentNode.removeChild(container)
    container = null
})

const ROW = `<li>
    <input class="t" type="text" data-model="name">
    <input class="k" type="checkbox" data-model="on">
    <select class="s" data-model="pick"><option value="x">x</option><option value="y">y</option></select>
    <span class="b" data-bind="name"></span>
</li>`

const opts = () => [
    { id: 1, name: 'a', on: false, pick: 'x' },
    { id: 2, name: 'b', on: false, pick: 'x' }
]

function markup(c, innerList) {
    return `<div data-component="${c}">
        <div data-list="groups" data-key="id"><template><section class="g">
            <ul data-list="${innerList}" data-key="id"><template>${ROW}</template></ul>
        </section></template></div>
    </div>`
}

const row = (g, i) => container.querySelectorAll('.g')[g].querySelectorAll('li')[i]

function type(el, value) {
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
}

function choose(el, value) {
    el.value = value
    el.dispatchEvent(new Event('change', { bubbles: true }))
}

// A nested list over one shared array: every group renders the same items,
// so a write from any group shows in all of them.
async function exerciseShared(source) {
    expect(container.querySelectorAll('.g').length).toBe(2)
    expect(row(0, 1).querySelector('.b').textContent).toBe('b')

    type(row(0, 1).querySelector('.t'), 'bb')
    await settle()
    expect(source()[1].name).toBe('bb')
    expect(source()[0].name).toBe('a')
    expect(row(0, 1).querySelector('.b').textContent).toBe('bb')
    expect(row(1, 1).querySelector('.b').textContent).toBe('bb')
    expect(row(1, 1).querySelector('.t').value).toBe('bb')

    row(1, 0).querySelector('.k').click()
    await settle()
    expect(source()[0].on).toBe(true)
    expect(source()[1].on).toBe(false)
    expect(row(0, 0).querySelector('.k').checked).toBe(true)

    choose(row(0, 0).querySelector('.s'), 'y')
    await settle()
    expect(source()[0].pick).toBe('y')
    expect(source()[1].pick).toBe('x')
    expect(row(1, 0).querySelector('.s').value).toBe('y')

    // A later write to the source repaints every group's inputs.
    source()[0].name = 'zz'
    source()[1].on = true
    source()[1].pick = 'y'
    await settle()
    expect(row(0, 0).querySelector('.t').value).toBe('zz')
    expect(row(1, 0).querySelector('.t').value).toBe('zz')
    expect(row(1, 0).querySelector('.b').textContent).toBe('zz')
    expect(row(0, 1).querySelector('.k').checked).toBe(true)
    expect(row(1, 1).querySelector('.s').value).toBe('y')
}

listsSuite('data-model in nested rows over a shared source', () => {
    it('$store.path: typing, a checkbox and a select write the store item', async () => {
        const s = uname('s'); const c = uname('c')
        wildflower.store(s, { state: { opts: opts() } })
        wildflower.component(c, { state: { groups: [{ id: 'g0' }, { id: 'g1' }] } })
        container.innerHTML = markup(c, `$${s}.opts`)
        wildflower.scan(container)
        await settle(200)
        await exerciseShared(() => wildflower.getStore(s).opts)
        // The outer row items were not written.
        const groups = wildflower.getComponent(c).groups
        expect(Object.keys(groups[0]).sort()).toEqual(['id'])
        expect(Object.keys(groups[1]).sort()).toEqual(['id'])
    })

    it('$store.path with outer rows from a store too', async () => {
        const s = uname('s'); const g = uname('g'); const c = uname('c')
        wildflower.store(s, { state: { opts: opts() } })
        wildflower.store(g, { state: { groups: [{ id: 'g0' }, { id: 'g1' }] } })
        wildflower.component(c, { state: {} })
        container.innerHTML = `<div data-component="${c}">
            <div data-list="$${g}.groups" data-key="id"><template><section class="g">
                <ul data-list="$${s}.opts" data-key="id"><template>${ROW}</template></ul>
            </section></template></div></div>`
        wildflower.scan(container)
        await settle(200)
        await exerciseShared(() => wildflower.getStore(s).opts)
    })
})

listsSuite('data-model in nested rows over a component-read dotted path', () => {
    it('settings.options: writes the component\'s item, never the row item\'s same-named field', async () => {
        const c = uname('c')
        wildflower.component(c, {
            state: {
                settings: { options: opts() },
                // Each outer row carries its own settings.options: the nested
                // list does not read it (the component declares settings).
                groups: [
                    { id: 'g0', settings: { options: [{ id: 1, name: 'decoy' }, { id: 2, name: 'decoy' }] } },
                    { id: 'g1', settings: { options: [{ id: 1, name: 'decoy' }, { id: 2, name: 'decoy' }] } }
                ]
            }
        })
        container.innerHTML = markup(c, 'settings.options')
        wildflower.scan(container)
        await settle(200)
        const ctx = wildflower.getComponent(c)
        await exerciseShared(() => ctx.settings.options)
        for (const g of ctx.groups) {
            expect(g.settings.options.map(o => o.name)).toEqual(['decoy', 'decoy'])
            expect(g.settings.options.every(o => o.on === undefined && o.pick === undefined)).toBe(true)
        }
    })

    it('computed:cfg.options (a computed returning the component\'s array): writes the component\'s item', async () => {
        const c = uname('c')
        wildflower.component(c, {
            state: { settings: { options: opts() }, groups: [{ id: 'g0' }, { id: 'g1' }] },
            computed: { cfg() { return { options: this.settings.options } } }
        })
        container.innerHTML = markup(c, 'computed:cfg.options')
        wildflower.scan(container)
        await settle(200)
        const ctx = wildflower.getComponent(c)
        await exerciseShared(() => ctx.settings.options)
    })

    it('cfg.options, the bare form of the same path', async () => {
        const c = uname('c')
        wildflower.component(c, {
            state: { settings: { options: opts() }, groups: [{ id: 'g0' }, { id: 'g1' }] },
            computed: { cfg() { return { options: this.settings.options } } }
        })
        container.innerHTML = markup(c, 'cfg.options')
        wildflower.scan(container)
        await settle(200)
        const ctx = wildflower.getComponent(c)
        await exerciseShared(() => ctx.settings.options)
    })
})

listsSuite('data-model in nested rows over the row item (pin)', () => {
    async function exerciseOwn(groupsOf) {
        type(row(1, 1).querySelector('.t'), 'g1b')
        await settle()
        expect(groupsOf()[1].kids[1].name).toBe('g1b')
        expect(groupsOf()[0].kids[1].name).toBe('b')
        expect(row(1, 1).querySelector('.b').textContent).toBe('g1b')
        expect(row(0, 1).querySelector('.b').textContent).toBe('b')

        row(0, 0).querySelector('.k').click()
        await settle()
        expect(groupsOf()[0].kids[0].on).toBe(true)
        expect(groupsOf()[1].kids[0].on).toBe(false)

        choose(row(1, 0).querySelector('.s'), 'y')
        await settle()
        expect(groupsOf()[1].kids[0].pick).toBe('y')
        expect(groupsOf()[0].kids[0].pick).toBe('x')

        groupsOf()[0].kids[1].name = 'later'
        await settle()
        expect(row(0, 1).querySelector('.t').value).toBe('later')
        expect(row(0, 1).querySelector('.b').textContent).toBe('later')
    }

    it('bare kids in rows of a state list', async () => {
        const c = uname('c')
        wildflower.component(c, { state: { groups: [{ id: 'g0', kids: opts() }, { id: 'g1', kids: opts() }] } })
        container.innerHTML = markup(c, 'kids')
        wildflower.scan(container)
        await settle(200)
        const ctx = wildflower.getComponent(c)
        await exerciseOwn(() => ctx.groups)
    })

    it('bare kids in rows of a store list', async () => {
        const g = uname('g'); const c = uname('c')
        wildflower.store(g, { state: { groups: [{ id: 'g0', kids: opts() }, { id: 'g1', kids: opts() }] } })
        wildflower.component(c, { state: {} })
        container.innerHTML = `<div data-component="${c}">
            <div data-list="$${g}.groups" data-key="id"><template><section class="g">
                <ul data-list="kids" data-key="id"><template>${ROW}</template></ul>
            </section></template></div></div>`
        wildflower.scan(container)
        await settle(200)
        await exerciseOwn(() => wildflower.getStore(g).groups)
    })

    it('a top-level list over the store: unchanged', async () => {
        const s = uname('s'); const c = uname('c')
        wildflower.store(s, { state: { opts: opts() } })
        wildflower.component(c, { state: {} })
        container.innerHTML = `<div data-component="${c}"><div class="g"><ul data-list="$${s}.opts" data-key="id"><template>${ROW}</template></ul></div></div>`
        wildflower.scan(container)
        await settle(200)
        type(row(0, 1).querySelector('.t'), 'top')
        await settle()
        expect(wildflower.getStore(s).opts[1].name).toBe('top')
        expect(row(0, 1).querySelector('.b').textContent).toBe('top')
    })
})
