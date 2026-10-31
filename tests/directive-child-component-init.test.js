/**
 * A custom directive on an element inside a child component belongs to the
 * child: init runs once per element, from the child; update follows the
 * child's state and never the parent's; destroy runs once when the element or
 * its component goes. The parent's own directive elements are the parent's.
 * A directive on the child's ROOT is written in the parent's markup, so it is
 * the parent's, as the value bindings on a root are, however the child
 * arrived (at load, in a section that turns on, appended, as a list row); a
 * top-level root's is the component's own.
 *
 * Before 2026-10-03 the parent's pass over its subtree reached into nested
 * components, so an element inside a child was initialized by both, and a
 * change to the parent's state updated it with the parent's value.
 *
 * Every shape is covered with directive elements in both components, in the
 * child only, and in the parent only (the child has none of its own).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const listsSuite = hasFeature('lists') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-dcc-${++seq}`
const settle = (ms = 100) => new Promise(r => setTimeout(r, ms))

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

// A fresh directive per test (registrations are global), recording every call
// against the element it was made for.
function track(dir) {
    const calls = { init: [], update: [], destroy: [] }
    wildflower.directive(dir, {
        init(el, value, ctx) { calls.init.push({ el, value: ctx.resolvedValue }) },
        update(el, newValue, oldValue) { calls.update.push({ el, newValue, oldValue }) },
        destroy(el) { calls.destroy.push({ el }) }
    })
    const count = (kind, el) => calls[kind].filter(c => c.el === el).length
    return { calls, count }
}

const SHAPES = [
    { name: 'directives in both', parent: true, child: true },
    { name: 'directives in the child only', parent: false, child: true },
    { name: 'directives in the parent only', parent: true, child: false }
]

const parentMark = (dir, shape) => (shape.parent ? `<span class="p" data-${dir}="label"></span>` : '')
const childMarkup = (c, dir, shape) =>
    `<div class="kid" data-component="${c}"><b>kid</b>${shape.child ? `<span class="c" data-${dir}="label"></span>` : ''}</div>`

function register(p, c, parentState = {}) {
    wildflower.component(p, { state: { label: 'p1', on: false, ...parentState } })
    wildflower.component(c, { state: { label: 'c1' } })
}

// Asserts, for whichever elements exist: one init each, from its own component.
function expectInitOnce(t, shape) {
    const p = container.querySelector('.p')
    const kids = container.querySelectorAll('.c')
    if (shape.parent) {
        expect(t.count('init', p)).toBe(1)
        expect(t.calls.init.find(c => c.el === p).value).toBe('p1')
    }
    if (shape.child) {
        expect(kids.length).toBeGreaterThan(0)
        for (const k of kids) {
            expect(t.count('init', k)).toBe(1)
            expect(t.calls.init.find(c => c.el === k).value).toBe('c1')
        }
    }
    const expected = (shape.parent ? 1 : 0) + (shape.child ? kids.length : 0)
    expect(t.calls.init.length).toBe(expected)
}

// The child's change updates the child's element only; the parent's change
// updates the parent's element only.
async function expectUpdatesFromOwner(t, shape, pName, cName) {
    const p = container.querySelector('.p')
    const k = container.querySelector('.c')
    wildflower.getComponent(cName).label = 'c2'
    await settle(80)
    if (shape.child) {
        expect(t.calls.update.filter(u => u.el === k).map(u => [u.newValue, u.oldValue])).toEqual([['c2', 'c1']])
    }
    if (shape.parent) expect(t.count('update', p)).toBe(0)

    wildflower.getComponent(pName).label = 'p2'
    await settle(80)
    if (shape.parent) {
        expect(t.calls.update.filter(u => u.el === p).map(u => [u.newValue, u.oldValue])).toEqual([['p2', 'p1']])
    }
    if (shape.child) expect(t.count('update', k)).toBe(1)
}

describe('a directive inside a static child component', () => {
    for (const shape of SHAPES) {
        it(`${shape.name}: init once each, updates from the owner, destroy once`, async () => {
            const p = uname('p'); const c = uname('c'); const dir = uname('dir')
            const t = track(dir)
            register(p, c)
            container.innerHTML = `<div class="parent" data-component="${p}">${parentMark(dir, shape)}${childMarkup(c, dir, shape)}</div>`
            wildflower.scan(container)
            await settle(150)
            expectInitOnce(t, shape)
            await expectUpdatesFromOwner(t, shape, p, c)

            // The child goes: its element is destroyed once, the parent's stays.
            const kidEl = container.querySelector('.kid')
            const k = container.querySelector('.c')
            const pEl = container.querySelector('.p')
            const kidId = kidEl.dataset.componentId
            kidEl.remove()
            wildflower.destroyComponent(kidId)
            await settle(80)
            if (shape.child) expect(t.count('destroy', k)).toBe(1)
            if (shape.parent) expect(t.count('destroy', pEl)).toBe(0)

            const parentEl = container.querySelector('.parent')
            const parentId = parentEl.dataset.componentId
            parentEl.remove()
            wildflower.destroyComponent(parentId)
            await settle(80)
            if (shape.parent) expect(t.count('destroy', pEl)).toBe(1)
            if (shape.child) expect(t.count('destroy', k)).toBe(1)
        })
    }

    it('destroying the parent destroys the child\'s element once and the parent\'s once', async () => {
        const p = uname('p'); const c = uname('c'); const dir = uname('dir')
        const t = track(dir)
        register(p, c)
        const shape = SHAPES[0]
        container.innerHTML = `<div class="parent" data-component="${p}">${parentMark(dir, shape)}${childMarkup(c, dir, shape)}</div>`
        wildflower.scan(container)
        await settle(150)
        expectInitOnce(t, shape)
        const pEl = container.querySelector('.p')
        const k = container.querySelector('.c')
        const parentEl = container.querySelector('.parent')
        const parentId = parentEl.dataset.componentId
        parentEl.remove()
        wildflower.destroyComponent(parentId)
        await settle(80)
        expect(t.count('destroy', pEl)).toBe(1)
        expect(t.count('destroy', k)).toBe(1)
    })

    it('a grandchild\'s element belongs to the grandchild only', async () => {
        const p = uname('p'); const c = uname('c'); const g = uname('g'); const dir = uname('dir')
        const t = track(dir)
        wildflower.component(p, { state: { label: 'p1' } })
        wildflower.component(c, { state: { label: 'c1' } })
        wildflower.component(g, { state: { label: 'g1' } })
        container.innerHTML = `<div data-component="${p}"><div data-component="${c}"><div class="gk" data-component="${g}"><i class="g" data-${dir}="label"></i></div></div></div>`
        wildflower.scan(container)
        await settle(150)
        const gEl = container.querySelector('.g')
        expect(t.count('init', gEl)).toBe(1)
        expect(t.calls.init[0].value).toBe('g1')
        wildflower.getComponent(p).label = 'p2'
        wildflower.getComponent(c).label = 'c2'
        await settle(80)
        expect(t.count('update', gEl)).toBe(0)
        wildflower.getComponent(g).label = 'g2'
        await settle(80)
        expect(t.calls.update.map(u => u.newValue)).toEqual(['g2'])
    })
})

describe('a directive on a child component\'s root', () => {
    // The tag is written in the parent's markup, so the directive on it reads
    // the parent, as the value bindings on a root do.
    for (const arrival of ['static', 'late', 'append']) {
        it(`${arrival}: the parent runs it, once, and updates it from the parent's state only`, async () => {
            const p = uname('p'); const c = uname('c'); const dir = uname('dir')
            const t = track(dir)
            register(p, c)
            const root = `<div class="r1" data-component="${c}" data-${dir}="label"></div>`
            if (arrival === 'static') {
                container.innerHTML = `<div class="parent" data-component="${p}">${root}</div>`
            } else if (arrival === 'late') {
                container.innerHTML = `<div class="parent" data-component="${p}"><section data-render="on">${root}</section></div>`
            } else {
                container.innerHTML = `<div class="parent" data-component="${p}"><div class="slot"></div></div>`
            }
            wildflower.scan(container)
            await settle(150)
            if (arrival === 'late') {
                expect(t.calls.init.length).toBe(0)
                wildflower.getComponent(p).on = true
                await settle(200)
            } else if (arrival === 'append') {
                container.querySelector('.slot').insertAdjacentHTML('beforeend', root)
                wildflower.scan(container)
                await settle(150)
            }
            const r1 = container.querySelector('.r1')
            expect(r1.dataset.componentId).toBeTruthy()
            expect(t.calls.init.map(x => [x.el.className, x.value])).toEqual([['r1', 'p1']])

            wildflower.getComponent(c).label = 'c2'
            await settle(80)
            expect(t.calls.update.length).toBe(0)
            wildflower.getComponent(p).label = 'p2'
            await settle(80)
            expect(t.calls.update.map(u => [u.el.className, u.newValue, u.oldValue])).toEqual([['r1', 'p2', 'p1']])

            // The child goes with its element: destroyed once.
            const kidId = r1.dataset.componentId
            r1.remove()
            wildflower.destroyComponent(kidId)
            await settle(80)
            expect(t.count('destroy', r1)).toBe(1)
            const parentEl = container.querySelector('.parent')
            const parentId = parentEl.dataset.componentId
            parentEl.remove()
            wildflower.destroyComponent(parentId)
            await settle(80)
            expect(t.count('destroy', r1)).toBe(1)
        })
    }

    it.skipIf(!hasFeature('portals'))('a root portaled into another component stays with the parent that moved it', async () => {
        const a = uname('a'); const p = uname('p'); const c = uname('c'); const dir = uname('dir'); const tgt = uname('tgt')
        const t = track(dir)
        wildflower.component(a, { state: { label: 'a1' } })
        register(p, c)
        container.innerHTML = `<div data-component="${a}"><div id="${tgt}"></div>
            <div class="parent" data-component="${p}"><div data-portal="#${tgt}"><div class="r1" data-component="${c}" data-${dir}="label"></div></div></div></div>`
        wildflower.scan(container)
        await settle(200)
        const r1 = container.querySelector('.r1')
        expect(r1.parentElement.id).toBe(tgt)
        expect(t.calls.init.map(x => x.value)).toEqual(['p1'])
        wildflower.getComponent(a).label = 'a2'
        wildflower.getComponent(c).label = 'c2'
        await settle(80)
        expect(t.calls.update.length).toBe(0)
        wildflower.getComponent(p).label = 'p2'
        await settle(80)
        expect(t.calls.update.map(u => u.newValue)).toEqual(['p2'])
    })

    it('a parent\'s directive left on a child root: destroyed once when the parent goes, after the root was removed', async () => {
        const p = uname('p'); const c = uname('c'); const dir = uname('dir')
        const t = track(dir)
        register(p, c)
        container.innerHTML = `<div class="parent" data-component="${p}"><div class="r1" data-component="${c}" data-${dir}="label"></div></div>`
        wildflower.scan(container)
        await settle(150)
        const r1 = container.querySelector('.r1')
        const warn = console.warn
        console.warn = () => {}
        try { wildflower.destroyComponent(r1.dataset.componentId) } finally { console.warn = warn }
        r1.remove()
        await settle(150)
        const parentEl = container.querySelector('.parent')
        const parentId = parentEl.dataset.componentId
        parentEl.remove()
        wildflower.destroyComponent(parentId)
        await settle(80)
        expect(t.count('destroy', r1)).toBe(1)
    })

    it('destroying only the child while its root stays keeps the parent\'s directive, until the parent goes', async () => {
        const p = uname('p'); const c = uname('c'); const dir = uname('dir')
        const t = track(dir)
        register(p, c)
        container.innerHTML = `<div class="parent" data-component="${p}"><div class="r1" data-component="${c}" data-${dir}="label"></div></div>`
        wildflower.scan(container)
        await settle(150)
        const r1 = container.querySelector('.r1')
        const warn = console.warn
        console.warn = () => {}
        try { wildflower.destroyComponent(r1.dataset.componentId) } finally { console.warn = warn }
        await settle(80)
        expect(t.count('destroy', r1)).toBe(0)
        // The next scan initializes the child again; the parent's directive is not run twice.
        wildflower.scan(container)
        await settle(150)
        expect(t.count('init', r1)).toBe(1)
        const parentEl = container.querySelector('.parent')
        const parentId = parentEl.dataset.componentId
        parentEl.remove()
        wildflower.destroyComponent(parentId)
        await settle(80)
        expect(t.count('destroy', r1)).toBe(1)
    })

    it('a top-level component\'s root is its own', async () => {
        const c = uname('c'); const dir = uname('dir')
        const t = track(dir)
        wildflower.component(c, { state: { label: 't1' } })
        container.innerHTML = `<div class="top" data-component="${c}" data-${dir}="label"></div>`
        wildflower.scan(container)
        await settle(150)
        expect(t.calls.init.map(x => x.value)).toEqual(['t1'])
        wildflower.getComponent(c).label = 't2'
        await settle(80)
        expect(t.calls.update.map(u => u.newValue)).toEqual(['t2'])
    })
})

describe('a directive inside a child appended after the parent mounted', () => {
    for (const shape of SHAPES) {
        it(`${shape.name}: init once each, updates from the owner, destroy once`, async () => {
            const p = uname('p'); const c = uname('c'); const dir = uname('dir')
            const t = track(dir)
            register(p, c)
            container.innerHTML = `<div class="parent" data-component="${p}">${parentMark(dir, shape)}<div class="slot"></div></div>`
            wildflower.scan(container)
            await settle(150)
            container.querySelector('.slot').insertAdjacentHTML('beforeend', childMarkup(c, dir, shape))
            wildflower.scan(container)
            await settle(150)
            expectInitOnce(t, shape)
            await expectUpdatesFromOwner(t, shape, p, c)

            const kidEl = container.querySelector('.kid')
            const k = container.querySelector('.c')
            const kidId = kidEl.dataset.componentId
            kidEl.remove()
            wildflower.destroyComponent(kidId)
            await settle(80)
            if (shape.child) expect(t.count('destroy', k)).toBe(1)
            if (shape.parent) expect(t.count('destroy', container.querySelector('.p'))).toBe(0)
        })
    }
})

describe('a directive inside a child in a data-render section that turns on', () => {
    for (const shape of SHAPES) {
        it(`${shape.name}: init once each, and once more after a hide and reveal`, async () => {
            const p = uname('p'); const c = uname('c'); const dir = uname('dir')
            const t = track(dir)
            register(p, c)
            container.innerHTML = `<div class="parent" data-component="${p}"><section data-render="on">${parentMark(dir, shape)}${childMarkup(c, dir, shape)}</section></div>`
            wildflower.scan(container)
            await settle(150)
            expect(t.calls.init.length).toBe(0)

            const parent = wildflower.getComponent(p)
            parent.on = true
            await settle(200)
            expectInitOnce(t, shape)
            await expectUpdatesFromOwner(t, shape, p, c)

            const before = t.calls.init.length
            parent.on = false
            await settle(150)
            expect(t.calls.destroy.length).toBe(before)
            parent.on = true
            await settle(200)
            expect(t.calls.init.length).toBe(before * 2)
            for (const el of container.querySelectorAll('.p, .c')) expect(t.count('init', el)).toBe(1)
        })
    }
})

listsSuite('a directive inside a child in a list row', () => {
    for (const shape of SHAPES) {
        it(`${shape.name}: init once each, updates from the owner, destroy once per removed row`, async () => {
            const p = uname('p'); const c = uname('c'); const dir = uname('dir')
            const t = track(dir)
            wildflower.component(p, { state: { label: 'p1', rows: [{ id: 1 }, { id: 2 }] } })
            wildflower.component(c, { state: { label: 'c1' } })
            container.innerHTML = `<div class="parent" data-component="${p}">${parentMark(dir, shape)}
                <ul data-list="rows" data-key="id"><template><li>${childMarkup(c, dir, shape)}</li></template></ul></div>`
            wildflower.scan(container)
            await settle(200)
            expect(container.querySelectorAll('.kid').length).toBe(2)
            expectInitOnce(t, shape)

            // The parent's change reaches only the parent's element.
            const parent = wildflower.getComponent(p)
            parent.label = 'p2'
            await settle(80)
            for (const k of container.querySelectorAll('.c')) expect(t.count('update', k)).toBe(0)
            if (shape.parent) expect(t.count('update', container.querySelector('.p'))).toBe(1)

            // A child's change reaches only its own element.
            const kids = wildflower.getComponents(c)
            expect(kids.length).toBe(2)
            kids[0].label = 'c2'
            await settle(80)
            if (shape.child) expect(t.calls.update.filter(u => u.newValue === 'c2').length).toBe(1)

            // A row added later: once.
            parent.rows.push({ id: 3 })
            await settle(200)
            expect(container.querySelectorAll('.kid').length).toBe(3)
            for (const el of container.querySelectorAll('.p, .c')) expect(t.count('init', el)).toBe(1)

            // A row removed: its element is destroyed once.
            const last = container.querySelectorAll('.c')[2]
            parent.rows.pop()
            await settle(200)
            if (shape.child) expect(t.count('destroy', last)).toBe(1)
            if (shape.parent) expect(t.count('destroy', container.querySelector('.p'))).toBe(0)
        })
    }

    it('a row that is a child\'s root: the list\'s component runs it, once, with the row\'s item', async () => {
        const p = uname('p'); const c = uname('c'); const dir = uname('dir')
        const t = track(dir)
        const ctxs = []
        wildflower.directive(dir + 'x', { init(el, value, ctx) { ctxs.push(ctx.listItem && ctx.listItem.id) } })
        wildflower.component(p, { state: { label: 'p1', rows: [{ id: 1 }, { id: 2 }] } })
        wildflower.component(c, { state: { label: 'c1' } })
        container.innerHTML = `<div data-component="${p}"><ul data-list="rows" data-key="id"><template>
            <li class="rr" data-component="${c}" data-${dir}="label" data-${dir}x="label"></li></template></ul></div>`
        wildflower.scan(container)
        await settle(200)
        const rows = container.querySelectorAll('.rr')
        expect(rows.length).toBe(2)
        for (const r of rows) expect(t.count('init', r)).toBe(1)
        expect(t.calls.init.map(x => x.value)).toEqual(['p1', 'p1'])
        expect(ctxs.sort()).toEqual([1, 2])
        for (const kid of wildflower.getComponents(c)) kid.label = 'c2'
        await settle(80)
        expect(t.calls.update.length).toBe(0)
        wildflower.getComponent(p).label = 'p2'
        await settle(80)
        expect(t.calls.update.map(u => u.newValue)).toEqual(['p2', 'p2'])
        // A removed row: destroyed once.
        const last = rows[1]
        wildflower.getComponent(p).rows.pop()
        await settle(200)
        expect(t.count('destroy', last)).toBe(1)
    })

    for (const n of [3, 13]) {
        it(`a child root inside a row (not the row root), ${n} rows: the list's component runs its directive once, static and pushed`, async () => {
            const p = uname('p'); const c = uname('c'); const dir = uname('dir')
            const t = track(dir)
            wildflower.component(p, { state: { label: 'p1', rows: Array.from({ length: n }, (_, i) => ({ id: i + 1 })) } })
            wildflower.component(c, { state: { label: 'c1' } })
            container.innerHTML = `<div data-component="${p}"><ul data-list="rows" data-key="id"><template>
                <li><div class="rk" data-component="${c}" data-${dir}="label"></div></li></template></ul></div>`
            wildflower.scan(container)
            await settle(250)
            let kids = [...container.querySelectorAll('.rk')]
            expect(kids.length).toBe(n)
            for (const k of kids) expect(t.count('init', k)).toBe(1)
            expect(t.calls.init.every(x => x.value === 'p1')).toBe(true)
            wildflower.getComponents(c).forEach(k => { k.label = 'c2' })
            await settle(100)
            expect(t.calls.update.length).toBe(0)
            wildflower.getComponent(p).label = 'p2'
            await settle(100)
            expect(t.calls.update.length).toBe(n)
            expect(t.calls.update.every(u => u.newValue === 'p2')).toBe(true)
            wildflower.getComponent(p).rows.push({ id: 99 })
            await settle(250)
            kids = [...container.querySelectorAll('.rk')]
            expect(kids.length).toBe(n + 1)
            for (const k of kids) expect(t.count('init', k)).toBe(1)
            expect(t.calls.init[n].value).toBe('p2')
            const last = kids[n]
            wildflower.getComponent(p).rows.pop()
            await settle(250)
            expect(t.count('destroy', last)).toBe(1)
        })
    }

    it('rows cleared and refilled 4 times: destroy runs for every removed row, and nothing removed is held', async () => {
        const p = uname('p'); const dir = uname('dir')
        const t = track(dir)
        const rows = () => [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }]
        wildflower.component(p, { state: { label: 'p1', rows: rows() } })
        container.innerHTML = `<div class="parent" data-component="${p}"><ul data-list="rows" data-key="id"><template>
            <li><b data-bind="name"></b><i class="d" data-${dir}="label"></i></li></template></ul></div>`
        wildflower.scan(container)
        await settle(200)
        const ctx = wildflower.getComponent(p)
        const instance = wildflower.componentInstances.get(container.querySelector('.parent').dataset.componentId)
        for (let cycle = 0; cycle < 4; cycle++) {
            ctx.rows = []
            await settle(120)
            ctx.rows = rows()
            await settle(120)
        }
        expect(container.querySelectorAll('.d').length).toBe(3)
        expect(t.calls.init.length).toBe(15)
        expect(t.calls.destroy.length).toBe(12)
        if (!isMinifiedBuild()) expect(instance._directiveEls.size).toBe(3)
        ctx.rows = []
        await settle(120)
        expect(t.calls.destroy.length).toBe(15)
        if (!isMinifiedBuild()) expect(instance._directiveEls.size).toBe(0)
    })

    it('a child in a nested list row: init once per element', async () => {
        const p = uname('p'); const c = uname('c'); const dir = uname('dir')
        const t = track(dir)
        wildflower.component(p, { state: { groups: [{ id: 'g0', kids: [{ id: 'a' }, { id: 'b' }] }, { id: 'g1', kids: [{ id: 'c' }] }] } })
        wildflower.component(c, { state: { label: 'c1' } })
        container.innerHTML = `<div data-component="${p}"><div data-list="groups" data-key="id"><template><section>
            <p data-list="kids" data-key="id"><template><span>${childMarkup(c, dir, SHAPES[1])}</span></template></p></section></template></div></div>`
        wildflower.scan(container)
        await settle(200)
        const ks = container.querySelectorAll('.c')
        expect(ks.length).toBe(3)
        for (const k of ks) expect(t.count('init', k)).toBe(1)
        expect(t.calls.init.length).toBe(3)
    })
})
