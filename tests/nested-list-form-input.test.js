/**
 * Nested List Form Input Test Suite
 *
 * Tests for input handling in forms inside nested lists.
 * Investigates issues with:
 * - Input lag/delay when typing
 * - Characters getting jumbled (e.g., "test1" becomes "tst1e")
 * - Form submit clearing input issues
 * - Dropdown appearing/disappearing on first click
 *
 * These tests replicate the exact structure from the docs site
 * lists.html page (project-manager component).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, waitForUpdate, waitForDOM } from './helpers/load-framework.js'

describe('Nested List Form Input', () => {
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

    describe('Control: No List (form directly in component)', () => {
        it('should properly clear input after form submit when NOT in a list', async () => {
            testContainer.innerHTML = `
                <div data-component="no-list-control-test">
                    <form data-action="handleSubmit">
                        <input type="text" data-model="inputValue" class="test-input">
                        <button type="submit">Submit</button>
                    </form>
                    <span data-bind="inputValue" class="display"></span>
                </div>
            `

            let submitCount = 0

            wildflower.component('no-list-control-test', {
                state: {
                    inputValue: ''
                },
                handleSubmit(event, element, details) {
                    event.preventDefault()
                    submitCount++
                    // Clear the value after submit
                    this.state.inputValue = ''
                }
            })

            await waitForUpdate(100)

            const input = testContainer.querySelector('.test-input')

            // Type a value
            input.value = 'test value'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(50)

            // Verify state was updated
            const component = wildflower.getComponent('no-list-control-test')
            expect(component.state.inputValue).toBe('test value')

            // Submit the form
            input.blur()
            await waitForUpdate(10)

            const form = testContainer.querySelector('form')
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
            await waitForUpdate(100)

            // Verify submit was called
            expect(submitCount).toBe(1)

            // Check state and DOM
            console.log('Control (no list) - State value after submit:', component.state.inputValue)
            console.log('Control (no list) - DOM value after submit:', input.value)

            expect(component.state.inputValue).toBe('')
            expect(input.value).toBe('')
        })
    })

    describe('Simple List (non-nested)', () => {
        it('should properly clear input after form submit in simple list', async () => {
            testContainer.innerHTML = `
                <div data-component="simple-list-test">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <form data-action="handleSubmit">
                                    <input type="text" data-model="inputValue" class="test-input">
                                    <button type="submit">Submit</button>
                                </form>
                                <span data-bind="inputValue" class="display"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            let submitCount = 0
            let lastDetails = null

            wildflower.component('simple-list-test', {
                state: {
                    items: [
                        { id: 1, inputValue: '' },
                        { id: 2, inputValue: '' }
                    ]
                },
                handleSubmit(event, element, details) {
                    event.preventDefault()
                    submitCount++
                    lastDetails = details
                    const index = details.index
                    console.log('SUBMIT HANDLER: Before clear, state=', this.state.items[index].inputValue)
                    // Clear using immutable update
                    const newItems = [...this.state.items]
                    newItems[index] = {...newItems[index], inputValue: ''}
                    this.state.items = newItems
                    console.log('SUBMIT HANDLER: After clear, state=', this.state.items[index].inputValue)

                    // Schedule micro check
                    queueMicrotask(() => {
                        console.log('SUBMIT HANDLER: After microtask, state=', this.state.items[index].inputValue)
                    })

                    // Schedule macro check
                    setTimeout(() => {
                        console.log('SUBMIT HANDLER: After setTimeout(0), state=', this.state.items[index].inputValue)
                    }, 0)
                }
            })

            await waitForUpdate(100)

            const inputs = testContainer.querySelectorAll('.test-input')
            expect(inputs.length).toBe(2)

            const input = inputs[0]
            const component = wildflower.getComponent('simple-list-test')

            // Add event listeners to trace what's happening
            const eventLog = []
            input.addEventListener('input', (e) => {
                eventLog.push(`INPUT: DOM=${e.target.value}, state=${component.state.items[0].inputValue}`)
            })
            input.addEventListener('change', (e) => {
                eventLog.push(`CHANGE: DOM=${e.target.value}, state=${component.state.items[0].inputValue}`)
            })
            input.addEventListener('blur', (e) => {
                eventLog.push(`BLUR: DOM=${e.target.value}, state=${component.state.items[0].inputValue}`)
            })

            // Type a value
            input.value = 'test value'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(50)
            eventLog.push(`AFTER INPUT WAIT: state=${component.state.items[0].inputValue}`)

            // Verify state was updated
            expect(component.state.items[0].inputValue).toBe('test value')

            // Submit the form (without blur first to isolate)
            const form = testContainer.querySelector('form')
            eventLog.push(`BEFORE SUBMIT: state=${component.state.items[0].inputValue}`)
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
            eventLog.push(`AFTER SUBMIT SYNC: state=${component.state.items[0].inputValue}`)
            await waitForUpdate(100)
            eventLog.push(`AFTER SUBMIT WAIT: state=${component.state.items[0].inputValue}`)

            // Log all events
            console.log('Event sequence:', eventLog)

            // Verify submit was called with correct details
            expect(submitCount).toBe(1)
            expect(lastDetails).not.toBeNull()
            expect(lastDetails.index).toBe(0)

            // Check state and DOM
            console.log('Simple list - State value after submit:', component.state.items[0].inputValue)
            console.log('Simple list - DOM value after submit:', input.value)

            expect(component.state.items[0].inputValue).toBe('')
            expect(input.value).toBe('')
        })
    })

    describe('Project Manager Replica', () => {
        /**
         * This test replicates the exact structure from lists.html
         */
        it('should handle form input in nested list without lag or jumbling', async () => {
            testContainer.innerHTML = `
                <div data-component="project-manager-test">
                    <!-- Projects list with nested tasks -->
                    <div data-list="projects">
                        <template>
                            <div class="project-card">
                                <div class="card-header">
                                    <h5 data-bind="name"></h5>
                                </div>
                                <div class="card-body">
                                    <!-- Task input form (exactly as in docs) -->
                                    <form data-action="addTaskForm" class="mb-3">
                                        <div class="input-group">
                                            <input type="text"
                                                   data-model="newTaskName"
                                                   placeholder="New task name..."
                                                   class="form-control task-input"
                                                   required>
                                            <select data-model="newTaskPriority" class="form-select priority-select">
                                                <option value="Low">Low</option>
                                                <option value="Medium" selected>Medium</option>
                                                <option value="High">High</option>
                                            </select>
                                            <button type="submit" class="btn btn-primary">Add Task</button>
                                        </div>
                                    </form>

                                    <!-- Nested tasks list -->
                                    <div data-list="tasks">
                                        <template>
                                            <div class="task-item">
                                                <input type="checkbox"
                                                       data-model="completed"
                                                       class="task-checkbox">
                                                <span data-bind="name" class="task-name"></span>
                                                <span data-bind="priority" class="task-priority"></span>
                                                <button data-action="deleteTask" class="btn-delete">Delete</button>
                                            </div>
                                        </template>
                                    </div>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            let formSubmitDetails = null
            let deleteDetails = null

            wildflower.component('project-manager-test', {
                state: {
                    projects: [
                        {
                            id: 1,
                            name: 'Project 1',
                            newTaskName: '',
                            newTaskPriority: 'Medium',
                            tasks: [
                                { id: 1, name: 'Task 1', priority: 'High', completed: false },
                                { id: 2, name: 'Task 2', priority: 'Medium', completed: true }
                            ]
                        },
                        {
                            id: 2,
                            name: 'Project 2',
                            newTaskName: '',
                            newTaskPriority: 'Medium',
                            tasks: [
                                { id: 3, name: 'Task 3', priority: 'Low', completed: false }
                            ]
                        }
                    ],
                    nextTaskId: 4
                },

                addTaskForm(event, element, details) {
                    event.preventDefault()
                    formSubmitDetails = details

                    const projectIndex = details.index
                    const project = this.state.projects[projectIndex]
                    const taskName = project.newTaskName?.trim() || ''

                    if (taskName) {
                        const newTask = {
                            id: this.state.nextTaskId++,
                            name: taskName,
                            priority: project.newTaskPriority,
                            completed: false
                        }

                        // Direct nested property update (as used in docs)
                        const targetProject = this.state.projects[projectIndex]
                        targetProject.tasks = [...targetProject.tasks, newTask]
                        targetProject.newTaskName = ''
                        targetProject.newTaskPriority = 'Medium'
                    }
                },

                deleteTask(event, element, details) {
                    deleteDetails = details
                    const taskIndex = details.index
                    const projectIndex = details.parent.index

                    const updatedProjects = [...this.state.projects]
                    updatedProjects[projectIndex] = {
                        ...updatedProjects[projectIndex],
                        tasks: updatedProjects[projectIndex].tasks.filter((_, i) => i !== taskIndex)
                    }
                    this.state.projects = updatedProjects
                }
            })

            await waitForUpdate(100)

            // Verify initial render
            const projectCards = testContainer.querySelectorAll('.project-card')
            expect(projectCards.length).toBe(2)

            // Get first project's input field
            const firstProject = projectCards[0]
            const taskInput = firstProject.querySelector('.task-input')
            expect(taskInput).not.toBeNull()
            expect(taskInput.placeholder).toBe('New task name...')

            // Test 1: Verify input field is initially empty
            expect(taskInput.value).toBe('')

            // Test 2: Simulate typing "test1" character by character
            // This mimics real user typing behavior
            const testString = 'test1'
            for (const char of testString) {
                taskInput.value += char
                taskInput.dispatchEvent(new Event('input', { bubbles: true }))
                await waitForUpdate(10) // Small delay between keystrokes
            }

            // Verify the input value matches what was typed
            expect(taskInput.value).toBe('test1')

            // Test 3: Verify state was updated correctly
            const component = wildflower.getComponent('project-manager-test')
            expect(component.state.projects[0].newTaskName).toBe('test1')
        })

        it('should handle rapid typing without losing characters', async () => {
            testContainer.innerHTML = `
                <div data-component="rapid-typing-test">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <form data-action="handleSubmit">
                                    <input type="text" data-model="inputValue" class="test-input">
                                    <button type="submit">Submit</button>
                                </form>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('rapid-typing-test', {
                state: {
                    items: [
                        { id: 1, inputValue: '' },
                        { id: 2, inputValue: '' }
                    ]
                },
                handleSubmit(event, element, details) {
                    event.preventDefault()
                }
            })

            await waitForUpdate(100)

            const inputs = testContainer.querySelectorAll('.test-input')
            expect(inputs.length).toBe(2)

            const input = inputs[0]

            // Simulate rapid typing - all at once (paste-like)
            input.value = 'rapidtest'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(50)

            // Check value is correct
            expect(input.value).toBe('rapidtest')

            // Check state is correct
            const component = wildflower.getComponent('rapid-typing-test')
            expect(component.state.items[0].inputValue).toBe('rapidtest')
        })

        it('should properly clear input after form submit', async () => {
            testContainer.innerHTML = `
                <div data-component="form-clear-test">
                    <div data-list="projects">
                        <template>
                            <div class="project">
                                <form data-action="addTaskForm">
                                    <input type="text" data-model="newTaskName" class="task-input">
                                    <button type="submit">Add</button>
                                </form>
                                <div data-list="tasks">
                                    <template>
                                        <div class="task" data-bind="name"></div>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('form-clear-test', {
                state: {
                    projects: [
                        { id: 1, name: 'Project 1', newTaskName: '', tasks: [] }
                    ],
                    nextTaskId: 1
                },
                addTaskForm(event, element, details) {
                    event.preventDefault()
                    const projectIndex = details.index
                    const project = this.state.projects[projectIndex]
                    const taskName = project.newTaskName?.trim()

                    if (taskName) {
                        // Add task
                        project.tasks = [...project.tasks, {
                            id: this.state.nextTaskId++,
                            name: taskName
                        }]
                        // Clear input by setting state
                        project.newTaskName = ''
                    }
                }
            })

            await waitForUpdate(100)

            const input = testContainer.querySelector('.task-input')

            // Type a value
            input.value = 'New Task'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(50)

            // Verify value was set
            expect(input.value).toBe('New Task')

            // Submit the form
            const form = testContainer.querySelector('form')
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
            await waitForUpdate(100)

            // Verify task was added
            const tasks = testContainer.querySelectorAll('.task')
            expect(tasks.length).toBe(1)
            expect(tasks[0].textContent).toBe('New Task')

            // Verify input was cleared
            // Note: This is where the bug manifests - input might not stay cleared
            expect(input.value).toBe('')
        })

        it('should handle select dropdown in nested list', async () => {
            testContainer.innerHTML = `
                <div data-component="dropdown-test">
                    <div data-list="projects">
                        <template>
                            <div class="project">
                                <select data-model="selectedPriority" class="priority-select">
                                    <option value="Low">Low</option>
                                    <option value="Medium" selected>Medium</option>
                                    <option value="High">High</option>
                                </select>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('dropdown-test', {
                state: {
                    projects: [
                        { id: 1, selectedPriority: 'Medium' },
                        { id: 2, selectedPriority: 'Low' }
                    ]
                }
            })

            await waitForUpdate(100)

            const selects = testContainer.querySelectorAll('.priority-select')
            expect(selects.length).toBe(2)

            // First select should have Medium selected
            expect(selects[0].value).toBe('Medium')

            // Second select should have Low selected
            expect(selects[1].value).toBe('Low')

            // Change first select to High
            selects[0].value = 'High'
            selects[0].dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate(50)

            // Verify state was updated
            const component = wildflower.getComponent('dropdown-test')
            expect(component.state.projects[0].selectedPriority).toBe('High')
        })

        it('should update model binding even after focus changes during submit', async () => {
            // This test specifically checks if the focus-skip logic in _updateModelElement
            // is causing the input to not clear after form submit
            testContainer.innerHTML = `
                <div data-component="focus-test">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <form data-action="handleSubmit">
                                    <input type="text" data-model="value" class="test-input">
                                    <button type="submit" class="submit-btn">Submit</button>
                                </form>
                            </div>
                        </template>
                    </div>
                </div>
            `

            let submitCount = 0

            wildflower.component('focus-test', {
                state: {
                    items: [{ id: 1, value: '' }]
                },
                handleSubmit(event, element, details) {
                    event.preventDefault()
                    submitCount++
                    const index = details.index
                    // Clear the value after submit
                    this.state.items[index].value = ''
                }
            })

            await waitForUpdate(100)

            const input = testContainer.querySelector('.test-input')
            const submitBtn = testContainer.querySelector('.submit-btn')

            // Focus the input and type
            input.focus()
            expect(document.activeElement).toBe(input)

            input.value = 'test value'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(50)

            // Verify state has the value
            const component = wildflower.getComponent('focus-test')
            expect(component.state.items[0].value).toBe('test value')

            // Now submit the form (this should blur the input and clear the value)
            // In real browser, clicking submit would blur input then fire submit
            input.blur() // Simulate focus leaving input
            await waitForUpdate(10)

            const form = testContainer.querySelector('form')
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
            await waitForUpdate(100)

            // Verify submit was called
            expect(submitCount).toBe(1)

            // State should be empty
            console.log('State value after submit:', component.state.items[0].value)
            console.log('DOM value after submit:', input.value)
            console.log('Active element:', document.activeElement?.tagName, document.activeElement?.className)

            expect(component.state.items[0].value).toBe('')

            // DOM should also be empty (this is where the bug manifests)
            // If state is '' but DOM is 'test value', the reactive update didn't propagate to DOM
            expect(input.value).toBe('')
        })

        it('should not have timing issues with nested list model bindings', async () => {
            // This test specifically checks for the timing/race condition issues
            testContainer.innerHTML = `
                <div data-component="timing-test">
                    <div data-list="projects">
                        <template>
                            <div class="project">
                                <span data-bind="name" class="project-name"></span>
                                <input type="text" data-model="inputValue" class="project-input">
                                <div data-list="items">
                                    <template>
                                        <div class="item">
                                            <span data-bind="text" class="item-text"></span>
                                            <input type="text" data-model="itemInput" class="item-input">
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('timing-test', {
                state: {
                    projects: [
                        {
                            id: 1,
                            name: 'Project A',
                            inputValue: '',
                            items: [
                                { id: 1, text: 'Item 1', itemInput: '' },
                                { id: 2, text: 'Item 2', itemInput: '' }
                            ]
                        }
                    ]
                }
            })

            await waitForUpdate(100)

            // Get the deeply nested input (inside items list inside projects list)
            const itemInputs = testContainer.querySelectorAll('.item-input')
            expect(itemInputs.length).toBe(2)

            const deepInput = itemInputs[0]

            // Type into the deeply nested input
            const testValue = 'deep-test'
            deepInput.value = testValue
            deepInput.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(50)

            // Verify the value stuck
            expect(deepInput.value).toBe(testValue)

            // Verify state was updated at the correct nested path
            const component = wildflower.getComponent('timing-test')
            expect(component.state.projects[0].items[0].itemInput).toBe(testValue)
        })
    })
})
