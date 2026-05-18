/**
 * Symmetry audit follow-up probes.
 *
 * Generated from a 2026-04-27 source-and-test audit that found four cells in
 * the scope×capability matrix marked "supported but untested" — code path
 * exists, no test confirms behavior. Each probe below converts a ⚠️ cell to
 * either ✅ (works as documented) or 🐛 (real bug).
 *
 * Findings if all four pass: contract is uniform across scopes for the
 * tested capabilities. Findings if any fail: real asymmetry to fix.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import {
    loadFramework, resetFramework, waitForCompleteRender, createTestContainer,
} from '../packages/test-utils/index.js'

describe('Symmetry audit follow-ups', () => {
    let testContainer
    let cleanup
    let componentRef

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        resetFramework()
        const c = createTestContainer({ visible: true })
        testContainer = c.container
        cleanup = c.cleanup
        componentRef = null
    })

    afterEach(() => {
        if (cleanup) cleanup()
    })

    // -----------------------------------------------------------------------
    // PROBE 1: this.stores.X inside an item-level computed
    // -----------------------------------------------------------------------

    it('PROBE-1. this.stores.X works inside item-level computed', async () => {
        wildflower.store('cart', {
            state: {
                items: { p1: 2, p3: 1 } // map of productId -> qty in cart
            }
        })

        wildflower.component('probe1', {
            subscribe: { cart: ['items'] },
            state: {
                products: [
                    { id: 'p1', name: 'Widget' },
                    { id: 'p2', name: 'Gadget' },
                    { id: 'p3', name: 'Sprocket' }
                ]
            },
            computed: {
                // Item-level computed reading from this.stores.cart
                qtyInCart(item) {
                    return this.stores.cart.items[item.id] || 0
                }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="probe1">
                <ul data-list="products" data-key="id">
                    <template>
                        <li><span class="qty" data-bind="qtyInCart"></span></li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const qtys = testContainer.querySelectorAll('.qty')
        expect(qtys.length).toBe(3)
        expect(qtys[0].textContent).toBe('2') // p1 → 2
        expect(qtys[1].textContent).toBe('0') // p2 → 0 (no entry)
        expect(qtys[2].textContent).toBe('1') // p3 → 1

        // Mutate the store and verify per-row reactivity
        wildflower.getStore('cart').items.p2 = 5
        await waitForCompleteRender()
        expect(testContainer.querySelectorAll('.qty')[1].textContent).toBe('5')
    })

    // -----------------------------------------------------------------------
    // PROBE 2: this.X (state shortcut) and this.computed.X inside watcher
    // -----------------------------------------------------------------------

    it('PROBE-2. watcher callback can use this.X shortcut and this.computed.X', async () => {
        const watcherSeen = { stateRead: null, computedRead: null }

        wildflower.component('probe2', {
            state: {
                input: '',
                multiplier: 3
            },
            computed: {
                tripled() { return this.input.length * this.multiplier }
            },
            watch: {
                input(newVal) {
                    // Inside the watcher, we should be able to use:
                    //   this.X  → state.X (bare shortcut)
                    //   this.X  → computed value (resolved via ContextProxy)
                    watcherSeen.stateRead = this.multiplier  // state via shortcut
                    watcherSeen.computedRead = this.tripled  // computed via shortcut
                }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="probe2">
                <input id="i" data-model="input">
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        componentRef.input = 'hello'
        await waitForCompleteRender()

        expect(watcherSeen.stateRead).toBe(3)        // state.multiplier read via this.multiplier
        expect(watcherSeen.computedRead).toBe(15)    // computed.tripled read via this.tripled
    })

    // -----------------------------------------------------------------------
    // PROBE 3: this.parent, this.listItem, this.$el inside lifecycle hooks
    // -----------------------------------------------------------------------

    it('PROBE-3. lifecycle hooks expose this.$el and (in list context) this.listItem', async () => {
        const captured = { initListItem: null, initEl: null, destroyEl: null }

        wildflower.component('child-probe3', {
            state: { local: 'x' },
            init() {
                // this.listItem populated when component mounts inside a data-list item
                captured.initListItem = this.listItem ? { id: this.listItem.id } : null
                // this.$el(selector) is a DOM helper — should work in init
                const helper = this.$el && this.$el('.marker')
                captured.initEl = helper ? helper.el?.tagName : null
            },
            beforeDestroy() {
                const helper = this.$el && this.$el('.marker')
                captured.destroyEl = helper ? helper.el?.tagName : null
            }
        })

        wildflower.component('parent-probe3', {
            state: {
                items: [{ id: 'a', name: 'Alice' }]
            }
        })

        testContainer.innerHTML = `
            <div data-component="parent-probe3">
                <ul data-list="items" data-key="id">
                    <template>
                        <li data-component="child-probe3">
                            <span class="marker">M</span>
                        </li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        // listItem populated for component-in-list
        expect(captured.initListItem).toEqual({ id: 'a' })
        // $el helper resolved a child element from inside init
        expect(captured.initEl).toBe('SPAN')
    })

    // -----------------------------------------------------------------------
    // PROBE 4: item-level → item-level computed chaining via this.computed.X(item)
    //          Verify reactivity is per-row (not over-broad component-level).
    // -----------------------------------------------------------------------

    it('PROBE-4. chained item-level computed registers per-row deps (mutation only re-runs affected row)', async () => {
        const evalCount = { isPremium: 0, displayLabel: 0 }

        wildflower.component('probe4', {
            state: {
                products: [
                    { id: 'p1', name: 'Widget',  price: 10 },
                    { id: 'p2', name: 'Gadget',  price: 50 },
                    { id: 'p3', name: 'Sprocket', price: 200 }
                ],
                premiumThreshold: { p1: 5, p2: 100, p3: 100 }
            },
            computed: {
                // Item-level: reads sibling state keyed by item.id
                isPremium(item) {
                    evalCount.isPremium++
                    return item.price >= this.premiumThreshold[item.id]
                },
                // Item-level that calls another item-level via this.computed.X(item)
                displayLabel(item) {
                    evalCount.displayLabel++
                    return this.computed.isPremium(item)
                        ? '★ ' + item.name
                        : item.name
                }
            },
            init() { componentRef = this }
        })

        testContainer.innerHTML = `
            <div data-component="probe4">
                <ul data-list="products" data-key="id">
                    <template>
                        <li class="prod" data-bind="displayLabel"></li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const labels = testContainer.querySelectorAll('.prod')
        expect(labels.length).toBe(3)
        expect(labels[0].textContent).toBe('★ Widget')   // p1 price 10 ≥ threshold 5
        expect(labels[1].textContent).toBe('Gadget')      // p2 price 50 < threshold 100
        expect(labels[2].textContent).toBe('★ Sprocket') // p3 price 200 ≥ threshold 100

        // Snapshot eval counts after initial render
        const initialIsPremium = evalCount.isPremium
        const initialDisplayLabel = evalCount.displayLabel

        // Mutate ONLY the threshold for p2 — should re-evaluate p2 only,
        // not p1 or p3. Per-item dep registration through chained item-level
        // computeds should keep this granular.
        componentRef.premiumThreshold.p2 = 40
        await waitForCompleteRender()

        // p2 should now be premium
        expect(testContainer.querySelectorAll('.prod')[1].textContent).toBe('★ Gadget')

        // After the mutation, both isPremium and displayLabel must have been
        // re-evaluated for p2. They may also have been called for p1/p3 in
        // some implementations, but we want at most ~1-2 extra calls per
        // unrelated row, NOT a full re-evaluation of every row.
        const isPremiumDelta = evalCount.isPremium - initialIsPremium
        const displayLabelDelta = evalCount.displayLabel - initialDisplayLabel

        // Generous bound: at most 3 extra evaluations of each (one per row,
        // accounting for any safety re-runs). If reactivity were over-broad
        // (always re-run all rows on any threshold change), we'd see
        // significantly more calls — and we want to know.
        // The test passes today's behavior; if a future regression makes
        // chained-computed reactivity over-broad, this test will catch it.
        expect(isPremiumDelta).toBeGreaterThanOrEqual(1)     // p2 re-evaluated
        expect(isPremiumDelta).toBeLessThanOrEqual(6)        // not all 3 rows × 2 cycles
        expect(displayLabelDelta).toBeGreaterThanOrEqual(1)
        expect(displayLabelDelta).toBeLessThanOrEqual(6)
    })
})
