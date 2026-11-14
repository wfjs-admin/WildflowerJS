/**
 * data-bind-class object keys that name several classes.
 *
 * Two keys may name the same class ({ 'font-bold text-red': error,
 * 'font-bold': selected, underline: link }). The writer collected the class
 * once per key that named it, and its unchanged-set check compared counts, so
 * a duplicate could hide a class that had dropped out: with all three true
 * and then link false, underline stayed on the element.
 *
 * The classes in a key may be separated by any whitespace, not only a space.
 * A key with a tab or a newline between its classes (built by a computed,
 * { [names]: on }) reached classList as one token: classList threw, the
 * component's effect stopped, and the bindings after it never ran. A pool
 * entity's class writer split on single spaces, so two spaces in a row gave an
 * empty token, which classList also refuses: the add() that rendered the
 * entity threw.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))
let seq = 0

const OVERLAP = `{ 'font-bold text-red': err, 'font-bold': sel, underline: link }`

describe('data-bind-class keys that share or separate classes', () => {
    let wildflower
    let container
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })
    afterEach(() => { if (container && container.parentNode) container.parentNode.removeChild(container) })

    // The framework's own classes (wf-show on portal content) are not the test's.
    const classes = (el) => [...el.classList].filter(c => c.indexOf('wf-') !== 0).sort().join(' ')
    const all = (sel) => [...container.querySelectorAll(sel)].map(classes)

    it('two keys naming one class: a third key turning false removes its class', async () => {
        const c = `cbk-${++seq}`
        wildflower.component(c, { state: { err: true, sel: true, link: true } })
        container.innerHTML = `<div data-component="${c}"><b class="t" data-bind-class="${OVERLAP}">x</b></div>`
        wildflower.scan(container)
        await settle()
        expect(all('.t')).toEqual(['font-bold t text-red underline'])
        const ctx = wildflower.getComponent(c)
        ctx.link = false; await settle()
        expect(all('.t')).toEqual(['font-bold t text-red'])
        ctx.err = false; await settle()
        expect(all('.t')).toEqual(['font-bold t'])
        ctx.sel = false; await settle()
        expect(all('.t')).toEqual(['t'])
    })

    it.skipIf(!hasFeature('lists'))('the same in a list row', async () => {
        const c = `cbk-${++seq}`
        wildflower.component(c, { state: { items: [{ id: 1, err: true, sel: true, link: true }] } })
        container.innerHTML = `<div data-component="${c}"><ul data-list="items" data-key="id"><template><li class="t" data-bind-class="${OVERLAP}">r</li></template></ul></div>`
        wildflower.scan(container)
        await settle()
        expect(all('li')).toEqual(['font-bold t text-red underline'])
        wildflower.getComponent(c).items[0].link = false; await settle()
        expect(all('li')).toEqual(['font-bold t text-red'])
    })

    it('the same on a child component\'s root (the binding reads the parent)', async () => {
        const p = `cbk-${++seq}`; const ch = `cbk-child-${seq}`
        wildflower.component(ch, { state: {} })
        wildflower.component(p, { state: { err: true, sel: true, link: true } })
        container.innerHTML = `<div data-component="${p}"><div class="t" data-component="${ch}" data-bind-class="${OVERLAP}">k</div></div>`
        wildflower.scan(container)
        await settle()
        expect(all('.t')).toEqual(['font-bold t text-red underline'])
        wildflower.getComponent(p).link = false; await settle()
        expect(all('.t')).toEqual(['font-bold t text-red'])
    })

    it.skipIf(!hasFeature('pools'))('the same on a pool entity', async () => {
        const c = `cbk-${++seq}`
        wildflower.component(c, { state: {}, pools: { dots: {} }, init() { this.pools.dots.add({ id: 1, err: true, sel: true, link: true }) } })
        container.innerHTML = `<div data-component="${c}"><div data-pool="dots" data-key="id"><template><i class="t" data-bind-class="${OVERLAP}">d</i></template></div></div>`
        wildflower.scan(container)
        await settle()
        expect(all('.t')).toEqual(['font-bold t text-red underline'])
        wildflower.getComponent(c).pools.dots.update(1, { link: false }); await settle()
        expect(all('.t')).toEqual(['font-bold t text-red'])
    })

    for (const [label, sep] of [['a tab', '\t'], ['a newline', '\n']]) {
        it(`a key with ${label} between its classes toggles both, and the bindings after it keep working`, async () => {
            const c = `cbk-${++seq}`
            wildflower.component(c, {
                state: { on: false, t: 'T1' },
                computed: { k() { return { ['a' + sep + 'b']: this.on } } },
            })
            container.innerHTML = `<div data-component="${c}"><b class="x a b" data-bind-class="k">c</b><i class="t" data-bind-attr="{ title: t }">i</i></div>`
            wildflower.scan(container)
            await settle()
            expect(all('.x')).toEqual(['x'])
            const ctx = wildflower.getComponent(c)
            ctx.on = true; ctx.t = 'T2'; await settle()
            expect(all('.x')).toEqual(['a b x'])
            expect(container.querySelector('.t').getAttribute('title')).toBe('T2')
            ctx.on = false; await settle()
            expect(all('.x')).toEqual(['x'])
        })
    }

    it.skipIf(!hasFeature('lists'))('a list row: a key with a tab between its classes renders every row', async () => {
        const c = `cbk-${++seq}`
        wildflower.component(c, {
            state: { items: [{ id: 1, on: false }, { id: 2, on: true }] },
            computed: { k(item) { return { ['a\tb']: item.on } } },
        })
        container.innerHTML = `<div data-component="${c}"><ul data-list="items" data-key="id"><template><li class="x" data-bind-class="k">r</li></template></ul></div>`
        wildflower.scan(container)
        await settle()
        expect(all('li')).toEqual(['x', 'a b x'])
    })

    // The same two rules for the other forms of the value: a class named
    // twice is one class, and whitespace of any kind separates classes.
    for (const [label, before, after] of [
        ['a string', 'x y', 'x x'],
        ['an array', ['x', 'y'], ['x', 'x']],
        ['an array entry naming two classes', ['x y'], ['x x']],
    ]) {
        it(`${label} that names a class twice drops the class that left`, async () => {
            const c = `cbk-${++seq}`
            wildflower.component(c, { state: { v: before, t: 'T1' } })
            container.innerHTML = `<div data-component="${c}"><b class="t" data-bind-class="v">x</b><i class="u" data-bind-attr="{ title: t }">i</i></div>`
            wildflower.scan(container)
            await settle()
            expect(all('.t')).toEqual(['t x y'])
            const ctx = wildflower.getComponent(c)
            ctx.v = after; ctx.t = 'T2'; await settle()
            expect(all('.t')).toEqual(['t x'])
            expect(container.querySelector('.u').getAttribute('title')).toBe('T2')
        })
    }

    it.skipIf(!hasFeature('pools'))('a pool entity: a class string with a leading space and two spaces renders the entity', async () => {
        const c = `cbk-${++seq}`
        wildflower.component(c, { state: {}, pools: { dots: {} }, init() { this.pools.dots.add({ id: 1, cls: ' a  b' }) } })
        container.innerHTML = `<div data-component="${c}"><div data-pool="dots" data-key="id"><template><i class="d" data-bind-class="cls">d</i></template></div></div>`
        wildflower.scan(container)
        await settle()
        expect(all('.d')).toEqual(['a b d'])
    })

    // The other writers of class names split them the same way.
    it('a root: class key that names two classes toggles both', async () => {
        const c = `cbk-${++seq}`
        wildflower.component(c, { state: { on: true, t: 'T1' }, root: { class: { 'a  b': 'on' } } })
        container.innerHTML = `<div class="t" data-component="${c}"><i class="u" data-bind="t"></i></div>`
        wildflower.scan(container)
        await settle()
        expect(all('.t')).toEqual(['a b t'])
        expect(container.querySelector('.u').textContent).toBe('T1')
        wildflower.getComponent(c).on = false; await settle()
        expect(all('.t')).toEqual(['t'])
    })

    it.skipIf(!hasFeature('portals'))('portal content: an array, and a key naming two classes', async () => {
        const c = `cbk-${++seq}`
        const tgt = document.createElement('div')
        tgt.id = `cbk-tgt-${seq}`
        document.body.appendChild(tgt)
        try {
            wildflower.component(c, { state: { v: ['x', 'y'], on: true } })
            container.innerHTML = `<div data-component="${c}"><div data-portal="#${tgt.id}"><b class="t" data-bind-class="v">p</b><i class="k" data-bind-class="{ 'a  b': on }">q</i></div></div>`
            wildflower.scan(container)
            await settle()
            expect(classes(tgt.querySelector('.t'))).toBe('t x y')
            expect(classes(tgt.querySelector('.k'))).toBe('a b k')
            const ctx = wildflower.getComponent(c)
            ctx.v = ['x', 'x']; ctx.on = false; await settle()
            expect(classes(tgt.querySelector('.t'))).toBe('t x')
            expect(classes(tgt.querySelector('.k'))).toBe('k')
        } finally { tgt.remove() }
    })

    it('this.$el().addClass and removeClass take classes separated by any whitespace', async () => {
        const c = `cbk-${++seq}`
        let threw = null
        wildflower.component(c, {
            state: {},
            init() {
                try {
                    this.$el('.t').addClass(' a  b\tc ')
                    this.$el('.t').removeClass('b \n c')
                } catch (e) { threw = e }
            },
        })
        container.innerHTML = `<div data-component="${c}"><b class="t">x</b></div>`
        wildflower.scan(container)
        await settle()
        expect(threw).toBe(null)
        expect(all('.t')).toEqual(['a t'])
    })

    for (const [label, key] of [['two spaces', 'a  b'], ['a tab', 'a\\tb']]) {
        it.skipIf(!hasFeature('pools'))(`a pool entity: a key with ${label} between its classes renders the entity`, async () => {
            const c = `cbk-${++seq}`
            wildflower.component(c, { state: {}, pools: { dots: {} }, init() { this.pools.dots.add({ id: 1, on: true }) } })
            container.innerHTML = `<div data-component="${c}"><div data-pool="dots" data-key="id"><template><i class="d" data-bind-class="{ '${key}': on }">d</i></template></div></div>`
            wildflower.scan(container)
            await settle()
            expect(all('.d')).toEqual(['a b d'])
        })
    }
})
