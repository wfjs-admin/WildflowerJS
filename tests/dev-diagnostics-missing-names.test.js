/**
 * Missing-name diagnostics: names declared in one place that never
 * register anywhere warn instead of silently doing nothing.
 *
 *   - subscribe: ['store'] naming a store that never registers reports
 *     the miss (console.error, dev builds) and init continues best-effort.
 *   - A polymorphic list item whose type has no matching template and no
 *     default warns naming the type.
 *
 * Companion receipts elsewhere: the missing-provider warn is pinned by
 * plugin-injection.test.js; configurable-template lookup misses are
 * pinned by configurable-templates.test.js.
 *
 * __DEV__-gated output; skipped on min variants.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature, waitForCompleteRender } from './helpers/load-framework.js'

function ensureComponentScanning(wildflower) {
    if (wildflower._setupDynamicComponentDetection) {
        wildflower._setupDynamicComponentDetection()
    }
}

describe.skipIf(isMinifiedBuild())('Dev-mode missing-name diagnostics', () => {
    let testContainer
    let warnings
    let errors
    let originalWarn
    let originalError

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        resetFramework()
        testContainer = document.createElement('div')
        document.body.appendChild(testContainer)
        warnings = []
        errors = []
        originalWarn = console.warn
        originalError = console.error
        console.warn = (...args) => { warnings.push(args.map(a => (a && a.nodeType) ? '<el>' : String(a)).join(' ')) }
        console.error = (...args) => { errors.push(args.map(a => (a && a.nodeType) ? '<el>' : String(a)).join(' ')) }
    })

    afterEach(() => {
        console.warn = originalWarn
        console.error = originalError
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    // ------------------------------------------------------------ firing cases

    it('reports a subscribe to a store that never registers, and init continues', async () => {
        window.wildflower.component('mn-ghost-sub', {
            state: { label: 'alive' },
            subscribe: ['mn-ghost-store']
        })
        testContainer.innerHTML = `
            <div data-component="mn-ghost-sub">
                <span data-bind="label"></span>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        const found = errors.filter(e => e.includes("subscribes to store 'mn-ghost-store'"))
        expect(found.length).toBe(1)
        expect(found[0]).toContain('[WF WF-909]')
        expect(found[0]).toContain('does not exist')

        // Best-effort init: the component still binds and renders.
        expect(testContainer.querySelector('span').textContent).toBe('alive')
    })

    it.skipIf(!hasFeature('lists'))('warns for a polymorphic item type with no template and no default', async () => {
        window.wildflower.component('mn-poly-miss', {
            state: { rows: [{ id: 1, kind: 'a', label: 'x' }, { id: 2, kind: 'mystery', label: 'y' }] }
        })
        testContainer.innerHTML = `
            <div data-component="mn-poly-miss">
                <div data-list="rows" data-key="id" data-template-key="kind">
                    <template data-type="a"><p class="a" data-bind="label"></p></template>
                </div>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        const found = warnings.filter(w => w.includes('No template for type'))
        expect(found.length).toBeGreaterThanOrEqual(1)
        expect(found[0]).toContain('mystery')

        // The unmatched type falls back to the first available template,
        // so both rows render with it; the warn is the only signal.
        expect(testContainer.querySelectorAll('p.a').length).toBe(2)
    })

    // ----------------------------------------------------------- silence suite

    it('stays silent when the subscribed store exists', async () => {
        window.wildflower.store('mn-real-store', {
            state: { count: 1 }
        })
        window.wildflower.component('mn-real-sub', {
            state: { label: 'ok' },
            subscribe: ['mn-real-store']
        })
        testContainer.innerHTML = `
            <div data-component="mn-real-sub">
                <span data-bind="label"></span>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        expect(errors.filter(e => e.includes('subscribes to store'))).toEqual([])
        expect(testContainer.querySelector('span').textContent).toBe('ok')
    })
})
