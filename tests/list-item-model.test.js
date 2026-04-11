/**
 * List Item Model Binding Tests
 *
 * Tests that data-model works correctly within regular lists (data-list="items").
 * Covers all input types: checkbox, text, number, select, radio buttons.
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

describe('List Item Model Binding - Regular Lists', () => {
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

    describe('Checkbox Binding', () => {
        it('should update state when checkbox is clicked in regular list', async () => {
            wildflower.component('checkbox-list-test', {
                state: {
                    items: [
                        { name: 'Item 1', done: false },
                        { name: 'Item 2', done: false },
                        { name: 'Item 3', done: true }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="checkbox-list-test">
                    <ul data-list="items">
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

            const component = testContainer.querySelector('[data-component="checkbox-list-test"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            // Initial state
            expect(instance.state.items[0].done).toBe(false)
            expect(instance.state.items[1].done).toBe(false)
            expect(instance.state.items[2].done).toBe(true)

            // Click first checkbox to check it
            const checkboxes = testContainer.querySelectorAll('.checkbox')
            checkboxes[0].checked = true
            checkboxes[0].dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate(100)

            expect(instance.state.items[0].done).toBe(true)

            // Click third checkbox to uncheck it
            checkboxes[2].checked = false
            checkboxes[2].dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate(100)

            expect(instance.state.items[2].done).toBe(false)
        })

        it('should reflect initial checkbox state from data', async () => {
            wildflower.component('checkbox-initial-test', {
                state: {
                    items: [
                        { name: 'Unchecked', active: false },
                        { name: 'Checked', active: true }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="checkbox-initial-test">
                    <ul data-list="items">
                        <template>
                            <li>
                                <input type="checkbox" data-model="active" class="cb">
                                <span data-bind="name"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const checkboxes = testContainer.querySelectorAll('.cb')
            expect(checkboxes[0].checked).toBe(false)
            expect(checkboxes[1].checked).toBe(true)
        })
    })

    describe('Text Input Binding', () => {
        it('should update state when text input changes in regular list', async () => {
            wildflower.component('text-list-test', {
                state: {
                    items: [
                        { name: 'First' },
                        { name: 'Second' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="text-list-test">
                    <ul data-list="items">
                        <template>
                            <li>
                                <input type="text" data-model="name" class="name-input">
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="text-list-test"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            const inputs = testContainer.querySelectorAll('.name-input')

            // Change first input
            inputs[0].value = 'Changed First'
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(100)

            expect(instance.state.items[0].name).toBe('Changed First')
            expect(instance.state.items[1].name).toBe('Second')

            // Change second input
            inputs[1].value = 'Changed Second'
            inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(100)

            expect(instance.state.items[1].name).toBe('Changed Second')
        })

        it('should reflect initial text value from data', async () => {
            wildflower.component('text-initial-test', {
                state: {
                    items: [
                        { title: 'Hello World' },
                        { title: 'Goodbye World' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="text-initial-test">
                    <ul data-list="items">
                        <template>
                            <li>
                                <input type="text" data-model="title" class="title-input">
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const inputs = testContainer.querySelectorAll('.title-input')
            expect(inputs[0].value).toBe('Hello World')
            expect(inputs[1].value).toBe('Goodbye World')
        })
    })

    describe('Number Input Binding', () => {
        it('should update state when number input changes in regular list', async () => {
            wildflower.component('number-list-test', {
                state: {
                    items: [
                        { quantity: 1 },
                        { quantity: 5 }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="number-list-test">
                    <ul data-list="items">
                        <template>
                            <li>
                                <input type="number" data-model="quantity" class="qty-input">
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="number-list-test"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            const inputs = testContainer.querySelectorAll('.qty-input')

            // Change first input
            inputs[0].value = '10'
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(100)

            expect(instance.state.items[0].quantity).toBe(10)
        })

        it('should reflect initial number value from data', async () => {
            wildflower.component('number-initial-test', {
                state: {
                    items: [
                        { count: 42 },
                        { count: 0 }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="number-initial-test">
                    <ul data-list="items">
                        <template>
                            <li>
                                <input type="number" data-model="count" class="count-input">
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const inputs = testContainer.querySelectorAll('.count-input')
            expect(inputs[0].value).toBe('42')
            expect(inputs[1].value).toBe('0')
        })
    })

    describe('Select Binding', () => {
        it('should update state when select changes in regular list', async () => {
            wildflower.component('select-list-test', {
                state: {
                    items: [
                        { priority: 'low' },
                        { priority: 'high' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="select-list-test">
                    <ul data-list="items">
                        <template>
                            <li>
                                <select data-model="priority" class="priority-select">
                                    <option value="low">Low</option>
                                    <option value="medium">Medium</option>
                                    <option value="high">High</option>
                                </select>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="select-list-test"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            const selects = testContainer.querySelectorAll('.priority-select')

            // Change first select
            selects[0].value = 'medium'
            selects[0].dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate(100)

            expect(instance.state.items[0].priority).toBe('medium')
            expect(instance.state.items[1].priority).toBe('high')
        })

        it('should reflect initial select value from data', async () => {
            wildflower.component('select-initial-test', {
                state: {
                    items: [
                        { status: 'pending' },
                        { status: 'complete' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="select-initial-test">
                    <ul data-list="items">
                        <template>
                            <li>
                                <select data-model="status" class="status-select">
                                    <option value="pending">Pending</option>
                                    <option value="active">Active</option>
                                    <option value="complete">Complete</option>
                                </select>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const selects = testContainer.querySelectorAll('.status-select')
            expect(selects[0].value).toBe('pending')
            expect(selects[1].value).toBe('complete')
        })
    })

    describe('Nested Property Binding', () => {
        it('should update nested property when input changes in regular list', async () => {
            wildflower.component('nested-model-test', {
                state: {
                    items: [
                        { user: { email: 'user1@test.com' } },
                        { user: { email: 'user2@test.com' } }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-model-test">
                    <ul data-list="items">
                        <template>
                            <li>
                                <input type="email" data-model="user.email" class="email-input">
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="nested-model-test"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            const inputs = testContainer.querySelectorAll('.email-input')

            // Change first input
            inputs[0].value = 'changed@test.com'
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(100)

            expect(instance.state.items[0].user.email).toBe('changed@test.com')
            expect(instance.state.items[1].user.email).toBe('user2@test.com')
        })
    })

    describe('Computed Property Updates', () => {
        it('should update computed properties when checkbox changes in regular list', async () => {
            wildflower.component('computed-update-test', {
                state: {
                    tasks: [
                        { text: 'Task 1', done: false },
                        { text: 'Task 2', done: false },
                        { text: 'Task 3', done: true }
                    ]
                },
                computed: {
                    completedCount() {
                        return this.state.tasks.filter(t => t.done).length
                    },
                    pendingCount() {
                        return this.state.tasks.filter(t => !t.done).length
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-update-test">
                    <p>Completed: <span class="completed" data-bind="computed:completedCount"></span></p>
                    <p>Pending: <span class="pending" data-bind="computed:pendingCount"></span></p>
                    <ul data-list="tasks">
                        <template>
                            <li>
                                <input type="checkbox" data-model="done" class="task-cb">
                                <span data-bind="text"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const completedEl = testContainer.querySelector('.completed')
            const pendingEl = testContainer.querySelector('.pending')

            // Initial: 1 completed, 2 pending
            expect(completedEl.textContent).toBe('1')
            expect(pendingEl.textContent).toBe('2')

            // Check first task
            const checkboxes = testContainer.querySelectorAll('.task-cb')
            checkboxes[0].checked = true
            checkboxes[0].dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate(100)

            expect(completedEl.textContent).toBe('2')
            expect(pendingEl.textContent).toBe('1')

            // Uncheck third task
            checkboxes[2].checked = false
            checkboxes[2].dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate(100)

            expect(completedEl.textContent).toBe('1')
            expect(pendingEl.textContent).toBe('2')
        })
    })
})
