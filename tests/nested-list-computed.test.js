/**
 * Nested Lists with Computed Lists Tests
 *
 * Tests complex nested list scenarios where the outer list is a computed list.
 * Covers model binding, actions, and deep nesting with computed list parents.
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

describe('Nested Lists with Computed Parent', () => {
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

    describe('Parent-Child List Rendering', () => {
        it('should render nested lists within computed parent list', async () => {
            wildflower.component('computed-parent-nested', {
                state: {
                    departments: [
                        {
                            id: 1,
                            name: 'Engineering',
                            active: true,
                            employees: [
                                { id: 101, name: 'Alice' },
                                { id: 102, name: 'Bob' }
                            ]
                        },
                        {
                            id: 2,
                            name: 'Marketing',
                            active: false,
                            employees: [
                                { id: 201, name: 'Carol' }
                            ]
                        },
                        {
                            id: 3,
                            name: 'Sales',
                            active: true,
                            employees: [
                                { id: 301, name: 'Dave' },
                                { id: 302, name: 'Eve' },
                                { id: 303, name: 'Frank' }
                            ]
                        }
                    ]
                },
                computed: {
                    activeDepartments() {
                        return this.state.departments.filter(d => d.active)
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-parent-nested">
                    <div data-list="computed:activeDepartments">
                        <template>
                            <div class="department">
                                <h3 class="dept-name" data-bind="name"></h3>
                                <ul data-list="employees">
                                    <template>
                                        <li class="employee" data-bind="name"></li>
                                    </template>
                                </ul>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            // Only active departments (Engineering, Sales)
            const departments = testContainer.querySelectorAll('.department')
            expect(departments.length).toBe(2)

            const deptNames = testContainer.querySelectorAll('.dept-name')
            expect(deptNames[0].textContent).toBe('Engineering')
            expect(deptNames[1].textContent).toBe('Sales')

            // Engineering: 2 employees
            const eng = departments[0]
            const engEmployees = eng.querySelectorAll('.employee')
            expect(engEmployees.length).toBe(2)
            expect(engEmployees[0].textContent).toBe('Alice')
            expect(engEmployees[1].textContent).toBe('Bob')

            // Sales: 3 employees
            const sales = departments[1]
            const salesEmployees = sales.querySelectorAll('.employee')
            expect(salesEmployees.length).toBe(3)
            expect(salesEmployees[0].textContent).toBe('Dave')
            expect(salesEmployees[1].textContent).toBe('Eve')
            expect(salesEmployees[2].textContent).toBe('Frank')
        })
    })

    describe('Update Nested List Items', () => {
        it('should update nested list items in computed parent', async () => {
            wildflower.component('computed-update-nested', {
                state: {
                    categories: [
                        {
                            id: 1,
                            name: 'Category A',
                            visible: true,
                            items: [{ id: 1, title: 'Original Title' }]
                        }
                    ]
                },
                computed: {
                    visibleCategories() {
                        return this.state.categories.filter(c => c.visible)
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-update-nested">
                    <div data-list="computed:visibleCategories">
                        <template>
                            <div class="category">
                                <div data-list="items">
                                    <template>
                                        <div class="item">
                                            <span class="item-title" data-bind="title"></span>
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

            const component = testContainer.querySelector('[data-component="computed-update-nested"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            let title = testContainer.querySelector('.item-title')
            expect(title.textContent).toBe('Original Title')

            // Update nested item via array reassignment
            instance.state.categories = [
                {
                    id: 1,
                    name: 'Category A',
                    visible: true,
                    items: [{ id: 1, title: 'Updated Title' }]
                }
            ]
            await waitForCompleteRender()

            title = testContainer.querySelector('.item-title')
            expect(title.textContent).toBe('Updated Title')
        })
    })

    describe('Child List Model Binding - Checkbox', () => {
        it('should update child item checkbox in computed parent list', async () => {
            wildflower.component('computed-nested-checkbox', {
                state: {
                    projects: [
                        {
                            id: 1,
                            name: 'Project Alpha',
                            active: true,
                            tasks: [
                                { id: 101, text: 'Task A-1', done: false },
                                { id: 102, text: 'Task A-2', done: true }
                            ]
                        },
                        {
                            id: 2,
                            name: 'Project Beta',
                            active: false,
                            tasks: [
                                { id: 201, text: 'Task B-1', done: false }
                            ]
                        }
                    ]
                },
                computed: {
                    activeProjects() {
                        return this.state.projects.filter(p => p.active)
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-nested-checkbox">
                    <div data-list="computed:activeProjects">
                        <template>
                            <div class="project">
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

            const component = testContainer.querySelector('[data-component="computed-nested-checkbox"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            // Only active project (Project Alpha)
            const projects = testContainer.querySelectorAll('.project')
            expect(projects.length).toBe(1)

            const checkboxes = testContainer.querySelectorAll('.task-cb')
            expect(checkboxes.length).toBe(2)

            // Initial state
            expect(checkboxes[0].checked).toBe(false)
            expect(checkboxes[1].checked).toBe(true)

            // Toggle first checkbox
            checkboxes[0].checked = true
            checkboxes[0].dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate(100)

            expect(instance.state.projects[0].tasks[0].done).toBe(true)

            // Toggle second checkbox
            checkboxes[1].checked = false
            checkboxes[1].dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate(100)

            expect(instance.state.projects[0].tasks[1].done).toBe(false)
        })
    })

    describe('Child List Model Binding - Text Input', () => {
        it('should update child item text input in computed parent list', async () => {
            wildflower.component('computed-nested-text', {
                state: {
                    folders: [
                        {
                            id: 1,
                            name: 'Documents',
                            pinned: true,
                            files: [
                                { id: 101, filename: 'report.pdf' },
                                { id: 102, filename: 'notes.txt' }
                            ]
                        },
                        {
                            id: 2,
                            name: 'Downloads',
                            pinned: false,
                            files: [
                                { id: 201, filename: 'image.png' }
                            ]
                        }
                    ]
                },
                computed: {
                    pinnedFolders() {
                        return this.state.folders.filter(f => f.pinned)
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-nested-text">
                    <div data-list="computed:pinnedFolders">
                        <template>
                            <div class="folder">
                                <h3 data-bind="name"></h3>
                                <div data-list="files">
                                    <template>
                                        <div class="file">
                                            <input type="text" data-model="filename" class="filename-input">
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

            const component = testContainer.querySelector('[data-component="computed-nested-text"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            const inputs = testContainer.querySelectorAll('.filename-input')
            expect(inputs.length).toBe(2)

            // Initial values
            expect(inputs[0].value).toBe('report.pdf')
            expect(inputs[1].value).toBe('notes.txt')

            // Change first filename
            inputs[0].value = 'annual-report.pdf'
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(100)

            expect(instance.state.folders[0].files[0].filename).toBe('annual-report.pdf')
            expect(instance.state.folders[0].files[1].filename).toBe('notes.txt')
        })
    })

    describe('Child List Actions - Add', () => {
        it('should add item to nested list in computed parent', async () => {
            wildflower.component('computed-nested-add', {
                state: {
                    groups: [
                        {
                            id: 1,
                            name: 'Group 1',
                            enabled: true,
                            members: [{ id: 1, name: 'Initial Member' }]
                        }
                    ],
                    nextMemberId: 2
                },
                computed: {
                    enabledGroups() {
                        return this.state.groups.filter(g => g.enabled)
                    }
                },
                addMember(event, element, details) {
                    const group = details.item
                    const newMember = { id: this.state.nextMemberId++, name: `New Member ${this.state.nextMemberId - 1}` }
                    group.members = [...group.members, newMember]
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-nested-add">
                    <div data-list="computed:enabledGroups">
                        <template>
                            <div class="group">
                                <h3 data-bind="name"></h3>
                                <button class="add-btn" data-action="addMember">Add Member</button>
                                <ul data-list="members">
                                    <template>
                                        <li class="member" data-bind="name"></li>
                                    </template>
                                </ul>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            // Initial: 1 member
            let members = testContainer.querySelectorAll('.member')
            expect(members.length).toBe(1)
            expect(members[0].textContent).toBe('Initial Member')

            // Add member
            const addBtn = testContainer.querySelector('.add-btn')
            addBtn.click()
            await waitForCompleteRender()

            // Should have 2 members
            members = testContainer.querySelectorAll('.member')
            expect(members.length).toBe(2)
            expect(members[1].textContent).toBe('New Member 2')

            // Add another
            addBtn.click()
            await waitForCompleteRender()

            members = testContainer.querySelectorAll('.member')
            expect(members.length).toBe(3)
        })
    })

    describe('Child List Actions - Delete', () => {
        it('should delete item from nested list in computed parent', async () => {
            let capturedDetails = null

            wildflower.component('computed-nested-delete', {
                state: {
                    sections: [
                        {
                            id: 1,
                            title: 'Section A',
                            expanded: true,
                            items: [
                                { id: 101, label: 'Item 1' },
                                { id: 102, label: 'Item 2' },
                                { id: 103, label: 'Item 3' }
                            ]
                        }
                    ]
                },
                computed: {
                    expandedSections() {
                        return this.state.sections.filter(s => s.expanded)
                    }
                },
                deleteItem(event, element, details) {
                    capturedDetails = { ...details, item: details.item ? { ...details.item } : null }
                    const { index } = details
                    if (typeof index === 'number') {
                        const newItems = [...this.state.sections[0].items]
                        newItems.splice(index, 1)
                        this.state.sections[0].items = newItems
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-nested-delete">
                    <div data-list="computed:expandedSections">
                        <template>
                            <div class="section">
                                <h3 data-bind="title"></h3>
                                <ul data-list="items">
                                    <template>
                                        <li class="item">
                                            <span class="item-label" data-bind="label"></span>
                                            <button class="delete-btn" data-action="deleteItem">Delete</button>
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

            const component = testContainer.querySelector('[data-component="computed-nested-delete"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            // Initial: 3 items
            let items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(3)

            // Verify initial order
            let labels = testContainer.querySelectorAll('.item-label')
            expect(labels[0].textContent).toBe('Item 1')
            expect(labels[1].textContent).toBe('Item 2')
            expect(labels[2].textContent).toBe('Item 3')

            // Delete middle item (Item 2)
            const deleteBtns = testContainer.querySelectorAll('.delete-btn')
            deleteBtns[1].click()
            await waitForCompleteRender()

            // Verify captured details
            expect(capturedDetails).not.toBeNull()
            expect(capturedDetails.index).toBe(1)
            expect(capturedDetails.item?.label).toBe('Item 2')

            // Should have 2 items
            items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)

            // Verify correct items remain
            labels = testContainer.querySelectorAll('.item-label')
            expect(labels[0].textContent).toBe('Item 1')
            expect(labels[1].textContent).toBe('Item 3')

            expect(instance.state.sections[0].items.length).toBe(2)
        })
    })

    describe('Delete Parent with Children', () => {
        it('should delete parent category and all children in computed list', async () => {
            wildflower.component('computed-delete-parent', {
                state: {
                    containers: [
                        {
                            id: 1,
                            name: 'Container A',
                            open: true,
                            widgets: [{ id: 101, type: 'button' }]
                        },
                        {
                            id: 2,
                            name: 'Container B',
                            open: true,
                            widgets: [
                                { id: 201, type: 'input' },
                                { id: 202, type: 'checkbox' }
                            ]
                        }
                    ]
                },
                computed: {
                    openContainers() {
                        return this.state.containers.filter(c => c.open)
                    }
                },
                deleteContainer(event, element, details) {
                    const container = details.item
                    const idx = this.state.containers.findIndex(c => c.id === container.id)
                    if (idx > -1) {
                        const newContainers = [...this.state.containers]
                        newContainers.splice(idx, 1)
                        this.state.containers = newContainers
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-delete-parent">
                    <div data-list="computed:openContainers">
                        <template>
                            <div class="container">
                                <h3 class="container-name" data-bind="name"></h3>
                                <button class="delete-container-btn" data-action="deleteContainer">Delete</button>
                                <ul data-list="widgets">
                                    <template>
                                        <li class="widget" data-bind="type"></li>
                                    </template>
                                </ul>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            // Initial: 2 containers, 3 total widgets
            let containers = testContainer.querySelectorAll('.container')
            let widgets = testContainer.querySelectorAll('.widget')
            expect(containers.length).toBe(2)
            expect(widgets.length).toBe(3)

            // Delete first container
            const deleteBtns = testContainer.querySelectorAll('.delete-container-btn')
            deleteBtns[0].click()
            await waitForCompleteRender()

            // Should have 1 container, 2 widgets
            containers = testContainer.querySelectorAll('.container')
            widgets = testContainer.querySelectorAll('.widget')
            expect(containers.length).toBe(1)
            expect(widgets.length).toBe(2)

            // Verify Container B remains
            const containerName = testContainer.querySelector('.container-name')
            expect(containerName.textContent).toBe('Container B')
        })
    })

    describe('Deeply Nested (3+ Levels)', () => {
        it('should render 3-level nested structure with computed parent', async () => {
            wildflower.component('computed-deep-nested', {
                state: {
                    regions: [
                        {
                            id: 1,
                            name: 'North America',
                            active: true,
                            countries: [
                                {
                                    name: 'USA',
                                    cities: [
                                        { name: 'New York' },
                                        { name: 'Los Angeles' }
                                    ]
                                },
                                {
                                    name: 'Canada',
                                    cities: [
                                        { name: 'Toronto' }
                                    ]
                                }
                            ]
                        },
                        {
                            id: 2,
                            name: 'Europe',
                            active: false,
                            countries: []
                        },
                        {
                            id: 3,
                            name: 'Asia',
                            active: true,
                            countries: [
                                {
                                    name: 'Japan',
                                    cities: [
                                        { name: 'Tokyo' },
                                        { name: 'Osaka' }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                computed: {
                    activeRegions() {
                        return this.state.regions.filter(r => r.active)
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-deep-nested">
                    <div data-list="computed:activeRegions">
                        <template>
                            <div class="region">
                                <h2 class="region-name" data-bind="name"></h2>
                                <div data-list="countries">
                                    <template>
                                        <div class="country">
                                            <h3 class="country-name" data-bind="name"></h3>
                                            <ul data-list="cities">
                                                <template>
                                                    <li class="city" data-bind="name"></li>
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

            // Only active regions (North America, Asia)
            const regions = testContainer.querySelectorAll('.region')
            expect(regions.length).toBe(2)

            const regionNames = testContainer.querySelectorAll('.region-name')
            expect(regionNames[0].textContent).toBe('North America')
            expect(regionNames[1].textContent).toBe('Asia')

            // Countries
            const countries = testContainer.querySelectorAll('.country')
            expect(countries.length).toBe(3) // USA, Canada, Japan

            // Cities
            const cities = testContainer.querySelectorAll('.city')
            expect(cities.length).toBe(5) // NY, LA, Toronto, Tokyo, Osaka

            // Verify specific cities
            expect(cities[0].textContent).toBe('New York')
            expect(cities[1].textContent).toBe('Los Angeles')
            expect(cities[2].textContent).toBe('Toronto')
            expect(cities[3].textContent).toBe('Tokyo')
            expect(cities[4].textContent).toBe('Osaka')
        })

        it('should handle model binding at deepest level in computed parent', async () => {
            wildflower.component('computed-deep-model', {
                state: {
                    organizations: [
                        {
                            name: 'Org A',
                            visible: true,
                            divisions: [
                                {
                                    name: 'Division 1',
                                    teams: [
                                        { name: 'Team Alpha', active: true }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                computed: {
                    visibleOrgs() {
                        return this.state.organizations.filter(o => o.visible)
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-deep-model">
                    <div data-list="computed:visibleOrgs">
                        <template>
                            <div class="org">
                                <div data-list="divisions">
                                    <template>
                                        <div class="division">
                                            <div data-list="teams">
                                                <template>
                                                    <div class="team">
                                                        <input type="checkbox" data-model="active" class="team-cb">
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

            const component = testContainer.querySelector('[data-component="computed-deep-model"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            const checkbox = testContainer.querySelector('.team-cb')
            expect(checkbox.checked).toBe(true)

            // Toggle checkbox at deepest level
            checkbox.checked = false
            checkbox.dispatchEvent(new Event('change', { bubbles: true }))
            await waitForUpdate(100)

            expect(instance.state.organizations[0].divisions[0].teams[0].active).toBe(false)
        })
    })
})
