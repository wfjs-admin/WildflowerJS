/**
 * Computed List Model Binding Tests
 *
 * Tests that data-model works correctly within computed lists (data-list="computed:...").
 *
 * The fix involved updating _updateModelValue to handle computed lists by:
 * 1. Detecting when listContext.path starts with 'computed:'
 * 2. Updating the original item by reference (since computed arrays contain refs to originals)
 * 3. Clearing the computed cache to trigger re-evaluation
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

describe('Computed List Model Binding', () => {
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

    it('should update state when checkbox is clicked in computed list', async () => {
        wildflower.component('computed-checkbox-test', {
            state: {
                items: [
                    { name: 'Item 1', done: false },
                    { name: 'Item 2', done: false },
                    { name: 'Item 3', done: false }
                ]
            },
            computed: {
                filteredItems() {
                    return this.state.items
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="computed-checkbox-test">
                <ul data-list="computed:filteredItems">
                    <template>
                        <li class="item">
                            <input type="checkbox" data-model="done" class="checkbox">
                            <span data-bind="name"></span>
                        </li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const component = testContainer.querySelector('[data-component="computed-checkbox-test"]')
        const instance = wildflower.componentInstances.get(component.dataset.componentId)

        // Initial state - all unchecked
        expect(instance.state.items[0].done).toBe(false)
        expect(instance.state.items[1].done).toBe(false)

        // Click first checkbox
        const checkboxes = testContainer.querySelectorAll('.checkbox')
        checkboxes[0].checked = true
        checkboxes[0].dispatchEvent(new Event('change', { bubbles: true }))
        await waitForUpdate(100)

        // State should be updated
        expect(instance.state.items[0].done).toBe(true)
        expect(instance.state.items[1].done).toBe(false)

        // Click second checkbox
        checkboxes[1].checked = true
        checkboxes[1].dispatchEvent(new Event('change', { bubbles: true }))
        await waitForUpdate(100)

        expect(instance.state.items[0].done).toBe(true)
        expect(instance.state.items[1].done).toBe(true)
    })

    it('should update computed properties when checkbox is clicked in computed list', async () => {
        wildflower.component('computed-counter-test', {
            state: {
                items: [
                    { name: 'Item 1', done: false },
                    { name: 'Item 2', done: false },
                    { name: 'Item 3', done: false }
                ]
            },
            computed: {
                filteredItems() {
                    return this.state.items
                },
                doneCount() {
                    return this.state.items.filter(i => i.done).length
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="computed-counter-test">
                <p>Done: <span class="done-count" data-bind="computed:doneCount"></span></p>
                <ul data-list="computed:filteredItems">
                    <template>
                        <li class="item">
                            <input type="checkbox" data-model="done" class="checkbox">
                            <span data-bind="name"></span>
                        </li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const doneCountEl = testContainer.querySelector('.done-count')

        // Initial count should be 0
        expect(doneCountEl.textContent).toBe('0')

        // Click first checkbox
        const checkboxes = testContainer.querySelectorAll('.checkbox')
        checkboxes[0].checked = true
        checkboxes[0].dispatchEvent(new Event('change', { bubbles: true }))
        await waitForUpdate(100)

        // Count should update to 1
        expect(doneCountEl.textContent).toBe('1')

        // Click second checkbox
        checkboxes[1].checked = true
        checkboxes[1].dispatchEvent(new Event('change', { bubbles: true }))
        await waitForUpdate(100)

        // Count should update to 2
        expect(doneCountEl.textContent).toBe('2')

        // Uncheck first checkbox
        checkboxes[0].checked = false
        checkboxes[0].dispatchEvent(new Event('change', { bubbles: true }))
        await waitForUpdate(100)

        // Count should update back to 1
        expect(doneCountEl.textContent).toBe('1')
    })

    it('should work with filtered computed list', async () => {
        wildflower.component('filtered-list-test', {
            state: {
                items: [
                    { name: 'Active 1', done: false },
                    { name: 'Done 1', done: true },
                    { name: 'Active 2', done: false }
                ]
            },
            computed: {
                activeItems() {
                    return this.state.items.filter(i => !i.done)
                },
                activeCount() {
                    return this.state.items.filter(i => !i.done).length
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="filtered-list-test">
                <p>Active: <span class="active-count" data-bind="computed:activeCount"></span></p>
                <ul data-list="computed:activeItems">
                    <template>
                        <li class="item">
                            <input type="checkbox" data-model="done" class="checkbox">
                            <span data-bind="name"></span>
                        </li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const activeCountEl = testContainer.querySelector('.active-count')

        // Initial: 2 active items
        expect(activeCountEl.textContent).toBe('2')

        // Check first active item (should mark it done)
        const checkboxes = testContainer.querySelectorAll('.checkbox')
        expect(checkboxes.length).toBe(2) // Only 2 active items shown

        checkboxes[0].click()
        await waitForUpdate()

        // Now only 1 active item
        expect(activeCountEl.textContent).toBe('1')
    })

    it('should work with text input in computed list', async () => {
        wildflower.component('text-input-test', {
            state: {
                items: [
                    { name: 'Original 1' },
                    { name: 'Original 2' }
                ]
            },
            computed: {
                allItems() {
                    return this.state.items
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="text-input-test">
                <ul data-list="computed:allItems">
                    <template>
                        <li class="item">
                            <input type="text" data-model="name" class="name-input">
                            <span class="name-display" data-bind="name"></span>
                        </li>
                    </template>
                </ul>
            </div>
        `

        wildflower.scan()
        await waitForCompleteRender()

        const component = testContainer.querySelector('[data-component="text-input-test"]')
        const instance = wildflower.componentInstances.get(component.dataset.componentId)

        // Change first input
        const inputs = testContainer.querySelectorAll('.name-input')
        inputs[0].value = 'Changed 1'
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
        await waitForUpdate()

        // State should be updated
        expect(instance.state.items[0].name).toBe('Changed 1')
    })
})
