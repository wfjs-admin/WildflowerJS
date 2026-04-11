/**
 * Computed List Reorder Tests
 *
 * Tests that computed lists correctly handle item reordering
 * including sort operations and manual reordering.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForCompleteRender() {
    if (window.wildflower?._forceCompleteRender) {
        await window.wildflower._forceCompleteRender()
    }
    await new Promise(resolve => setTimeout(resolve, 50))
}

describe('Computed List Reorder', () => {
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

    describe('Sort Order Changes', () => {
        it('should update DOM when sort order changes in computed list', async () => {
            wildflower.component('computed-sort-change', {
                state: {
                    sortAscending: true,
                    items: [
                        { id: 1, name: 'Charlie', score: 85 },
                        { id: 2, name: 'Alice', score: 92 },
                        { id: 3, name: 'Bob', score: 78 }
                    ]
                },
                computed: {
                    sortedItems() {
                        const sorted = [...this.state.items]
                        if (this.state.sortAscending) {
                            sorted.sort((a, b) => a.name.localeCompare(b.name))
                        } else {
                            sorted.sort((a, b) => b.name.localeCompare(a.name))
                        }
                        return sorted
                    }
                },
                toggleSort() {
                    this.state.sortAscending = !this.state.sortAscending
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-sort-change">
                    <button class="sort-btn" data-action="toggleSort">Toggle Sort</button>
                    <ul data-list="computed:sortedItems">
                        <template>
                            <li class="item">
                                <span class="item-name" data-bind="name"></span>
                                <span class="item-score" data-bind="score"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            // Initial: sorted ascending (Alice, Bob, Charlie)
            let names = testContainer.querySelectorAll('.item-name')
            expect(names[0].textContent).toBe('Alice')
            expect(names[1].textContent).toBe('Bob')
            expect(names[2].textContent).toBe('Charlie')

            // Toggle to descending
            const sortBtn = testContainer.querySelector('.sort-btn')
            sortBtn.click()
            await waitForCompleteRender()

            // Now: sorted descending (Charlie, Bob, Alice)
            names = testContainer.querySelectorAll('.item-name')
            expect(names[0].textContent).toBe('Charlie')
            expect(names[1].textContent).toBe('Bob')
            expect(names[2].textContent).toBe('Alice')

            // Toggle back to ascending
            sortBtn.click()
            await waitForCompleteRender()

            names = testContainer.querySelectorAll('.item-name')
            expect(names[0].textContent).toBe('Alice')
            expect(names[1].textContent).toBe('Bob')
            expect(names[2].textContent).toBe('Charlie')
        })

        it('should handle numeric sort in computed list', async () => {
            wildflower.component('computed-numeric-sort', {
                state: {
                    sortField: 'price',
                    products: [
                        { id: 1, name: 'Widget', price: 29.99 },
                        { id: 2, name: 'Gadget', price: 49.99 },
                        { id: 3, name: 'Tool', price: 19.99 }
                    ]
                },
                computed: {
                    sortedProducts() {
                        const sorted = [...this.state.products]
                        sorted.sort((a, b) => a[this.state.sortField] - b[this.state.sortField])
                        return sorted
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-numeric-sort">
                    <div data-list="computed:sortedProducts">
                        <template>
                            <div class="product">
                                <span class="product-name" data-bind="name"></span>
                                <span class="product-price" data-bind="price"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="computed-numeric-sort"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            // Initial: sorted by price ascending (Tool: 19.99, Widget: 29.99, Gadget: 49.99)
            let names = testContainer.querySelectorAll('.product-name')
            expect(names[0].textContent).toBe('Tool')
            expect(names[1].textContent).toBe('Widget')
            expect(names[2].textContent).toBe('Gadget')

            // Verify prices are in order
            let prices = testContainer.querySelectorAll('.product-price')
            expect(prices[0].textContent).toBe('19.99')
            expect(prices[1].textContent).toBe('29.99')
            expect(prices[2].textContent).toBe('49.99')
        })
    })

    describe('Manual Reorder', () => {
        it('should update DOM when items are manually reordered via array replacement', async () => {
            wildflower.component('computed-manual-reorder', {
                state: {
                    tasks: [
                        { id: 1, title: 'First', order: 1, active: true },
                        { id: 2, title: 'Second', order: 2, active: true },
                        { id: 3, title: 'Third', order: 3, active: true }
                    ]
                },
                computed: {
                    orderedTasks() {
                        return [...this.state.tasks]
                            .filter(t => t.active)
                            .sort((a, b) => a.order - b.order)
                    }
                },
                moveToTop(event, element, details) {
                    const task = details.item
                    // Move this task to order 0, shift others up
                    this.state.tasks = this.state.tasks.map(t => {
                        if (t.id === task.id) {
                            return { ...t, order: 0 }
                        }
                        return { ...t, order: t.order + 1 }
                    })
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-manual-reorder">
                    <ul data-list="computed:orderedTasks">
                        <template>
                            <li class="task">
                                <span class="task-title" data-bind="title"></span>
                                <button class="move-top-btn" data-action="moveToTop">Move to Top</button>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            // Initial order
            let titles = testContainer.querySelectorAll('.task-title')
            expect(titles[0].textContent).toBe('First')
            expect(titles[1].textContent).toBe('Second')
            expect(titles[2].textContent).toBe('Third')

            // Move "Third" to top
            const moveBtns = testContainer.querySelectorAll('.move-top-btn')
            moveBtns[2].click()
            await waitForCompleteRender()

            // New order: Third, First, Second
            titles = testContainer.querySelectorAll('.task-title')
            expect(titles[0].textContent).toBe('Third')
            expect(titles[1].textContent).toBe('First')
            expect(titles[2].textContent).toBe('Second')
        })

        it('should handle swap operation in computed list', async () => {
            wildflower.component('computed-swap', {
                state: {
                    queue: [
                        { id: 1, label: 'A', position: 0 },
                        { id: 2, label: 'B', position: 1 },
                        { id: 3, label: 'C', position: 2 }
                    ]
                },
                computed: {
                    orderedQueue() {
                        return [...this.state.queue].sort((a, b) => a.position - b.position)
                    }
                },
                swapWithNext(event, element, details) {
                    const item = details.item
                    const currentPos = item.position
                    const nextItem = this.state.queue.find(q => q.position === currentPos + 1)

                    if (nextItem) {
                        this.state.queue = this.state.queue.map(q => {
                            if (q.id === item.id) {
                                return { ...q, position: currentPos + 1 }
                            }
                            if (q.id === nextItem.id) {
                                return { ...q, position: currentPos }
                            }
                            return q
                        })
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-swap">
                    <ul data-list="computed:orderedQueue">
                        <template>
                            <li class="queue-item">
                                <span class="queue-label" data-bind="label"></span>
                                <button class="swap-btn" data-action="swapWithNext">Swap Down</button>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            // Initial: A, B, C
            let labels = testContainer.querySelectorAll('.queue-label')
            expect(labels[0].textContent).toBe('A')
            expect(labels[1].textContent).toBe('B')
            expect(labels[2].textContent).toBe('C')

            // Swap A with B
            let swapBtns = testContainer.querySelectorAll('.swap-btn')
            swapBtns[0].click()
            await waitForCompleteRender()

            // Now: B, A, C
            labels = testContainer.querySelectorAll('.queue-label')
            expect(labels[0].textContent).toBe('B')
            expect(labels[1].textContent).toBe('A')
            expect(labels[2].textContent).toBe('C')

            // Swap A (now at position 1) with C
            swapBtns = testContainer.querySelectorAll('.swap-btn')
            swapBtns[1].click()
            await waitForCompleteRender()

            // Now: B, C, A
            labels = testContainer.querySelectorAll('.queue-label')
            expect(labels[0].textContent).toBe('B')
            expect(labels[1].textContent).toBe('C')
            expect(labels[2].textContent).toBe('A')
        })
    })

    describe('Reorder with Bindings', () => {
        it('should maintain data bindings after reorder', async () => {
            wildflower.component('computed-reorder-bindings', {
                state: {
                    sortOrder: 'asc',
                    items: [
                        { id: 1, name: 'Zebra', count: 5, active: true },
                        { id: 2, name: 'Apple', count: 10, active: false },
                        { id: 3, name: 'Mango', count: 3, active: true }
                    ]
                },
                computed: {
                    sortedItems() {
                        const items = [...this.state.items]
                        if (this.state.sortOrder === 'asc') {
                            items.sort((a, b) => a.name.localeCompare(b.name))
                        } else {
                            items.sort((a, b) => b.name.localeCompare(a.name))
                        }
                        return items
                    }
                },
                reverseSortOrder() {
                    this.state.sortOrder = this.state.sortOrder === 'asc' ? 'desc' : 'asc'
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-reorder-bindings">
                    <button class="reverse-btn" data-action="reverseSortOrder">Reverse</button>
                    <ul data-list="computed:sortedItems">
                        <template>
                            <li class="item">
                                <span class="item-name" data-bind="name"></span>
                                <span class="item-count" data-bind="count"></span>
                                <input type="checkbox" data-model="active" class="item-active">
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="computed-reorder-bindings"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            // Initial order (asc): Apple, Mango, Zebra
            let names = testContainer.querySelectorAll('.item-name')
            let counts = testContainer.querySelectorAll('.item-count')
            let checkboxes = testContainer.querySelectorAll('.item-active')

            expect(names[0].textContent).toBe('Apple')
            expect(counts[0].textContent).toBe('10')
            expect(checkboxes[0].checked).toBe(false)

            expect(names[1].textContent).toBe('Mango')
            expect(counts[1].textContent).toBe('3')
            expect(checkboxes[1].checked).toBe(true)

            expect(names[2].textContent).toBe('Zebra')
            expect(counts[2].textContent).toBe('5')
            expect(checkboxes[2].checked).toBe(true)

            // Reverse order
            testContainer.querySelector('.reverse-btn').click()
            await waitForCompleteRender()

            // New order (desc): Zebra, Mango, Apple
            names = testContainer.querySelectorAll('.item-name')
            counts = testContainer.querySelectorAll('.item-count')
            checkboxes = testContainer.querySelectorAll('.item-active')

            expect(names[0].textContent).toBe('Zebra')
            expect(counts[0].textContent).toBe('5')
            expect(checkboxes[0].checked).toBe(true)

            expect(names[1].textContent).toBe('Mango')
            expect(counts[1].textContent).toBe('3')
            expect(checkboxes[1].checked).toBe(true)

            expect(names[2].textContent).toBe('Apple')
            expect(counts[2].textContent).toBe('10')
            expect(checkboxes[2].checked).toBe(false)

            // Toggle checkbox on first item (Zebra)
            checkboxes[0].checked = false
            checkboxes[0].dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate(100)

            // Verify state was updated correctly (Zebra is id: 1)
            expect(instance.state.items[0].active).toBe(false) // Zebra
        })

        it('should handle actions after reorder', async () => {
            let lastClickedId = null

            wildflower.component('computed-reorder-actions', {
                state: {
                    reversed: false,
                    items: [
                        { id: 1, name: 'First' },
                        { id: 2, name: 'Second' },
                        { id: 3, name: 'Third' }
                    ]
                },
                computed: {
                    displayedItems() {
                        const items = [...this.state.items]
                        if (this.state.reversed) {
                            items.reverse()
                        }
                        return items
                    }
                },
                toggleReverse() {
                    this.state.reversed = !this.state.reversed
                },
                selectItem(event, element, details) {
                    lastClickedId = details.item.id
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-reorder-actions">
                    <button class="toggle-btn" data-action="toggleReverse">Toggle Reverse</button>
                    <ul data-list="computed:displayedItems">
                        <template>
                            <li class="item">
                                <button class="select-btn" data-action="selectItem">
                                    <span data-bind="name"></span>
                                </button>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            // Initial order: First (1), Second (2), Third (3)
            let selectBtns = testContainer.querySelectorAll('.select-btn')

            // Click first button (should be id: 1)
            selectBtns[0].click()
            await waitForUpdate()
            expect(lastClickedId).toBe(1)

            // Click third button (should be id: 3)
            selectBtns[2].click()
            await waitForUpdate()
            expect(lastClickedId).toBe(3)

            // Reverse order
            testContainer.querySelector('.toggle-btn').click()
            await waitForCompleteRender()

            // New order: Third (3), Second (2), First (1)
            selectBtns = testContainer.querySelectorAll('.select-btn')

            // Click first button (should now be id: 3)
            selectBtns[0].click()
            await waitForUpdate()
            expect(lastClickedId).toBe(3)

            // Click third button (should now be id: 1)
            selectBtns[2].click()
            await waitForUpdate()
            expect(lastClickedId).toBe(1)
        })
    })
})
