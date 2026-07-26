/**
 * PENDING CONTRACT — data-bind-class item-field-over-computed precedence (CL-18 for class).
 *
 * STATUS: describe.SKIP. This documents the INTENDED behaviour and is the acceptance
 * test for a deferred correctness fix. UNSKIP it to verify the fix; it currently FAILS.
 *
 * The bug: a plain (non-`computed:`) data-bind-class of a bare name whose name matches
 * BOTH an item field AND a same-name COMPONENT-level computed resolves to the COMPUTED,
 * while data-bind (text), data-bind-style and data-bind-attr all resolve the ITEM field
 * first (CL-18). The collision compiles to a merged-context evaluator, so the resolution
 * happens in the class merged-ctx builders (_buildClassMergedCtx / _buildClassMergedCtxLazy)
 * where the order is `componentState (which exposes computeds) > item`. The fix makes the
 * class merged-ctx item-own-key-first; blast radius = class EXPRESSIONS referencing a name
 * that is simultaneously an item key and componentState/a computed (so the fix also needs an
 * expression-form collision test, not just the bare-name cases below).
 *
 * Deferred (2026-07-09, session orange-circle-50) to AFTER the SSR-executor-deletion slice,
 * by Chris. See memory [[class-precedence-pending]] and [[list-cluster-reimagining]].
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('data-bind-class item-field-over-computed precedence (CL-18 for class)', () => {
    let testContainer
    let cleanup
    let componentRef

    beforeAll(async () => { await loadFramework() })

    beforeEach(() => {
        resetFramework()
        const c = createTestContainer({ visible: true })
        testContainer = c.container
        cleanup = c.cleanup
        componentRef = null
    })

    afterEach(() => { if (cleanup) cleanup() })

    it('renders the item field, not a same-name component computed, on initial bind and after mutation', async () => {
        wildflower.component('clsp-both', {
            state: { items: [{ id: 'a', status: 'itemA' }, { id: 'b', status: 'itemB' }] },
            computed: { status() { return 'COMPUTED' } },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="clsp-both">
                <ul data-list="items" data-key="id">
                    <template>
                        <li data-bind-class="status" data-bind="id"></li>
                    </template>
                </ul>
            </div>`

        wildflower.scan()
        await waitForCompleteRender()

        const lis = testContainer.querySelectorAll('li')
        expect(lis.length).toBe(2)
        expect(lis[0].classList.contains('itemA')).toBe(true)
        expect(lis[0].classList.contains('COMPUTED')).toBe(false)
        expect(lis[1].classList.contains('itemB')).toBe(true)
        expect(lis[1].classList.contains('COMPUTED')).toBe(false)

        componentRef.state.items[0].status = 'itemA2'
        await waitForCompleteRender()
        expect(lis[0].classList.contains('itemA2')).toBe(true)
        expect(lis[0].classList.contains('itemA')).toBe(false)
        expect(lis[0].classList.contains('COMPUTED')).toBe(false)
    })

    it('resolves the item field (not a same-name computed) inside a class EXPRESSION', async () => {
        // Expression form compiles to a merged-context evaluator (not the bare-name
        // simple-property path). Distinguish item from computed by VALUE: item field
        // 'itemA' -> 'itemA-cls', the same-name computed -> 'COMPUTED-cls'.
        wildflower.component('clsp-expr', {
            state: { items: [{ id: 'a', status: 'itemA' }] },
            computed: { status() { return 'COMPUTED' } },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="clsp-expr">
                <ul data-list="items" data-key="id">
                    <template>
                        <li data-bind-class="status + '-cls'" data-bind="id"></li>
                    </template>
                </ul>
            </div>`

        wildflower.scan()
        await waitForCompleteRender()

        const li = testContainer.querySelector('li')
        expect(li.classList.contains('itemA-cls')).toBe(true)
        expect(li.classList.contains('COMPUTED-cls')).toBe(false)

        componentRef.state.items[0].status = 'itemA2'
        await waitForCompleteRender()
        expect(li.classList.contains('itemA2-cls')).toBe(true)
        expect(li.classList.contains('itemA-cls')).toBe(false)
        expect(li.classList.contains('COMPUTED-cls')).toBe(false)
    })

    it('falls back to a same-name component computed when the item lacks the field', async () => {
        wildflower.component('clsp-computed-only', {
            state: { items: [{ id: 'a' }] },   // no `status` field on the item
            computed: { status() { return 'fromComputed' } },
        })

        testContainer.innerHTML = `
            <div data-component="clsp-computed-only">
                <ul data-list="items" data-key="id">
                    <template>
                        <li data-bind-class="status" data-bind="id"></li>
                    </template>
                </ul>
            </div>`

        wildflower.scan()
        await waitForCompleteRender()

        const li = testContainer.querySelector('li')
        expect(li.classList.contains('fromComputed')).toBe(true)
    })
})
