/**
 * Repro: a class/expression list binding that reads a NESTED item prop which
 * no other binding co-reads should still react when that nested prop mutates.
 *
 * Hypothesis (the gap): the per-item effect's first-run dependency registration
 * (`touchExpressionVars`) touches only ROOT identifiers (`user`, `active`) for an
 * expression binding, never the full dotted path `user.active`. So the effect's
 * `_itemProps` lacks `user.active`, and a mutation to `rows[i].user.active` (whose
 * notification carries prop `"user.active"`) fails the exact-match check and the
 * effect never re-runs — the class goes stale.
 *
 * A sibling text binding on the SAME nested leaf masks the gap (the text binding
 * registers the full path via touchPath), which is why it only shows up when the
 * nested prop is read solely by an expression/class binding.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer, triggerAction,
} from '../packages/test-utils/index.js'

describe('Nested class-only item prop reactivity', () => {
    let testContainer
    let cleanup

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        resetFramework()
        const c = createTestContainer({ visible: true })
        testContainer = c.container
        cleanup = c.cleanup
    })

    afterEach(() => { if (cleanup) cleanup() })

    it('a class binding reading user.active (read by nothing else) reacts when user.active mutates', async () => {
        wildflower.component('dep-gap', {
            state: {
                rows: [
                    { id: 'a', label: 'A', user: { active: true } },
                    { id: 'b', label: 'B', user: { active: false } }
                ]
            },
            toggleFirst() { this.state.rows[0].user.active = !this.state.rows[0].user.active }
        })

        testContainer.innerHTML = `
            <div data-component="dep-gap">
                <button class="act" data-action="toggleFirst"></button>
                <div data-list="rows" data-key="id">
                    <template>
                        <div class="row">
                            <span class="label" data-bind="label"></span>
                            <span class="status" data-bind-class="user.active ? 'on' : 'off'"></span>
                        </div>
                    </template>
                </div>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const statuses = testContainer.querySelectorAll('.status')
        expect(statuses[0].classList.contains('on')).toBe(true)
        expect(statuses[0].classList.contains('off')).toBe(false)
        expect(statuses[1].classList.contains('off')).toBe(true)

        await triggerAction(testContainer.querySelector('.act'))
        await waitForCompleteRender()

        // user.active flipped to false — the class must re-evaluate to 'off'.
        expect(statuses[0].classList.contains('off')).toBe(true)
        expect(statuses[0].classList.contains('on')).toBe(false)
        // Row 1 untouched.
        expect(statuses[1].classList.contains('off')).toBe(true)
    })
})
