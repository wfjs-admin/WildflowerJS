/**
 * A6 (DX diagnostics sweep): calling destroyComponent while the component's
 * element is still in the document is the auto-resurrect trap — the next scan
 * re-inits a fresh instance. Warn on direct user calls only; framework-
 * internal teardown flows (list reconcile destroying nested components, child
 * recursion, GC sweeps, framework destroy()) route through the quiet wrapper
 * and stay silent.
 *
 * __DEV__-gated; skipped on min variants.
 * Plan: docs/future/DX_DIAGNOSTICS_SWEEP_2026-07-12.md (item A6).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature, waitForCompleteRender } from './helpers/load-framework.js'

function ensureComponentScanning(wildflower) {
    if (wildflower._setupDynamicComponentDetection) {
        wildflower._setupDynamicComponentDetection()
    }
}

describe.skipIf(isMinifiedBuild())('Dev-mode destroy/auto-resurrect warning (A6)', () => {
    let testContainer
    let warnings
    let originalWarn

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
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

    function resurrectWarnings() {
        return warnings.filter(w => w.includes('auto-resurrect'))
    }

    it('warns when destroyComponent is called with the element still connected', async () => {
        window.wildflower.component('dr-connected', { state: { label: 'x' } })
        testContainer.innerHTML = '<div data-component="dr-connected"><span data-bind="label"></span></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        const el = testContainer.querySelector('[data-component="dr-connected"]')
        const id = el.dataset.componentId
        expect(id).toBeTruthy()
        window.wildflower.destroyComponent(id)

        const found = resurrectWarnings()
        expect(found.length).toBe(1)
        expect(found[0]).toContain('[WF WF-106]')
        // The teardown fix rides wfError's suggestion line.
        expect(warnings.some(w => w.includes('element.remove()'))).toBe(true)
    })

    it('stays silent for the correct teardown (element removed first)', async () => {
        window.wildflower.component('dr-correct', { state: { label: 'x' } })
        testContainer.innerHTML = '<div data-component="dr-correct"><span data-bind="label"></span></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        const el = testContainer.querySelector('[data-component="dr-correct"]')
        const id = el.dataset.componentId
        el.remove()
        window.wildflower.destroyComponent(id)

        expect(resurrectWarnings()).toEqual([])
    })

    it.skipIf(!hasFeature('lists'))('stays silent during internal list churn destroying nested components', async () => {
        window.wildflower.component('dr-row-child', { state: { tag: 'c' } })
        window.wildflower.component('dr-list-host', {
            state: { rows: [{ id: 1 }, { id: 2 }, { id: 3 }] },
            clear() { this.state.rows = [] }
        })
        testContainer.innerHTML = `
            <div data-component="dr-list-host">
                <div data-list="rows" data-key="id">
                    <template><div><div data-component="dr-row-child"><i data-bind="tag"></i></div></div></template>
                </div>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 80))

        // Clearing the list destroys the nested row components internally
        // while their elements are still connected — must NOT warn.
        const host = testContainer.querySelector('[data-component="dr-list-host"]')
        const inst = window.wildflower.componentInstances.get(host.dataset.componentId)
        inst.context.clear()
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 80))

        expect(resurrectWarnings()).toEqual([])
    })

    it('stays silent for framework destroy() (bulk teardown)', async () => {
        window.wildflower.component('dr-bulk', { state: { label: 'x' } })
        testContainer.innerHTML = '<div data-component="dr-bulk"><span data-bind="label"></span></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        window.wildflower.destroy()

        expect(resurrectWarnings()).toEqual([])
    })
})
