/**
 * A binding that calls a method on a value: data-bind="a.toFixed(2)",
 * data-show="form.isDirty()". The evaluator runs such a call, but the binding
 * was classified as an expression only when it held an operator, so
 * `(a * b).toFixed(2)` rendered and `a.toFixed(2)` was looked up as a
 * property path and rendered nothing, with no warning.
 *
 * What still cannot work gets a development warning (WF-522): a binding that
 * calls or names one of the component's methods, calls a computed, or names
 * a function without calling it.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))

describe('a binding that calls a method on a value', () => {
    let wildflower, host, n = 0, warnSpy

    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        n++
        warnSpy = vi.spyOn(console, 'warn')
        host = document.createElement('div')
        document.body.appendChild(host)
    })
    afterEach(() => {
        warnSpy.mockRestore()
        host.remove()
        wildflower.config({ forceCSPMode: false })
        if (wildflower._useCSPSafeEvaluation) wildflower._useCSPSafeEvaluation = false
    })

    const text = (id) => host.querySelector('#' + id).textContent
    const shown = (id) => host.querySelector('#' + id).style.display !== 'none'
    const warned = (code) => warnSpy.mock.calls.map((a) => a.map(String).join(' ')).filter((l) => l.includes(`[${code}]`))

    it('renders a call with no operator in it, as it does with one', async () => {
        const comp = `bmc-render-${n}`
        wildflower.component(comp, {
            state: { a: 2, b: 5, name: 'ab', list: [1, 2, 3], form: { name: 'y', initial: 'x', isDirty() { return this.name !== this.initial } } },
        })
        host.innerHTML = `<div data-component="${comp}">
            <span id="fixed" data-bind="a.toFixed(2)"></span>
            <span id="upper" data-bind="name.toUpperCase()"></span>
            <span id="join" data-bind='list.join(",")'></span>
            <span id="max" data-bind="Math.max(a, b)"></span>
            <span id="has" data-show="list.includes(2)">has</span>
            <span id="dirty" data-show="form.isDirty()">dirty</span>
        </div>`
        wildflower.scan()
        await settle()
        expect(text('fixed')).toBe('2.00')
        expect(text('upper')).toBe('AB')
        expect(text('join')).toBe('1,2,3')
        expect(text('max')).toBe('5')
        expect(shown('has')).toBe(true)
        // True only if the call ran: as a property path it read nothing.
        expect(shown('dirty')).toBe(true)
    })

    it('follows the state the called method reads', async () => {
        const comp = `bmc-live-${n}`
        wildflower.component(comp, {
            state: { a: 2, form: { name: 'x', initial: 'x', isDirty() { return this.name !== this.initial } } },
        })
        host.innerHTML = `<div data-component="${comp}">
            <span id="fixed" data-bind="a.toFixed(1)"></span>
            <span id="dirty" data-show="form.isDirty()">dirty</span>
            <b id="dirtyText" data-bind="form.isDirty()"></b>
        </div>`
        wildflower.scan()
        await settle()
        expect(text('fixed')).toBe('2.0')
        expect(shown('dirty')).toBe(false)
        expect(text('dirtyText')).toBe('false')
        const c = wildflower.getComponent(comp)
        c.a = 3
        c.form.name = 'y'
        await settle()
        expect(text('fixed')).toBe('3.0')
        expect(shown('dirty')).toBe(true)
        expect(text('dirtyText')).toBe('true')
    })

    it.skipIf(!hasFeature('lists'))('renders a call on a row field inside a list row', async () => {
        const comp = `bmc-row-${n}`
        wildflower.component(comp, { state: { rows: [{ id: 1, price: 1.5, name: 'pen' }, { id: 2, price: 20, name: 'ink' }] } })
        host.innerHTML = `<div data-component="${comp}">
            <ul data-list="rows" data-key="id"><template><li>
                <span class="p" data-bind="price.toFixed(2)"></span><i class="n" data-bind="name.toUpperCase()"></i>
            </li></template></ul>
        </div>`
        wildflower.scan()
        await settle()
        expect([...host.querySelectorAll('.p')].map((e) => e.textContent)).toEqual(['1.50', '20.00'])
        expect([...host.querySelectorAll('.n')].map((e) => e.textContent)).toEqual(['PEN', 'INK'])
    })

    it('in CSP mode a call renders nothing, and development builds say the call was blocked', async () => {
        wildflower.config({ forceCSPMode: true })
        const comp = `bmc-csp-${n}`
        wildflower.component(comp, { state: { a: 2 } })
        host.innerHTML = `<div data-component="${comp}"><span id="fixed" data-bind="a.toFixed(2)"></span></div>`
        wildflower.scan()
        await settle()
        expect(text('fixed')).toBe('')
        if (!isMinifiedBuild()) {
            const lines = warnSpy.mock.calls.map((a) => a.map(String).join(' '))
            expect(lines.some((l) => l.includes('blocked call'))).toBe(true)
        }
    })

    it.skipIf(isMinifiedBuild())('warns WF-522, not WF-509, for a component method or computed in a binding', async () => {
        const comp = `bmc-warn-${n}`
        wildflower.component(comp, {
            state: { a: 2, form: { name: 'x', isDirty() { return true } } },
            computed: { dbl() { return this.a * 2 } },
            isTop() { return true },
        })
        host.innerHTML = `<div data-component="${comp}">
            <span data-bind="isTop()"></span>
            <span data-show="isTop">top</span>
            <span data-bind="dbl()"></span>
            <span data-bind="form.isDirty"></span>
        </div>`
        wildflower.scan()
        await settle()
        const hits = warned('WF-522').filter((l) => !l.includes('Docs:'))
        expect(hits.some((l) => l.includes('isTop()'))).toBe(true)
        expect(hits.some((l) => l.includes('"isTop"'))).toBe(true)
        expect(hits.some((l) => l.includes('dbl()'))).toBe(true)
        expect(hits.some((l) => l.includes('form.isDirty'))).toBe(true)
        expect(warned('WF-509').filter((l) => l.includes('isTop'))).toEqual([])
    })

    it.skipIf(isMinifiedBuild())('does not warn for calls on values, or for a computed named without a call', async () => {
        const comp = `bmc-quiet-${n}`
        wildflower.component(comp, {
            state: { a: 2, name: 'ab', form: { isDirty() { return true } } },
            computed: { dbl() { return this.a * 2 } },
        })
        host.innerHTML = `<div data-component="${comp}">
            <span data-bind="a.toFixed(2)"></span>
            <span data-bind="name.toUpperCase()"></span>
            <span data-show="form.isDirty()">d</span>
            <span data-bind="dbl"></span>
        </div>`
        wildflower.scan()
        await settle()
        expect(warned('WF-522')).toEqual([])
        expect(warned('WF-509')).toEqual([])
    })

    it.skipIf(isMinifiedBuild())('does not warn for a call on a computed that returns a function', async () => {
        const comp = `bmc-fn-${n}`
        wildflower.component(comp, {
            state: { price: 2 },
            computed: { formatter() { return (v) => '#' + v } },
        })
        host.innerHTML = `<div data-component="${comp}"><span id="fmt" data-bind="formatter(price)"></span></div>`
        wildflower.scan()
        await settle()
        expect(text('fmt')).toBe('#2')
        expect(warned('WF-522')).toEqual([])
    })

    it.skipIf(isMinifiedBuild())('a function named without a call: only data-bind is told it shows the source', async () => {
        const comp = `bmc-bare-${n}`
        wildflower.component(comp, { state: { form: { isDirty() { return true } } } })
        host.innerHTML = `<div data-component="${comp}">
            <span data-bind="form.isDirty"></span>
            <span data-show="form.isDirty">d</span>
        </div>`
        wildflower.scan()
        await settle()
        const hits = warned('WF-522').filter((l) => !l.includes('Docs:'))
        const forBind = hits.filter((l) => l.includes('data-bind="form.isDirty"'))
        const forShow = hits.filter((l) => l.includes('data-show="form.isDirty"'))
        expect(forBind.length).toBe(1)
        expect(forBind[0]).toContain('shows its source')
        expect(forShow.length).toBe(1)
        expect(forShow[0]).not.toContain('shows its source')
        expect(forShow[0]).toContain('form.isDirty()')
    })
})
