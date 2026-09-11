/**
 * @vitest-environment browser
 *
 * Dev diagnostic WF-235: an item-level list computed (fn.length > 0) returned
 * a Promise. Async computeds live at component/store/plugin scope (v1.5); the
 * item-level machinery is per-row and does no async tracking, so a promise
 * there would mean one uncoordinated request per row and the promise object
 * binding as text. Dev builds warn once per (component, computed).
 *
 * __DEV__-gated; skipped on min variants.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

async function waitForUpdate(ms = 80) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe.skipIf(isMinifiedBuild())('Dev-mode item-level async computed diagnostic (WF-235)', () => {
    let testContainer
    let warnings
    let originalWarn
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        testContainer = document.createElement('div')
        document.body.appendChild(testContainer)
        warnings = []
        originalWarn = console.warn
        console.warn = (...args) => { warnings.push(args.join(' ')) }
    })

    afterEach(() => {
        console.warn = originalWarn
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    const wf235Warnings = () => warnings.filter(w => w.includes('[WF WF-235]'))

    it('warns when an item-level computed returns a thenable', async () => {
        wildflower.component('wf235-async-item', {
            state: { items: [{ id: 1, n: 1 }, { id: 2, n: 2 }] },
            computed: {
                rowLabel(item) {
                    return Promise.resolve('row ' + item.n)
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="wf235-async-item">
                <ul data-list="items" data-key="id">
                    <template><li data-bind="computed:rowLabel"></li></template>
                </ul>
            </div>
        `
        wildflower.scan(testContainer)
        await waitForUpdate()

        const hits = wf235Warnings()
        expect(hits.length).toBe(1) // deduped: once per (component, computed), not per row
        expect(hits[0]).toContain('rowLabel')
        expect(hits[0]).toContain('wf235-async-item')
    })

    it('stays silent for a synchronous item-level computed', async () => {
        wildflower.component('wf235-sync-item', {
            state: { items: [{ id: 1, n: 1 }, { id: 2, n: 2 }] },
            computed: {
                rowLabel(item) {
                    return 'row ' + item.n
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="wf235-sync-item">
                <ul data-list="items" data-key="id">
                    <template><li data-bind="computed:rowLabel"></li></template>
                </ul>
            </div>
        `
        wildflower.scan(testContainer)
        await waitForUpdate()

        expect(wf235Warnings().length).toBe(0)
        const rows = testContainer.querySelectorAll('li')
        expect(rows.length).toBe(2)
        expect(rows[0].textContent).toBe('row 1')
    })

    it('stays silent for a component-level async computed referenced in a row', async () => {
        wildflower.component('wf235-comp-async', {
            state: { items: [{ id: 1 }] },
            computed: {
                header() { return Promise.resolve('shared header') }
            }
        })

        testContainer.innerHTML = `
            <div data-component="wf235-comp-async">
                <span id="wf235-header" data-bind="header"></span>
                <ul data-list="items" data-key="id">
                    <template><li data-bind="computed:header"></li></template>
                </ul>
            </div>
        `
        wildflower.scan(testContainer)
        await waitForUpdate()

        expect(wf235Warnings().length).toBe(0)
    })
})
