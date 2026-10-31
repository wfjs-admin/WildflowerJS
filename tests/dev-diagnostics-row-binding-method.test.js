/**
 * WF-516: dev warning when a list-row binding names a component METHOD.
 * Bindings read state and computeds, never methods. Outside lists that
 * mistake gets WF-509; inside rows it rendered nothing with no warning at
 * all.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))
const wf516 = (spy) => spy.mock.calls.filter((args) => String(args[0]).includes('[WF-516]'))

describe('WF-516: a row binding that names a method', () => {
    let host, wildflower, warnSpy

    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        warnSpy = vi.spyOn(console, 'warn')
        host = document.createElement('div')
        document.body.appendChild(host)
    })
    afterEach(() => { warnSpy.mockRestore(); host.remove() })

    it.skipIf(isMinifiedBuild())('warns for a call, a bare name and an expression, once per method', async () => {
        wildflower.component('wf516-methods', {
            state: { cats: [{ name: 'A', n: 2 }, { name: 'B', n: 5 }], factor: 10 },
            fmt(v) { return '#' + v * this.factor },
            total(c) { return c.n * this.factor },
            isBig(v) { return v > 3 }
        })
        host.innerHTML = `
            <div data-component="wf516-methods">
                <div data-list="cats" data-key="name">
                    <template><div>
                        <span data-bind="fmt(n)"></span>
                        <span data-bind="total"></span>
                        <span data-show="isBig(n) && name">big</span>
                        <span data-bind="fmt(n)"></span>
                    </div></template>
                </div>
            </div>`
        wildflower.scan()
        await settle()
        const msgs = wf516(warnSpy).map((a) => a.join(' '))
        expect(msgs.length).toBe(3)                        // fmt once, total, isBig
        expect(msgs.some((m) => m.includes('"fmt"'))).toBe(true)
        expect(msgs.some((m) => m.includes('"total"'))).toBe(true)
        expect(msgs.some((m) => m.includes('"isBig"'))).toBe(true)
    })

    it('stays silent for state, computeds, item fields, string text and actions', async () => {
        wildflower.component('wf516-ok', {
            state: { cats: [{ name: 'Alpha', n: 2, label: 'x' }], factor: 3 },
            computed: {
                spent(c) { return c.n * 10 },
                heading() { return 'H' }
            },
            label() { return 'method named like a field' },
            remove() {},
            fmt() {}
        })
        host.innerHTML = `
            <div data-component="wf516-ok">
                <div data-list="cats" data-key="name">
                    <template><div>
                        <span data-bind="spent"></span>
                        <span data-bind="heading"></span>
                        <span data-bind="factor"></span>
                        <span data-bind="label"></span>
                        <span data-bind-attr="{ title: 'fmt this ' + name }"></span>
                        <button data-action="remove">x</button>
                    </div></template>
                </div>
            </div>`
        wildflower.scan()
        await settle()
        expect(wf516(warnSpy).length).toBe(0)
    })

    it('stays silent for an object key that shares a method\'s name', async () => {
        wildflower.component('wf516-key', {
            state: { cats: [{ name: 'A', isOpen: true }] },
            open() {}
        })
        host.innerHTML = `
            <div data-component="wf516-key">
                <ul data-list="cats" data-key="name">
                    <template><li data-bind-class="{ open: isOpen }" data-bind="name"></li></template>
                </ul>
            </div>`
        wildflower.scan()
        await settle()
        expect(host.querySelector('li').classList.contains('open')).toBe(true)
        expect(wf516(warnSpy).length).toBe(0)
    })

    it('stays silent for an item field named like a method when the list mounts empty', async () => {
        wildflower.component('wf516-empty', {
            state: { cats: [] },
            open() {}
        })
        host.innerHTML = `
            <div data-component="wf516-empty">
                <ul data-list="cats" data-key="name">
                    <template><li data-show="open" data-bind="name"></li></template>
                </ul>
            </div>`
        wildflower.scan()
        await settle()
        expect(wf516(warnSpy).length).toBe(0)
    })
})
