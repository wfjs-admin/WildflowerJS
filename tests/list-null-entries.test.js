/**
 * A null or undefined entry in a list array renders an empty row.
 *
 * The row is made from the template with every binding empty, and the rows
 * after it render. The same holds when an entry becomes undefined later, in
 * a keyed list, and for a row's data-show, class and attribute bindings.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const describeIfLists = hasFeature('lists') ? describe : describe.skip
const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))
let seq = 0

describeIfLists('null and undefined entries in a list', () => {
    let wildflower
    let container

    beforeAll(async () => {
        await loadFramework()
        wildflower = window.wildflower
    })

    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
    })

    afterEach(() => {
        container.remove()
    })

    const mount = async (state, inner) => {
        const name = `lne-${++seq}`
        let ctx
        wildflower.component(name, { state, init() { ctx = this } })
        container.innerHTML = `<div data-component="${name}">${inner}</div>`
        wildflower.scan(container)
        await settle()
        return ctx
    }
    const texts = (sel) => [...container.querySelectorAll(sel)].map(e => e.textContent)

    it('primitives: the row for a null is empty and the rest render', async () => {
        await mount({ nums: [1, null, 3, undefined, 5] }, '<ul data-list="nums"><template><li class="n" data-bind="$item"></li></template></ul>')
        expect(texts('.n')).toEqual(['1', '', '3', '', '5'])
    })

    it('objects: the row for a null is empty and the rest render', async () => {
        await mount({ objs: [{ label: 'a' }, null, { label: 'c' }] }, '<ul data-list="objs"><template><li class="o"><b data-bind="label"></b></li></template></ul>')
        expect(texts('.o')).toEqual(['a', '', 'c'])
    })

    it('a keyed list', async () => {
        const ctx = await mount({ rows: [{ id: 1, label: 'a' }, null, { id: 3, label: 'c' }] }, '<ul data-list="rows" data-key="id"><template><li class="k"><b data-bind="label"></b></li></template></ul>')
        expect(texts('.k')).toEqual(['a', '', 'c'])
        ctx.rows.push({ id: 4, label: 'd' })
        await settle()
        expect(texts('.k')).toEqual(['a', '', 'c', 'd'])
    })

    it('a keyed list through replace, push, and splice', async () => {
        const row = (i) => ({ id: i, label: 'r' + i })
        const ctx = await mount({ rows: [] }, '<ul data-list="rows" data-key="id"><template><li class="k"><b data-bind="label"></b></li></template></ul>')
        ctx.rows = Array.from({ length: 40 }, (_, i) => (i % 10 === 3 ? null : row(i)))
        await settle()
        const expected = () => ctx.rows.map(r => (r ? r.label : ''))
        expect(texts('.k')).toEqual(expected())
        expect(texts('.k').filter(t => t === '').length).toBe(4)
        ctx.rows.push(null)
        ctx.rows.push(row(99))
        await settle()
        expect(texts('.k')).toEqual(expected())
        ctx.rows.splice(3, 1)
        await settle()
        expect(texts('.k')).toEqual(expected())
        expect(texts('.k').length).toBe(41)
        ctx.rows = ctx.rows.map(r => (r ? { ...r, label: r.label + '+' } : r))
        await settle()
        expect(texts('.k')).toEqual(expected())
        expect(texts('.k')[0]).toBe('r0+')
    })

    it('an entry written to undefined empties its row, and a later push still renders', async () => {
        const ctx = await mount({ later: [1, 2, 3] }, '<ul data-list="later"><template><li class="w" data-bind="$this"></li></template></ul>')
        ctx.later[1] = undefined
        await settle()
        expect(texts('.w')).toEqual(['1', '', '3'])
        ctx.later.push(4)
        await settle()
        expect(texts('.w')).toEqual(['1', '', '3', '4'])
    })

    it('a null entry replaced by an object shows the object', async () => {
        const ctx = await mount({ objs: [{ label: 'a' }, null] }, '<ul data-list="objs"><template><li class="o"><b data-bind="label"></b></li></template></ul>')
        ctx.objs[1] = { label: 'b' }
        await settle()
        expect(texts('.o')).toEqual(['a', 'b'])
    })

    it('show, class, attribute and expression bindings on a null row read nothing', async () => {
        await mount({ objs: [{ label: 'a', on: true }, null] }, `<ul data-list="objs"><template><li class="o" data-bind-class="on ? 'is-on' : 'is-off'">
            <b data-bind="label"></b><i class="s" data-show="on">s</i><u data-bind-attr="{ title: label }"></u><em data-bind="label + '!'"></em>
        </li></template></ul>`)
        const rows = [...container.querySelectorAll('.o')]
        expect(rows.length).toBe(2)
        expect(rows[1].querySelector('b').textContent).toBe('')
        expect(getComputedStyle(rows[1].querySelector('.s')).display).toBe('none')
        expect(rows[1].classList.contains('is-on')).toBe(false)
        expect(rows[1].querySelector('u').hasAttribute('title')).toBe(false)
    })
})
