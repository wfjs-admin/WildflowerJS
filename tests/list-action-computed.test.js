/**
 * List Action Tests - Computed Lists
 *
 * Tests that data-action works correctly within computed lists.
 * Covers:
 * - getItemIndex() accuracy in filtered/sorted computed lists
 * - Delete item (splice) from computed list
 * - Update item in computed list
 * - Nested list actions in computed lists
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild} from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForCompleteRender() {
    if (window.wildflower?._forceCompleteRender) {
        await window.wildflower._forceCompleteRender()
    }
    await new Promise(resolve => setTimeout(resolve, 50))
}

describe('List Actions - Computed Lists', () => {
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

    describe('Basic Computed List Actions', () => {
        it('should handle click action in computed list', async () => {
            let clickedIndex = null
            let clickedItem = null

            wildflower.component('computed-action-basic', {
                state: {
                    items: [
                        { id: 1, name: 'Item 1' },
                        { id: 2, name: 'Item 2' },
                        { id: 3, name: 'Item 3' }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                },
                handleClick(event, element, details) {
                    clickedIndex = details.index
                    clickedItem = details.item
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-action-basic">
                    <ul data-list="computed:allItems">
                        <template>
                            <li class="item">
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
            expect(buttons.length).toBe(3)

            // Click second button
            buttons[1].click()
            await waitForUpdate()

            expect(clickedIndex).toBe(1)
            expect(clickedItem).toBeDefined()
            expect(clickedItem.name).toBe('Item 2')
        })

        it('should delete item from computed list via splice', async () => {
            wildflower.component('computed-action-delete', {
                state: {
                    items: [
                        { id: 1, name: 'Item 1' },
                        { id: 2, name: 'Item 2' },
                        { id: 3, name: 'Item 3' }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                },
                removeItem(event, element, details) {
                    const { index } = details
                    const updatedItems = [...this.state.items]
                    updatedItems.splice(index, 1)
                    this.state.items = updatedItems
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-action-delete">
                    <ul data-list="computed:allItems">
                        <template>
                            <li class="item">
                                <span class="name" data-bind="name"></span>
                                <button class="remove-btn" data-action="removeItem">Remove</button>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            let items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(3)

            // Remove second item
            const removeButtons = testContainer.querySelectorAll('.remove-btn')
            removeButtons[1].click()
            await waitForCompleteRender()

            items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)

            // Verify correct items remain
            const names = testContainer.querySelectorAll('.name')
            expect(names[0].textContent).toBe('Item 1')
            expect(names[1].textContent).toBe('Item 3')
        })

        it('should update item in computed list', async () => {
            wildflower.component('computed-action-update', {
                state: {
                    items: [
                        { id: 1, name: 'Item 1', active: false },
                        { id: 2, name: 'Item 2', active: false },
                        { id: 3, name: 'Item 3', active: false }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                },
                toggleActive(event, element, details) {
                    const { index } = details
                    const updatedItems = [...this.state.items]
                    updatedItems[index] = {
                        ...updatedItems[index],
                        active: !updatedItems[index].active
                    }
                    this.state.items = updatedItems
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-action-update">
                    <ul data-list="computed:allItems">
                        <template>
                            <li class="item">
                                <span data-bind="name"></span>
                                <span class="status" data-bind="active ? 'Active' : 'Inactive'"></span>
                                <button class="toggle-btn" data-action="toggleActive">Toggle</button>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="computed-action-update"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            // Initial state
            expect(instance.state.items[1].active).toBe(false)

            // Toggle second item
            const toggleButtons = testContainer.querySelectorAll('.toggle-btn')
            toggleButtons[1].click()
            await waitForUpdate()

            expect(instance.state.items[1].active).toBe(true)

            // Toggle again
            toggleButtons[1].click()
            await waitForUpdate()

            expect(instance.state.items[1].active).toBe(false)
        })
    })

    describe('Filtered Computed List Actions', () => {
        it('should return correct original index for filtered list', async () => {
            let capturedDetails = null

            wildflower.component('filtered-action-index', {
                state: {
                    items: [
                        { id: 1, name: 'Item 1', visible: true },
                        { id: 2, name: 'Item 2', visible: false },  // hidden
                        { id: 3, name: 'Item 3', visible: true },
                        { id: 4, name: 'Item 4', visible: false },  // hidden
                        { id: 5, name: 'Item 5', visible: true }
                    ]
                },
                computed: {
                    visibleItems() {
                        return this.state.items.filter(i => i.visible)
                    }
                },
                handleClick(event, element, details) {
                    capturedDetails = details
                }
            })

            testContainer.innerHTML = `
                <div data-component="filtered-action-index">
                    <ul data-list="computed:visibleItems">
                        <template>
                            <li class="item">
                                <span class="name" data-bind="name"></span>
                                <button class="click-btn" data-action="handleClick">Click</button>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            // Should only have 3 visible items
            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(3)

            const buttons = testContainer.querySelectorAll('.click-btn')

            // Click first visible item (Item 1, original index 0)
            buttons[0].click()
            await waitForUpdate()
            expect(capturedDetails.index).toBe(0)
            expect(capturedDetails.item.name).toBe('Item 1')

            // Click second visible item (Item 3, original index 2)
            buttons[1].click()
            await waitForUpdate()
            expect(capturedDetails.index).toBe(1)
            expect(capturedDetails.item.name).toBe('Item 3')

            // Click third visible item (Item 5, original index 4)
            buttons[2].click()
            await waitForUpdate()
            expect(capturedDetails.index).toBe(2)
            expect(capturedDetails.item.name).toBe('Item 5')
        })

        it('should correctly delete from filtered list using original index', async () => {
            wildflower.component('filtered-action-delete', {
                state: {
                    items: [
                        { id: 1, name: 'Active 1', active: true },
                        { id: 2, name: 'Inactive 1', active: false },
                        { id: 3, name: 'Active 2', active: true },
                        { id: 4, name: 'Inactive 2', active: false },
                        { id: 5, name: 'Active 3', active: true }
                    ]
                },
                computed: {
                    activeItems() {
                        return this.state.items.filter(i => i.active)
                    }
                },
                removeActive(event, element, details) {
                    // Find the actual item and remove it from the source array
                    const item = details.item
                    const originalIndex = this.state.items.findIndex(i => i.id === item.id)
                    if (originalIndex > -1) {
                        const updatedItems = [...this.state.items]
                        updatedItems.splice(originalIndex, 1)
                        this.state.items = updatedItems
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="filtered-action-delete">
                    <ul data-list="computed:activeItems">
                        <template>
                            <li class="item">
                                <span class="name" data-bind="name"></span>
                                <button class="remove-btn" data-action="removeActive">Remove</button>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="filtered-action-delete"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            // Initial: 3 active items displayed, 5 total
            let items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(3)
            expect(instance.state.items.length).toBe(5)

            // Remove "Active 2" (second visible item)
            const removeButtons = testContainer.querySelectorAll('.remove-btn')
            removeButtons[1].click()
            await waitForCompleteRender()

            // Now: 2 active items displayed, 4 total
            items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)
            expect(instance.state.items.length).toBe(4)

            // Verify the correct item was removed
            const names = testContainer.querySelectorAll('.name')
            expect(names[0].textContent).toBe('Active 1')
            expect(names[1].textContent).toBe('Active 3')
        })

        it('should update item properties through filtered list action', async () => {
            wildflower.component('filtered-action-update', {
                state: {
                    tasks: [
                        { id: 1, title: 'Task 1', done: false, priority: 'high' },
                        { id: 2, title: 'Task 2', done: true, priority: 'low' },
                        { id: 3, title: 'Task 3', done: false, priority: 'high' },
                        { id: 4, title: 'Task 4', done: false, priority: 'low' }
                    ]
                },
                computed: {
                    highPriorityTasks() {
                        return this.state.tasks.filter(t => t.priority === 'high')
                    }
                },
                markDone(event, element, details) {
                    const item = details.item
                    const originalIndex = this.state.tasks.findIndex(t => t.id === item.id)
                    if (originalIndex > -1) {
                        const updatedTasks = [...this.state.tasks]
                        updatedTasks[originalIndex] = {
                            ...updatedTasks[originalIndex],
                            done: true
                        }
                        this.state.tasks = updatedTasks
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="filtered-action-update">
                    <ul data-list="computed:highPriorityTasks">
                        <template>
                            <li class="task">
                                <span class="title" data-bind="title"></span>
                                <span class="status" data-bind="done ? 'Done' : 'Pending'"></span>
                                <button class="done-btn" data-action="markDone">Mark Done</button>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="filtered-action-update"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            // Should show 2 high priority tasks
            const tasks = testContainer.querySelectorAll('.task')
            expect(tasks.length).toBe(2)

            // Initial state: Task 1 (id: 1) is not done
            expect(instance.state.tasks[0].done).toBe(false)

            // Mark Task 1 as done
            const doneButtons = testContainer.querySelectorAll('.done-btn')
            doneButtons[0].click()
            await waitForUpdate()

            // Verify Task 1 is now done
            expect(instance.state.tasks[0].done).toBe(true)
        })
    })

    describe('Action Context Properties', () => {
        it.skipIf(isMinifiedBuild())('should have correct action context in computed list', async () => {
            wildflower.component('computed-context-test', {
                state: {
                    items: [{ id: 1, name: 'Test Item' }]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                },
                testAction() {}
            })

            testContainer.innerHTML = `
                <div data-component="computed-context-test">
                    <ul data-list="computed:allItems">
                        <template>
                            <li class="item">
                                <button class="action-btn" data-action="testAction">Test</button>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const button = testContainer.querySelector('.action-btn')
            const actionContext = button._actionContext

            expect(actionContext).toBeDefined()
            expect(actionContext.type).toBe('action')
            expect(actionContext.path).toBe('testAction')

            // Should have parent list context
            expect(actionContext.parent).toBeDefined()
            expect(actionContext.parent.type).toBe('list')
        })

        it.skipIf(isMinifiedBuild())('should cleanup action contexts when computed list re-renders', async () => {
            wildflower.component('computed-context-cleanup', {
                state: {
                    items: [
                        { id: 1, name: 'Item 1' },
                        { id: 2, name: 'Item 2' }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                },
                removeItem(event, element, details) {
                    const updatedItems = [...this.state.items]
                    updatedItems.splice(details.index, 1)
                    this.state.items = updatedItems
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-context-cleanup">
                    <ul data-list="computed:allItems">
                        <template>
                            <li class="item">
                                <button class="remove-btn" data-action="removeItem">Remove</button>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            // Initial: should have 2 buttons (one per item)
            let removeButtons = testContainer.querySelectorAll('.remove-btn')
            expect(removeButtons.length).toBe(2)

            // Each button should have an action record
            const context1 = removeButtons[0]._actionContext
            const context2 = removeButtons[1]._actionContext
            expect(context1).toBeDefined()
            expect(context1.type).toBe('action')
            expect(context2).toBeDefined()
            expect(context2.type).toBe('action')

            // Remove first item
            removeButtons[0].click()
            await waitForCompleteRender()

            // After removal: should have 1 button
            removeButtons = testContainer.querySelectorAll('.remove-btn')
            expect(removeButtons.length).toBe(1)

            // The remaining button should have a valid action record
            const remainingContext = removeButtons[0]._actionContext
            expect(remainingContext).toBeDefined()
            expect(remainingContext.type).toBe('action')
        })
    })

    describe('Multiple Actions in Computed Lists', () => {
        it('should handle multiple different actions in same computed list item', async () => {
            let editClicked = false
            let deleteClicked = false
            let viewClicked = false

            wildflower.component('computed-multi-action', {
                state: {
                    items: [{ id: 1, name: 'Test Item' }]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                },
                editItem() { editClicked = true },
                deleteItem() { deleteClicked = true },
                viewItem() { viewClicked = true }
            })

            testContainer.innerHTML = `
                <div data-component="computed-multi-action">
                    <ul data-list="computed:allItems">
                        <template>
                            <li class="item">
                                <span data-bind="name"></span>
                                <button class="view-btn" data-action="viewItem">View</button>
                                <button class="edit-btn" data-action="editItem">Edit</button>
                                <button class="delete-btn" data-action="deleteItem">Delete</button>
                            </li>
                        </template>
                    </ul>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const viewBtn = testContainer.querySelector('.view-btn')
            const editBtn = testContainer.querySelector('.edit-btn')
            const deleteBtn = testContainer.querySelector('.delete-btn')

            viewBtn.click()
            await waitForUpdate()
            expect(viewClicked).toBe(true)

            editBtn.click()
            await waitForUpdate()
            expect(editClicked).toBe(true)

            deleteBtn.click()
            await waitForUpdate()
            expect(deleteClicked).toBe(true)
        })
    })
})
