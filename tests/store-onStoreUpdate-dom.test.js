/**
 * Store onStoreUpdate DOM Update Tests
 *
 * Tests that state changes made inside onStoreUpdate() correctly update the DOM.
 * This covers the "kanban pattern" where:
 * - Store holds list data (columnA, columnB)
 * - Component uses computed properties to display lists
 * - Component uses state properties (updated in onStoreUpdate) for badge counts
 *
 * Related files:
 * - test-cases/badge-update-clean.html (manual browser test)
 * - www/demos/kanban-v3-manual-wf/ (kanban demo using this pattern)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { loadFramework, resetFramework, waitForUpdate, isMinifiedBuild} from './helpers/load-framework.js'

describe('Store onStoreUpdate DOM Updates', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterAll(() => {
        if (testContainer?.parentNode) {
            testContainer.remove()
        }
    })

    it.skipIf(isMinifiedBuild())('should set up store subscriptions correctly', async () => {
        // Create component HTML FIRST (like static HTML in manual test)
        testContainer.innerHTML = `
            <div data-component="badge-test">
                <span data-bind="totalCount">?</span>
            </div>
        `

        // Create store BEFORE component registration (like manual test)
        wildflower.store('test-kanban', {
            state: {
                columnA: [{ id: 1, title: 'Card 1' }],
                columnB: [{ id: 2, title: 'Card 2' }]
            }
        })

        // Track onStoreUpdate calls
        let onStoreUpdateCalled = false
        let updateArgs = null

        // Register component with subscribe declaration AFTER store and HTML exist
        wildflower.component('badge-test', {
            state: {
                totalCount: 0,
                colACount: 0
            },
            subscribe: {
                'test-kanban': ['columnA', 'columnB']
            },
            onStoreUpdate(storeName, path, newValue, oldValue) {
                console.log(`[TEST] onStoreUpdate called: ${storeName}.${path}`)
                onStoreUpdateCalled = true
                updateArgs = { storeName, path, newValue, oldValue }

                const store = wildflower.getStore('test-kanban')
                if (store) {
                    this.state.totalCount = store.state.columnA.length + store.state.columnB.length
                    this.state.colACount = store.state.columnA.length
                }
            },
            init() {
                console.log('[TEST] init called')
                console.log('[TEST] _storeSubscriptions:', this._storeSubscriptions)
                console.log('[TEST] _subscribedStores:', this._subscribedStores)

                const store = wildflower.getStore('test-kanban')
                if (store) {
                    this.state.totalCount = store.state.columnA.length + store.state.columnB.length
                    this.state.colACount = store.state.columnA.length
                }
            }
        })

        wildflower._scanForDynamicComponents()
        await waitForUpdate(200)

        // Find the component instance
        const comp = Array.from(wildflower.componentInstances.values()).find(c => c.name === 'badge-test')
        console.log('[TEST] Component instance:', comp?.name)
        console.log('[TEST] Component _storeSubscriptions:', comp?._storeSubscriptions)
        console.log('[TEST] Component _subscribedStores:', comp?._subscribedStores)

        // Check store's path subscribers
        const store = wildflower.getStore('test-kanban')
        console.log('[TEST] Store _pathSubscribers:', store?._pathSubscribers)

        // Verify subscriptions were set up
        expect(comp).toBeDefined()
        expect(comp._storeSubscriptions).toBeDefined()
        expect(comp._storeSubscriptions.length).toBeGreaterThan(0)
        expect(comp._subscribedStores).toBeDefined()
        expect(comp._subscribedStores).toContain('test-kanban')

        // Now modify the store and check if onStoreUpdate is called
        onStoreUpdateCalled = false
        store.state.columnA = [...store.state.columnA, { id: 3, title: 'Card 3' }]

        await waitForUpdate(200)

        console.log('[TEST] onStoreUpdate called after add:', onStoreUpdateCalled)
        expect(onStoreUpdateCalled).toBe(true)
        expect(updateArgs?.path).toBe('columnA')

        // Now test move (delete from A, add to B)
        onStoreUpdateCalled = false
        const card = store.state.columnA[0]
        store.state.columnA = store.state.columnA.filter(c => c.id !== card.id)

        await waitForUpdate(200)

        console.log('[TEST] onStoreUpdate called after move:', onStoreUpdateCalled)
        expect(onStoreUpdateCalled).toBe(true)

        // Check DOM update
        const span = testContainer.querySelector('span[data-bind="totalCount"]')
        console.log('[TEST] Total count in DOM:', span?.textContent)
    })

    it('should update badges when using store method that modifies two arrays', async () => {
        let onStoreUpdateCalls = []

        // Create component HTML FIRST
        testContainer.innerHTML = `
            <div data-component="kanban-test">
                <span class="total" data-bind="totalCount">?</span>
                <span class="colA" data-bind="colACount">?</span>
                <span class="colB" data-bind="colBCount">?</span>
            </div>
        `

        // Create store with methods (exactly like kanban demo)
        wildflower.store('kanban-test', {
            state: {
                columnA: [
                    { id: 1, title: 'Card 1' },
                    { id: 2, title: 'Card 2' }
                ],
                columnB: [
                    { id: 3, title: 'Card 3' }
                ],
                nextId: 4
            },

            // Move method that modifies TWO arrays (like kanban)
            moveCard(cardId, fromCol, toCol) {
                console.log(`[STORE] moveCard: ${cardId} from ${fromCol} to ${toCol}`)
                const fromArr = this.state[fromCol]
                const toArr = this.state[toCol]
                const idx = fromArr.findIndex(c => c.id === cardId)
                if (idx >= 0) {
                    const card = fromArr[idx]
                    // Modify both arrays
                    this.state[fromCol] = fromArr.filter(c => c.id !== cardId)
                    this.state[toCol] = [...toArr, card]
                }
            },

            deleteCard(cardId, column) {
                console.log(`[STORE] deleteCard: ${cardId} from ${column}`)
                this.state[column] = this.state[column].filter(c => c.id !== cardId)
            }
        })

        // Register component with subscribe and STATE for counts (like kanban demo)
        wildflower.component('kanban-test', {
            state: {
                totalCount: 0,
                colACount: 0,
                colBCount: 0
            },
            subscribe: {
                'kanban-test': ['columnA', 'columnB']
            },
            onStoreUpdate(storeName, path, newValue, oldValue) {
                console.log(`[onStoreUpdate] ${storeName}.${path} changed`)
                onStoreUpdateCalls.push({ storeName, path, newValue })

                // Update STATE properties (this is the pattern from kanban demo)
                const store = wildflower.getStore('kanban-test')
                if (store) {
                    this.state.totalCount = store.state.columnA.length + store.state.columnB.length
                    this.state.colACount = store.state.columnA.length
                    this.state.colBCount = store.state.columnB.length
                    console.log('[BADGE UPDATE] totalCount:', this.state.totalCount,
                                'colACount:', this.state.colACount,
                                'colBCount:', this.state.colBCount)
                }
            },
            init() {
                console.log('[init] kanban-test initialized')
                const store = wildflower.getStore('kanban-test')
                if (store) {
                    this.state.totalCount = store.state.columnA.length + store.state.columnB.length
                    this.state.colACount = store.state.columnA.length
                    this.state.colBCount = store.state.columnB.length
                }
            }
        })

        wildflower._scanForDynamicComponents()
        await waitForUpdate(200)

        // Verify initial state
        const totalSpan = testContainer.querySelector('.total')
        const colASpan = testContainer.querySelector('.colA')
        const colBSpan = testContainer.querySelector('.colB')

        console.log('[TEST] Initial - Total:', totalSpan?.textContent, 'ColA:', colASpan?.textContent, 'ColB:', colBSpan?.textContent)
        expect(totalSpan?.textContent).toBe('3')
        expect(colASpan?.textContent).toBe('2')
        expect(colBSpan?.textContent).toBe('1')

        // Now MOVE a card from A to B using the store method
        onStoreUpdateCalls = []
        const store = wildflower.getStore('kanban-test')
        store.moveCard(1, 'columnA', 'columnB')

        await waitForUpdate(200)

        console.log('[TEST] After move - onStoreUpdate calls:', onStoreUpdateCalls.length)
        console.log('[TEST] After move - Total:', totalSpan?.textContent, 'ColA:', colASpan?.textContent, 'ColB:', colBSpan?.textContent)

        // onStoreUpdate should have been called for both columnA and columnB
        expect(onStoreUpdateCalls.length).toBeGreaterThan(0)

        // DOM should reflect the change: A has 1 card, B has 2 cards, total still 3
        expect(totalSpan?.textContent).toBe('3')  // Total unchanged
        expect(colASpan?.textContent).toBe('1')   // A: 2 -> 1
        expect(colBSpan?.textContent).toBe('2')   // B: 1 -> 2

        // Now DELETE a card
        onStoreUpdateCalls = []
        store.deleteCard(2, 'columnA')

        await waitForUpdate(200)

        console.log('[TEST] After delete - onStoreUpdate calls:', onStoreUpdateCalls.length)
        console.log('[TEST] After delete - Total:', totalSpan?.textContent, 'ColA:', colASpan?.textContent, 'ColB:', colBSpan?.textContent)

        // DOM should reflect: A has 0 cards, B has 2 cards, total is 2
        expect(totalSpan?.textContent).toBe('2')  // Total: 3 -> 2
        expect(colASpan?.textContent).toBe('0')   // A: 1 -> 0
        expect(colBSpan?.textContent).toBe('2')   // B unchanged
    })

    it('should update badges when component has BOTH computed lists AND state counts (kanban pattern)', async () => {
        // This matches the exact pattern from badge-update-minimal.html and kanban demo:
        // - Computed properties return store arrays for data-list
        // - State properties hold counts, updated in onStoreUpdate
        // - Both patterns coexist in the same component

        let onStoreUpdateCalls = []

        // Create component HTML with BOTH list rendering AND badge counts
        testContainer.innerHTML = `
            <div data-component="kanban-full-test">
                <div class="toolbar">
                    <span class="total" data-bind="totalCount">?</span>
                    <span class="colA" data-bind="colACount">?</span>
                    <span class="colB" data-bind="colBCount">?</span>
                </div>
                <div class="columns">
                    <div data-list="computed:columnACards" data-key="id">
                        <template>
                            <div class="card"><span data-bind="title"></span></div>
                        </template>
                    </div>
                    <div data-list="computed:columnBCards" data-key="id">
                        <template>
                            <div class="card"><span data-bind="title"></span></div>
                        </template>
                    </div>
                </div>
            </div>
        `

        // Create store
        wildflower.store('kanban-full', {
            state: {
                columnA: [
                    { id: 1, title: 'Card 1' },
                    { id: 2, title: 'Card 2' }
                ],
                columnB: [
                    { id: 3, title: 'Card 3' }
                ]
            },

            moveCard(cardId, fromCol, toCol) {
                console.log(`[STORE] moveCard: ${cardId} from ${fromCol} to ${toCol}`)
                const fromArr = this.state[fromCol]
                const toArr = this.state[toCol]
                const idx = fromArr.findIndex(c => c.id === cardId)
                if (idx >= 0) {
                    const card = fromArr[idx]
                    this.state[fromCol] = fromArr.filter(c => c.id !== cardId)
                    this.state[toCol] = [...toArr, card]
                }
            },

            deleteCard(cardId, column) {
                console.log(`[STORE] deleteCard: ${cardId} from ${column}`)
                this.state[column] = this.state[column].filter(c => c.id !== cardId)
            }
        })

        // Register component with BOTH computed lists AND state counts
        wildflower.component('kanban-full-test', {
            state: {
                // STATE properties for badge counts (updated in onStoreUpdate)
                totalCount: 0,
                colACount: 0,
                colBCount: 0
            },

            computed: {
                // COMPUTED properties for list data (direct store access)
                columnACards() {
                    const store = wildflower.getStore('kanban-full')
                    return store?.state.columnA || []
                },
                columnBCards() {
                    const store = wildflower.getStore('kanban-full')
                    return store?.state.columnB || []
                }
            },

            subscribe: {
                'kanban-full': ['columnA', 'columnB']
            },

            onStoreUpdate(storeName, path, newValue, oldValue) {
                console.log(`[onStoreUpdate] ${storeName}.${path} changed`)
                onStoreUpdateCalls.push({ storeName, path, newValue })

                const store = wildflower.getStore('kanban-full')
                if (store) {
                    this.state.totalCount = store.state.columnA.length + store.state.columnB.length
                    this.state.colACount = store.state.columnA.length
                    this.state.colBCount = store.state.columnB.length
                    console.log('[BADGE UPDATE] totalCount:', this.state.totalCount,
                                'colACount:', this.state.colACount,
                                'colBCount:', this.state.colBCount)
                }
            },

            init() {
                console.log('[init] kanban-full-test initialized')
                const store = wildflower.getStore('kanban-full')
                if (store) {
                    this.state.totalCount = store.state.columnA.length + store.state.columnB.length
                    this.state.colACount = store.state.columnA.length
                    this.state.colBCount = store.state.columnB.length
                }
            }
        })

        wildflower._scanForDynamicComponents()
        await waitForUpdate(300)

        // Verify initial state
        const totalSpan = testContainer.querySelector('.total')
        const colASpan = testContainer.querySelector('.colA')
        const colBSpan = testContainer.querySelector('.colB')
        const colACards = testContainer.querySelectorAll('.columns > div:first-child .card')
        const colBCards = testContainer.querySelectorAll('.columns > div:last-child .card')

        console.log('[TEST] Initial - Total:', totalSpan?.textContent, 'ColA:', colASpan?.textContent, 'ColB:', colBSpan?.textContent)
        console.log('[TEST] Initial - Cards in A:', colACards.length, 'Cards in B:', colBCards.length)

        expect(totalSpan?.textContent).toBe('3')
        expect(colASpan?.textContent).toBe('2')
        expect(colBSpan?.textContent).toBe('1')
        expect(colACards.length).toBe(2)
        expect(colBCards.length).toBe(1)

        // MOVE a card from A to B
        onStoreUpdateCalls = []
        const store = wildflower.getStore('kanban-full')
        store.moveCard(1, 'columnA', 'columnB')

        await waitForUpdate(300)

        const colACardsAfterMove = testContainer.querySelectorAll('.columns > div:first-child .card')
        const colBCardsAfterMove = testContainer.querySelectorAll('.columns > div:last-child .card')

        console.log('[TEST] After move - Total:', totalSpan?.textContent, 'ColA:', colASpan?.textContent, 'ColB:', colBSpan?.textContent)
        console.log('[TEST] After move - Cards in A:', colACardsAfterMove.length, 'Cards in B:', colBCardsAfterMove.length)
        console.log('[TEST] After move - onStoreUpdate calls:', onStoreUpdateCalls.length)

        // Lists should update (computed properties work)
        expect(colACardsAfterMove.length).toBe(1)
        expect(colBCardsAfterMove.length).toBe(2)

        // Badges should ALSO update (state properties via onStoreUpdate)
        expect(onStoreUpdateCalls.length).toBeGreaterThan(0)
        expect(totalSpan?.textContent).toBe('3')  // Total unchanged
        expect(colASpan?.textContent).toBe('1')   // A: 2 -> 1
        expect(colBSpan?.textContent).toBe('2')   // B: 1 -> 2

        // DELETE a card
        onStoreUpdateCalls = []
        store.deleteCard(2, 'columnA')

        await waitForUpdate(300)

        const colACardsAfterDelete = testContainer.querySelectorAll('.columns > div:first-child .card')

        console.log('[TEST] After delete - Total:', totalSpan?.textContent, 'ColA:', colASpan?.textContent, 'ColB:', colBSpan?.textContent)
        console.log('[TEST] After delete - Cards in A:', colACardsAfterDelete.length)

        // Lists should update
        expect(colACardsAfterDelete.length).toBe(0)

        // Badges should ALSO update
        expect(totalSpan?.textContent).toBe('2')  // Total: 3 -> 2
        expect(colASpan?.textContent).toBe('0')   // A: 1 -> 0
        expect(colBSpan?.textContent).toBe('2')   // B unchanged
    })
})
