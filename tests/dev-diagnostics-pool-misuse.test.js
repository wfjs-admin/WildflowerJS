/**
 * A7 (DX diagnostics sweep): pools use swap-with-last, index-unstable storage.
 * The index-dependent array methods are deliberately omitted from the handle;
 * in dev builds they exist as throwing stubs that explain why. Direct mutation
 * of pool.items (the raw array exposed for hot-loop iteration) silently
 * desyncs the entity registry — a one-comparison consistency assert at the
 * API entries catches it after the fact and attributes it clearly.
 *
 * __DEV__-gated; skipped on min variants. Requires the pools feature.
 * Plan: docs/future/DX_DIAGNOSTICS_SWEEP_2026-07-12.md (item A7).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature, waitForCompleteRender } from './helpers/load-framework.js'

function ensureComponentScanning(wildflower) {
    if (wildflower._setupDynamicComponentDetection) {
        wildflower._setupDynamicComponentDetection()
    }
}

describe.skipIf(isMinifiedBuild() || !hasFeature('pools'))('Dev-mode pool-misuse diagnostics (A7)', () => {
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

    async function makePool(name) {
        let pool = null
        window.wildflower.component(name, {
            state: {},
            pools: { items: {} },
            init() { pool = this.getPool('items') }
        })
        testContainer.innerHTML = `<div data-component="${name}"><div data-pool="items"><template><span data-bind="label"></span></template></div></div>`
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 50))
        return pool
    }

    it('throws an explanatory error for the omitted index-dependent methods', async () => {
        const pool = await makePool('pm-stubs')
        expect(pool).toBeTruthy()
        pool.add({ id: 1, label: 'a' })

        for (const m of ['splice', 'pop', 'indexOf', 'slice']) {
            expect(() => pool[m]()).toThrowError(/swap-with-last/)
        }
        expect(() => pool.splice(0, 1)).toThrowError(/remove\(key\)/)
    })

    it('detects direct pool.items mutation at the next API call', async () => {
        const pool = await makePool('pm-mutate')
        expect(pool).toBeTruthy()
        pool.add({ id: 1, label: 'a' })
        pool.add({ id: 2, label: 'b' })

        // The misuse: bypassing the API
        pool.items.push({ id: 99, label: 'smuggled' })

        // Next legitimate API call flags it
        pool.add({ id: 3, label: 'c' })
        const found = warnings.filter(w => w.includes('mutated directly'))
        expect(found.length).toBe(1)
        expect(found[0]).toContain('pool API')
    })

    it('stays silent for API-only usage (add/remove/iterate)', async () => {
        const pool = await makePool('pm-good')
        expect(pool).toBeTruthy()
        pool.add([{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 3, label: 'c' }])
        pool.remove(2)
        let count = 0
        pool.forEach(() => count++)
        pool.add({ id: 4, label: 'd' })

        expect(count).toBe(2)
        expect(warnings.filter(w => w.includes('mutated directly'))).toEqual([])
    })
})
