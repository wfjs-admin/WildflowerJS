/**
 * List Item Class Binding Tests
 *
 * Tests that data-bind-class works correctly within lists (both regular and computed).
 * Covers various expression patterns for dynamic class application.
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

describe('List Item Class Binding', () => {
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

    describe('Regular List', () => {
        it('should apply class based on ternary expression', async () => {
            wildflower.component('class-ternary-test', {
                state: {
                    items: [
                        { name: 'Item 1', active: true },
                        { name: 'Item 2', active: false },
                        { name: 'Item 3', active: true }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="class-ternary-test">
                    <ul data-list="items">
                        <template>
                            <li class="item" data-bind-class="active ? 'is-active' : ''">
                                <span data-bind="name"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')
            expect(items[0].classList.contains('is-active')).toBe(true)
            expect(items[1].classList.contains('is-active')).toBe(false)
            expect(items[2].classList.contains('is-active')).toBe(true)
        })

        it('should apply class based on done property', async () => {
            wildflower.component('class-done-test', {
                state: {
                    tasks: [
                        { text: 'Task 1', done: false },
                        { text: 'Task 2', done: true },
                        { text: 'Task 3', done: false }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="class-done-test">
                    <ul data-list="tasks">
                        <template>
                            <li class="task" data-bind-class="done ? 'completed' : ''">
                                <span data-bind="text"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const tasks = testContainer.querySelectorAll('.task')
            expect(tasks[0].classList.contains('completed')).toBe(false)
            expect(tasks[1].classList.contains('completed')).toBe(true)
            expect(tasks[2].classList.contains('completed')).toBe(false)
        })

        it('should update class when state changes', async () => {
            wildflower.component('class-update-test', {
                state: {
                    items: [
                        { name: 'Item 1', selected: false },
                        { name: 'Item 2', selected: false }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="class-update-test">
                    <ul data-list="items">
                        <template>
                            <li class="item" data-bind-class="selected ? 'selected' : ''">
                                <input type="checkbox" data-model="selected" class="select-cb">
                                <span data-bind="name"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')
            const checkboxes = testContainer.querySelectorAll('.select-cb')

            // Initially no selected class
            expect(items[0].classList.contains('selected')).toBe(false)

            // Check first item
            checkboxes[0].checked = true
            checkboxes[0].dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate(100)

            // Class should update
            expect(items[0].classList.contains('selected')).toBe(true)
            expect(items[1].classList.contains('selected')).toBe(false)
        })

        it('should apply multiple classes from expression', async () => {
            wildflower.component('class-multiple-test', {
                state: {
                    items: [
                        { name: 'Item 1', status: 'active', priority: 'high' },
                        { name: 'Item 2', status: 'inactive', priority: 'low' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="class-multiple-test">
                    <ul data-list="items">
                        <template>
                            <li class="item" data-bind-class="status + ' priority-' + priority">
                                <span data-bind="name"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')
            expect(items[0].classList.contains('active')).toBe(true)
            expect(items[0].classList.contains('priority-high')).toBe(true)
            expect(items[1].classList.contains('inactive')).toBe(true)
            expect(items[1].classList.contains('priority-low')).toBe(true)
        })
    })

    describe('Computed List', () => {
        it('should apply class based on ternary expression in computed list', async () => {
            wildflower.component('computed-class-test', {
                state: {
                    items: [
                        { name: 'Item 1', active: true },
                        { name: 'Item 2', active: false },
                        { name: 'Item 3', active: true }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-class-test">
                    <ul data-list="computed:allItems">
                        <template>
                            <li class="item" data-bind-class="active ? 'is-active' : ''">
                                <span data-bind="name"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')
            expect(items[0].classList.contains('is-active')).toBe(true)
            expect(items[1].classList.contains('is-active')).toBe(false)
            expect(items[2].classList.contains('is-active')).toBe(true)
        })

        it('should update class when checkbox changes in computed list', async () => {
            wildflower.component('computed-class-update-test', {
                state: {
                    tasks: [
                        { text: 'Task 1', done: false },
                        { text: 'Task 2', done: false }
                    ]
                },
                computed: {
                    allTasks() {
                        return this.state.tasks
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-class-update-test">
                    <ul data-list="computed:allTasks">
                        <template>
                            <li class="task" data-bind-class="done ? 'completed' : ''">
                                <input type="checkbox" data-model="done" class="done-cb">
                                <span data-bind="text"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const tasks = testContainer.querySelectorAll('.task')
            const checkboxes = testContainer.querySelectorAll('.done-cb')

            // Initially no completed class
            expect(tasks[0].classList.contains('completed')).toBe(false)
            expect(tasks[1].classList.contains('completed')).toBe(false)

            // Check first task
            checkboxes[0].checked = true
            checkboxes[0].dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate(100)

            // Class should update
            expect(tasks[0].classList.contains('completed')).toBe(true)
            expect(tasks[1].classList.contains('completed')).toBe(false)
        })

        it('should apply class in filtered computed list', async () => {
            wildflower.component('filtered-class-test', {
                state: {
                    items: [
                        { name: 'Active 1', visible: true, highlighted: true },
                        { name: 'Hidden', visible: false, highlighted: false },
                        { name: 'Active 2', visible: true, highlighted: false }
                    ]
                },
                computed: {
                    visibleItems() {
                        return this.state.items.filter(i => i.visible)
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="filtered-class-test">
                    <ul data-list="computed:visibleItems">
                        <template>
                            <li class="item" data-bind-class="highlighted ? 'highlight' : ''">
                                <span data-bind="name"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')

            // Should only have 2 items (filtered)
            expect(items.length).toBe(2)

            // First visible item is highlighted
            expect(items[0].classList.contains('highlight')).toBe(true)
            // Second visible item is not highlighted
            expect(items[1].classList.contains('highlight')).toBe(false)
        })
    })

    describe('Using Item Properties', () => {
        it('should use item property directly as class name', async () => {
            wildflower.component('property-class-test', {
                state: {
                    items: [
                        { name: 'Item 1', type: 'primary' },
                        { name: 'Item 2', type: 'secondary' },
                        { name: 'Item 3', type: 'danger' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="property-class-test">
                    <ul data-list="items">
                        <template>
                            <li class="item" data-bind-class="type">
                                <span data-bind="name"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')
            expect(items[0].classList.contains('primary')).toBe(true)
            expect(items[1].classList.contains('secondary')).toBe(true)
            expect(items[2].classList.contains('danger')).toBe(true)
        })

        it('should handle class based on comparison', async () => {
            wildflower.component('comparison-class-test', {
                state: {
                    items: [
                        { name: 'Item 1', count: 5 },
                        { name: 'Item 2', count: 0 },
                        { name: 'Item 3', count: 10 }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="comparison-class-test">
                    <ul data-list="items">
                        <template>
                            <li class="item" data-bind-class="count > 0 ? 'has-items' : 'empty'">
                                <span data-bind="name"></span>: <span data-bind="count"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')
            expect(items[0].classList.contains('has-items')).toBe(true)
            expect(items[0].classList.contains('empty')).toBe(false)
            expect(items[1].classList.contains('empty')).toBe(true)
            expect(items[1].classList.contains('has-items')).toBe(false)
            expect(items[2].classList.contains('has-items')).toBe(true)
        })
    })
})
