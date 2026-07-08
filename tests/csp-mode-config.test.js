/**
 * wildflower.config({ forceCSPMode: true }) must actually switch the
 * evaluator to CSP-safe mode at runtime.
 *
 * The docs (pages/docs/expressions.html "Forcing CSP-Safe Mode") present this
 * as the way to force CSP mode when auto-detection fails — but config() only
 * merged the option object, while every evaluation site reads the
 * _useCSPSafeEvaluation snapshot computed once at construction. The
 * documented call was a silent no-op. Found 2026-07-04 while building the
 * strict-CSP demo page.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('forceCSPMode via wildflower.config()', () => {
    let testContainer
    let cleanup

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        resetFramework()
        const c = createTestContainer({ visible: true })
        testContainer = c.container
        cleanup = c.cleanup
    })

    afterEach(() => {
        // Never leak forced CSP mode into other test files
        wildflower.config({ forceCSPMode: false })
        if (wildflower._useCSPSafeEvaluation) wildflower._useCSPSafeEvaluation = false
        if (cleanup) cleanup()
    })

    it('CSPM-A. config({forceCSPMode:true}) flips the live evaluation flag', () => {
        // Test env has no CSP, so auto-detection leaves the fast path active.
        expect(wildflower._useCSPSafeEvaluation).toBe(false)

        wildflower.config({ forceCSPMode: true })

        expect(wildflower.config().forceCSPMode).toBe(true)
        expect(wildflower._useCSPSafeEvaluation).toBe(true) // was the silent no-op
    })

    it('CSPM-B. expressions bound AFTER the switch evaluate through the CSP-safe path', async () => {
        wildflower.config({ forceCSPMode: true })

        wildflower.component('cspm-b', {
            state: { qty: 2, price: 10 }
        })
        testContainer.innerHTML = `
            <div data-component="cspm-b">
                <span id="cspmb-out" data-bind="qty * price + 1"></span>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()
        expect(testContainer.querySelector('#cspmb-out').textContent).toBe('21')

        const el = testContainer.querySelector('[data-component="cspm-b"]')
        const instance = wildflower.componentInstances.get(el.dataset.componentId)
        instance.state.qty = 5
        await waitForCompleteRender()
        expect(testContainer.querySelector('#cspmb-out').textContent).toBe('51')
    })
})
