/**
 * data-bind-attr keeps a form control's live value in step with state.
 *
 * A browser stops following the `checked` or `value` attribute of a control
 * once the user has clicked or typed in it, and a <select> and a <textarea>
 * have no `value` attribute at all. So for `checked` and `value` on an
 * <input>, a <select> or a <textarea>, the binding sets the property as well
 * as the attribute, and the control goes on following state after the user
 * has touched it.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

let seq = 0
const uname = (p) => `${p}-bafc-${++seq}`
const settle = (ms = 120) => new Promise(r => setTimeout(r, ms))

describe('checked and value through data-bind-attr', () => {
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
        const name = uname('c')
        let ctx
        wildflower.component(name, { state, init() { ctx = this } })
        container.innerHTML = `<div data-component="${name}">${inner}</div>`
        wildflower.scan(container)
        await settle()
        return ctx
    }

    it('a checkbox follows state after the user has clicked it', async () => {
        const ctx = await mount({ on: false }, '<input class="box" type="checkbox" data-bind-attr="{ checked: on }">')
        const box = container.querySelector('.box')
        ctx.on = true
        await settle()
        expect(box.checked).toBe(true)
        box.click()
        expect(box.checked).toBe(false)
        ctx.on = false
        await settle()
        ctx.on = true
        await settle()
        expect(box.checked).toBe(true)
        expect(box.hasAttribute('checked')).toBe(true)
        ctx.on = false
        await settle()
        expect(box.checked).toBe(false)
        expect(box.hasAttribute('checked')).toBe(false)
    })

    it('a checkbox is checked for the values that leave the attribute on', async () => {
        const ctx = await mount({ v: 0 }, '<input class="box" type="checkbox" data-bind-attr="{ checked: v }">')
        const box = container.querySelector('.box')
        box.click()
        box.click()
        for (const [value, checked] of [[0, true], [null, false], ['', true], [false, false], [true, true], [undefined, false]]) {
            ctx.v = value
            await settle(60)
            expect([String(value), box.hasAttribute('checked'), box.checked]).toEqual([String(value), checked, checked])
        }
    })

    it('a text input follows state after the user has typed in it', async () => {
        const ctx = await mount({ text: 'one' }, '<input class="txt" type="text" data-bind-attr="{ value: text }">')
        const txt = container.querySelector('.txt')
        expect(txt.value).toBe('one')
        txt.value = 'typed by user'
        txt.dispatchEvent(new Event('input', { bubbles: true }))
        ctx.text = 'two'
        await settle()
        expect(txt.value).toBe('two')
        ctx.text = null
        await settle()
        expect(txt.value).toBe('')
    })

    it('a select and a textarea take their value from state', async () => {
        const ctx = await mount({ choice: 'b', note: 'n1' }, `
            <select class="sel" data-bind-attr="{ value: choice }"><option value="a">a</option><option value="b">b</option><option value="c">c</option></select>
            <textarea class="area" data-bind-attr="{ value: note }"></textarea>`)
        const sel = container.querySelector('.sel')
        const area = container.querySelector('.area')
        expect([sel.value, area.value]).toEqual(['b', 'n1'])
        sel.value = 'c'
        sel.dispatchEvent(new Event('change', { bubbles: true }))
        ctx.choice = 'a'
        ctx.note = 'n2'
        await settle()
        expect([sel.value, area.value]).toEqual(['a', 'n2'])
    })

    it('other elements and other attributes get the attribute only', async () => {
        const ctx = await mount({ v: 'x', t: 'tip' }, '<div class="plain" data-bind-attr="{ value: v, title: t }"></div><progress class="bar" max="10" data-bind-attr="{ value: 3 }"></progress>')
        const plain = container.querySelector('.plain')
        expect(plain.getAttribute('value')).toBe('x')
        expect('value' in plain && plain.value).toBe(false)
        expect(plain.getAttribute('title')).toBe('tip')
        expect(container.querySelector('.bar').value).toBe(3)
        ctx.v = 'y'
        await settle()
        expect(plain.getAttribute('value')).toBe('y')
    })

    it.skipIf(isMinifiedBuild())('a development build says that data-bind on a checkbox does not check it', async () => {
        const warnSpy = vi.spyOn(console, 'warn')
        try {
            await mount({ on: true }, '<input class="box" type="checkbox" data-bind="on"><input class="txt" type="text" data-bind="on">')
            const lines = warnSpy.mock.calls.map((a) => a.map(String).join(' '))
            expect(lines.filter((l) => l.includes('[WF-509]') && l.includes('on a checkbox')).length).toBe(1)
            expect(lines.some((l) => l.includes('data-model="on"'))).toBe(true)
        } finally {
            warnSpy.mockRestore()
        }
    })

    const itIfLists = hasFeature('lists') ? it : it.skip

    itIfLists('a checkbox in a list row follows its item after a click', async () => {
        const ctx = await mount({ rows: [{ id: 1, done: false }, { id: 2, done: true }] },
            '<ul data-list="rows" data-key="id"><template><li><input class="row-box" type="checkbox" data-bind-attr="{ checked: done }"></li></template></ul>')
        const boxes = () => [...container.querySelectorAll('.row-box')]
        expect(boxes().map(b => b.checked)).toEqual([false, true])
        boxes()[1].click()
        expect(boxes()[1].checked).toBe(false)
        ctx.rows[1].done = false
        await settle()
        ctx.rows[1].done = true
        ctx.rows[0].done = true
        await settle()
        expect(boxes().map(b => b.checked)).toEqual([true, true])
    })
})
