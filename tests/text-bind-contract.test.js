/**
 * Convergence guard for the binding-kernel TEXT slice (applyText).
 *
 * The cold component / template / context text appliers had drifted between
 * `value ?? ''`, `value == null ? '' : value`, and `value == null ? '' : String(value)`.
 * They now route through BindingWriters.applyText, whose canonical normalization is
 * `null/undefined -> ''`, everything else `-> String(value)` (with a redundant-write
 * guard). These tests lock the two edges that distinguish that contract from the common
 * wrong alternatives:
 *   - null/undefined render as '' (not the literal "null"/"undefined")
 *   - 0 / false render as "0" / "false" (a `value || ''` style writer would blank them)
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('data-bind text contract (applyText)', () => {
    let testContainer
    let cleanup
    let ref

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        resetFramework()
        const c = createTestContainer({ visible: true })
        testContainer = c.container
        cleanup = c.cleanup
        ref = null
    })

    afterEach(() => {
        if (cleanup) cleanup()
    })

    it('renders null/undefined as empty string and 0/false as their string form', async () => {
        wildflower.component('tb-edges', {
            state: { val: 'hello' },
            init() { ref = this }
        })

        testContainer.innerHTML = `
            <div data-component="tb-edges">
                <span id="out" data-bind="val"></span>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const out = testContainer.querySelector('#out')
        expect(out.textContent).toBe('hello')

        // 0 must render as "0", not blank (rules out `value || ''`).
        ref.state.val = 0
        await waitForCompleteRender()
        expect(out.textContent).toBe('0')

        // false must render as "false", not blank.
        ref.state.val = false
        await waitForCompleteRender()
        expect(out.textContent).toBe('false')

        // null must render as '', not the literal "null".
        ref.state.val = null
        await waitForCompleteRender()
        expect(out.textContent).toBe('')

        // undefined must render as '', not the literal "undefined".
        ref.state.val = undefined
        await waitForCompleteRender()
        expect(out.textContent).toBe('')

        // back to a normal value
        ref.state.val = 'world'
        await waitForCompleteRender()
        expect(out.textContent).toBe('world')
    })
})
