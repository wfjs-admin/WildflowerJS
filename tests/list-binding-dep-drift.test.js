/**
 * Guards for two list-item binding update fixes uncovered by the binding
 * value-resolution work.
 *
 * 1. Root binding dependency drift (commit 361edf3): the old hand-copied static
 *    extractors did not evaluate item-level computeds on root bindings, so a root
 *    binding driven by an item-level computed that read an item prop NOTHING else
 *    co-read could miss that prop on the cached static fast path and go stale. The
 *    unified _computeDeps 'path' kind now evaluates the computed like inner bindings.
 *
 * 2. data-bind-html expression targeted-rebind: _executeHtmlBindings' targeted-
 *    rebind skip filter matched only binding.path, never binding.expressionVars, so
 *    an html EXPRESSION binding referencing the mutated prop was skipped on a single-
 *    prop update (the value resolved correctly but the innerHTML write was skipped).
 *    Its siblings _executeBindings/_executeShows/_executeClassBindings already had the
 *    expression-aware filter; html was missed. Now mirrored.
 *
 * Sibling of nested-class-only-dep-gap.test.js (same bug family: a dependency read
 * solely by one binding must still wake / re-apply the per-item binding on mutation).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer, triggerAction,
} from '../packages/test-utils/index.js'

describe('List binding dependency drift fixes', () => {
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

    it('root data-bind via an item-level computed reading a sole-read item prop reacts', async () => {
        wildflower.component('root-bind-list', {
            state: {
                rows: [
                    { id: 'a', note: 'alpha' },
                    { id: 'b', note: 'beta' }
                ]
            },
            computed: {
                // Item-level computed; reads item.note, which no other binding co-reads.
                rowLabel(item) { return item.note.toUpperCase() }
            },
            renameFirst() { this.state.rows[0].note = 'changed' }
        })

        testContainer.innerHTML = `
            <div data-component="root-bind-list">
                <button class="act" data-action="renameFirst"></button>
                <ul data-list="rows" data-key="id">
                    <template>
                        <li class="row" data-bind="rowLabel"></li>
                    </template>
                </ul>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const rows = testContainer.querySelectorAll('li.row')
        expect(rows[0].textContent).toBe('ALPHA')
        expect(rows[1].textContent).toBe('BETA')

        await triggerAction(testContainer.querySelector('.act'))
        await waitForCompleteRender()

        // Mutating note must reach the root computed binding: the computed's
        // transitive read of note has to be registered on the row's effect, which
        // requires the root binding to evaluate the item-level computed on first run.
        expect(rows[0].textContent).toBe('CHANGED')
        expect(rows[1].textContent).toBe('BETA')
    })

    it('data-bind-html expression re-applies on a single-prop targeted update', async () => {
        wildflower.component('html-expr-list', {
            state: {
                rows: [
                    { id: 'a', open: true },
                    { id: 'b', open: false }
                ]
            },
            toggleFirst() { this.state.rows[0].open = !this.state.rows[0].open }
        })

        testContainer.innerHTML = `
            <div data-component="html-expr-list">
                <button class="act" data-action="toggleFirst"></button>
                <ul data-list="rows" data-key="id">
                    <template>
                        <li class="row" data-bind-html="open ? '<b>OPEN</b>' : '<i>shut</i>'"></li>
                    </template>
                </ul>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const rows = testContainer.querySelectorAll('li.row')
        expect(rows[0].innerHTML).toContain('OPEN')
        expect(rows[1].innerHTML).toContain('shut')

        await triggerAction(testContainer.querySelector('.act'))
        await waitForCompleteRender()

        // open flipped to false on row 0 (a single-prop targeted update). The html
        // expression references `open` only in expressionVars, so the targeted-rebind
        // filter must match on expressionVars, not binding.path, to re-apply innerHTML.
        expect(rows[0].innerHTML).toContain('shut')
        expect(rows[1].innerHTML).toContain('shut')
    })
})
