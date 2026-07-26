/**
 * moveBefore State Preservation Tests
 *
 * The keyed-reorder paths (data-list onMove, pool swap) use
 * Element.moveBefore (Chrome 133+) when available, so already-connected rows
 * relocate WITHOUT disconnect/reconnect — focus, selection, iframe/media
 * state, and running CSS animations survive a re-sort.
 *
 * Order/identity assertions run on every browser (the insertBefore fallback
 * must keep identical semantics). Focus-preservation assertions only run
 * where moveBefore exists — plain insertBefore blurs the moved subtree, so
 * those tests are skipped (not failed) on pre-133 engines.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const describeIfLists = hasFeature('lists') ? describe : describe.skip
const describeIfPools = hasFeature('pools') ? describe : describe.skip
const HAS_MOVE_BEFORE = typeof Element.prototype.moveBefore === 'function'
const itFocus = HAS_MOVE_BEFORE ? it : it.skip

async function waitForCompleteRender() {
    if (window.wildflower?._forceCompleteRender) {
        await window.wildflower._forceCompleteRender()
    }
    await new Promise(resolve => setTimeout(resolve, 50))
}

function ensureComponentScanning(wildflower) {
    if (wildflower._setupDynamicComponentDetection) {
        wildflower._setupDynamicComponentDetection()
    }
}

describe('moveBefore State Preservation', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()

        if (wildflower._contextRegistry) {
            wildflower._contextRegistry.contexts?.clear()
            wildflower._contextRegistry.contextsByType?.clear()
            wildflower._contextRegistry.contextsByComponent?.clear()
            wildflower._contextRegistry.dependencies?.clear()
            wildflower._contextRegistry._contextTypeCache?.clear()
            wildflower._contextRegistry._contextModificationCounter = 0
        }

        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    describeIfLists('data-list keyed reorder', () => {
        function mountSwapList() {
            wildflower.component('mb-swap-list', {
                state: {
                    items: [
                        { id: 1, name: 'A' },
                        { id: 2, name: 'B' },
                        { id: 3, name: 'C' },
                        { id: 4, name: 'D' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="mb-swap-list">
                    <ul data-list="items" data-key="id">
                        <template>
                            <li class="row">
                                <span class="row-name" data-bind="name"></span>
                                <input type="text" class="row-input">
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan(testContainer)
        }

        it('in-place index-write swap keeps row identity and final order', async () => {
            mountSwapList()
            await waitForCompleteRender()

            const rowsBefore = [...testContainer.querySelectorAll('.row')]
            expect(rowsBefore.length).toBe(4)

            // Bare index writes → the reconciler's tryInPlaceSwap fast path,
            // which moves exactly the two exchanged rows.
            const component = wildflower.getComponentsByType('mb-swap-list')[0]
            const arr = component.context.state.items
            const tmp = arr[1]
            arr[1] = arr[3]
            arr[3] = tmp
            await waitForCompleteRender()

            const names = [...testContainer.querySelectorAll('.row-name')].map(el => el.textContent)
            expect(names).toEqual(['A', 'D', 'C', 'B'])

            // Keyed reuse: the same DOM nodes, relocated — never recreated.
            const rowsAfter = [...testContainer.querySelectorAll('.row')]
            expect(rowsAfter[1]).toBe(rowsBefore[3])
            expect(rowsAfter[3]).toBe(rowsBefore[1])
        })

        itFocus('in-place index-write swap preserves focus and typed value in a moved row', async () => {
            mountSwapList()
            await waitForCompleteRender()

            const inputs = testContainer.querySelectorAll('.row-input')
            const focusedInput = inputs[1] // row B: one of the two rows the swap moves
            focusedInput.value = 'typing here'
            focusedInput.focus()
            expect(document.activeElement).toBe(focusedInput)

            const component = wildflower.getComponentsByType('mb-swap-list')[0]
            const arr = component.context.state.items
            const tmp = arr[1]
            arr[1] = arr[3]
            arr[3] = tmp
            await waitForCompleteRender()

            // The focused row moved from index 1 to index 3 without a blur or a
            // node recreation. (Selection RANGE inside the text control is reset
            // by the atomic move itself — Chromium behavior, not the framework —
            // so it is deliberately not asserted here; unmoved rows keep it, see
            // keyed-diff-scenarios.test.js.)
            expect(document.activeElement).toBe(focusedInput)
            expect(focusedInput.value).toBe('typing here')
            expect(testContainer.querySelectorAll('.row-input')[3]).toBe(focusedInput)
        })

        itFocus('full-reconcile reorder preserves focus in the row that moves', async () => {
            mountSwapList()
            await waitForCompleteRender()

            const inputs = testContainer.querySelectorAll('.row-input')
            // Rotate [A,B,C,D] → [D,A,B,C] via whole-array replace (no recorded
            // index ops → full reconcile). The LIS pass keeps A,B,C in place and
            // moves ONLY row D, so focusing D pins the moved-row case.
            const focusedInput = inputs[3]
            focusedInput.focus()
            expect(document.activeElement).toBe(focusedInput)

            const component = wildflower.getComponentsByType('mb-swap-list')[0]
            component.context.state.items = [
                { id: 4, name: 'D' },
                { id: 1, name: 'A' },
                { id: 2, name: 'B' },
                { id: 3, name: 'C' }
            ]
            await waitForCompleteRender()

            const names = [...testContainer.querySelectorAll('.row-name')].map(el => el.textContent)
            expect(names).toEqual(['D', 'A', 'B', 'C'])
            expect(document.activeElement).toBe(focusedInput)
            expect(testContainer.querySelectorAll('.row-input')[0]).toBe(focusedInput)
        })
    })

    describeIfPools('pool swap', () => {
        function mountSwapPool() {
            testContainer.innerHTML = `
                <div data-component="mb-swap-pool">
                    <div data-pool="items" data-key="id">
                        <template>
                            <div class="entity">
                                <span class="entity-name" data-bind="name"></span>
                                <input type="text" class="entity-input">
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('mb-swap-pool', {
                state: {},
                pools: { items: {} },
                init() {
                    this.pools.items.add([
                        { id: 1, name: 'A' },
                        { id: 2, name: 'B' },
                        { id: 3, name: 'C' },
                        { id: 4, name: 'D' }
                    ])
                }
            })

            ensureComponentScanning(wildflower)
        }

        function getPool() {
            const compEl = testContainer.querySelector('[data-component]')
            const instance = wildflower.componentInstances.get(compEl.dataset.componentId)
            return instance.pools.items
        }

        it('non-adjacent swap keeps element identity and final order', async () => {
            mountSwapPool()
            await waitForCompleteRender()

            const elsBefore = [...testContainer.querySelectorAll('.entity')]
            expect(elsBefore.length).toBe(4)

            expect(getPool().swap(2, 4)).toBe(true)
            await waitForCompleteRender()

            const names = [...testContainer.querySelectorAll('.entity-name')].map(el => el.textContent)
            expect(names).toEqual(['A', 'D', 'C', 'B'])

            const elsAfter = [...testContainer.querySelectorAll('.entity')]
            expect(elsAfter[1]).toBe(elsBefore[3])
            expect(elsAfter[3]).toBe(elsBefore[1])
        })

        itFocus('non-adjacent swap preserves focus in a moved entity', async () => {
            mountSwapPool()
            await waitForCompleteRender()

            const focusedInput = testContainer.querySelectorAll('.entity-input')[1] // entity B
            focusedInput.focus()
            expect(document.activeElement).toBe(focusedInput)

            getPool().swap(2, 4)
            await waitForCompleteRender()

            expect(document.activeElement).toBe(focusedInput)
            expect(testContainer.querySelectorAll('.entity-input')[3]).toBe(focusedInput)
        })

        itFocus('adjacent-sibling swap preserves focus in the moved entity', async () => {
            mountSwapPool()
            await waitForCompleteRender()

            // swap(1, 2) with adjacent siblings takes the single-move branch:
            // el2 moves before el1. Focus el2's input to pin the moved element.
            const focusedInput = testContainer.querySelectorAll('.entity-input')[1] // entity B
            focusedInput.focus()
            expect(document.activeElement).toBe(focusedInput)

            getPool().swap(1, 2)
            await waitForCompleteRender()

            const names = [...testContainer.querySelectorAll('.entity-name')].map(el => el.textContent)
            expect(names).toEqual(['B', 'A', 'C', 'D'])
            expect(document.activeElement).toBe(focusedInput)
            expect(testContainer.querySelectorAll('.entity-input')[0]).toBe(focusedInput)
        })
    })
})
