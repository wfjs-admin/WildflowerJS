/**
 * Details Object Enhancement Tests
 *
 * TDD tests for adding `length`, `first`, and `last` properties to the
 * details object passed to action handlers in list contexts.
 *
 * These properties provide parity with template-level context variables
 * (_index, _length, _first, _last) but in action handlers.
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

describe('Details Object Enhancements', () => {
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

    describe('details.length', () => {
        it('should provide list length in action handler', async () => {
            let capturedLength = null

            wildflower.component('length-test', {
                state: {
                    items: [
                        { id: 1, name: 'Item 1' },
                        { id: 2, name: 'Item 2' },
                        { id: 3, name: 'Item 3' }
                    ]
                },
                handleClick(event, element, details) {
                    capturedLength = details.length
                }
            })

            testContainer.innerHTML = `
                <div data-component="length-test">
                    <ul data-list="items">
                        <template>
                            <li>
                                <span data-bind="name"></span>
                                <button class="click-btn" data-action="handleClick">Click</button>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const buttons = testContainer.querySelectorAll('.click-btn')
            buttons[0].click()
            await waitForUpdate()

            expect(capturedLength).toBe(3)
        })

        it('should update length when list changes', async () => {
            let capturedLength = null

            wildflower.component('length-update-test', {
                state: {
                    items: [
                        { id: 1, name: 'Item 1' },
                        { id: 2, name: 'Item 2' }
                    ]
                },
                addItem() {
                    this.state.items.push({ id: 3, name: 'Item 3' })
                },
                checkLength(event, element, details) {
                    capturedLength = details.length
                }
            })

            testContainer.innerHTML = `
                <div data-component="length-update-test">
                    <button class="add-btn" data-action="addItem">Add</button>
                    <ul data-list="items">
                        <template>
                            <li>
                                <span data-bind="name"></span>
                                <button class="check-btn" data-action="checkLength">Check</button>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            // Initial length check
            let checkButtons = testContainer.querySelectorAll('.check-btn')
            checkButtons[0].click()
            await waitForUpdate()
            expect(capturedLength).toBe(2)

            // Add item
            testContainer.querySelector('.add-btn').click()
            await waitForUpdate()

            // Check length again
            checkButtons = testContainer.querySelectorAll('.check-btn')
            checkButtons[0].click()
            await waitForUpdate()
            expect(capturedLength).toBe(3)
        })
    })

    describe('details.first', () => {
        it('should be true for first item only', async () => {
            const capturedFirst = []

            wildflower.component('first-test', {
                state: {
                    items: [
                        { id: 1, name: 'Item 1' },
                        { id: 2, name: 'Item 2' },
                        { id: 3, name: 'Item 3' }
                    ]
                },
                handleClick(event, element, details) {
                    capturedFirst.push(details.first)
                }
            })

            testContainer.innerHTML = `
                <div data-component="first-test">
                    <ul data-list="items">
                        <template>
                            <li>
                                <span data-bind="name"></span>
                                <button class="click-btn" data-action="handleClick">Click</button>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const buttons = testContainer.querySelectorAll('.click-btn')

            // Click all buttons in order
            buttons[0].click()
            await waitForUpdate()
            buttons[1].click()
            await waitForUpdate()
            buttons[2].click()
            await waitForUpdate()

            expect(capturedFirst).toEqual([true, false, false])
        })

        it('should update after removing first item', async () => {
            let capturedFirst = null

            wildflower.component('first-update-test', {
                state: {
                    items: [
                        { id: 1, name: 'Item 1' },
                        { id: 2, name: 'Item 2' },
                        { id: 3, name: 'Item 3' }
                    ]
                },
                removeFirst() {
                    this.state.items.shift()
                },
                checkFirst(event, element, details) {
                    capturedFirst = details.first
                }
            })

            testContainer.innerHTML = `
                <div data-component="first-update-test">
                    <button class="remove-btn" data-action="removeFirst">Remove First</button>
                    <ul data-list="items">
                        <template>
                            <li>
                                <span data-bind="name"></span>
                                <button class="check-btn" data-action="checkFirst">Check</button>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            // Initially, second item (index 1) should NOT be first
            let checkButtons = testContainer.querySelectorAll('.check-btn')
            checkButtons[1].click()
            await waitForUpdate()
            expect(capturedFirst).toBe(false)

            // Remove first item
            testContainer.querySelector('.remove-btn').click()
            await waitForUpdate()

            // Now the formerly-second item (Item 2) should be first
            checkButtons = testContainer.querySelectorAll('.check-btn')
            checkButtons[0].click()
            await waitForUpdate()
            expect(capturedFirst).toBe(true)
        })
    })

    describe('details.last', () => {
        it('should be true for last item only', async () => {
            const capturedLast = []

            wildflower.component('last-test', {
                state: {
                    items: [
                        { id: 1, name: 'Item 1' },
                        { id: 2, name: 'Item 2' },
                        { id: 3, name: 'Item 3' }
                    ]
                },
                handleClick(event, element, details) {
                    capturedLast.push(details.last)
                }
            })

            testContainer.innerHTML = `
                <div data-component="last-test">
                    <ul data-list="items">
                        <template>
                            <li>
                                <span data-bind="name"></span>
                                <button class="click-btn" data-action="handleClick">Click</button>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const buttons = testContainer.querySelectorAll('.click-btn')

            // Click all buttons in order
            buttons[0].click()
            await waitForUpdate()
            buttons[1].click()
            await waitForUpdate()
            buttons[2].click()
            await waitForUpdate()

            expect(capturedLast).toEqual([false, false, true])
        })

        it('should update after removing last item', async () => {
            let capturedLast = null

            wildflower.component('last-update-test', {
                state: {
                    items: [
                        { id: 1, name: 'Item 1' },
                        { id: 2, name: 'Item 2' },
                        { id: 3, name: 'Item 3' }
                    ]
                },
                removeLast() {
                    this.state.items.pop()
                },
                checkLast(event, element, details) {
                    capturedLast = details.last
                }
            })

            testContainer.innerHTML = `
                <div data-component="last-update-test">
                    <button class="remove-btn" data-action="removeLast">Remove Last</button>
                    <ul data-list="items">
                        <template>
                            <li>
                                <span data-bind="name"></span>
                                <button class="check-btn" data-action="checkLast">Check</button>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            // Initially, second item (index 1) should NOT be last
            let checkButtons = testContainer.querySelectorAll('.check-btn')
            checkButtons[1].click()
            await waitForUpdate()
            expect(capturedLast).toBe(false)

            // Remove last item
            testContainer.querySelector('.remove-btn').click()
            await waitForUpdate()

            // Now Item 2 should be last
            checkButtons = testContainer.querySelectorAll('.check-btn')
            checkButtons[1].click()
            await waitForUpdate()
            expect(capturedLast).toBe(true)
        })
    })

    describe('details object completeness', () => {
        it('should have all expected properties in list action handler', async () => {
            let capturedDetails = null

            wildflower.component('complete-details-test', {
                state: {
                    items: [
                        { id: 1, name: 'Item 1' },
                        { id: 2, name: 'Item 2' },
                        { id: 3, name: 'Item 3' }
                    ]
                },
                captureDetails(event, element, details) {
                    capturedDetails = details
                }
            })

            testContainer.innerHTML = `
                <div data-component="complete-details-test">
                    <ul data-list="items">
                        <template>
                            <li>
                                <span data-bind="name"></span>
                                <button class="click-btn" data-action="captureDetails">Click</button>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            // Click second item (index 1)
            const buttons = testContainer.querySelectorAll('.click-btn')
            buttons[1].click()
            await waitForUpdate()

            // Verify all expected properties exist
            expect(capturedDetails).toBeDefined()
            expect(capturedDetails.index).toBe(1)
            // Use JSON round-trip to strip Symbol properties for comparison
            expect(JSON.parse(JSON.stringify(capturedDetails.item))).toEqual({ id: 2, name: 'Item 2' })
            expect(capturedDetails.list).toHaveLength(3)
            expect(capturedDetails.length).toBe(3)
            expect(capturedDetails.first).toBe(false)
            expect(capturedDetails.last).toBe(false)
        })

        it('should have correct values for single-item list', async () => {
            let capturedDetails = null

            wildflower.component('single-item-test', {
                state: {
                    items: [{ id: 1, name: 'Only Item' }]
                },
                captureDetails(event, element, details) {
                    capturedDetails = details
                }
            })

            testContainer.innerHTML = `
                <div data-component="single-item-test">
                    <ul data-list="items">
                        <template>
                            <li>
                                <span data-bind="name"></span>
                                <button class="click-btn" data-action="captureDetails">Click</button>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const button = testContainer.querySelector('.click-btn')
            button.click()
            await waitForUpdate()

            // Single item should be both first AND last
            expect(capturedDetails.index).toBe(0)
            expect(capturedDetails.length).toBe(1)
            expect(capturedDetails.first).toBe(true)
            expect(capturedDetails.last).toBe(true)
        })
    })

    describe('computed lists', () => {
        it('should provide correct details for computed list actions', async () => {
            let capturedDetails = null

            wildflower.component('computed-details-test', {
                state: {
                    items: [
                        { id: 1, name: 'Item 1', active: true },
                        { id: 2, name: 'Item 2', active: false },
                        { id: 3, name: 'Item 3', active: true }
                    ]
                },
                computed: {
                    activeItems() {
                        return this.state.items.filter(item => item.active)
                    }
                },
                captureDetails(event, element, details) {
                    capturedDetails = details
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-details-test">
                    <ul data-list="computed:activeItems">
                        <template>
                            <li>
                                <span data-bind="name"></span>
                                <button class="click-btn" data-action="captureDetails">Click</button>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            // Should only show 2 active items
            const buttons = testContainer.querySelectorAll('.click-btn')
            expect(buttons.length).toBe(2)

            // Click second (last) active item
            buttons[1].click()
            await waitForUpdate()

            // Details should reflect computed list, not source array
            expect(capturedDetails.index).toBe(1)
            expect(capturedDetails.length).toBe(2)
            expect(capturedDetails.first).toBe(false)
            expect(capturedDetails.last).toBe(true)
            expect(capturedDetails.item.name).toBe('Item 3')
        })
    })

    describe('nested lists', () => {
        it('should provide correct details for inner list actions', async () => {
            let capturedDetails = null

            wildflower.component('nested-details-test', {
                state: {
                    categories: [
                        {
                            name: 'Category 1',
                            items: [
                                { id: 1, name: 'Item 1.1' },
                                { id: 2, name: 'Item 1.2' }
                            ]
                        },
                        {
                            name: 'Category 2',
                            items: [
                                { id: 3, name: 'Item 2.1' },
                                { id: 4, name: 'Item 2.2' },
                                { id: 5, name: 'Item 2.3' }
                            ]
                        }
                    ]
                },
                captureDetails(event, element, details) {
                    capturedDetails = details
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-details-test">
                    <div data-list="categories">
                        <template>
                            <div class="category">
                                <h3 data-bind="name"></h3>
                                <ul data-list="items">
                                    <template>
                                        <li>
                                            <span data-bind="name"></span>
                                            <button class="click-btn" data-action="captureDetails">Click</button>
                                        </li>
                                    </template>
                                </ul>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            // Get buttons from second category (which has 3 items)
            const categories = testContainer.querySelectorAll('.category')
            const secondCategoryButtons = categories[1].querySelectorAll('.click-btn')

            // Click last item in second category
            secondCategoryButtons[2].click()
            await waitForUpdate()

            // Should reflect inner list context
            expect(capturedDetails.index).toBe(2)
            expect(capturedDetails.length).toBe(3)
            expect(capturedDetails.first).toBe(false)
            expect(capturedDetails.last).toBe(true)
            expect(capturedDetails.item.name).toBe('Item 2.3')
        })
    })
})
