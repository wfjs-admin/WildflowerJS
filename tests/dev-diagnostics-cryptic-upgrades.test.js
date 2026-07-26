/**
 * A9 (DX diagnostics sweep): the loud-but-cryptic failures get corrections.
 * wildflower.createStore() and this.getStore() have never existed — in dev
 * builds they throw the correction instead of a bare "not a function"
 * (production keeps the plain TypeError; the stubs are dead-code-eliminated).
 *
 * A9c verification (ground truth for the docs table): store.state.value was
 * listed as an anti-pattern, but contexts DO carry .state — the assertion
 * below pins that both forms work, so the docs row is an idiom preference,
 * not a failure mode.
 *
 * __DEV__-gated; skipped on min variants.
 * Plan: docs/future/DX_DIAGNOSTICS_SWEEP_2026-07-12.md (item A9).
 */

import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, waitForCompleteRender } from './helpers/load-framework.js'

function ensureComponentScanning(wildflower) {
    if (wildflower._setupDynamicComponentDetection) {
        wildflower._setupDynamicComponentDetection()
    }
}

describe.skipIf(isMinifiedBuild())('Dev-mode cryptic-failure upgrades (A9)', () => {
    let testContainer

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        resetFramework()
        testContainer = document.createElement('div')
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    // A9a (createStore stub) was DROPPED per Chris 2026-07-12: the rename to
    // store() predates the public launch by three months, so no human or
    // model ever saw createStore as WildflowerJS API — a diagnostic for it
    // defends against an audience that cannot exist. The remaining tests pin
    // GROUND TRUTH for two anti-pattern-table rows the sweep falsified.

    it('A9b ground truth: this.getStore() EXISTS on component contexts (docs row was stale)', async () => {
        // The anti-pattern table claimed this.getStore is a mistake; the
        // context factory (ComponentLifecycle) provides it as a working
        // delegate to the global store registry. Pin the truth so the docs
        // correction (Phase C) has a test behind it.
        window.wildflower.store('cu-target', { state: { hello: 'yes' } })
        let got = null
        window.wildflower.component('cu-getstore', {
            state: {},
            init() { got = this.getStore('cu-target') }
        })
        testContainer.innerHTML = '<div data-component="cu-getstore"></div>'
        ensureComponentScanning(window.wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 30))

        expect(got).toBeTruthy()
        expect(got.hello).toBe('yes')
    })

    it('A9c ground truth: store.value and store.state.value BOTH work (idiom, not failure)', () => {
        window.wildflower.store('cu-shape', { state: { count: 7 } })
        const s = window.wildflower.getStore('cu-shape')
        expect(s.count).toBe(7)
        expect(s.state.count).toBe(7)
        s.count = 8
        expect(s.state.count).toBe(8)
    })
})
