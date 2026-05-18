/**
 * List Bulk Update Test Suite
 *
 * Tests that bulk updates to list items (e.g., marking all complete via forEach)
 * properly update all binding types:
 * - data-model (checkbox, select, text input)
 * - data-bind-class with computed: prefix
 * - data-bind-class with inline expressions
 * - data-bind-style with inline expressions
 * - Toggle operations (inverting state)
 * - Single item direct mutations
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('List Bulk Update', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()

        if (wildflower._initContextSystem) {
            wildflower._contextSystemInitialized = false
            wildflower._initContextSystem()
        }

        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
    })

    describe('forEach bulk update', () => {
        it('should update data-model checkboxes when items are mutated via forEach', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="bulk-checkbox">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <input type="checkbox" class="check" data-model="completed">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                    <button data-action="markAllComplete">Mark All</button>
                </div>
            `

            wildflower.component('bulk-checkbox', {
                state: {
                    items: [
                        { name: 'Item 1', completed: false },
                        { name: 'Item 2', completed: false },
                        { name: 'Item 3', completed: false }
                    ]
                },
                init() { instance = this },
                markAllComplete() {
                    this.state.items.forEach(item => {
                        item.completed = true
                    })
                }
            })

            await waitForUpdate(100)

            // Initial state - all unchecked
            const checkboxes = testContainer.querySelectorAll('.check')
            expect(checkboxes.length).toBe(3)
            expect(checkboxes[0].checked).toBe(false)
            expect(checkboxes[1].checked).toBe(false)
            expect(checkboxes[2].checked).toBe(false)

            // Click mark all complete
            testContainer.querySelector('button').click()
            await waitForUpdate(100)

            // All checkboxes should now be checked
            expect(checkboxes[0].checked).toBe(true)
            expect(checkboxes[1].checked).toBe(true)
            expect(checkboxes[2].checked).toBe(true)
        })

        it('should update inline expression class bindings when items are mutated via forEach', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="bulk-inline-class">
                    <div data-list="items">
                        <template>
                            <div class="item" data-bind-class="completed ? 'done' : 'pending'">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                    <button data-action="markAllComplete">Mark All</button>
                </div>
            `

            wildflower.component('bulk-inline-class', {
                state: {
                    items: [
                        { name: 'Item 1', completed: false },
                        { name: 'Item 2', completed: false },
                        { name: 'Item 3', completed: false }
                    ]
                },
                init() { instance = this },
                markAllComplete() {
                    this.state.items.forEach(item => {
                        item.completed = true
                    })
                }
            })

            await waitForUpdate(100)

            // Initial state - all pending
            const items = testContainer.querySelectorAll('.item')
            expect(items[0].classList.contains('pending')).toBe(true)
            expect(items[1].classList.contains('pending')).toBe(true)
            expect(items[2].classList.contains('pending')).toBe(true)

            // Click mark all complete
            testContainer.querySelector('button').click()
            await waitForUpdate(100)

            // All items should now have 'done' class
            expect(items[0].classList.contains('done')).toBe(true)
            expect(items[1].classList.contains('done')).toBe(true)
            expect(items[2].classList.contains('done')).toBe(true)
        })

        it('should update computed: class bindings when items are mutated via forEach', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="bulk-computed-class">
                    <div data-list="items">
                        <template>
                            <div class="item" data-bind-class="computed:itemClass">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                    <button data-action="markAllComplete">Mark All</button>
                </div>
            `

            wildflower.component('bulk-computed-class', {
                state: {
                    items: [
                        { name: 'Item 1', completed: false },
                        { name: 'Item 2', completed: false },
                        { name: 'Item 3', completed: false }
                    ]
                },
                computed: {
                    itemClass(item) {
                        return item && item.completed ? 'done' : 'pending'
                    }
                },
                init() { instance = this },
                markAllComplete() {
                    this.state.items.forEach(item => {
                        item.completed = true
                    })
                }
            })

            await waitForUpdate(100)

            // Initial state - all pending
            const items = testContainer.querySelectorAll('.item')
            expect(items[0].classList.contains('pending')).toBe(true)
            expect(items[1].classList.contains('pending')).toBe(true)
            expect(items[2].classList.contains('pending')).toBe(true)

            // Click mark all complete
            testContainer.querySelector('button').click()
            await waitForUpdate(100)

            // All items should now have 'done' class
            expect(items[0].classList.contains('done')).toBe(true)
            expect(items[1].classList.contains('done')).toBe(true)
            expect(items[2].classList.contains('done')).toBe(true)
        })

        it('should update multiple binding types simultaneously via forEach', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="bulk-multi-binding">
                    <div data-list="items">
                        <template>
                            <div class="item" data-bind-class="completed ? 'bg-success' : 'bg-light'">
                                <input type="checkbox" class="check" data-model="completed">
                                <span class="text" data-bind-class="completed ? 'text-muted line-through' : ''">
                                    <span data-bind="name"></span>
                                </span>
                            </div>
                        </template>
                    </div>
                    <button data-action="markAllComplete">Mark All</button>
                </div>
            `

            wildflower.component('bulk-multi-binding', {
                state: {
                    items: [
                        { name: 'Item 1', completed: false },
                        { name: 'Item 2', completed: true },  // One already complete
                        { name: 'Item 3', completed: false }
                    ]
                },
                init() { instance = this },
                markAllComplete() {
                    this.state.items.forEach(item => {
                        item.completed = true
                    })
                }
            })

            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            const checkboxes = testContainer.querySelectorAll('.check')
            const texts = testContainer.querySelectorAll('.text')

            // Initial state
            expect(checkboxes[0].checked).toBe(false)
            expect(checkboxes[1].checked).toBe(true)  // Already complete
            expect(checkboxes[2].checked).toBe(false)
            expect(items[0].classList.contains('bg-light')).toBe(true)
            expect(items[1].classList.contains('bg-success')).toBe(true)
            expect(items[2].classList.contains('bg-light')).toBe(true)

            // Click mark all complete
            testContainer.querySelector('button').click()
            await waitForUpdate(100)

            // All should be complete now
            expect(checkboxes[0].checked).toBe(true)
            expect(checkboxes[1].checked).toBe(true)
            expect(checkboxes[2].checked).toBe(true)
            expect(items[0].classList.contains('bg-success')).toBe(true)
            expect(items[1].classList.contains('bg-success')).toBe(true)
            expect(items[2].classList.contains('bg-success')).toBe(true)
            expect(texts[0].classList.contains('text-muted')).toBe(true)
            expect(texts[1].classList.contains('text-muted')).toBe(true)
            expect(texts[2].classList.contains('text-muted')).toBe(true)
        })
    })

    describe('style bindings', () => {
        it('should update data-bind-style when items are mutated via forEach', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="bulk-style">
                    <div data-list="items">
                        <template>
                            <div class="item" data-bind-style="{ backgroundColor: completed ? 'green' : 'red' }">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                    <button data-action="markAllComplete">Mark All</button>
                </div>
            `

            wildflower.component('bulk-style', {
                state: {
                    items: [
                        { name: 'Item 1', completed: false },
                        { name: 'Item 2', completed: false },
                        { name: 'Item 3', completed: false }
                    ]
                },
                init() { instance = this },
                markAllComplete() {
                    this.state.items.forEach(item => {
                        item.completed = true
                    })
                }
            })

            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            // Initial state - all red
            expect(items[0].style.backgroundColor).toBe('red')
            expect(items[1].style.backgroundColor).toBe('red')
            expect(items[2].style.backgroundColor).toBe('red')

            // Click mark all complete
            testContainer.querySelector('button').click()
            await waitForUpdate(100)

            // All should be green
            expect(items[0].style.backgroundColor).toBe('green')
            expect(items[1].style.backgroundColor).toBe('green')
            expect(items[2].style.backgroundColor).toBe('green')
        })
    })

    describe('toggle operations', () => {
        it('should update bindings when toggling item state via forEach', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="bulk-toggle">
                    <div data-list="items">
                        <template>
                            <div class="item" data-bind-class="completed ? 'done' : 'pending'">
                                <input type="checkbox" class="check" data-model="completed">
                            </div>
                        </template>
                    </div>
                    <button data-action="toggleAll">Toggle All</button>
                </div>
            `

            wildflower.component('bulk-toggle', {
                state: {
                    items: [
                        { name: 'Item 1', completed: false },
                        { name: 'Item 2', completed: true },
                        { name: 'Item 3', completed: false }
                    ]
                },
                init() { instance = this },
                toggleAll() {
                    this.state.items.forEach(item => {
                        item.completed = !item.completed
                    })
                }
            })

            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            const checkboxes = testContainer.querySelectorAll('.check')

            // Initial state
            expect(checkboxes[0].checked).toBe(false)
            expect(checkboxes[1].checked).toBe(true)
            expect(checkboxes[2].checked).toBe(false)
            expect(items[0].classList.contains('pending')).toBe(true)
            expect(items[1].classList.contains('done')).toBe(true)
            expect(items[2].classList.contains('pending')).toBe(true)

            // Toggle all
            testContainer.querySelector('button').click()
            await waitForUpdate(100)

            // All should be inverted
            expect(checkboxes[0].checked).toBe(true)
            expect(checkboxes[1].checked).toBe(false)
            expect(checkboxes[2].checked).toBe(true)
            expect(items[0].classList.contains('done')).toBe(true)
            expect(items[1].classList.contains('pending')).toBe(true)
            expect(items[2].classList.contains('done')).toBe(true)
        })
    })

    describe('other form elements', () => {
        it('should update data-model select dropdown when items are mutated', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="bulk-select">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span data-bind="name"></span>
                                <select class="priority" data-model="priority">
                                    <option value="low">Low</option>
                                    <option value="medium">Medium</option>
                                    <option value="high">High</option>
                                </select>
                            </div>
                        </template>
                    </div>
                    <button data-action="setAllHigh">Set All High</button>
                </div>
            `

            wildflower.component('bulk-select', {
                state: {
                    items: [
                        { name: 'Item 1', priority: 'low' },
                        { name: 'Item 2', priority: 'medium' },
                        { name: 'Item 3', priority: 'low' }
                    ]
                },
                init() { instance = this },
                setAllHigh() {
                    this.state.items.forEach(item => {
                        item.priority = 'high'
                    })
                }
            })

            await waitForUpdate(100)

            const selects = testContainer.querySelectorAll('.priority')
            // Initial state
            expect(selects[0].value).toBe('low')
            expect(selects[1].value).toBe('medium')
            expect(selects[2].value).toBe('low')

            // Set all to high
            testContainer.querySelector('button').click()
            await waitForUpdate(100)

            // All should be high
            expect(selects[0].value).toBe('high')
            expect(selects[1].value).toBe('high')
            expect(selects[2].value).toBe('high')
        })

        it('should update data-model text input when items are mutated', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="bulk-input">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <input type="text" class="label" data-model="label">
                            </div>
                        </template>
                    </div>
                    <button data-action="clearLabels">Clear All</button>
                </div>
            `

            wildflower.component('bulk-input', {
                state: {
                    items: [
                        { label: 'First' },
                        { label: 'Second' },
                        { label: 'Third' }
                    ]
                },
                init() { instance = this },
                clearLabels() {
                    this.state.items.forEach(item => {
                        item.label = ''
                    })
                }
            })

            await waitForUpdate(100)

            const inputs = testContainer.querySelectorAll('.label')
            // Initial state
            expect(inputs[0].value).toBe('First')
            expect(inputs[1].value).toBe('Second')
            expect(inputs[2].value).toBe('Third')

            // Clear all
            testContainer.querySelector('button').click()
            await waitForUpdate(100)

            // All should be empty
            expect(inputs[0].value).toBe('')
            expect(inputs[1].value).toBe('')
            expect(inputs[2].value).toBe('')
        })
    })

    describe('single item direct mutation', () => {
        it('should update data-model checkbox when single item is mutated directly', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="single-checkbox">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <input type="checkbox" class="check" data-model="completed">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('single-checkbox', {
                state: {
                    items: [
                        { name: 'Item 1', completed: false },
                        { name: 'Item 2', completed: false }
                    ]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const checkboxes = testContainer.querySelectorAll('.check')
            expect(checkboxes[0].checked).toBe(false)
            expect(checkboxes[1].checked).toBe(false)

            // Direct mutation of single item
            instance.state.items[0].completed = true
            await waitForUpdate(100)

            // First checkbox should be checked, second unchanged
            expect(checkboxes[0].checked).toBe(true)
            expect(checkboxes[1].checked).toBe(false)
        })

        it('should update computed: class binding when single item is mutated directly', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="single-computed-class">
                    <div data-list="items">
                        <template>
                            <div class="item" data-bind-class="computed:itemClass">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('single-computed-class', {
                state: {
                    items: [
                        { name: 'Item 1', completed: false },
                        { name: 'Item 2', completed: false }
                    ]
                },
                computed: {
                    itemClass(item) {
                        return item && item.completed ? 'done' : 'pending'
                    }
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            expect(items[0].classList.contains('pending')).toBe(true)
            expect(items[1].classList.contains('pending')).toBe(true)

            // Direct mutation of single item
            instance.state.items[0].completed = true
            await waitForUpdate(100)

            // First item should have 'done' class, second unchanged
            expect(items[0].classList.contains('done')).toBe(true)
            expect(items[1].classList.contains('pending')).toBe(true)
        })
    })
})
