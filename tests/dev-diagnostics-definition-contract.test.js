/**
 * A1 (DX diagnostics sweep): entity definitions silently ignore unknown
 * non-function top-level keys — the classic mistake is state written at the
 * top level instead of inside `state: {}` (the value vanishes, bindings stay
 * dead, no error anywhere). validateEntityDefinition warns once per
 * definition for each ignored key, across all four entity kinds.
 *
 * The warning is __DEV__-gated and dead-code-eliminated in min builds, so
 * this suite skips on min variants (same pattern as binding-shape-warning).
 * Plan: docs/future/DX_DIAGNOSTICS_SWEEP_2026-07-12.md (item A1).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature, waitForCompleteRender } from './helpers/load-framework.js'

function ensureComponentScanning(wildflower) {
    if (wildflower._setupDynamicComponentDetection) {
        wildflower._setupDynamicComponentDetection()
    }
}

describe.skipIf(isMinifiedBuild())('Dev-mode definition-contract warnings (A1)', () => {
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

    function contractWarnings() {
        return warnings.filter(w => w.includes('is not part of the') && w.includes('it was ignored'))
    }

    // ------------------------------------------------------------- components

    it('warns when a component definition carries top-level state values', async () => {
        window.wildflower.component('contract-comp-bad', {
            items: [],                       // the classic mistake
            state: { label: 'x' }
        })
        testContainer.innerHTML = '<div data-component="contract-comp-bad"><span data-bind="label"></span></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        const found = contractWarnings()
        expect(found.length).toBe(1)
        expect(found[0]).toContain('[WF WF-219]')
        expect(found[0]).toContain("Component 'contract-comp-bad'")
        expect(found[0]).toContain("'items'")
        // The fix hint rides wfError's suggestion line, not the main line.
        expect(warnings.some(w => w.includes("state: {}"))).toBe(true)
    })

    it('warns only once per definition even with multiple instances', async () => {
        window.wildflower.component('contract-comp-once', {
            stray: 42,
            state: { label: 'x' }
        })
        testContainer.innerHTML = `
            <div data-component="contract-comp-once"><span data-bind="label"></span></div>
            <div data-component="contract-comp-once"><span data-bind="label"></span></div>
        `
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 50))

        expect(contractWarnings().length).toBe(1)
    })

    it('gives the methods-block hint for a methods:/actions: object', async () => {
        window.wildflower.component('contract-comp-methods', {
            state: { label: 'x' },
            methods: { go() {} }             // other frameworks' shape
        })
        testContainer.innerHTML = '<div data-component="contract-comp-methods"><span data-bind="label"></span></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        const found = contractWarnings()
        expect(found.length).toBe(1)
        // The fix hint rides wfError's suggestion line, not the main line.
        expect(warnings.some(w => w.includes("not in a 'methods' block"))).toBe(true)
    })

    it('stays silent for a valid component definition (incl. lifecycle fns and _-prefixed keys)', async () => {
        window.wildflower.component('contract-comp-good', {
            state: { label: 'x' },
            computed: { up() { return this.label.toUpperCase() } },
            watch: { label() {} },
            _stash: { anything: true },
            init() {},
            handleClick() {}
        })
        testContainer.innerHTML = '<div data-component="contract-comp-good"><span data-bind="label"></span></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()

        expect(contractWarnings()).toEqual([])
    })

    // ------------------------------------------------------------------ stores

    it('warns when a store definition carries top-level state values', () => {
        window.wildflower.store('contract-store-bad', {
            count: 0,                        // vanishes silently today
            increment() { this.count++ }
        })
        const found = contractWarnings()
        expect(found.length).toBe(1)
        expect(found[0]).toContain("Store 'contract-store-bad'")
        expect(found[0]).toContain("'count'")
    })

    it('stays silent for a valid store definition', () => {
        window.wildflower.store('contract-store-good', {
            state: { count: 0 },
            computed: { double() { return this.count * 2 } },
            storageKey: 'contract-store-good-v1',
            autoSave: false,
            increment() { this.count++ }
        })
        expect(contractWarnings()).toEqual([])
    })

    // ----------------------------------------------------------------- plugins

    it.skipIf(!hasFeature('plugins'))('allows the plugin methods block but warns on stray plugin keys', () => {
        window.wildflower.plugin({
            name: 'contract-plugin',
            state: {},
            methods: { ping() { return 'pong' } },   // legal for plugins
            config: { retries: 3 },                  // stray — ignored today
            install() {}
        })
        const found = contractWarnings()
        expect(found.length).toBe(1)
        expect(found[0]).toContain("Plugin 'contract-plugin'")
        expect(found[0]).toContain("'config'")
        expect(found.some(w => w.includes("'methods'"))).toBe(false)
    })

    // ------------------------------------------------------------ pool entities

    it.skipIf(!hasFeature('pools'))('warns on stray non-function keys in a pool entity block', async () => {
        window.wildflower.component('contract-pool-comp', {
            state: {},
            pools: {
                items: {
                    entity: {
                        hp: 100,             // belongs in entity.state
                        state: { alive: true },
                        kill() { this.alive = false }
                    }
                }
            },
            init() { this.getPool('items') }
        })
        testContainer.innerHTML = '<div data-component="contract-pool-comp"></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 50))

        const found = contractWarnings()
        expect(found.length).toBe(1)
        expect(found[0]).toContain('Pool entity')
        expect(found[0]).toContain("'hp'")
    })
})
