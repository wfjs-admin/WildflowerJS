/**
 * External List Actions Test Suite
 *
 * Tests that actions inside data-list with external() expressions
 * properly receive details.item when triggered
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, waitForUpdate } from './helpers/load-framework.js'

describe('External List Actions', () => {
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

    describe('action in external list', () => {
        it('should receive details.item when action is triggered', async () => {
            let receivedDetails = null

            // Create store with items
            wildflower.store('cart', {
                state: {
                    items: [
                        { id: 1, name: 'Item 1', price: 10 },
                        { id: 2, name: 'Item 2', price: 20 },
                        { id: 3, name: 'Item 3', price: 30 }
                    ]
                },
                removeItem(itemId) {
                    this.state.items = this.state.items.filter(item => item.id !== itemId)
                }
            })

            testContainer.innerHTML = `
                <div data-component="cart-display">
                    <div data-list="external('cart', 'items')">
                        <template>
                            <div class="cart-item">
                                <span class="name" data-bind="name"></span>
                                <button class="remove-btn" data-action="removeItem">Remove</button>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('cart-display', {
                state: {},
                removeItem(event, element, details) {
                    receivedDetails = details
                    const cartStore = wildflower.getStore('cart')
                    cartStore.removeItem(details.item.id)
                }
            })

            await waitForUpdate(100)

            // Verify items rendered
            const items = testContainer.querySelectorAll('.cart-item')
            expect(items.length).toBe(3)

            // Click the remove button on the second item
            const removeBtn = items[1].querySelector('.remove-btn')
            removeBtn.click()

            await waitForUpdate(100)

            // Verify details was received
            expect(receivedDetails).not.toBeNull()
            expect(receivedDetails.index).toBe(1)
            expect(receivedDetails.item).toBeDefined()
            expect(receivedDetails.item.id).toBe(2)
            expect(receivedDetails.item.name).toBe('Item 2')

            // Verify item was removed
            const remainingItems = testContainer.querySelectorAll('.cart-item')
            expect(remainingItems.length).toBe(2)
        })

        it('should receive details.item for first item', async () => {
            let receivedDetails = null

            wildflower.store('test-store', {
                state: {
                    items: [
                        { id: 100, value: 'First' },
                        { id: 200, value: 'Second' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="test-component">
                    <div data-list="external('test-store', 'items')">
                        <template>
                            <div class="item">
                                <button class="action-btn" data-action="handleClick">Click</button>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('test-component', {
                state: {},
                handleClick(event, element, details) {
                    receivedDetails = details
                }
            })

            await waitForUpdate(100)

            // Click first item's button
            const firstBtn = testContainer.querySelector('.item .action-btn')
            firstBtn.click()

            await waitForUpdate(50)

            expect(receivedDetails).not.toBeNull()
            expect(receivedDetails.index).toBe(0)
            expect(receivedDetails.item).toBeDefined()
            expect(receivedDetails.item.id).toBe(100)
            expect(receivedDetails.item.value).toBe('First')
        })

        it('should receive details.item for last item', async () => {
            let receivedDetails = null

            wildflower.store('test-store-2', {
                state: {
                    items: [
                        { id: 'a', label: 'Alpha' },
                        { id: 'b', label: 'Beta' },
                        { id: 'c', label: 'Gamma' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="test-component-2">
                    <div data-list="external('test-store-2', 'items')">
                        <template>
                            <div class="item">
                                <button class="action-btn" data-action="handleClick">Click</button>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('test-component-2', {
                state: {},
                handleClick(event, element, details) {
                    receivedDetails = details
                }
            })

            await waitForUpdate(100)

            // Click last item's button
            const items = testContainer.querySelectorAll('.item')
            const lastBtn = items[items.length - 1].querySelector('.action-btn')
            lastBtn.click()

            await waitForUpdate(50)

            expect(receivedDetails).not.toBeNull()
            expect(receivedDetails.index).toBe(2)
            expect(receivedDetails.item).toBeDefined()
            expect(receivedDetails.item.id).toBe('c')
            expect(receivedDetails.item.label).toBe('Gamma')
            expect(receivedDetails.last).toBe(true)
        })
    })
})
