/**
 * What a list row holds besides its own bindings: nested lists, child
 * components, and a select whose options are a list.
 *
 * Each of these was set up once, when the row was created, from whatever the
 * item held at that moment:
 *
 * - a nested list was mounted only if the item already had the array, so an
 *   array assigned later never rendered, and a row replaced by a same-key
 *   object without the array kept the old rows for good;
 * - the row's nested lists were found by attribute across the whole row, so a
 *   child component's own list with the same name was rendered by the parent;
 * - a child component in a nested row was created while the outer row was
 *   still detached, and so had no parent and no props;
 * - a select was given its value before its options existed, and the browser
 *   then selected the first option;
 * - a child component's row prop kept the old item after a same-key replace.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))
const text = (el) => (el ? (el.textContent || '').trim() : null)
const describeIfLists = hasFeature('lists') ? describe : describe.skip

describeIfLists('list rows: nested lists, child components and select options', () => {
    let host, wildflower
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => { resetFramework(); host = document.createElement('div'); document.body.appendChild(host) })
    afterEach(() => host.remove())

    let n = 0
    const name = () => 'ncm' + (++n)
    const ctxOf = (c) => wildflower.componentInstances.get(host.querySelector(`[data-component="${c}"]`).dataset.componentId).context
    const mount = async (def, html, c = name()) => {
        wildflower.component(c, def)
        host.innerHTML = `<div data-component="${c}">${html}</div>`
        wildflower.scan()
        await settle(120)
        return ctxOf(c)
    }
    const NESTED = `<div class="L" data-list="rows" data-key="id"><template><div class="row"><p data-list="tags" data-key="id"><template><b data-bind="t"></b></template></p></div></template></div>`
    const rowsText = () => [...host.querySelectorAll('.L .row')].map((r) => [...r.querySelectorAll('b')].map(text))

    describe('a nested list whose array is not there when the row is created', () => {
        it('N01 renders when the array is assigned later', async () => {
            const ctx = await mount({ state: { rows: [{ id: 'a' }, { id: 'b', tags: [{ id: 't1', t: 'T1' }] }] } }, NESTED)
            expect(rowsText()).toEqual([[], ['T1']])
            ctx.rows[0].tags = [{ id: 't9', t: 'T9' }]; await settle(100)
            expect(rowsText()).toEqual([['T9'], ['T1']])
            ctx.rows[0].tags.push({ id: 't10', t: 'T10' }); await settle(100)
            expect(rowsText()).toEqual([['T9', 'T10'], ['T1']])
        })

        it('N02 the same for a null value, and for a row pushed later without the array', async () => {
            const ctx = await mount({ state: { rows: [{ id: 'a', tags: null }] } }, NESTED)
            ctx.rows.push({ id: 'b' }); await settle(100)
            ctx.rows[0].tags = [{ id: 't1', t: 'T1' }]
            ctx.rows[1].tags = [{ id: 't2', t: 'T2' }]; await settle(100)
            expect(rowsText()).toEqual([['T1'], ['T2']])
        })

        it('N18 a value that is not an array (an object, a number, a string) renders no rows, and an array assigned later renders', async () => {
            const ctx = await mount({ state: { rows: [{ id: 'a', tags: {} }, { id: 'b', tags: 3 }, { id: 'c', tags: 'xyz' }, { id: 'd', tags: { x: 1 } }] } }, NESTED)
            expect(rowsText()).toEqual([[], [], [], []])
            for (const row of ctx.rows) row.tags = [{ id: 't-' + row.id, t: 'T-' + row.id }]
            await settle(100)
            expect(rowsText()).toEqual([['T-a'], ['T-b'], ['T-c'], ['T-d']])
            // And an array replaced by a non-array empties the list without breaking it.
            ctx.rows[0].tags = 'oops'; await settle(100)
            ctx.rows[0].tags = [{ id: 't2', t: 'T2' }]; await settle(100)
            expect(rowsText()).toEqual([['T2'], ['T-b'], ['T-c'], ['T-d']])
        })

        it('N03 an array that goes away and comes back', async () => {
            const ctx = await mount({ state: { rows: [{ id: 'a', tags: [{ id: 't1', t: 'T1' }] }] } }, NESTED)
            ctx.rows[0].tags = undefined; await settle(100)
            expect(rowsText()).toEqual([[]])
            ctx.rows[0].tags = [{ id: 't5', t: 'T5' }]; await settle(100)
            expect(rowsText()).toEqual([['T5']])
        })
    })

    describe('a row replaced by another object with the same key', () => {
        it('N04 without the array: the old rows go, and a later assignment renders', async () => {
            const ctx = await mount({ state: { rows: [{ id: 'a', tags: [{ id: 't1', t: 'T1' }, { id: 't2', t: 'T2' }] }] } }, NESTED)
            expect(rowsText()).toEqual([['T1', 'T2']])
            ctx.rows = [{ id: 'a' }]; await settle(100)
            expect(rowsText()).toEqual([[]])
            ctx.rows[0].tags = [{ id: 't9', t: 'T9' }]; await settle(100)
            expect(rowsText()).toEqual([['T9']])
        })

        it('N05 with another array: its rows render, and an edit to the new object repaints', async () => {
            const ctx = await mount({ state: { rows: [{ id: 'a', tags: [{ id: 't1', t: 'T1' }] }] } }, NESTED)
            ctx.rows = [{ id: 'a', tags: [{ id: 't1', t: 'T1b' }, { id: 't3', t: 'T3' }] }]; await settle(100)
            expect(rowsText()).toEqual([['T1b', 'T3']])
            ctx.rows[0].tags[1].t = 'T3c'; await settle(100)
            expect(rowsText()).toEqual([['T1b', 'T3c']])
        })

        it('N06 a row that had no array, replaced by one that has it', async () => {
            const ctx = await mount({ state: { rows: [{ id: 'a' }] } }, NESTED)
            ctx.rows = [{ id: 'a', tags: [{ id: 't1', t: 'T1' }] }]; await settle(100)
            expect(rowsText()).toEqual([['T1']])
        })

        it('N07 a child component\'s row prop is the new object', async () => {
            const kid = name() + 'kid'
            const insts = []
            wildflower.component(kid, { props: { it: { type: 'object' } }, init() { insts.push(this) } })
            const ctx = await mount({ state: { rows: [{ id: 'a', label: 'old' }] } },
                `<div class="L" data-list="rows" data-key="id"><template><div><i data-component="${kid}" data-prop-it="."><u class="d" data-bind="props.it.label"></u></i></div></template></div>`)
            await settle(80)
            expect(insts.length).toBe(1)
            expect(text(host.querySelector('.d'))).toBe('old')
            ctx.rows = [{ id: 'a', label: 'new' }]; await settle(120)
            expect(insts.length).toBe(1)
            expect(insts[0].props.it.label).toBe('new')
            expect(text(host.querySelector('.d'))).toBe('new')
        })
    })

    describe('a child component in a row', () => {
        it('N08 its own list, named like one of the parent\'s nested lists, shows the child\'s data', async () => {
            const kid = name() + 'kid'
            wildflower.component(kid, { state: { tags: [{ id: 'k1', t: 'kid-1' }, { id: 'k2', t: 'kid-2' }] } })
            const ctx = await mount({ state: { rows: [{ id: 'a', tags: [{ id: 'p1', t: 'parent-a' }] }, { id: 'b', tags: [{ id: 'p2', t: 'parent-b' }] }] } },
                `<div class="L" data-list="rows" data-key="id"><template><div class="row">
                    <p class="own" data-list="tags" data-key="id"><template><b data-bind="t"></b></template></p>
                    <i data-component="${kid}"><p class="kids" data-list="tags" data-key="id"><template><b data-bind="t"></b></template></p></i>
                </div></template></div>`)
            await settle(120)
            const read = (cls) => [...host.querySelectorAll('.L .' + cls)].map((p) => [...p.querySelectorAll('b')].map(text))
            expect(read('own')).toEqual([['parent-a'], ['parent-b']])
            expect(read('kids')).toEqual([['kid-1', 'kid-2'], ['kid-1', 'kid-2']])
            // And they stay apart through a same-key replace and a parent edit.
            ctx.rows = [{ id: 'a', tags: [{ id: 'p9', t: 'parent-a2' }] }, { id: 'b', tags: [{ id: 'p2', t: 'parent-b' }] }]; await settle(120)
            expect(read('own')).toEqual([['parent-a2'], ['parent-b']])
            expect(read('kids')).toEqual([['kid-1', 'kid-2'], ['kid-1', 'kid-2']])
        })

        it('N09 in a nested row: it has its parent and its props when init() runs, on first render and in rows added later', async () => {
            const kid = name() + 'kid'
            const seen = []
            let destroyed = 0
            wildflower.component(kid, {
                props: { title: { type: 'string' }, it: { type: 'object' } },
                init() { seen.push([!!this.parent, this.props.title, this.props.it && this.props.it.id]) },
                destroy() { destroyed++ }
            })
            const ctx = await mount({ state: { title: 'host', groups: [{ id: 'g0', kids: [{ id: 'k0' }] }] } },
                `<div class="L" data-list="groups" data-key="id"><template><section><p data-list="kids" data-key="id"><template>
                    <span><i data-component="${kid}" data-prop-title="title" data-prop-it="."></i></span></template></p></section></template></div>`)
            await settle(100)
            expect(seen).toEqual([[true, 'host', 'k0']])
            ctx.groups[0].kids.push({ id: 'k1' }); await settle(120)
            ctx.groups.push({ id: 'g1', kids: [{ id: 'k2' }, { id: 'k3' }] }); await settle(120)
            expect(seen).toEqual([[true, 'host', 'k0'], [true, 'host', 'k1'], [true, 'host', 'k2'], [true, 'host', 'k3']])
            // One component per nested row, none made twice, all destroyed with the host.
            expect(host.querySelectorAll(`[data-component="${kid}"]`).length).toBe(4)
            ctx.groups.splice(0, 1); await settle(120)
            expect(destroyed).toBe(2)
        })

        it('N10 in a row that is itself a list, and three levels down', async () => {
            const kid = name() + 'kid'
            const seen = []
            wildflower.component(kid, { props: { it: { type: 'object' } }, init() { seen.push([!!this.parent, this.props.it && this.props.it.id]) } })
            await mount({ state: { a: [{ id: 'a0', b: [{ id: 'b0', c: [{ id: 'c0' }] }] }] } },
                `<div class="L" data-list="a" data-key="id"><template><div data-list="b" data-key="id"><template><div><p data-list="c" data-key="id"><template>
                    <span><i data-component="${kid}" data-prop-it="."></i></span></template></p></div></template></div></template></div>`)
            await settle(140)
            expect(seen).toEqual([[true, 'c0']])
        })
    })

    describe('a custom directive in a nested row', () => {
        it('N19 init runs once per element, on the outer row\'s elements and the nested rows\' alike, and destroy once each', async () => {
            const calls = { init: [], destroy: 0 }
            wildflower.directive('ncm-dir', {
                init: (el, value, ctx) => { calls.init.push([value, ctx.listIndex]) },
                destroy: () => { calls.destroy++ }
            })
            const ctx = await mount({ state: { groups: [{ id: 'g0', kids: [{ id: 'a' }, { id: 'b' }] }, { id: 'g1', kids: [{ id: 'c' }] }] } },
                `<div class="L" data-list="groups" data-key="id"><template><section><b data-ncm-dir="outer"></b>
                    <p data-list="kids" data-key="id"><template><span data-ncm-dir="inner"></span></template></p></section></template></div>`)
            await settle(60)
            expect(host.querySelectorAll('[data-ncm-dir]').length).toBe(5)
            expect(calls.init.slice().sort()).toEqual([['inner', 0], ['inner', 0], ['inner', 1], ['outer', 0], ['outer', 1]])
            // A nested row added later is initialized once too.
            ctx.groups[1].kids.push({ id: 'd' }); await settle(100)
            expect(calls.init.length).toBe(6)
            ctx.groups = []; await settle(120)
            expect(calls.destroy).toBe(6)
        })
    })

    describe('a select whose options are a list', () => {
        const OPT = '<template><option data-bind="name" data-bind-attr="{ value: id }"></option></template>'
        const opts = () => [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]
        const sel = (c) => host.querySelector('.' + c)

        it('N11 shows its model value: single, multiple, store options, options that arrive later', async () => {
            const s = name() + 's'
            wildflower.store(s, { state: { opts: opts() } })
            const ctx = await mount({ state: { choice: 'b', many: ['a', 'c'], opts: opts(), late: null, lateChoice: 'c' } },
                `<select class="one" data-list="opts" data-key="id" data-model="choice">${OPT}</select>
                 <select class="multi" multiple data-list="opts" data-key="id" data-model="many">${OPT}</select>
                 <select class="store" data-list="$${s}.opts" data-key="id" data-model="choice">${OPT}</select>
                 <select class="late" data-list="late" data-key="id" data-model="lateChoice">${OPT}</select>`)
            expect(sel('one').value).toBe('b')
            expect([...sel('multi').selectedOptions].map((o) => o.value)).toEqual(['a', 'c'])
            expect(sel('store').value).toBe('b')
            ctx.late = [{ id: 'a', name: 'A' }, { id: 'c', name: 'C' }]; await settle(100)
            expect(sel('late').value).toBe('c')
        })

        it('N12 a one-way data-bind on the select shows its value', async () => {
            const ctx = await mount({ state: { shown: 'c', opts: opts() } },
                `<select class="oneway" data-list="opts" data-key="id" data-bind="shown">${OPT}</select>`)
            expect(sel('oneway').options.length).toBe(3)
            expect(sel('oneway').value).toBe('c')
            ctx.shown = 'a'; await settle(60)
            expect(sel('oneway').value).toBe('a')
        })

        it('N13 options in an optgroup', async () => {
            await mount({ state: { choice: 'c', opts: opts() } },
                `<select class="grp" data-model="choice"><optgroup label="g" data-list="opts" data-key="id">${OPT}</optgroup></select>`)
            expect(sel('grp').value).toBe('c')
        })

        it('N14 a value with no option selects nothing, as a select with fixed options does, and is selected when its option arrives', async () => {
            const ctx = await mount({ state: { choice: 'z', opts: opts() } },
                `<select class="one" data-list="opts" data-key="id" data-model="choice">${OPT}</select>
                 <select class="fixed" data-model="choice"><option value="a">A</option><option value="b">B</option></select>`)
            expect(sel('fixed').selectedIndex).toBe(-1)
            expect(sel('one').selectedIndex).toBe(-1)
            ctx.opts.push({ id: 'z', name: 'Z' }); await settle(100)
            expect(sel('one').value).toBe('z')
            expect(ctx.choice).toBe('z')
        })

        it('N15 the selection holds when the options change: one added, the list replaced, emptied and refilled', async () => {
            const ctx = await mount({ state: { choice: 'b', opts: opts() } },
                `<select class="one" data-list="opts" data-key="id" data-model="choice">${OPT}</select>`)
            ctx.opts.unshift({ id: 'x', name: 'X' }); await settle(100)
            expect(sel('one').value).toBe('b')
            ctx.opts = [{ id: 'q', name: 'Q' }, { id: 'b', name: 'B2' }]; await settle(100)
            expect(sel('one').value).toBe('b')
            ctx.opts = []; await settle(100)
            ctx.opts = opts(); await settle(100)
            expect(sel('one').value).toBe('b')
            expect(ctx.choice).toBe('b')
        })

        it('N16 a choice the user made is kept when the options change afterwards', async () => {
            const ctx = await mount({ state: { choice: 'b', opts: opts() } },
                `<select class="one" data-list="opts" data-key="id" data-model="choice">${OPT}</select>`)
            const el = sel('one')
            el.focus()
            el.value = 'c'
            el.dispatchEvent(new Event('change', { bubbles: true }))
            await settle(60)
            expect(ctx.choice).toBe('c')
            ctx.opts.push({ id: 'd', name: 'D' }); await settle(100)
            expect(el.value).toBe('c')
            expect(ctx.choice).toBe('c')
        })

        it('N17 in a list row: options from a nested list and from a store', async () => {
            const s = name() + 's'
            wildflower.store(s, { state: { opts: opts() } })
            const ctx = await mount({ state: { rows: [{ id: 'r0', choice: 'b', opts: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }, { id: 'r1', choice: 'c', opts: [{ id: 'b', name: 'B' }, { id: 'c', name: 'C' }] }] } },
                `<div class="L" data-list="rows" data-key="id"><template><div>
                    <select class="nested" data-model="choice" data-list="opts" data-key="id">${OPT}</select>
                    <select class="store" data-model="choice" data-list="$${s}.opts" data-key="id">${OPT}</select>
                 </div></template></div>`)
            const read = (cls) => [...host.querySelectorAll('.' + cls)].map((x) => x.value)
            expect(read('nested')).toEqual(['b', 'c'])
            expect(read('store')).toEqual(['b', 'c'])
            ctx.rows[0].opts.unshift({ id: 'z', name: 'Z' }); await settle(100)
            expect(read('nested')).toEqual(['b', 'c'])
            // A same-key replace of the row with another choice.
            ctx.rows = [{ id: 'r0', choice: 'a', opts: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }, ctx.rows[1]]; await settle(120)
            expect(read('nested')).toEqual(['a', 'c'])
            expect(read('store')).toEqual(['a', 'c'])
        })
    })

    describe('what must not change', () => {
        it('K01 one list name at three levels: replace, edit and push', async () => {
            const tree = () => [{ id: 'n1', label: 'one', kids: [{ id: 'n2', label: 'two', kids: [{ id: 'n3', label: 'three', kids: [] }] }] }]
            const ctx = await mount({ state: { kids: tree() } },
                `<ul class="L" data-list="kids" data-key="id"><template><li><span class="l1" data-bind="label"></span>
                    <ul data-list="kids" data-key="id"><template><li><span class="l2" data-bind="label"></span>
                        <ul data-list="kids" data-key="id"><template><li><span class="l3" data-bind="label"></span></li></template></ul>
                    </li></template></ul>
                 </li></template></ul>`)
            const read = () => ['l1', 'l2', 'l3'].map((c) => [...host.querySelectorAll('.' + c)].map(text))
            expect(read()).toEqual([['one'], ['two'], ['three']])
            ctx.kids[0].kids[0].kids.push({ id: 'n4', label: 'four', kids: [] }); await settle(100)
            ctx.kids[0].kids[0].label = 'TWO'; await settle(100)
            expect(read()).toEqual([['one'], ['TWO'], ['three', 'four']])
            const next = tree(); next[0].kids[0].kids[0].label = 'THREE'
            ctx.kids = next; await settle(120)
            expect(read()).toEqual([['one'], ['two'], ['THREE']])
        })

        it('K02 nested rows through remove, insert and reverse of the outer list', async () => {
            const ctx = await mount({ state: { rows: [0, 1, 2].map((i) => ({ id: 'r' + i, tags: [{ id: 't' + i, t: 'T' + i }] })) } }, NESTED)
            ctx.rows.splice(1, 1); await settle(100)
            ctx.rows.unshift({ id: 'r9', tags: [{ id: 't9', t: 'T9' }] }); await settle(100)
            ctx.rows.reverse(); await settle(100)
            expect(rowsText()).toEqual([['T2'], ['T0'], ['T9']])
            ctx.rows[0].tags.push({ id: 'tx', t: 'TX' }); await settle(100)
            expect(rowsText()).toEqual([['T2', 'TX'], ['T0'], ['T9']])
        })

        it('K03 a child component\'s own list under another name, and a child component in a top-level row', async () => {
            const kid = name() + 'kid'
            const seen = []
            wildflower.component(kid, { props: { it: { type: 'object' } }, state: { own: [{ id: 'o1', t: 'own-1' }] }, init() { seen.push([!!this.parent, this.props.it && this.props.it.id]) } })
            await mount({ state: { rows: [{ id: 'a', tags: [{ id: 'p1', t: 'pa' }] }] } },
                `<div class="L" data-list="rows" data-key="id"><template><div class="row">
                    <p class="own" data-list="tags" data-key="id"><template><b data-bind="t"></b></template></p>
                    <i data-component="${kid}" data-prop-it="."><p class="kids" data-list="own" data-key="id"><template><b data-bind="t"></b></template></p></i>
                </div></template></div>`)
            await settle(120)
            expect([...host.querySelectorAll('.own b')].map(text)).toEqual(['pa'])
            expect([...host.querySelectorAll('.kids b')].map(text)).toEqual(['own-1'])
            expect(seen).toEqual([[true, 'a']])
        })
    })
})
