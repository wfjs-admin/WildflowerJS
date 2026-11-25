/**
 * A list row whose template is chosen by data-template-key follows the field.
 *
 * The row is made from the template its item names. When the item later
 * names another one, by a write to the field or by a new object under the
 * same key, the row is made again from that template. The rows around it
 * keep their elements.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, whenSettled } from './helpers/load-framework.js'

const describeIfLists = hasFeature('lists') ? describe : describe.skip
const settle = (ms = 60) => new Promise(r => setTimeout(r, ms))
let seq = 0

describeIfLists('data-template-key: a row follows its field', () => {
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

    const TEMPLATES = `
        <template data-type="note"><li class="row note"><b data-bind="label"></b></li></template>
        <template data-type="task"><li class="row task"><input type="checkbox"><b data-bind="label"></b></li></template>
        <template><li class="row other"><b data-bind="label"></b></li></template>`

    const mount = async (state, attrs = 'data-key="id"', extra = {}) => {
        const name = `tkf-${++seq}`
        let context
        wildflower.component(name, { state, ...extra, init() { context = this } })
        container.innerHTML = `<div data-component="${name}"><ul data-list="rows" ${attrs} data-template-key="kind">${TEMPLATES}</ul></div>`
        wildflower.scan(container)
        await whenSettled()
        await settle()
        return context
    }
    const rows = () => [...container.querySelectorAll('.row')]
    const shown = () => rows().map(row => `${row.classList.contains('note') ? 'note' : row.classList.contains('task') ? 'task' : 'other'}:${row.querySelector('b').textContent}`)
    const three = () => [{ id: 1, kind: 'note', label: 'a' }, { id: 2, kind: 'task', label: 'b' }, { id: 3, kind: 'note', label: 'c' }]

    it('a write to the field makes the row again from the other template', async () => {
        const context = await mount({ rows: three() })
        expect(shown()).toEqual(['note:a', 'task:b', 'note:c'])
        const before = rows()

        context.rows[0].kind = 'task'
        await whenSettled()
        expect(shown()).toEqual(['task:a', 'task:b', 'note:c'])
        const after = rows()
        expect(after[0]).not.toBe(before[0])
        expect(after[0].querySelector('input')).not.toBe(null)
        expect(after[1]).toBe(before[1])
        expect(after[2]).toBe(before[2])
    })

    it('a new object under the same key, of another kind, makes the row again', async () => {
        const context = await mount({ rows: three() })
        const before = rows()

        context.rows[1] = { id: 2, kind: 'note', label: 'b2' }
        await whenSettled()
        expect(shown()).toEqual(['note:a', 'note:b2', 'note:c'])
        const after = rows()
        expect(after[1]).not.toBe(before[1])
        expect(after[0]).toBe(before[0])
        expect(after[2]).toBe(before[2])
    })

    it('the whole array replaced by copies, one of another kind', async () => {
        const context = await mount({ rows: three() })
        const before = rows()

        context.rows = three().map(item => (item.id === 3 ? { ...item, kind: 'task' } : item))
        await whenSettled()
        expect(shown()).toEqual(['note:a', 'task:b', 'task:c'])
        const after = rows()
        expect(after[0]).toBe(before[0])
        expect(after[1]).toBe(before[1])
        expect(after[2]).not.toBe(before[2])
    })

    it('a new object under the same key, of the same kind, keeps the row and repaints it', async () => {
        const context = await mount({ rows: three() })
        const before = rows()

        context.rows[1] = { id: 2, kind: 'task', label: 'b2' }
        await whenSettled()
        expect(shown()).toEqual(['note:a', 'task:b2', 'note:c'])
        expect(rows()[1]).toBe(before[1])
    })

    it('a kind with no template of its own goes to the untyped template, and back', async () => {
        const context = await mount({ rows: three() })

        context.rows[0].kind = 'unknown'
        await whenSettled()
        expect(shown()).toEqual(['other:a', 'task:b', 'note:c'])

        context.rows[0].kind = 'note'
        await whenSettled()
        expect(shown()).toEqual(['note:a', 'task:b', 'note:c'])
    })

    it('the row made again is live: a later write to its text reaches it', async () => {
        const context = await mount({ rows: three() })

        context.rows[0].kind = 'task'
        await whenSettled()
        context.rows[0].label = 'a2'
        await whenSettled()
        expect(shown()).toEqual(['task:a2', 'task:b', 'note:c'])

        context.rows[0].kind = 'note'
        await whenSettled()
        context.rows[0].label = 'a3'
        await whenSettled()
        expect(shown()).toEqual(['note:a3', 'task:b', 'note:c'])
    })

    it('rows keyed by position (no id on the items)', async () => {
        const context = await mount({ rows: [{ kind: 'note', label: 'a' }, { kind: 'task', label: 'b' }] })
        expect(shown()).toEqual(['note:a', 'task:b'])

        context.rows[1].kind = 'note'
        await whenSettled()
        expect(shown()).toEqual(['note:a', 'note:b'])

        context.rows[0] = { kind: 'task', label: 'a2' }
        await whenSettled()
        expect(shown()).toEqual(['task:a2', 'note:b'])
    })

    it('a write to the field in the same turn as a dozen rows appended', async () => {
        const context = await mount({ rows: three() })

        context.rows[0].kind = 'task'
        for (let i = 4; i < 16; i++) context.rows.push({ id: i, kind: 'note', label: 'n' + i })
        await whenSettled()
        const all = shown()
        expect(all.length).toBe(15)
        expect(all.slice(0, 3)).toEqual(['task:a', 'task:b', 'note:c'])
    })

    it('a write to the field, then a swap and a removal around the row', async () => {
        const context = await mount({ rows: three() })

        context.rows[2].kind = 'task'
        await whenSettled()
        const held = context.rows[0]
        context.rows[0] = context.rows[2]
        context.rows[2] = held
        await whenSettled()
        expect(shown()).toEqual(['task:c', 'task:b', 'note:a'])

        context.rows.splice(1, 1)
        await whenSettled()
        expect(shown()).toEqual(['task:c', 'note:a'])

        context.rows[1].kind = 'task'
        await whenSettled()
        expect(shown()).toEqual(['task:c', 'task:a'])
    })
})
