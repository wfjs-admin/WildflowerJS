/**
 * Facades in written containers.
 *
 * Reading state hands back facade proxies, so the immutable idioms copy them
 * into the new container: this.items = this.items.filter(...),
 * [...this.items, x], items.map(i => ({ ...i, done })). The set trap unwraps
 * the assigned value AND the first two levels inside it on every write, in
 * every build, so those forms store plain objects and stay silent.
 *
 * WF-966 (dev builds) now covers only what that pass does not reach: a
 * facade three or more levels inside the written container. That is the
 * class behind the 2026-08-16 query-ingest freeze, at a depth a copy of
 * state rarely produces by accident.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

const devIt = isMinifiedBuild() ? it.skip : it

let seq = 0
const uname = (p) => `${p}-fir-${++seq}`

async function settle(ms = 60) {
    await new Promise(r => setTimeout(r, ms))
}

describe('Facades written inside containers: unwrapped two levels down, WF-966 beyond', () => {
    let container
    let wildflower
    let warnings
    let realWarn

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        warnings = []
        realWarn = console.warn
        console.warn = (...a) => { warnings.push(a.join(' ')) }
    })

    afterEach(() => {
        console.warn = realWarn
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    const wf966 = () => warnings.filter(w => w.includes('WF-966')).length
    const names = () => [...container.querySelectorAll('li')].map(li => li.textContent).join(',')

    it('spread and filter of a list store raw elements, render, and stay silent', async () => {
        const c = uname('c')
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-list="items" data-key="id"><template><li data-bind="name"></li></template></ul>
                <button data-action="append"></button>
                <button data-action="drop"></button>
                <button data-action="rename"></button>
            </div>
        `
        wildflower.component(c, {
            state: { items: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] },
            append() { this.items = [...this.items, { id: 3, name: 'c' }] },
            drop() { this.items = this.items.filter(i => i.id !== 1) },
            rename() { this.items[0].name = 'B' }
        })
        wildflower.scan(container)
        await settle()
        expect(names()).toBe('a,b')

        container.querySelector('[data-action="append"]').click()
        await settle(40)
        expect(names()).toBe('a,b,c')

        container.querySelector('[data-action="drop"]').click()
        await settle(40)
        expect(names()).toBe('b,c')

        // A field write on an element that survived two immutable writes still
        // reaches its binding: the element was stored raw, not as a facade.
        container.querySelector('[data-action="rename"]').click()
        await settle(40)
        expect(names()).toBe('B,c')

        expect(wf966(), 'first- and second-level facades are unwrapped, never warned').toBe(0)
    })

    it('a plain object holding a facade value stores it raw and stays reactive', async () => {
        const c = uname('c')
        container.innerHTML = `<div data-component="${c}"><span data-bind="wrap.inner.name"></span><button data-action="edit"></button></div>`
        wildflower.component(c, {
            state: { inner: { name: 'x' }, wrap: null },
            init() { this.wrap = { inner: this.inner } },
            edit() { this.inner.name = 'y' }
        })
        wildflower.scan(container)
        await settle()
        expect(container.querySelector('span').textContent).toBe('x')

        // The same raw object sits at both paths, so a write through one shows at the other.
        container.querySelector('[data-action="edit"]').click()
        await settle(40)
        expect(container.querySelector('span').textContent).toBe('y')
        expect(wf966()).toBe(0)
    })

    devIt('a facade three levels deep still draws WF-966; the toRaw form stays silent', async () => {
        const c = uname('c')
        container.innerHTML = `<div data-component="${c}"><button data-action="nest"></button><button data-action="nestClean"></button></div>`
        wildflower.component(c, {
            state: { inner: { name: 'x' }, nested: null },
            nest() { this.nested = { a: { b: { c: this.inner } } } },
            nestClean() { this.nested = { a: { b: { c: wildflower.toRaw(this.inner) } } } }
        })
        wildflower.scan(container)
        await settle()
        const before = wf966()

        container.querySelector('[data-action="nest"]').click()
        await settle(40)
        expect(wf966(), 'depth-3 facade draws WF-966').toBe(before + 1)

        container.querySelector('[data-action="nestClean"]').click()
        await settle(40)
        expect(wf966(), 'the unwrapped copy stays silent').toBe(before + 1)
    })
})
