/**
 * WF-237: dev warning when a list-row binding CALLS an item-level computed,
 * e.g. data-bind="spent(item) + 1". Inside a row the name `spent` resolves to
 * the computed's value for that row, so the call throws and the binding
 * renders nothing, silently. The fix is to name the computed
 * (data-bind="spent"), or wrap the arithmetic in another item-level computed.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))
const wf237 = (spy) => spy.mock.calls.filter((args) => String(args[0]).includes('[WF-237]'))

describe('WF-237: a row binding that calls an item-level computed', () => {
    let host, wildflower, warnSpy

    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        warnSpy = vi.spyOn(console, 'warn')
        host = document.createElement('div')
        document.body.appendChild(host)
    })
    afterEach(() => { warnSpy.mockRestore(); host.remove() })

    it.skipIf(isMinifiedBuild())('warns once, naming the computed, however many rows', async () => {
        wildflower.component('wf237-call', {
            state: { cats: [{ name: 'A', n: 2 }, { name: 'B', n: 5 }, { name: 'C', n: 1 }] },
            computed: { spent(c) { return c.n * 10 } }
        })
        host.innerHTML = `
            <div data-component="wf237-call">
                <div data-list="cats" data-key="name">
                    <template><div class="row"><span data-bind="spent(item) + 1"></span></div></template>
                </div>
            </div>`
        wildflower.scan()
        await settle()
        const calls = wf237(warnSpy)
        expect(calls.length).toBe(1)
        const msg = calls.map((a) => a.join(' ')).join(' ')
        expect(msg).toContain('spent')
        expect(msg).toContain('wf237-call')
    })

    it.skipIf(isMinifiedBuild())('covers attribute, class, style and show bindings too', async () => {
        wildflower.component('wf237-attr', {
            state: { cats: [{ name: 'A', n: 2 }] },
            computed: { over(c) { return c.n > 1 } }
        })
        host.innerHTML = `
            <div data-component="wf237-attr">
                <div data-list="cats" data-key="name">
                    <template><div data-show="over(item) && name"></div></template>
                </div>
            </div>`
        wildflower.scan()
        await settle()
        expect(wf237(warnSpy).length).toBe(1)
    })

    it('stays silent for the correct forms', async () => {
        wildflower.component('wf237-ok', {
            state: { cats: [{ name: 'Alpha', n: 2 }], factor: 3 },
            computed: {
                spent(c) { return c.n * 10 },
                label(c) { return 'L' + this.spent(c) }    // item -> item call: documented, fine
            },
            format(v) { return v }                        // a method, not a computed
        })
        host.innerHTML = `
            <div data-component="wf237-ok">
                <div data-list="cats" data-key="name">
                    <template><div>
                        <span class="s" data-bind="spent"></span>
                        <span data-bind="label"></span>
                        <span data-bind-attr="{ id: 'spent-' + name.toLowerCase() }"></span>
                    </div></template>
                </div>
            </div>`
        wildflower.scan()
        await settle()
        expect(wf237(warnSpy).length).toBe(0)
        expect(host.querySelector('.s').textContent).toBe('20')
    })
})
