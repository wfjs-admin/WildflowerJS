/**
 * moveBefore Fallback Parity Tests
 *
 * Deletes Element.prototype.moveBefore BEFORE the framework bundle loads, so
 * the load-time feature detect (HAS_MOVE_BEFORE in wfUtils) compiles the
 * insertBefore fallback in — the path every pre-Chrome-133 browser takes.
 * Modern Chromium/Firefox both ship moveBefore, so without this file the
 * fallback branch would go unexercised by the whole suite.
 *
 * Asserts reorder SEMANTICS are identical to the moveBefore path: final
 * order and keyed node reuse. (Focus preservation is deliberately absent —
 * that is the moveBefore-only win, covered in
 * movebefore-state-preservation.test.js.)
 *
 * Real-world support (caniuse, 2026-07): Chrome/Edge 133+, Firefox 144+
 * (same standard WHATWG method, not an equivalent), Safari not yet — Safari
 * takes this fallback. Note the Playwright-pinned Firefox predates 144, so
 * the Firefox lane currently exercises the fallback naturally (the
 * state-preservation focus tests self-skip there); this file keeps the
 * fallback covered on Chromium too, and stays load-bearing once Playwright's
 * Firefox catches up.
 *
 * Safe because vitest browser mode runs each file in its own iframe realm
 * (isolate: true) — the deletion cannot leak into other test files.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const describeIfLists = hasFeature('lists') ? describe : describe.skip
const describeIfPools = hasFeature('pools') ? describe : describe.skip

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

describe('moveBefore Fallback Parity (API deleted pre-load)', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        // Must happen before the bundle evaluates its load-time detect.
        delete Element.prototype.moveBefore
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

    describeIfLists('data-list keyed reorder via insertBefore', () => {
        function mountSwapList() {
            wildflower.component('mbfb-swap-list', {
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
                <div data-component="mbfb-swap-list">
                    <ul data-list="items" data-key="id">
                        <template>
                            <li class="row"><span class="row-name" data-bind="name"></span></li>
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

            const component = wildflower.getComponentsByType('mbfb-swap-list')[0]
            const arr = component.context.state.items
            const tmp = arr[1]
            arr[1] = arr[3]
            arr[3] = tmp
            await waitForCompleteRender()

            const names = [...testContainer.querySelectorAll('.row-name')].map(el => el.textContent)
            expect(names).toEqual(['A', 'D', 'C', 'B'])

            const rowsAfter = [...testContainer.querySelectorAll('.row')]
            expect(rowsAfter[1]).toBe(rowsBefore[3])
            expect(rowsAfter[3]).toBe(rowsBefore[1])
        })

        it('full-reconcile rotate keeps row identity and final order', async () => {
            mountSwapList()
            await waitForCompleteRender()

            const rowsBefore = [...testContainer.querySelectorAll('.row')]

            const component = wildflower.getComponentsByType('mbfb-swap-list')[0]
            component.context.state.items = [
                { id: 4, name: 'D' },
                { id: 1, name: 'A' },
                { id: 2, name: 'B' },
                { id: 3, name: 'C' }
            ]
            await waitForCompleteRender()

            const names = [...testContainer.querySelectorAll('.row-name')].map(el => el.textContent)
            expect(names).toEqual(['D', 'A', 'B', 'C'])

            const rowsAfter = [...testContainer.querySelectorAll('.row')]
            expect(rowsAfter[0]).toBe(rowsBefore[3])
            expect(rowsAfter[1]).toBe(rowsBefore[0])
        })
    })

    describeIfPools('pool swap via insertBefore', () => {
        function mountSwapPool() {
            testContainer.innerHTML = `
                <div data-component="mbfb-swap-pool">
                    <div data-pool="items" data-key="id">
                        <template>
                            <div class="entity"><span class="entity-name" data-bind="name"></span></div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('mbfb-swap-pool', {
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

        it('adjacent-sibling swap keeps element identity and final order', async () => {
            mountSwapPool()
            await waitForCompleteRender()

            const elsBefore = [...testContainer.querySelectorAll('.entity')]

            expect(getPool().swap(1, 2)).toBe(true)
            await waitForCompleteRender()

            const names = [...testContainer.querySelectorAll('.entity-name')].map(el => el.textContent)
            expect(names).toEqual(['B', 'A', 'C', 'D'])

            const elsAfter = [...testContainer.querySelectorAll('.entity')]
            expect(elsAfter[0]).toBe(elsBefore[1])
            expect(elsAfter[1]).toBe(elsBefore[0])
        })
    })
})
