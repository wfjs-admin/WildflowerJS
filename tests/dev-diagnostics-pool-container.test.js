/**
 * Sealing-the-graph row 3: a data-pool container whose pool is never declared
 * and never populated renders nothing forever and says nothing. Two shapes:
 *
 *  (a) WF-408 — the container's name doesn't match any pool in the component's
 *      declared pools block (near-certain typo). Deterministic at setup;
 *      warns immediately with a did-you-mean over the declared names.
 *  (b) WF-409 — the container is wired but nothing was ever added by the
 *      settle window (dev note; apps that populate on interaction can ignore).
 *
 * __DEV__-gated; skipped on min variants. Requires the pools feature.
 * Ledger: docs/future/paths_forward/03-sealing-the-graph.md (row 3).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature, waitForCompleteRender } from './helpers/load-framework.js'

function ensureComponentScanning(wildflower) {
    if (wildflower._setupDynamicComponentDetection) {
        wildflower._setupDynamicComponentDetection()
    }
}

describe.skipIf(isMinifiedBuild() || !hasFeature('pools'))('Dev-mode pool-container diagnostics (sealing row 3)', () => {
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
        // Shrink the settle window so the never-populated note is testable
        window.wildflower._devPoolSettleMs = 40
    })

    afterEach(() => {
        console.warn = originalWarn
        delete window.wildflower._devPoolSettleMs
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    function undeclaredWarnings(name) {
        return warnings.filter(w => w.includes('WF-408') && w.includes(`'${name}'`))
    }
    function neverPopulatedWarnings(name) {
        return warnings.filter(w => w.includes('WF-409') && w.includes(`'${name}'`))
    }

    // ------------------------------------------------- (a) undeclared / typo

    it('warns at setup when the container name misses the declared pools block, with did-you-mean', async () => {
        window.wildflower.component('pc-typo', {
            state: {},
            pools: { items: {} }
        })
        testContainer.innerHTML = '<div data-component="pc-typo"><div data-pool="itmes"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 20))

        const found = undeclaredWarnings('pc-typo')
        expect(found.length).toBe(1)
        expect(found[0]).toContain('itmes')
        // The suggestion interpolates the user's own declared pool name
        const all = warnings.join('\n')
        expect(all).toContain('data-pool="items"')
    })

    it('does not stack the never-populated note on top of the undeclared warning', async () => {
        window.wildflower.component('pc-typo-once', {
            state: {},
            pools: { rows: {} }
        })
        testContainer.innerHTML = '<div data-component="pc-typo-once"><div data-pool="rowz"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 120))

        expect(undeclaredWarnings('pc-typo-once').length).toBe(1)
        expect(warnings.filter(w => w.includes('WF-409') && w.includes('rowz'))).toEqual([])
    })

    it('stays silent when the container matches a declared pool that is populated', async () => {
        window.wildflower.component('pc-good', {
            state: {},
            pools: { items: {} },
            init() { this.getPool('items').add({ id: 1, label: 'a' }) }
        })
        testContainer.innerHTML = '<div data-component="pc-good"><div data-pool="items"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 120))

        expect(undeclaredWarnings('pc-good')).toEqual([])
        expect(neverPopulatedWarnings('items')).toEqual([])
    })

    it('stays silent for a markup-only pool (no pools block) populated programmatically', async () => {
        window.wildflower.component('pc-markup-only', {
            state: {},
            init() { this.getPool('sprites').add({ id: 1, label: 's' }) }
        })
        testContainer.innerHTML = '<div data-component="pc-markup-only"><div data-pool="sprites"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 120))

        expect(undeclaredWarnings('pc-markup-only')).toEqual([])
        expect(neverPopulatedWarnings('sprites')).toEqual([])
    })

    // ------------------------------------------------ (b) never populated

    it('notes a wired container that was never populated once the settle window passes', async () => {
        window.wildflower.component('pc-empty', {
            state: {},
            pools: { orbs: {} }
        })
        testContainer.innerHTML = '<div data-component="pc-empty"><div data-pool="orbs"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 150))

        const found = neverPopulatedWarnings('orbs')
        expect(found.length).toBe(1)
        expect(found[0]).toContain('pc-empty')
        // The suggestion interpolates the user's own pool name
        expect(warnings.join('\n')).toContain("getPool('orbs')")
    })

    it('stays silent when the pool was populated and later cleared', async () => {
        window.wildflower.component('pc-cleared', {
            state: {},
            pools: { dots: {} },
            init() {
                const p = this.getPool('dots')
                p.add({ id: 1, label: 'd' })
                p.clear()
            }
        })
        testContainer.innerHTML = '<div data-component="pc-cleared"><div data-pool="dots"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 150))

        expect(neverPopulatedWarnings('dots')).toEqual([])
    })

    it('stays silent when the component is torn down before the window elapses', async () => {
        // Wider window so the teardown below reliably happens inside it
        window.wildflower._devPoolSettleMs = 500
        window.wildflower.component('pc-teardown', {
            state: {},
            pools: { stars: {} }
        })
        testContainer.innerHTML = '<div data-component="pc-teardown"><div data-pool="stars"><template><span data-bind="label"></span></template></div></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        const el = testContainer.querySelector('[data-component="pc-teardown"]')
        const id = el.dataset.componentId
        el.remove()
        window.wildflower.destroyComponent(id)
        await new Promise(r => setTimeout(r, 650))

        expect(neverPopulatedWarnings('stars')).toEqual([])
    })
})
