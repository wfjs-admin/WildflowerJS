/**
 * Nested List Path Resolution Test
 *
 * Tests to verify that form inputs in deeply nested lists
 * correctly resolve the full path (e.g., "projects.0.tasks" not just "tasks")
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, waitForUpdate } from './helpers/load-framework.js'

describe('Nested List Path Resolution', () => {
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

    describe('Two-level nested lists', () => {
        it('should update state at correct nested path when typing in nested list input', async () => {
            testContainer.innerHTML = `
                <div data-component="nested-path-test">
                    <div data-list="projects">
                        <template>
                            <div class="project">
                                <span data-bind="name" class="project-name"></span>
                                <div data-list="tasks">
                                    <template>
                                        <div class="task">
                                            <input type="text" data-model="title" class="task-input">
                                            <span data-bind="title" class="task-title"></span>
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                    <!-- This shows if a root-level "tasks" property accidentally gets created -->
                    <div id="root-tasks-check" data-bind="rootTasksExists"></div>
                </div>
            `

            wildflower.component('nested-path-test', {
                state: {
                    projects: [
                        {
                            id: 1,
                            name: 'Project A',
                            tasks: [
                                { id: 101, title: 'Task 1' },
                                { id: 102, title: 'Task 2' }
                            ]
                        },
                        {
                            id: 2,
                            name: 'Project B',
                            tasks: [
                                { id: 201, title: 'Task X' }
                            ]
                        }
                    ],
                    // Computed to detect if "tasks" gets created at root level
                    get rootTasksExists() {
                        return this.tasks !== undefined ? 'ROOT_TASKS_EXISTS' : 'NO_ROOT_TASKS'
                    }
                }
            })

            await waitForUpdate(100)

            // Verify initial render
            const projects = testContainer.querySelectorAll('.project')
            expect(projects.length).toBe(2)

            const project1Tasks = projects[0].querySelectorAll('.task')
            expect(project1Tasks.length).toBe(2)

            // Get the first task's input in the first project
            const taskInput = projects[0].querySelector('.task-input')
            expect(taskInput).not.toBeNull()
            expect(taskInput.value).toBe('Task 1')

            // Verify no root-level "tasks" exists initially
            const rootCheck = testContainer.querySelector('#root-tasks-check')
            expect(rootCheck.textContent).toBe('NO_ROOT_TASKS')

            // Type in the nested input
            taskInput.value = 'Updated Task 1'
            taskInput.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(100)

            // Verify the state was updated at the CORRECT nested path
            const component = wildflower.getComponent('nested-path-test')

            // The correct path should be updated
            expect(component.state.projects[0].tasks[0].title).toBe('Updated Task 1')

            // Other tasks should NOT be affected
            expect(component.state.projects[0].tasks[1].title).toBe('Task 2')
            expect(component.state.projects[1].tasks[0].title).toBe('Task X')

            // Root-level "tasks" should NOT have been created
            expect(component.state.tasks).toBeUndefined()
            expect(rootCheck.textContent).toBe('NO_ROOT_TASKS')

            // The DOM should reflect the update
            const taskTitle = projects[0].querySelector('.task-title')
            expect(taskTitle.textContent).toBe('Updated Task 1')
        })

        it('should update second project nested list correctly', async () => {
            testContainer.innerHTML = `
                <div data-component="second-project-test">
                    <div data-list="projects">
                        <template>
                            <div class="project">
                                <span data-bind="name" class="project-name"></span>
                                <div data-list="items">
                                    <template>
                                        <div class="item">
                                            <input type="text" data-model="value" class="item-input">
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('second-project-test', {
                state: {
                    projects: [
                        { id: 1, name: 'First', items: [{ value: 'A' }] },
                        { id: 2, name: 'Second', items: [{ value: 'B' }, { value: 'C' }] }
                    ]
                }
            })

            await waitForUpdate(100)

            const projects = testContainer.querySelectorAll('.project')
            expect(projects.length).toBe(2)

            // Get second project's second item input
            const secondProjectInputs = projects[1].querySelectorAll('.item-input')
            expect(secondProjectInputs.length).toBe(2)

            const targetInput = secondProjectInputs[1] // Second item
            expect(targetInput.value).toBe('C')

            // Update it
            targetInput.value = 'UPDATED_C'
            targetInput.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(100)

            // Verify correct path was updated
            const component = wildflower.getComponent('second-project-test')
            expect(component.state.projects[1].items[1].value).toBe('UPDATED_C')

            // Other values should be unchanged
            expect(component.state.projects[0].items[0].value).toBe('A')
            expect(component.state.projects[1].items[0].value).toBe('B')
        })

        it('should handle three-level nested lists', async () => {
            testContainer.innerHTML = `
                <div data-component="three-level-test">
                    <div data-list="companies">
                        <template>
                            <div class="company">
                                <div data-list="departments">
                                    <template>
                                        <div class="department">
                                            <div data-list="employees">
                                                <template>
                                                    <div class="employee">
                                                        <input type="text" data-model="name" class="employee-input">
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

            wildflower.component('three-level-test', {
                state: {
                    companies: [
                        {
                            id: 1,
                            departments: [
                                {
                                    id: 1,
                                    employees: [
                                        { name: 'Alice' },
                                        { name: 'Bob' }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            })

            await waitForUpdate(100)

            const employeeInputs = testContainer.querySelectorAll('.employee-input')
            expect(employeeInputs.length).toBe(2)
            expect(employeeInputs[1].value).toBe('Bob')

            // Update deeply nested value
            employeeInputs[1].value = 'Bobby'
            employeeInputs[1].dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(100)

            // Verify the deeply nested path was updated correctly
            const component = wildflower.getComponent('three-level-test')
            expect(component.state.companies[0].departments[0].employees[1].name).toBe('Bobby')
            expect(component.state.companies[0].departments[0].employees[0].name).toBe('Alice')
        })
    })
})
