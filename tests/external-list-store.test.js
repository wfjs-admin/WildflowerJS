/**
 * External List from Store Test Suite
 *
 * Tests that data-list with external() expressions properly:
 * 1. Resolves initial data from stores
 * 2. Updates when store data changes
 * 3. Doesn't cache stale data
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, waitForUpdate } from './helpers/load-framework.js'

describe('External List from Store', () => {
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

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
    })

    describe('data-list with external() store path', () => {
        it('should render items when store has initial data', async () => {
            // Create store with initial items
            wildflower.store('inventory', {
                state: {
                    items: [
                        { name: 'Item 1', price: 10 },
                        { name: 'Item 2', price: 20 }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="inventory-display">
                    <div data-list="external('inventory', 'items')">
                        <template>
                            <div class="item">
                                <span class="name" data-bind="name"></span>
                                <span class="price" data-bind="price"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('inventory-display', {
                state: {}
            })

            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)
            expect(items[0].querySelector('.name').textContent).toBe('Item 1')
            expect(items[1].querySelector('.name').textContent).toBe('Item 2')
        })

        it('should update list when items are added to store', async () => {
            // Create store with empty items
            wildflower.store('cart', {
                state: {
                    items: []
                },
                addItem(item) {
                    this.state.items.push({ ...item, id: Date.now() })
                }
            })

            testContainer.innerHTML = `
                <div data-component="cart-display">
                    <div class="cart-list" data-list="external('cart', 'items')">
                        <template>
                            <div class="cart-item">
                                <span class="name" data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                    <span class="count" data-bind="external('cart', 'computed:itemCount')"></span>
                </div>
            `

            wildflower.component('cart-display', {
                state: {}
            })

            await waitForUpdate(100)

            // Initially empty
            let items = testContainer.querySelectorAll('.cart-item')
            expect(items.length).toBe(0)

            // Add item to store
            const cart = wildflower.getStore('cart')
            cart.addItem({ name: 'Apple', price: 1.50 })

            await waitForUpdate(100)

            // Should now have 1 item
            items = testContainer.querySelectorAll('.cart-item')
            expect(items.length).toBe(1)
            expect(items[0].querySelector('.name').textContent).toBe('Apple')

            // Add another item
            cart.addItem({ name: 'Orange', price: 2.00 })

            await waitForUpdate(100)

            // Should now have 2 items
            items = testContainer.querySelectorAll('.cart-item')
            expect(items.length).toBe(2)
        })

        it('should update list when items are removed from store', async () => {
            wildflower.store('todo', {
                state: {
                    items: [
                        { id: 1, text: 'Task 1' },
                        { id: 2, text: 'Task 2' },
                        { id: 3, text: 'Task 3' }
                    ]
                },
                removeItem(id) {
                    this.state.items = this.state.items.filter(item => item.id !== id)
                }
            })

            testContainer.innerHTML = `
                <div data-component="todo-display">
                    <div data-list="external('todo', 'items')">
                        <template>
                            <div class="todo-item" data-bind="text"></div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('todo-display', {
                state: {}
            })

            await waitForUpdate(100)

            // Initially 3 items
            let items = testContainer.querySelectorAll('.todo-item')
            expect(items.length).toBe(3)

            // Remove middle item
            const todo = wildflower.getStore('todo')
            todo.removeItem(2)

            await waitForUpdate(100)

            // Should now have 2 items
            items = testContainer.querySelectorAll('.todo-item')
            expect(items.length).toBe(2)
            expect(items[0].textContent).toBe('Task 1')
            expect(items[1].textContent).toBe('Task 3')
        })

        it('should work with computed store properties for list data', async () => {
            wildflower.store('filtered-store', {
                state: {
                    allItems: [
                        { name: 'Active 1', active: true },
                        { name: 'Inactive 1', active: false },
                        { name: 'Active 2', active: true }
                    ]
                },
                computed: {
                    activeItems() {
                        return this.state.allItems.filter(item => item.active)
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="filtered-display">
                    <div data-list="external('filtered-store', 'computed:activeItems')">
                        <template>
                            <div class="active-item" data-bind="name"></div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('filtered-display', {
                state: {}
            })

            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.active-item')
            expect(items.length).toBe(2)
            expect(items[0].textContent).toBe('Active 1')
            expect(items[1].textContent).toBe('Active 2')
        })
    })
})
