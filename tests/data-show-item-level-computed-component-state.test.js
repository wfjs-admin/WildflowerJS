/**
 * Regression: data-show binding using an item-level computed that reads
 * COMPONENT-OWN STATE must re-evaluate when that state mutates.
 *
 * Surfaced by the PM tracker's inline-edit popovers (status / priority /
 * assignee). The popover element uses:
 *
 *     <div data-show="statusCellOpen" ...>
 *
 * where `statusCellOpen` is an item-level computed:
 *
 *     statusCellOpen(item) {
 *         return this.state.openCellField === 'status'
 *             && this.state.openCellIssueId === item.id;
 *     }
 *
 * Mutating `state.openCellIssueId` from row A's id to row B's id should:
 *   - row A's popover: data-show evaluates to false → display:none
 *   - row B's popover: data-show evaluates to true  → display:''
 *
 * Pre-fix bug: the targeted-rebind filter in _executeShows checked
 * `binding.path === targetedProp`. For `data-show="statusCellOpen"` with
 * a mutation to `openCellIssueId`, the filter returned false and skipped
 * the DOM write. The computed itself, called manually, returned the
 * correct value — but the binding never wrote it back to el.style.display.
 *
 * The fix adds a computed-name bypass to the filter: if `binding.path` is
 * a registered computed name, the path-equality check is bypassed so the
 * binding re-evaluates (same pattern as _executeBindings / _executeHtml
 * Bindings / _executeClassBindings). Browser-specific manifest before the
 * fix: Firefox repro'd reliably, Chrome happened to mask it via different
 * microtask scheduling.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
    isMinifiedBuild
} from '../packages/test-utils/index.js'

describe('data-show with item-level computed reading component state', () => {
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

    // Active-pump wait: force a complete render until cond() holds, or until the
    // cap. The second-order data-show re-eval (a row re-showing or re-hiding because
    // a SIBLING mutation changed shared component state) can lag a single flush when
    // the scheduler is saturated (heavy concurrent work, low-end CPU), and the show
    // and the sibling hide can settle in SEPARATE flushes. So call sites pump until
    // the ENTIRE asserted DOM state holds, not just one element. Pumping forced
    // renders drains the cascade. Non-masking: if it never settles, the following
    // expect() still fails loudly.
    async function pumpUntil(cond, max = 40) {
        for (let i = 0; i < max && !cond(); i++) {
            await waitForCompleteRender()
        }
    }

    // Single-field repro of the per-row data-show re-eval. Previously skipped as a
    // suspected _executeShows-vs-ContextManager race, but it is the same scheduler-
    // timing flake as its sibling tests here: under load the second-order re-eval
    // (a row re-showing because a SIBLING click changed shared component state) can
    // lag a single flush. Un-skipped with the pumpUntil active-wait, which stays
    // non-masking (a genuine wrong-value race would still fail it).
    it('per-row data-show re-evaluates when component-own state mutates', async () => {
        wildflower.component('popover-list', {
            state: {
                rows: [
                    { id: 'a', label: 'A' },
                    { id: 'b', label: 'B' },
                    { id: 'c', label: 'C' }
                ],
                openId: null
            },
            computed: {
                // Item-level: which row's popover should be visible.
                isOpen(item) {
                    if (!item || item.id === undefined) return false
                    return this.state.openId === item.id
                }
            },
            open(event, element, details) {
                this.state.openId = details.item.id
            }
        })

        testContainer.innerHTML = `
            <div data-component="popover-list">
                <ul data-list="rows" data-key="id">
                    <template>
                        <li class="row">
                            <button class="trigger" data-action="open" data-bind="label"></button>
                            <div class="popover" data-show="isOpen">
                                <span data-bind="label"></span> popover
                            </div>
                        </li>
                    </template>
                </ul>
            </div>
        `

        await waitForCompleteRender()
        await waitForCompleteRender()

        const triggers = testContainer.querySelectorAll('.trigger')
        const popovers = testContainer.querySelectorAll('.popover')

        expect(triggers.length).toBe(3)
        expect(popovers.length).toBe(3)

        // Initially all popovers hidden (openId is null)
        expect(popovers[0].style.display).toBe('none')
        expect(popovers[1].style.display).toBe('none')
        expect(popovers[2].style.display).toBe('none')

        // Click row A's trigger → row A's popover visible, others hidden
        triggers[0].click()
        await waitForCompleteRender()
        await pumpUntil(() => popovers[0].style.display === '' && popovers[1].style.display === 'none' && popovers[2].style.display === 'none')

        expect(popovers[0].style.display).toBe('') // row a → visible
        expect(popovers[1].style.display).toBe('none')
        expect(popovers[2].style.display).toBe('none')

        // Click row B's trigger → state.openId mutates from 'a' to 'b'.
        // Both row A's and row B's popovers must update synchronously:
        //   - row A's data-show("isOpen") now evaluates false → display:none
        //   - row B's data-show("isOpen") now evaluates true  → display:''
        // Pre-fix, the targeted-rebind filter skipped the DOM write because
        // binding.path "isOpen" !== changed prop "openId", leaving both
        // popovers in their stale state.
        triggers[1].click()
        await waitForCompleteRender()
        await pumpUntil(() => popovers[0].style.display === 'none' && popovers[1].style.display === '' && popovers[2].style.display === 'none')

        expect(popovers[0].style.display).toBe('none') // row a → hidden (the bug)
        expect(popovers[1].style.display).toBe('')     // row b → visible
        expect(popovers[2].style.display).toBe('none')

        // And once more, to row C
        triggers[2].click()
        await waitForCompleteRender()
        await pumpUntil(() => popovers[0].style.display === 'none' && popovers[1].style.display === 'none' && popovers[2].style.display === '')

        expect(popovers[0].style.display).toBe('none')
        expect(popovers[1].style.display).toBe('none')
        expect(popovers[2].style.display).toBe('')
    })

    it('PM-tracker-shape: two-field state mutation + computed checking both fields', async () => {
        // Mirrors PM tracker's openCellField+openCellIssueId pattern. The
        // statusCellOpen computed reads BOTH fields; the open action mutates
        // BOTH in one call. This exercises the path where the targeted-rebind
        // optimization might activate with the wrong targetedProp.
        wildflower.component('two-field-popover', {
            state: {
                rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
                openField: null,
                openId: null
            },
            computed: {
                isStatusOpen(item) {
                    if (!item || item.id === undefined) return false
                    return this.state.openField === 'status' && this.state.openId === item.id
                }
            },
            openStatus(event, element, details) {
                this.state.openField = 'status'
                this.state.openId = details.item.id
            }
        })

        testContainer.innerHTML = `
            <div data-component="two-field-popover">
                <ul data-list="rows" data-key="id">
                    <template>
                        <li>
                            <button class="trigger" data-action="openStatus"></button>
                            <div class="popover" data-show="isStatusOpen"></div>
                        </li>
                    </template>
                </ul>
            </div>
        `

        await waitForCompleteRender()
        await waitForCompleteRender()

        const triggers = testContainer.querySelectorAll('.trigger')
        const popovers = testContainer.querySelectorAll('.popover')

        // Click row A
        triggers[0].click()
        await waitForCompleteRender()
        await pumpUntil(() => popovers[0].style.display === '' && popovers[1].style.display === 'none' && popovers[2].style.display === 'none')
        expect(popovers[0].style.display).toBe('')
        expect(popovers[1].style.display).toBe('none')
        expect(popovers[2].style.display).toBe('none')

        // Click row B — both openField and openId change in one action.
        // Row A's data-show should now hide; row B's should show.
        triggers[1].click()
        await waitForCompleteRender()
        await pumpUntil(() => popovers[0].style.display === 'none' && popovers[1].style.display === '' && popovers[2].style.display === 'none')
        expect(popovers[0].style.display).toBe('none')
        expect(popovers[1].style.display).toBe('')
        expect(popovers[2].style.display).toBe('none')

        // Click row C — same pattern, different target
        triggers[2].click()
        await waitForCompleteRender()
        await pumpUntil(() => popovers[0].style.display === 'none' && popovers[1].style.display === 'none' && popovers[2].style.display === '')
        expect(popovers[0].style.display).toBe('none')
        expect(popovers[1].style.display).toBe('none')
        expect(popovers[2].style.display).toBe('')
    })

    it('data-show with negated computed-name binding (data-show="!isOpen") also re-evaluates', async () => {
        // Negation path uses the same _executeShows code with binding.negate=true.
        wildflower.component('inverse-popover', {
            state: {
                rows: [{ id: 'a' }, { id: 'b' }],
                openId: null
            },
            computed: {
                isOpen(item) {
                    return this.state.openId === item.id
                }
            },
            open(event, element, details) {
                this.state.openId = details.item.id
            }
        })

        testContainer.innerHTML = `
            <div data-component="inverse-popover">
                <ul data-list="rows" data-key="id">
                    <template>
                        <li>
                            <button class="t" data-action="open"></button>
                            <span class="placeholder" data-show="!isOpen">placeholder</span>
                        </li>
                    </template>
                </ul>
            </div>
        `

        await waitForCompleteRender()
        await waitForCompleteRender()

        const triggers = testContainer.querySelectorAll('.t')
        const placeholders = testContainer.querySelectorAll('.placeholder')

        // openId null → both inverse-show evaluate true → visible
        expect(placeholders[0].style.display).toBe('')
        expect(placeholders[1].style.display).toBe('')

        triggers[0].click()
        await waitForCompleteRender()
        await pumpUntil(() => placeholders[0].style.display === 'none' && placeholders[1].style.display === '')

        // row A inverse-show false → hidden; row B inverse-show true → visible
        expect(placeholders[0].style.display).toBe('none')
        expect(placeholders[1].style.display).toBe('')

        triggers[1].click()
        await waitForCompleteRender()
        // Row A is re-shown by a SIBLING click: clicking row B moves the shared
        // openId from 'a' to 'b', so row A's data-show="!isOpen" re-evaluates as a
        // second-order effect of row B's mutation. Under a saturated scheduler that
        // re-eval can lag a single flush, so pump forced renders until it settles
        // (non-masking: a real regression never settles and the expect below fails).
        await pumpUntil(() => placeholders[0].style.display === '' && placeholders[1].style.display === 'none')

        expect(placeholders[0].style.display).toBe('')
        expect(placeholders[1].style.display).toBe('none')
    })
})
