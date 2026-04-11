/**
 * Form in List Context Test Suite
 *
 * Tests that forms inside list templates properly receive list context
 * (details.index) when submitted.
 *
 * Bug: Form submit handlers in list items don't receive the `details` parameter
 * with `index`, causing "can't access property 'index', details is undefined"
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, waitForUpdate } from './helpers/load-framework.js'

describe('Form in List Context', () => {
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

    describe('Form Submit in List Item', () => {
        it('should receive details.index when form is submitted', async () => {
            let receivedDetails = null
            let receivedEvent = null

            testContainer.innerHTML = `
                <div data-component="form-list-test">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span data-bind="name"></span>
                                <form data-action="handleSubmit">
                                    <input type="text" data-model="inputValue" class="test-input">
                                    <button type="submit">Submit</button>
                                </form>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('form-list-test', {
                state: {
                    items: [
                        { name: 'Item 1', inputValue: '' },
                        { name: 'Item 2', inputValue: '' },
                        { name: 'Item 3', inputValue: '' }
                    ]
                },
                handleSubmit(event, element, details) {
                    receivedEvent = event
                    receivedDetails = details
                }
            })

            await waitForUpdate(100)

            // Get the second form (index 1)
            const forms = testContainer.querySelectorAll('form')
            expect(forms.length).toBe(3)

            const secondForm = forms[1]

            // Submit the form
            secondForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
            await waitForUpdate(50)

            // Verify details was received with correct index
            expect(receivedEvent).not.toBeNull()
            expect(receivedDetails).not.toBeNull()
            expect(receivedDetails).toHaveProperty('index')
            expect(receivedDetails.index).toBe(1)
        })

        it('should receive details.index for first item (index 0)', async () => {
            let receivedIndex = null
            let handlerCallCount = 0

            testContainer.innerHTML = `
                <div data-component="form-list-first">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <form data-action="handleSubmit">
                                    <button type="submit">Submit</button>
                                </form>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('form-list-first', {
                state: {
                    items: [{ id: 1 }, { id: 2 }]
                },
                handleSubmit(event, element, details) {
                    handlerCallCount++
                    // Note: Don't log the full details object - it contains context with Symbol properties
                    console.log('handleSubmit called', handlerCallCount, 'details.index:', details?.index)
                    receivedIndex = details?.index
                }
            })

            await waitForUpdate(100)

            // Get rendered forms (not the one inside template)
            const listElement = testContainer.querySelector('[data-list]')
            const items = listElement.querySelectorAll(':scope > .item')
            console.log('Found items:', items.length)

            const forms = listElement.querySelectorAll(':scope > .item > form')
            console.log('Found forms:', forms.length)
            expect(forms.length).toBe(2)

            const firstForm = forms[0]
            console.log('First form parent _listIndex:', firstForm.parentElement?._listIndex)

            firstForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
            await waitForUpdate(50)

            console.log('Handler called times:', handlerCallCount, 'receivedIndex:', receivedIndex)
            expect(receivedIndex).toBe(0)
        })

        it('should receive details.index for last item', async () => {
            let receivedIndex = null

            testContainer.innerHTML = `
                <div data-component="form-list-last">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <form data-action="handleSubmit">
                                    <button type="submit">Submit</button>
                                </form>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('form-list-last', {
                state: {
                    items: [{ id: 1 }, { id: 2 }, { id: 3 }]
                },
                handleSubmit(event, element, details) {
                    receivedIndex = details?.index
                }
            })

            await waitForUpdate(100)

            // Get rendered forms (not the one inside template)
            const listElement = testContainer.querySelector('[data-list]')
            const forms = listElement.querySelectorAll(':scope > .item > form')
            expect(forms.length).toBe(3)

            const lastForm = forms[forms.length - 1]
            lastForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
            await waitForUpdate(50)

            expect(receivedIndex).toBe(2)
        })

        it('should work with nested lists (form in inner list)', async () => {
            let receivedDetails = null

            testContainer.innerHTML = `
                <div data-component="nested-form-test">
                    <div data-list="projects">
                        <template>
                            <div class="project">
                                <span data-bind="name"></span>
                                <div data-list="tasks">
                                    <template>
                                        <div class="task">
                                            <form data-action="addTask">
                                                <button type="submit">Add</button>
                                            </form>
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('nested-form-test', {
                state: {
                    projects: [
                        { name: 'Project 1', tasks: [{ id: 1 }] },
                        { name: 'Project 2', tasks: [{ id: 2 }, { id: 3 }] }
                    ]
                },
                addTask(event, element, details) {
                    receivedDetails = details
                }
            })

            await waitForUpdate(100)

            // Get second project's first task form
            const projects = testContainer.querySelectorAll('.project')
            const secondProject = projects[1]
            const tasks = secondProject.querySelectorAll('.task')
            const form = tasks[0].querySelector('form')

            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
            await waitForUpdate(50)

            expect(receivedDetails).not.toBeNull()
            expect(receivedDetails).toHaveProperty('index')
            // The form is in the first task of the second project
            expect(receivedDetails.index).toBe(0)
            // Should also have parent index
            expect(receivedDetails).toHaveProperty('parent')
            expect(receivedDetails.parent.index).toBe(1)
        })
    })
})
