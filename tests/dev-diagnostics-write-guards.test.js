/**
 * Imperative write-guard diagnostics:
 *
 *   - Assigning to a computed property is a guarded no-op: the value is
 *     unchanged and the dev build warns that computeds are read-only.
 *   - Writing a store path from inside its own onStoreUpdate notification
 *     is caught by the re-entrancy guard: the write lands but the nested
 *     notification is dropped (no infinite loop) and the dev build warns.
 *
 * __DEV__-gated output; skipped on min variants.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, waitForCompleteRender } from './helpers/load-framework.js'

function ensureComponentScanning(wildflower) {
    if (wildflower._setupDynamicComponentDetection) {
        wildflower._setupDynamicComponentDetection()
    }
}

describe.skipIf(isMinifiedBuild())('Dev-mode write-guard diagnostics', () => {
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
        console.warn = (...args) => { warnings.push(args.map(a => (a && a.nodeType) ? '<el>' : String(a)).join(' ')) }
    })

    afterEach(() => {
        console.warn = originalWarn
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    // ------------------------------------------------------------ firing cases

    it('warns on assignment to a computed property and keeps it computed', async () => {
        window.wildflower.component('wg-computed-set', {
            state: { n: 21 },
            computed: {
                double() { return this.n * 2 }
            },
            init() {
                this.double = 999
            }
        })
        testContainer.innerHTML = `
            <div data-component="wg-computed-set">
                <span data-bind="double"></span>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        const found = warnings.filter(w => w.includes('Cannot set computed property'))
        expect(found.length).toBe(1)
        expect(found[0]).toContain('[WF WF-220]')
        expect(found[0]).toContain('"double"')
        expect(found[0]).toContain('read-only')

        // The assignment was a no-op: the binding still shows the computed value.
        expect(testContainer.querySelector('span').textContent).toBe('42')
    })

    it('catches a re-entrant store write from onStoreUpdate without looping', async () => {
        window.wildflower.store('wg-reentrant-store', {
            state: { total: 0 }
        })
        window.wildflower.component('wg-reentrant-sub', {
            state: {},
            subscribe: { 'wg-reentrant-store': ['total'] },
            onStoreUpdate(storeName, path) {
                // Write back exactly once; an unguarded write-back could
                // ping-pong via deferred notifications regardless of the
                // sync re-entrancy guard under test.
                if (storeName === 'wg-reentrant-store' && path === 'total' && !this._reentered) {
                    this._reentered = true
                    window.wildflower.getStore('wg-reentrant-store').total += 1
                }
            }
        })
        testContainer.innerHTML = '<div data-component="wg-reentrant-sub"></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        window.wildflower.getStore('wg-reentrant-store').total = 10
        await waitForCompleteRender()

        const found = warnings.filter(w => w.includes('Re-entrant store update detected'))
        expect(found.length).toBeGreaterThanOrEqual(1)
        expect(found[0]).toContain('[WF WF-908]')
        expect(found[0]).toContain('wg-reentrant-store:total')

        // The guard dropped the nested notification; the test completing at
        // all pins the no-infinite-loop contract. The inner write landed.
        expect(window.wildflower.getStore('wg-reentrant-store').total).toBe(11)
    })

    // ----------------------------------------------------------- silence suite

    it('stays silent for normal state writes', async () => {
        window.wildflower.component('wg-normal-write', {
            state: { n: 1 },
            init() {
                this.n = 2
            }
        })
        testContainer.innerHTML = `
            <div data-component="wg-normal-write">
                <span data-bind="n"></span>
            </div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        expect(warnings.filter(w => w.includes('Cannot set computed') || w.includes('Re-entrant'))).toEqual([])
        expect(testContainer.querySelector('span').textContent).toBe('2')
    })
})
