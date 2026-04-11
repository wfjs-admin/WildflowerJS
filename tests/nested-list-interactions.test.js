/**
 * Nested List Interactions Tests
 *
 * Tests complex interactions within nested lists including:
 * - Model binding in nested list items
 * - Actions that modify nested lists
 * - Parent-child list relationships
 * - Edge cases with deeply nested structures
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

describe('Nested List Interactions', () => {
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

    describe('Nested List Model Binding', () => {
        it('should update child item property via checkbox', async () => {
            wildflower.component('nested-model-checkbox', {
                state: {
                    categories: [
                        {
                            name: 'Category A',
                            tasks: [
                                { id: 1, text: 'Task A-1', done: false },
                                { id: 2, text: 'Task A-2', done: true }
                            ]
                        },
                        {
                            name: 'Category B',
                            tasks: [
                                { id: 3, text: 'Task B-1', done: false }
                            ]
                        }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-model-checkbox">
                    <div data-list="categories">
                        <template>
                            <div class="category">
                                <h3 data-bind="name"></h3>
                                <ul data-list="tasks">
                                    <template>
                                        <li class="task">
                                            <input type="checkbox" data-model="done" class="task-cb">
                                            <span data-bind="text"></span>
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

            const component = testContainer.querySelector('[data-component="nested-model-checkbox"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            // Initial state
            expect(instance.state.categories[0].tasks[0].done).toBe(false)
            expect(instance.state.categories[0].tasks[1].done).toBe(true)

            // Find checkboxes
            const categories = testContainer.querySelectorAll('.category')
            const firstCatCheckboxes = categories[0].querySelectorAll('.task-cb')

            // Check first task
            firstCatCheckboxes[0].checked = true
            firstCatCheckboxes[0].dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate(100)

            expect(instance.state.categories[0].tasks[0].done).toBe(true)

            // Uncheck second task
            firstCatCheckboxes[1].checked = false
            firstCatCheckboxes[1].dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate(100)

            expect(instance.state.categories[0].tasks[1].done).toBe(false)
        })

        it('should update child item text property via input', async () => {
            wildflower.component('nested-model-text', {
                state: {
                    groups: [
                        {
                            name: 'Group 1',
                            items: [
                                { id: 1, title: 'Item 1' },
                                { id: 2, title: 'Item 2' }
                            ]
                        }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-model-text">
                    <div data-list="groups">
                        <template>
                            <div class="group">
                                <h3 data-bind="name"></h3>
                                <div data-list="items">
                                    <template>
                                        <div class="item">
                                            <input type="text" data-model="title" class="title-input">
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="nested-model-text"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            const inputs = testContainer.querySelectorAll('.title-input')
            expect(inputs.length).toBe(2)

            // Initial values
            expect(inputs[0].value).toBe('Item 1')
            expect(inputs[1].value).toBe('Item 2')

            // Change first input
            inputs[0].value = 'Changed Item 1'
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(100)

            expect(instance.state.groups[0].items[0].title).toBe('Changed Item 1')
        })

        it('should reflect initial nested checkbox state', async () => {
            wildflower.component('nested-initial-state', {
                state: {
                    sections: [
                        {
                            name: 'Section',
                            options: [
                                { label: 'Opt 1', enabled: true },
                                { label: 'Opt 2', enabled: false },
                                { label: 'Opt 3', enabled: true }
                            ]
                        }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-initial-state">
                    <div data-list="sections">
                        <template>
                            <div class="section">
                                <div data-list="options">
                                    <template>
                                        <label class="option">
                                            <input type="checkbox" data-model="enabled" class="opt-cb">
                                            <span data-bind="label"></span>
                                        </label>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const checkboxes = testContainer.querySelectorAll('.opt-cb')
            expect(checkboxes[0].checked).toBe(true)
            expect(checkboxes[1].checked).toBe(false)
            expect(checkboxes[2].checked).toBe(true)
        })
    })

    describe('Nested List Actions', () => {
        it('should delete child item from nested list', async () => {
            let capturedDetails = null

            wildflower.component('nested-action-delete-child', {
                state: {
                    categories: [
                        {
                            id: 1,
                            name: 'Category A',
                            items: [
                                { id: 101, name: 'Item A-1' },
                                { id: 102, name: 'Item A-2' },
                                { id: 103, name: 'Item A-3' }
                            ]
                        }
                    ]
                },
                removeItem(event, element, details) {
                    capturedDetails = { ...details, item: details.item ? { ...details.item } : null }

                    // Use details.index for nested list deletion
                    const { index } = details
                    if (typeof index === 'number') {
                        // Find the parent list context - items is nested in categories[0]
                        const newItems = [...this.state.categories[0].items]
                        newItems.splice(index, 1)
                        this.state.categories[0].items = newItems
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-action-delete-child">
                    <div data-list="categories">
                        <template>
                            <div class="category">
                                <h3 data-bind="name"></h3>
                                <ul data-list="items">
                                    <template>
                                        <li class="item">
                                            <span class="item-name" data-bind="name"></span>
                                            <button class="remove-btn" data-action="removeItem">Remove</button>
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

            const component = testContainer.querySelector('[data-component="nested-action-delete-child"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            // Initial: 3 items
            let items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(3)

            // Verify initial render order
            let names = testContainer.querySelectorAll('.item-name')
            expect(names[0].textContent).toBe('Item A-1')
            expect(names[1].textContent).toBe('Item A-2')
            expect(names[2].textContent).toBe('Item A-3')

            // Remove middle item (Item A-2) - button index 1
            const removeButtons = testContainer.querySelectorAll('.remove-btn')
            expect(removeButtons.length).toBe(3)

            // Check which button we're clicking by looking at sibling
            const buttonParent = removeButtons[1].closest('.item')
            const siblingName = buttonParent.querySelector('.item-name').textContent
            expect(siblingName).toBe('Item A-2')  // Verify we're clicking the right button

            removeButtons[1].click()
            await waitForCompleteRender()

            // Verify the captured details
            expect(capturedDetails).not.toBeNull()
            expect(capturedDetails.index).toBe(1)  // Should be index 1 for Item A-2
            expect(capturedDetails.item?.name).toBe('Item A-2')  // Verify correct item

            // Should have 2 items
            items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)

            // Verify correct items remain
            names = testContainer.querySelectorAll('.item-name')
            expect(names[0].textContent).toBe('Item A-1')
            expect(names[1].textContent).toBe('Item A-3')

            expect(instance.state.categories[0].items.length).toBe(2)
        })

        it('should add item to nested list', async () => {
            wildflower.component('nested-action-add', {
                state: {
                    lists: [
                        {
                            id: 1,
                            name: 'List 1',
                            items: [{ id: 1, text: 'Initial item' }]
                        }
                    ],
                    nextId: 2
                },
                addItem(event, element, details) {
                    const list = details.item
                    const newItem = { id: this.state.nextId++, text: `New item ${this.state.nextId - 1}` }
                    list.items = [...list.items, newItem]
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-action-add">
                    <div data-list="lists">
                        <template>
                            <div class="list">
                                <h3 data-bind="name"></h3>
                                <button class="add-btn" data-action="addItem">Add Item</button>
                                <ul data-list="items">
                                    <template>
                                        <li class="item" data-bind="text"></li>
                                    </template>
                                </ul>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            // Initial: 1 item
            let items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(1)

            // Add item
            const addBtn = testContainer.querySelector('.add-btn')
            addBtn.click()
            await waitForCompleteRender()

            // Should have 2 items
            items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)
            expect(items[1].textContent).toBe('New item 2')
        })

        it('should delete parent category and all its children', async () => {
            wildflower.component('nested-action-delete-parent', {
                state: {
                    categories: [
                        {
                            id: 1,
                            name: 'Category A',
                            items: [{ id: 101, name: 'Item A-1' }]
                        },
                        {
                            id: 2,
                            name: 'Category B',
                            items: [{ id: 201, name: 'Item B-1' }, { id: 202, name: 'Item B-2' }]
                        }
                    ]
                },
                removeCategory(event, element, details) {
                    const category = details.item
                    const idx = this.state.categories.findIndex(c => c.id === category.id)
                    if (idx > -1) {
                        const newCategories = [...this.state.categories]
                        newCategories.splice(idx, 1)
                        this.state.categories = newCategories
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-action-delete-parent">
                    <div data-list="categories">
                        <template>
                            <div class="category">
                                <h3 class="cat-name" data-bind="name"></h3>
                                <button class="remove-cat-btn" data-action="removeCategory">Remove Category</button>
                                <ul data-list="items">
                                    <template>
                                        <li class="item" data-bind="name"></li>
                                    </template>
                                </ul>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            // Initial: 2 categories, 3 total items
            let categories = testContainer.querySelectorAll('.category')
            let items = testContainer.querySelectorAll('.item')
            expect(categories.length).toBe(2)
            expect(items.length).toBe(3)

            // Remove first category
            const removeCatBtns = testContainer.querySelectorAll('.remove-cat-btn')
            removeCatBtns[0].click()
            await waitForCompleteRender()

            // Should have 1 category, 2 items
            categories = testContainer.querySelectorAll('.category')
            items = testContainer.querySelectorAll('.item')
            expect(categories.length).toBe(1)
            expect(items.length).toBe(2)

            // Verify Category B remains
            const catName = testContainer.querySelector('.cat-name')
            expect(catName.textContent).toBe('Category B')
        })
    })

    describe('Deeply Nested Lists (3+ levels)', () => {
        it('should render 3-level nested list structure', async () => {
            wildflower.component('deep-nested-render', {
                state: {
                    departments: [
                        {
                            name: 'Engineering',
                            teams: [
                                {
                                    name: 'Frontend',
                                    members: [
                                        { name: 'Alice' },
                                        { name: 'Bob' }
                                    ]
                                },
                                {
                                    name: 'Backend',
                                    members: [
                                        { name: 'Charlie' }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="deep-nested-render">
                    <div data-list="departments">
                        <template>
                            <div class="department">
                                <h2 class="dept-name" data-bind="name"></h2>
                                <div data-list="teams">
                                    <template>
                                        <div class="team">
                                            <h3 class="team-name" data-bind="name"></h3>
                                            <ul data-list="members">
                                                <template>
                                                    <li class="member" data-bind="name"></li>
                                                </template>
                                            </ul>
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            // Verify structure
            const departments = testContainer.querySelectorAll('.department')
            expect(departments.length).toBe(1)

            const teams = testContainer.querySelectorAll('.team')
            expect(teams.length).toBe(2)

            const members = testContainer.querySelectorAll('.member')
            expect(members.length).toBe(3)

            // Verify content
            expect(testContainer.querySelector('.dept-name').textContent).toBe('Engineering')
            const teamNames = testContainer.querySelectorAll('.team-name')
            expect(teamNames[0].textContent).toBe('Frontend')
            expect(teamNames[1].textContent).toBe('Backend')

            expect(members[0].textContent).toBe('Alice')
            expect(members[1].textContent).toBe('Bob')
            expect(members[2].textContent).toBe('Charlie')
        })

        it('should handle model binding at deepest level', async () => {
            wildflower.component('deep-nested-model', {
                state: {
                    companies: [
                        {
                            name: 'Company A',
                            departments: [
                                {
                                    name: 'Sales',
                                    employees: [
                                        { name: 'John', active: true }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="deep-nested-model">
                    <div data-list="companies">
                        <template>
                            <div class="company">
                                <div data-list="departments">
                                    <template>
                                        <div class="department">
                                            <div data-list="employees">
                                                <template>
                                                    <div class="employee">
                                                        <input type="checkbox" data-model="active" class="emp-cb">
                                                        <span data-bind="name"></span>
                                                    </div>
                                                </template>
                                            </div>
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="deep-nested-model"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            const checkbox = testContainer.querySelector('.emp-cb')
            expect(checkbox.checked).toBe(true)

            // Toggle checkbox
            checkbox.checked = false
            checkbox.dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate(100)

            expect(instance.state.companies[0].departments[0].employees[0].active).toBe(false)
        })
    })

    describe('Radio Buttons in Lists', () => {
        it('should bind radio button group within single list item', async () => {
            wildflower.component('radio-in-list-item', {
                state: {
                    questions: [
                        { id: 1, text: 'Question 1', answer: 'b' },
                        { id: 2, text: 'Question 2', answer: 'a' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="radio-in-list-item">
                    <div data-list="questions">
                        <template>
                            <div class="question">
                                <p data-bind="text"></p>
                                <label>
                                    <input type="radio" data-model="answer" value="a" class="radio-a">
                                    Option A
                                </label>
                                <label>
                                    <input type="radio" data-model="answer" value="b" class="radio-b">
                                    Option B
                                </label>
                                <label>
                                    <input type="radio" data-model="answer" value="c" class="radio-c">
                                    Option C
                                </label>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="radio-in-list-item"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            const questions = testContainer.querySelectorAll('.question')

            // Question 1: answer is 'b'
            const q1Radios = questions[0].querySelectorAll('input[type="radio"]')
            expect(q1Radios[0].checked).toBe(false) // a
            expect(q1Radios[1].checked).toBe(true)  // b
            expect(q1Radios[2].checked).toBe(false) // c

            // Question 2: answer is 'a'
            const q2Radios = questions[1].querySelectorAll('input[type="radio"]')
            expect(q2Radios[0].checked).toBe(true)  // a
            expect(q2Radios[1].checked).toBe(false) // b
            expect(q2Radios[2].checked).toBe(false) // c

            // Change Question 1 to 'c'
            q1Radios[2].checked = true
            q1Radios[2].dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate(100)

            expect(instance.state.questions[0].answer).toBe('c')

            // Question 2 should be unchanged
            expect(instance.state.questions[1].answer).toBe('a')
        })

        it('should isolate radio groups between list items', async () => {
            wildflower.component('radio-isolation', {
                state: {
                    items: [
                        { id: 1, priority: 'low' },
                        { id: 2, priority: 'high' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="radio-isolation">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <label>
                                    <input type="radio" data-model="priority" value="low" class="radio-low">
                                    Low
                                </label>
                                <label>
                                    <input type="radio" data-model="priority" value="medium" class="radio-med">
                                    Medium
                                </label>
                                <label>
                                    <input type="radio" data-model="priority" value="high" class="radio-high">
                                    High
                                </label>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="radio-isolation"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            const items = testContainer.querySelectorAll('.item')

            // Item 1: priority is 'low'
            const item1Radios = items[0].querySelectorAll('input[type="radio"]')
            expect(item1Radios[0].checked).toBe(true)  // low
            expect(item1Radios[1].checked).toBe(false) // medium
            expect(item1Radios[2].checked).toBe(false) // high

            // Item 2: priority is 'high'
            const item2Radios = items[1].querySelectorAll('input[type="radio"]')
            expect(item2Radios[0].checked).toBe(false) // low
            expect(item2Radios[1].checked).toBe(false) // medium
            expect(item2Radios[2].checked).toBe(true)  // high

            // Change Item 1 to 'medium' - should not affect Item 2
            item1Radios[1].checked = true
            item1Radios[1].dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate(100)

            expect(instance.state.items[0].priority).toBe('medium')
            expect(instance.state.items[1].priority).toBe('high')
        })
    })

    describe('Nested List Parent Context Chain', () => {
        it('should provide parent context in nested list action details', async () => {
            let capturedDetails = null

            wildflower.component('nested-parent-context', {
                state: {
                    departments: [
                        {
                            id: 1,
                            name: 'Engineering',
                            employees: [
                                { id: 101, name: 'Alice' },
                                { id: 102, name: 'Bob' }
                            ]
                        },
                        {
                            id: 2,
                            name: 'Design',
                            employees: [
                                { id: 201, name: 'Carol' }
                            ]
                        }
                    ]
                },
                captureDetails(event, element, details) {
                    capturedDetails = details
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-parent-context">
                    <div data-list="departments">
                        <template>
                            <div class="dept">
                                <h3 data-bind="name"></h3>
                                <div data-list="employees">
                                    <template>
                                        <div class="emp">
                                            <span data-bind="name"></span>
                                            <button class="capture-btn" data-action="captureDetails">Capture</button>
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            await waitForCompleteRender()

            // Click the button for Carol (Design department, index 1, employee index 0)
            const designDept = testContainer.querySelectorAll('.dept')[1]
            const carolBtn = designDept.querySelector('.capture-btn')
            carolBtn.click()
            await waitForUpdate()

            // Verify inner list details
            expect(capturedDetails).not.toBeNull()
            expect(capturedDetails.index).toBe(0)  // Carol is index 0 in employees
            expect(capturedDetails.item.name).toBe('Carol')
            expect(capturedDetails.item.id).toBe(201)

            // Verify parent context chain
            expect(capturedDetails.parent).toBeDefined()
            expect(capturedDetails.parent.index).toBe(1)  // Design is index 1 in departments
            expect(capturedDetails.parent.item.name).toBe('Design')
            expect(capturedDetails.parent.item.id).toBe(2)
        })

        it('should allow removing nested item using parent context', async () => {
            wildflower.component('nested-remove-with-parent', {
                state: {
                    departments: [
                        {
                            id: 1,
                            name: 'Engineering',
                            employees: [
                                { id: 101, name: 'Alice' },
                                { id: 102, name: 'Bob' }
                            ]
                        },
                        {
                            id: 2,
                            name: 'Design',
                            employees: [
                                { id: 201, name: 'Carol' }
                            ]
                        }
                    ]
                },
                removeEmployee(event, element, { item, parent }) {
                    // Use parent.index to find the department, then remove employee
                    const deptIndex = parent.index
                    this.state.departments[deptIndex].employees =
                        this.state.departments[deptIndex].employees.filter(e => e.id !== item.id)
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-remove-with-parent">
                    <div data-list="departments">
                        <template>
                            <div class="dept">
                                <h3 data-bind="name"></h3>
                                <div data-list="employees">
                                    <template>
                                        <div class="emp">
                                            <span class="emp-name" data-bind="name"></span>
                                            <button class="remove-btn" data-action="removeEmployee">Remove</button>
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const componentEl = testContainer.querySelector('[data-component]')
            const instance = wildflower.componentInstances.get(componentEl.dataset.componentId)
            expect(instance).toBeDefined()

            // Verify initial state
            expect(instance.state.departments[0].employees).toHaveLength(2)
            expect(instance.state.departments[1].employees).toHaveLength(1)

            // Remove Carol from Design department
            const designDept = testContainer.querySelectorAll('.dept')[1]
            const carolRemoveBtn = designDept.querySelector('.remove-btn')
            carolRemoveBtn.click()
            await waitForUpdate(100)

            // Verify Carol was removed from correct department
            expect(instance.state.departments[0].employees).toHaveLength(2)  // Engineering unchanged
            expect(instance.state.departments[1].employees).toHaveLength(0)  // Design now empty

            // Verify Alice and Bob still exist
            expect(instance.state.departments[0].employees[0].name).toBe('Alice')
            expect(instance.state.departments[0].employees[1].name).toBe('Bob')
        })

        it('should remove correct employee from first department using parent context', async () => {
            wildflower.component('nested-remove-first-dept', {
                state: {
                    departments: [
                        {
                            id: 1,
                            name: 'Engineering',
                            employees: [
                                { id: 101, name: 'Alice' },
                                { id: 102, name: 'Bob' }
                            ]
                        },
                        {
                            id: 2,
                            name: 'Design',
                            employees: [
                                { id: 201, name: 'Carol' }
                            ]
                        }
                    ]
                },
                removeEmployee(event, element, { item, parent }) {
                    const deptIndex = parent.index
                    this.state.departments[deptIndex].employees =
                        this.state.departments[deptIndex].employees.filter(e => e.id !== item.id)
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-remove-first-dept">
                    <div data-list="departments">
                        <template>
                            <div class="dept">
                                <h3 data-bind="name"></h3>
                                <div data-list="employees">
                                    <template>
                                        <div class="emp">
                                            <span class="emp-name" data-bind="name"></span>
                                            <button class="remove-btn" data-action="removeEmployee">Remove</button>
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const componentEl = testContainer.querySelector('[data-component]')
            const instance = wildflower.componentInstances.get(componentEl.dataset.componentId)
            expect(instance).toBeDefined()

            // Remove Bob from Engineering (index 1 in Engineering's employees)
            const engineeringDept = testContainer.querySelectorAll('.dept')[0]
            const bobRemoveBtn = engineeringDept.querySelectorAll('.remove-btn')[1]
            bobRemoveBtn.click()
            await waitForUpdate(100)

            // Verify Bob was removed from Engineering
            expect(instance.state.departments[0].employees).toHaveLength(1)
            expect(instance.state.departments[0].employees[0].name).toBe('Alice')

            // Design unchanged
            expect(instance.state.departments[1].employees).toHaveLength(1)
            expect(instance.state.departments[1].employees[0].name).toBe('Carol')
        })

        it('should provide correct parent chain for triple-nested lists', async () => {
            let capturedDetails = null

            wildflower.component('triple-nested-context', {
                state: {
                    companies: [
                        {
                            id: 1,
                            name: 'TechCorp',
                            departments: [
                                {
                                    id: 11,
                                    name: 'Engineering',
                                    employees: [
                                        { id: 111, name: 'Alice' }
                                    ]
                                }
                            ]
                        },
                        {
                            id: 2,
                            name: 'DesignCo',
                            departments: [
                                {
                                    id: 21,
                                    name: 'UX',
                                    employees: [
                                        { id: 211, name: 'Bob' },
                                        { id: 212, name: 'Carol' }
                                    ]
                                },
                                {
                                    id: 22,
                                    name: 'Graphics',
                                    employees: [
                                        { id: 221, name: 'Dave' }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                captureDetails(event, element, details) {
                    capturedDetails = details
                }
            })

            testContainer.innerHTML = `
                <div data-component="triple-nested-context">
                    <div data-list="companies">
                        <template>
                            <div class="company">
                                <h2 data-bind="name"></h2>
                                <div data-list="departments">
                                    <template>
                                        <div class="dept">
                                            <h3 data-bind="name"></h3>
                                            <div data-list="employees">
                                                <template>
                                                    <div class="emp">
                                                        <span data-bind="name"></span>
                                                        <button class="capture-btn" data-action="captureDetails">Info</button>
                                                    </div>
                                                </template>
                                            </div>
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            await waitForCompleteRender()

            // Click button for Carol (DesignCo -> UX -> Carol)
            // DesignCo is company index 1, UX is dept index 0, Carol is emp index 1
            const companies = testContainer.querySelectorAll('.company')
            const designCo = companies[1]
            const uxDept = designCo.querySelectorAll('.dept')[0]
            const carolBtn = uxDept.querySelectorAll('.capture-btn')[1]
            carolBtn.click()
            await waitForUpdate()

            // Verify innermost level (employee)
            expect(capturedDetails).not.toBeNull()
            expect(capturedDetails.index).toBe(1)  // Carol is index 1 in UX employees
            expect(capturedDetails.item.name).toBe('Carol')

            // Verify first parent level (department)
            expect(capturedDetails.parent).toBeDefined()
            expect(capturedDetails.parent.index).toBe(0)  // UX is index 0 in DesignCo departments
            expect(capturedDetails.parent.item.name).toBe('UX')

            // Verify second parent level (company)
            expect(capturedDetails.parent.parent).toBeDefined()
            expect(capturedDetails.parent.parent.index).toBe(1)  // DesignCo is index 1 in companies
            expect(capturedDetails.parent.parent.item.name).toBe('DesignCo')
        })
    })
})
