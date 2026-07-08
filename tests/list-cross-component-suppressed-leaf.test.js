/**
 * Cross-COMPONENT reader of a suppressed pure-text list leaf.
 *
 * The suppressing direct writer's gate (_computeReactiveGraphRetireSafe) is
 * component-scoped: it sees the LIST component's own computeds/watchers/
 * subscriptions. A computed on a DIFFERENT component that reads the same item
 * leaf through the module-global reactive graph (store-backed items) forms an
 * observer edge the gate cannot see — and the writer's DIRECT_HANDLED return
 * precedes the observer wake in notifyNode, starving that reader.
 *
 * Fix under test: notifyNode only takes the suppressing branch when
 * node.observers.length === 0, read AT WRITE TIME (topology decides, not the
 * static gate). External review 2026-07-04, finding #3
 * (docs/future/LIST_PIPELINE_SYNOPSIS_FOR_REVIEW_2026-07-04.md Appendix A).
 *
 * Same three-write shape as RG-1 (reactive-graph-correctness.test.js): the
 * first write is where a writer would stamp; the second and third are where a
 * stamped writer starves the cross-component reader.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('Cross-component reader of a suppressed pure-text list leaf', () => {
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
        if (cleanup) cleanup()
    })

    it('XCS-A. a second component\'s aggregate computed stays fresh across repeated writes', async () => {
        wildflower.store('xcs-src', {
            state: { items: [{ id: 1, qty: 1 }, { id: 2, qty: 2 }] }
        })
        // List component: NO computeds/watchers/subscriptions — retire-safe,
        // so qty (one plain text binding) is writer-suppressible by the
        // component-scoped gate.
        wildflower.component('xcs-list', {
            state: {}
        })
        // Reader component: its computed reads the SAME item leaves through
        // the store — a cross-component graph edge invisible to the list
        // component's gate.
        // LOAD-BEARING: the subscribe path array must stay EMPTY. An empty
        // array injects this.stores WITHOUT path subscriptions, so the reader
        // is woken ONLY by its fine-grained graph edge — which is what the
        // suppression bug starves. Adding a path key here would deliver a
        // coarse store-change nudge that masks the regression and turns this
        // test green-always.
        wildflower.component('xcs-reader', {
            state: {},
            subscribe: { 'xcs-src': [] },
            computed: {
                total() {
                    return this.stores['xcs-src'].items.reduce((s, i) => s + i.qty, 0)
                }
            }
        })
        testContainer.innerHTML = `
            <div data-component="xcs-list">
                <ul data-list="external('xcs-src', 'items')" data-key="id">
                    <template>
                        <li><span class="qty" data-bind="qty"></span></li>
                    </template>
                </ul>
            </div>
            <div data-component="xcs-reader">
                <span id="xcs-out" data-bind="total"></span>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const out = () => testContainer.querySelector('#xcs-out').textContent
        const qty0 = () => testContainer.querySelector('[data-list] .qty').textContent
        expect(qty0()).toBe('1')
        expect(out()).toBe('3')

        const store = wildflower.getStore('xcs-src')

        // Write 1: this is where a suppressing writer would stamp.
        store.items[0].qty = 10
        await waitForCompleteRender()
        expect(qty0()).toBe('10')
        expect(out()).toBe('12')

        // Writes 2 and 3: a stamped writer that ignores cross-component
        // observers starves the reader here.
        store.items[0].qty = 100
        await waitForCompleteRender()
        expect(qty0()).toBe('100')
        expect(out()).toBe('102')

        store.items[0].qty = 1000
        await waitForCompleteRender()
        expect(qty0()).toBe('1000')
        expect(out()).toBe('1002')
    })

    it('XCS-C. same-key row replacement under a live cross-component observer re-stamps cleanly (old element released from the write path)', async () => {
        wildflower.store('xcs-src-c', {
            state: { items: [{ id: 1, qty: 1 }, { id: 2, qty: 2 }] }
        })
        wildflower.component('xcs-list-c', { state: {} })
        wildflower.component('xcs-reader-c', {
            state: {},
            subscribe: { 'xcs-src-c': [] }, // empty = injection only (load-bearing, see XCS-A)
            computed: {
                total() { return this.stores['xcs-src-c'].items.reduce((s, i) => s + i.qty, 0) }
            }
        })
        testContainer.innerHTML = `
            <div data-component="xcs-list-c">
                <ul data-list="external('xcs-src-c', 'items')" data-key="id">
                    <template>
                        <li><span class="qty" data-bind="qty"></span></li>
                    </template>
                </ul>
            </div>
            <div data-component="xcs-reader-c">
                <span id="xcsc-out" data-bind="total"></span>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const store = wildflower.getStore('xcs-src-c')
        const out = () => testContainer.querySelector('#xcsc-out').textContent
        expect(out()).toBe('3')

        // Write under the observer (demoted path), keep a handle on the OLD
        // first-row element, then same-key replace the whole array.
        store.items[0].qty = 10
        await waitForCompleteRender()
        const oldQtyEl = testContainer.querySelector('[data-list] .qty')
        expect(oldQtyEl.textContent).toBe('10')
        expect(out()).toBe('12')

        store.items = store.items.map(i => ({ ...i }))
        await waitForCompleteRender()

        // Writes to the NEW item objects must land on the live elements and
        // reach the observer; the old element must no longer receive writes
        // (its writer/sink registrations died with the replacement).
        store.items[0].qty = 100
        await waitForCompleteRender()
        const newQtyEl = testContainer.querySelector('[data-list] .qty')
        expect(newQtyEl.textContent).toBe('100')
        expect(out()).toBe('102')
        if (newQtyEl !== oldQtyEl) {
            expect(oldQtyEl.textContent).toBe('10') // stale snapshot, untouched
        }

        store.items[0].qty = 200
        await waitForCompleteRender()
        expect(testContainer.querySelector('[data-list] .qty').textContent).toBe('200')
        expect(out()).toBe('202')
    })

    it('XCS-B. a conditionally-reading cross-component computed never misses a wake across subscribe/unsubscribe toggles', async () => {
        wildflower.store('xcs-src-b', {
            state: { items: [{ id: 1, qty: 5 }] }
        })
        wildflower.component('xcs-list-b', { state: {} })
        // The computed's edge to qty appears and disappears as `watching`
        // toggles (its re-eval drops/re-adds the read). Suppression may
        // legitimately oscillate write-to-write; correctness must not.
        wildflower.component('xcs-reader-b', {
            state: { watching: true },
            subscribe: { 'xcs-src-b': [] },
            computed: {
                report() {
                    if (!this.state.watching) return 'off'
                    return 'qty:' + this.stores['xcs-src-b'].items[0].qty
                }
            }
        })
        testContainer.innerHTML = `
            <div data-component="xcs-list-b">
                <ul data-list="external('xcs-src-b', 'items')" data-key="id">
                    <template>
                        <li><span class="qty" data-bind="qty"></span></li>
                    </template>
                </ul>
            </div>
            <div data-component="xcs-reader-b">
                <span id="xcsb-out" data-bind="report"></span>
            </div>
        `
        wildflower.scan()
        await waitForCompleteRender()

        const out = () => testContainer.querySelector('#xcsb-out').textContent
        const qty0 = () => testContainer.querySelector('[data-list] .qty').textContent
        const store = wildflower.getStore('xcs-src-b')
        const readerEl = testContainer.querySelector('[data-component="xcs-reader-b"]')
        const reader = wildflower.componentInstances.get(readerEl.dataset.componentId)

        expect(out()).toBe('qty:5')

        // Watching: every write must reach the reader.
        store.items[0].qty = 6
        await waitForCompleteRender()
        expect(qty0()).toBe('6')
        expect(out()).toBe('qty:6')

        // Toggle off: the edge drops on re-eval; writes go dark for the
        // reader (by its own choice), list stays live.
        reader.state.watching = false
        await waitForCompleteRender()
        expect(out()).toBe('off')
        store.items[0].qty = 7
        await waitForCompleteRender()
        expect(qty0()).toBe('7')
        expect(out()).toBe('off')

        // Toggle back on: the re-eval re-reads qty (fresh value immediately)
        // and re-forms the edge; subsequent writes must wake it again even if
        // suppression re-engaged while the edge was down.
        reader.state.watching = true
        await waitForCompleteRender()
        expect(out()).toBe('qty:7')

        store.items[0].qty = 8
        await waitForCompleteRender()
        expect(qty0()).toBe('8')
        expect(out()).toBe('qty:8')

        store.items[0].qty = 9
        await waitForCompleteRender()
        expect(qty0()).toBe('9')
        expect(out()).toBe('qty:9')
    })
})
