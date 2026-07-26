/**
 * A5/5b (DX diagnostics sweep): cross-bucket name collisions are visible at
 * creation time (unlike duplicate keys within ONE literal, which JS collapses
 * at parse time — lint territory). A method colliding with a state/computed
 * name leaves one of them unreachable; state-vs-computed resolves by the
 * documented precedence (computed wins), which is a trap when unintentional —
 * that one gets a soft warning naming the precedence.
 *
 * __DEV__-gated; skipped on min variants.
 * Plan: docs/future/DX_DIAGNOSTICS_SWEEP_2026-07-12.md (item A5).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, waitForCompleteRender } from './helpers/load-framework.js'

function ensureComponentScanning(wildflower) {
    if (wildflower._setupDynamicComponentDetection) {
        wildflower._setupDynamicComponentDetection()
    }
}

describe.skipIf(isMinifiedBuild())('Dev-mode cross-bucket name-collision warnings (A5)', () => {
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

    function collisionWarnings() {
        return warnings.filter(w => w.includes('collides with') || w.includes('defined in both state and computed'))
    }

    it('warns when a method name collides with a state field', async () => {
        window.wildflower.component('col-method-state', {
            state: { total: 0 },
            total() { return 42 }
        })
        testContainer.innerHTML = '<div data-component="col-method-state"></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        const found = collisionWarnings()
        expect(found.length).toBe(1)
        expect(found[0]).toContain("method 'total()'")
        expect(found[0]).toContain('state.total')
    })

    it('warns when a method name collides with a computed', async () => {
        window.wildflower.component('col-method-computed', {
            state: { a: 1 },
            computed: { sum() { return this.a } },
            sum() { return 0 }
        })
        testContainer.innerHTML = '<div data-component="col-method-computed"></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        const found = collisionWarnings()
        expect(found.length).toBe(1)
        expect(found[0]).toContain("computed 'sum'")
    })

    it('soft-warns on state vs computed, naming the precedence', () => {
        window.wildflower.store('col-state-computed', {
            state: { fullName: 'raw' },
            computed: { fullName() { return 'derived' } }
        })
        const found = collisionWarnings()
        expect(found.length).toBe(1)
        expect(found[0]).toContain('defined in both state and computed')
        expect(found[0]).toContain('computed wins')
        expect(found[0]).toContain('this.state.fullName')
    })

    it('stays silent for disjoint names', async () => {
        window.wildflower.component('col-good', {
            state: { count: 0 },
            computed: { double() { return this.count * 2 } },
            increment() { this.count++ }
        })
        testContainer.innerHTML = '<div data-component="col-good"></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        expect(collisionWarnings()).toEqual([])
    })
})
