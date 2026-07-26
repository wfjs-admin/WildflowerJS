/**
 * A2 (DX diagnostics sweep): a data-action wired to a lifecycle hook name
 * (tick, init, destroy, ...) is framework-driven, not event-driven — tick
 * fires every animation frame, lifecycle names bypass the pre-init action
 * queue. Warn at mount, once per (component, name), including handlers that
 * live inside <template> row markup.
 *
 * __DEV__-gated; skipped on min variants (same pattern as A1).
 * Plan: docs/future/DX_DIAGNOSTICS_SWEEP_2026-07-12.md (item A2).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, waitForCompleteRender } from './helpers/load-framework.js'

function ensureComponentScanning(wildflower) {
    if (wildflower._setupDynamicComponentDetection) {
        wildflower._setupDynamicComponentDetection()
    }
}

describe.skipIf(isMinifiedBuild())('Dev-mode lifecycle-name action warnings (A2)', () => {
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

    function lifecycleWarnings() {
        return warnings.filter(w => w.includes('targets the lifecycle hook'))
    }

    it('warns when data-action targets tick', async () => {
        window.wildflower.component('la-tick', {
            state: { label: 'x' },
            tick() {}
        })
        testContainer.innerHTML = '<div data-component="la-tick"><button data-action="tick">go</button><span data-bind="label"></span></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        const found = lifecycleWarnings()
        expect(found.length).toBe(1)
        expect(found[0]).toContain('[WF WF-604]')
        expect(found[0]).toContain("'tick'")
        expect(found[0]).toContain('every animation frame')
    })

    it('warns for lifecycle actions inside <template> row markup', async () => {
        window.wildflower.component('la-rows', {
            state: { rows: [{ id: 1, label: 'a' }] }
        })
        testContainer.innerHTML = `
            <div data-component="la-rows">
                <ul data-list="rows" data-key="id">
                    <template><li><a data-action="destroy" data-bind="label"></a></li></template>
                </ul>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        const found = lifecycleWarnings()
        expect(found.length).toBe(1)
        expect(found[0]).toContain("'destroy'")
        expect(found[0]).toContain('auto-resurrect')
    })

    it('parses event-prefixed and argument forms', async () => {
        window.wildflower.component('la-forms', {
            state: { label: 'x' }
        })
        testContainer.innerHTML = '<div data-component="la-forms"><input data-action="input:onUpdate change:handleChange"><span data-bind="label"></span></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        const found = lifecycleWarnings()
        expect(found.length).toBe(1)
        expect(found[0]).toContain("'onUpdate'")
    })

    it('warns once per (component, name) across instances', async () => {
        window.wildflower.component('la-once', {
            state: { label: 'x' },
            tick() {}
        })
        testContainer.innerHTML = `
            <div data-component="la-once"><button data-action="tick">a</button></div>
            <div data-component="la-once"><button data-action="tick">b</button></div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 50))

        expect(lifecycleWarnings().length).toBe(1)
    })

    it('stays silent for ordinary handler names (and lifecycle DEFINITIONS without action wiring)', async () => {
        window.wildflower.component('la-good', {
            state: { label: 'x' },
            init() {},
            tick() {},
            handleClick() {},
            step() {}
        })
        testContainer.innerHTML = '<div data-component="la-good"><button data-action="handleClick">a</button><a data-action="step(1)">b</a><span data-bind="label"></span></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        expect(lifecycleWarnings()).toEqual([])
    })
})
