/**
 * Model Binding Debounce Tests
 *
 * Tests that data-model-debounce works correctly in both regular lists
 * and computed lists to delay state updates during rapid typing.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
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

describe('Model Binding Debounce', () => {
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

    describe('Regular List Debounce', () => {
        it('should delay state update when using debounce in regular list', async () => {
            wildflower.component('debounce-regular-list', {
                state: {
                    items: [
                        { id: 1, name: 'Item 1' },
                        { id: 2, name: 'Item 2' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="debounce-regular-list">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <input type="text" data-model="name" data-model-debounce="200" class="name-input">
                                <span class="name-display" data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="debounce-regular-list"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            const inputs = testContainer.querySelectorAll('.name-input')
            const displays = testContainer.querySelectorAll('.name-display')

            // Initial state
            expect(displays[0].textContent).toBe('Item 1')
            expect(instance.state.items[0].name).toBe('Item 1')

            // Type rapidly (should not update state immediately)
            inputs[0].value = 'N'
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(50)

            inputs[0].value = 'Ne'
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(50)

            inputs[0].value = 'New'
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(50)

            // State should still be old value (debounce hasn't fired yet)
            expect(instance.state.items[0].name).toBe('Item 1')

            // Wait for debounce to complete
            await waitForUpdate(250)

            // Now state should be updated
            expect(instance.state.items[0].name).toBe('New')
        })

        it('should use default debounce time of 300ms', async () => {
            wildflower.component('debounce-default-time', {
                state: {
                    items: [{ id: 1, value: 'initial' }]
                }
            })

            testContainer.innerHTML = `
                <div data-component="debounce-default-time">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <input type="text" data-model="value" data-model-debounce class="val-input">
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="debounce-default-time"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            const input = testContainer.querySelector('.val-input')

            // Type and wait less than 300ms
            input.value = 'changed'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(200)

            // Should not have updated yet
            expect(instance.state.items[0].value).toBe('initial')

            // Wait for rest of debounce
            await waitForUpdate(150)

            // Now should be updated
            expect(instance.state.items[0].value).toBe('changed')
        })
    })

    describe('Computed List Debounce', () => {
        it('should delay state update when using debounce in computed list', async () => {
            wildflower.component('debounce-computed-list', {
                state: {
                    tasks: [
                        { id: 1, title: 'Task 1', active: true },
                        { id: 2, title: 'Task 2', active: true },
                        { id: 3, title: 'Task 3', active: false }
                    ]
                },
                computed: {
                    activeTasks() {
                        return this.state.tasks.filter(t => t.active)
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="debounce-computed-list">
                    <div data-list="computed:activeTasks">
                        <template>
                            <div class="task">
                                <input type="text" data-model="title" data-model-debounce="150" class="title-input">
                                <span class="title-display" data-bind="title"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="debounce-computed-list"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            const tasks = testContainer.querySelectorAll('.task')
            expect(tasks.length).toBe(2) // Only active tasks

            const inputs = testContainer.querySelectorAll('.title-input')

            // Type rapidly in first input
            inputs[0].value = 'Updated'
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(50)

            // State should still be old value
            expect(instance.state.tasks[0].title).toBe('Task 1')

            // Wait for debounce
            await waitForUpdate(200)

            // Now should be updated
            expect(instance.state.tasks[0].title).toBe('Updated')

            // Second item should be unchanged
            expect(instance.state.tasks[1].title).toBe('Task 2')
        })

        it('should handle debounce with nested property in computed list', async () => {
            wildflower.component('debounce-nested-computed', {
                state: {
                    users: [
                        { id: 1, profile: { bio: 'Bio 1' }, visible: true },
                        { id: 2, profile: { bio: 'Bio 2' }, visible: true }
                    ]
                },
                computed: {
                    visibleUsers() {
                        return this.state.users.filter(u => u.visible)
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="debounce-nested-computed">
                    <div data-list="computed:visibleUsers">
                        <template>
                            <div class="user">
                                <textarea data-model="profile.bio" data-model-debounce="100" class="bio-input"></textarea>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="debounce-nested-computed"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            const textareas = testContainer.querySelectorAll('.bio-input')

            // Verify initial value
            expect(textareas[0].value).toBe('Bio 1')

            // Type with debounce
            textareas[0].value = 'New Bio Content'
            textareas[0].dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(50)

            // Should not be updated yet
            expect(instance.state.users[0].profile.bio).toBe('Bio 1')

            // Wait for debounce
            await waitForUpdate(100)

            // Now should be updated
            expect(instance.state.users[0].profile.bio).toBe('New Bio Content')
        })

        it('should cancel previous debounce on new input', async () => {
            wildflower.component('debounce-cancel-previous', {
                state: {
                    items: [{ id: 1, search: '', active: true }]
                },
                computed: {
                    activeItems() {
                        return this.state.items.filter(i => i.active)
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="debounce-cancel-previous">
                    <div data-list="computed:activeItems">
                        <template>
                            <div class="item">
                                <input type="text" data-model="search" data-model-debounce="200" class="search-input">
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="debounce-cancel-previous"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            const input = testContainer.querySelector('.search-input')

            // Type 'first' and wait half the debounce time
            input.value = 'first'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(100)

            // Type 'second' before debounce fires - should cancel 'first'
            input.value = 'second'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(100)

            // At this point (200ms from first, 100ms from second), state should still be empty
            // because 'second' reset the debounce timer
            expect(instance.state.items[0].search).toBe('')

            // Wait for the debounce on 'second' to complete
            await waitForUpdate(150)

            // State should be 'second', not 'first'
            expect(instance.state.items[0].search).toBe('second')
        })
    })

    describe('Edge Cases', () => {
        it('should handle debounce with number input in list', async () => {
            wildflower.component('debounce-number-input', {
                state: {
                    quantities: [
                        { id: 1, amount: 10 },
                        { id: 2, amount: 20 }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="debounce-number-input">
                    <div data-list="quantities">
                        <template>
                            <div class="qty-row">
                                <input type="number" data-model="amount" data-model-debounce="150" class="amount-input">
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="debounce-number-input"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            const inputs = testContainer.querySelectorAll('.amount-input')

            // Change number with debounce
            inputs[0].value = '100'
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(50)

            // Should not be updated yet
            expect(instance.state.quantities[0].amount).toBe(10)

            // Wait for debounce
            await waitForUpdate(150)

            // Now should be updated (as number, not string)
            expect(instance.state.quantities[0].amount).toBe(100)
        })

        it('should independently debounce different inputs in list', async () => {
            wildflower.component('debounce-independent', {
                state: {
                    fields: [
                        { id: 1, value: 'a' },
                        { id: 2, value: 'b' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="debounce-independent">
                    <div data-list="fields">
                        <template>
                            <div class="field">
                                <input type="text" data-model="value" data-model-debounce="150" class="field-input">
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="debounce-independent"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            const inputs = testContainer.querySelectorAll('.field-input')

            // Type in first input
            inputs[0].value = 'first-changed'
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(75)

            // Type in second input (75ms later)
            inputs[1].value = 'second-changed'
            inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(100)

            // First should have updated (150ms passed), second should not (only 100ms)
            expect(instance.state.fields[0].value).toBe('first-changed')
            expect(instance.state.fields[1].value).toBe('b')

            // Wait for second to complete
            await waitForUpdate(75)

            expect(instance.state.fields[1].value).toBe('second-changed')
        })
    })
})
