/**
 * Tests for computed properties in list item context
 *
 * Issue: data-bind-style="computed:..." works in list item context and has access
 * to list item properties (like this.tasks), but data-bind="computed:..." does not.
 * Both binding types should have consistent behavior.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Computed Properties in List Item Context', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
        wildflower = window.wildflower
    })

    beforeEach(() => {
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

    describe('Consistency between data-bind and data-bind-style', () => {
        it('should allow computed properties to access list item data via data-bind-style', async () => {
            // This test verifies that data-bind-style with computed works (baseline)
            wildflower.component('style-computed-test', {
                state: {
                    projects: [
                        {
                            id: 1,
                            name: 'Project 1',
                            tasks: [
                                { completed: true },
                                { completed: false },
                                { completed: true }
                            ]
                        }
                    ]
                },
                computed: {
                    progressStyle(item) {
                        const tasks = (item && item.tasks) || []
                        if (tasks.length === 0) return { width: '0%' }
                        const completed = tasks.filter(t => t.completed).length
                        const progress = Math.round((completed / tasks.length) * 100)
                        return { width: progress + '%' }
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="style-computed-test">
                    <div data-list="projects">
                        <template>
                            <div class="project">
                                <div class="progress-bar" data-bind-style="computed:progressStyle"></div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const progressBar = testContainer.querySelector('.progress-bar')
            expect(progressBar).toBeTruthy()
            // 2 out of 3 tasks completed = 67%
            expect(progressBar.style.width).toBe('67%')
        })

        it('should allow computed properties to access list item data via data-bind', async () => {
            // This test currently FAILS - demonstrates the inconsistency
            wildflower.component('text-computed-test', {
                state: {
                    projects: [
                        {
                            id: 1,
                            name: 'Project 1',
                            tasks: [
                                { completed: true },
                                { completed: false },
                                { completed: true }
                            ]
                        }
                    ]
                },
                computed: {
                    progressText(item) {
                        const tasks = (item && item.tasks) || []
                        if (tasks.length === 0) return '0%'
                        const completed = tasks.filter(t => t.completed).length
                        return Math.round((completed / tasks.length) * 100) + '%'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="text-computed-test">
                    <div data-list="projects">
                        <template>
                            <div class="project">
                                <span class="progress-text" data-bind="computed:progressText"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const progressText = testContainer.querySelector('.progress-text')
            expect(progressText).toBeTruthy()
            // Should be "67%" but currently returns empty/null due to the inconsistency
            expect(progressText.textContent).toBe('67%')
        })

        it('should allow both binding types to access the same list item computed property', async () => {
            // Combined test showing both should work together
            wildflower.component('combined-computed-test', {
                state: {
                    items: [
                        { value: 25 },
                        { value: 75 }
                    ]
                },
                computed: {
                    displayValue(item) {
                        // Access list item property
                        return item.value + '%'
                    },
                    barStyle(item) {
                        // Access list item property
                        return { width: item.value + '%' }
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="combined-computed-test">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <div class="bar" data-bind-style="computed:barStyle"></div>
                                <span class="text" data-bind="computed:displayValue"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)

            // First item: value = 25
            const bar1 = items[0].querySelector('.bar')
            const text1 = items[0].querySelector('.text')
            expect(bar1.style.width).toBe('25%')
            expect(text1.textContent).toBe('25%')

            // Second item: value = 75
            const bar2 = items[1].querySelector('.bar')
            const text2 = items[1].querySelector('.text')
            expect(bar2.style.width).toBe('75%')
            expect(text2.textContent).toBe('75%')
        })
    })

    describe('Nested list computed properties', () => {
        it('should access nested list item properties in computed via data-bind', async () => {
            wildflower.component('nested-computed-test', {
                state: {
                    departments: [
                        {
                            name: 'Engineering',
                            employees: [
                                { name: 'Alice', active: true },
                                { name: 'Bob', active: false }
                            ]
                        }
                    ]
                },
                computed: {
                    activeCount(dept) {
                        const employees = (dept && dept.employees) || []
                        return employees.filter(e => e.active).length + ' active'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-computed-test">
                    <div data-list="departments">
                        <template>
                            <div class="dept">
                                <span class="dept-name" data-bind="name"></span>
                                <span class="active-count" data-bind="computed:activeCount"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const deptName = testContainer.querySelector('.dept-name')
            const activeCount = testContainer.querySelector('.active-count')

            expect(deptName.textContent).toBe('Engineering')
            // This should show "1 active" but currently fails
            expect(activeCount.textContent).toBe('1 active')
        })
    })

    describe('data-bind-class with computed in list context', () => {
        it('should apply computed class based on list item data', async () => {
            wildflower.component('class-computed-test', {
                state: {
                    items: [
                        { status: 'active', priority: 3 },
                        { status: 'inactive', priority: 1 }
                    ]
                },
                computed: {
                    statusClass(item) {
                        return item.status === 'active' ? 'bg-success' : 'bg-danger'
                    },
                    priorityClass(item) {
                        if (item.priority >= 3) return 'priority-high'
                        if (item.priority >= 2) return 'priority-medium'
                        return 'priority-low'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="class-computed-test">
                    <div data-list="items">
                        <template>
                            <div class="item" data-bind-class="computed:statusClass">
                                <span class="priority-badge" data-bind-class="computed:priorityClass"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)

            // First item: active, priority 3
            expect(items[0].classList.contains('bg-success')).toBe(true)
            expect(items[0].querySelector('.priority-badge').classList.contains('priority-high')).toBe(true)

            // Second item: inactive, priority 1
            expect(items[1].classList.contains('bg-danger')).toBe(true)
            expect(items[1].querySelector('.priority-badge').classList.contains('priority-low')).toBe(true)
        })
    })

    describe('data-bind-html with computed in list context', () => {
        it('should render computed HTML based on list item data', async () => {
            wildflower.component('html-computed-test', {
                state: {
                    articles: [
                        { title: 'First Post', highlight: true },
                        { title: 'Second Post', highlight: false }
                    ]
                },
                computed: {
                    formattedTitle(item) {
                        if (item.highlight) {
                            return `<strong>${item.title}</strong>`
                        }
                        return `<em>${item.title}</em>`
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="html-computed-test">
                    <div data-list="articles">
                        <template>
                            <div class="article">
                                <div class="title" data-bind-html="computed:formattedTitle"></div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const articles = testContainer.querySelectorAll('.article')
            expect(articles.length).toBe(2)

            // First article: highlighted
            const title1 = articles[0].querySelector('.title')
            expect(title1.innerHTML).toContain('<strong>')
            expect(title1.textContent).toBe('First Post')

            // Second article: not highlighted
            const title2 = articles[1].querySelector('.title')
            expect(title2.innerHTML).toContain('<em>')
            expect(title2.textContent).toBe('Second Post')
        })
    })

    describe('data-show with computed in list context', () => {
        it('should conditionally show elements based on computed in list item', async () => {
            wildflower.component('show-computed-test', {
                state: {
                    products: [
                        { name: 'Item A', stock: 10 },
                        { name: 'Item B', stock: 0 }
                    ]
                },
                computed: {
                    isInStock(item) {
                        return item.stock > 0
                    },
                    isOutOfStock(item) {
                        return item.stock === 0
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="show-computed-test">
                    <div data-list="products">
                        <template>
                            <div class="product">
                                <span class="name" data-bind="name"></span>
                                <span class="in-stock" data-show="computed:isInStock">In Stock</span>
                                <span class="out-of-stock" data-show="computed:isOutOfStock">Out of Stock</span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const products = testContainer.querySelectorAll('.product')
            expect(products.length).toBe(2)

            // First product: stock = 10 (in stock)
            const inStock1 = products[0].querySelector('.in-stock')
            const outOfStock1 = products[0].querySelector('.out-of-stock')
            expect(getComputedStyle(inStock1).display).not.toBe('none')
            expect(getComputedStyle(outOfStock1).display).toBe('none')

            // Second product: stock = 0 (out of stock)
            const inStock2 = products[1].querySelector('.in-stock')
            const outOfStock2 = products[1].querySelector('.out-of-stock')
            expect(getComputedStyle(inStock2).display).toBe('none')
            expect(getComputedStyle(outOfStock2).display).not.toBe('none')
        })
    })

    describe('data-render with computed in list context', () => {
        it('should conditionally render elements based on computed in list item', async () => {
            wildflower.component('render-computed-test', {
                state: {
                    users: [
                        { name: 'Admin', isAdmin: true },
                        { name: 'User', isAdmin: false }
                    ]
                },
                computed: {
                    showAdminBadge(user) {
                        return user.isAdmin === true
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="render-computed-test">
                    <div data-list="users">
                        <template>
                            <div class="user">
                                <span class="name" data-bind="name"></span>
                                <span class="admin-badge" data-render="computed:showAdminBadge">ADMIN</span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const users = testContainer.querySelectorAll('.user')
            expect(users.length).toBe(2)

            // First user: admin - badge should be in DOM
            const adminBadge1 = users[0].querySelector('.admin-badge')
            expect(adminBadge1).toBeTruthy()
            expect(adminBadge1.textContent).toBe('ADMIN')

            // Second user: not admin - badge should not be in DOM
            const adminBadge2 = users[1].querySelector('.admin-badge')
            expect(adminBadge2).toBeFalsy()
        })
    })

    describe('Reactivity: computed re-evaluates when item is replaced', () => {
        it('should update computed text binding when item is replaced', async () => {
            let componentInstance
            wildflower.component('reactive-text-test', {
                state: {
                    items: [
                        { name: 'Alice', score: 85 },
                        { name: 'Bob', score: 72 }
                    ]
                },
                computed: {
                    grade(item) {
                        if (item.score >= 90) return 'A'
                        if (item.score >= 80) return 'B'
                        if (item.score >= 70) return 'C'
                        return 'F'
                    }
                },
                init() {
                    componentInstance = this
                }
            })

            testContainer.innerHTML = `
                <div data-component="reactive-text-test">
                    <div data-list="items">
                        <template>
                            <div class="student">
                                <span class="name" data-bind="name"></span>
                                <span class="grade" data-bind="computed:grade"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            // Initial state
            let grades = testContainer.querySelectorAll('.grade')
            expect(grades[0].textContent).toBe('B') // Alice: 85
            expect(grades[1].textContent).toBe('C') // Bob: 72

            // Replace Alice with updated score (triggers reactive update)
            componentInstance.state.items.splice(0, 1, { name: 'Alice', score: 95 })
            await waitForUpdate(100)

            grades = testContainer.querySelectorAll('.grade')
            expect(grades[0].textContent).toBe('A') // Alice: 95 -> A
            expect(grades[1].textContent).toBe('C') // Bob unchanged
        })

        it('should update computed class binding when item is replaced', async () => {
            let componentInstance
            wildflower.component('reactive-class-test', {
                state: {
                    tasks: [
                        { title: 'Task 1', completed: false },
                        { title: 'Task 2', completed: true }
                    ]
                },
                computed: {
                    taskClass(task) {
                        return task.completed ? 'task-done' : 'task-pending'
                    }
                },
                init() {
                    componentInstance = this
                }
            })

            testContainer.innerHTML = `
                <div data-component="reactive-class-test">
                    <div data-list="tasks">
                        <template>
                            <div class="task" data-bind-class="computed:taskClass">
                                <span data-bind="title"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            let tasks = testContainer.querySelectorAll('.task')
            expect(tasks[0].classList.contains('task-pending')).toBe(true)
            expect(tasks[1].classList.contains('task-done')).toBe(true)

            // Replace task 1 with completed version
            componentInstance.state.tasks.splice(0, 1, { title: 'Task 1', completed: true })
            await waitForUpdate(100)

            tasks = testContainer.querySelectorAll('.task')
            expect(tasks[0].classList.contains('task-done')).toBe(true)
            expect(tasks[0].classList.contains('task-pending')).toBe(false)
        })

        it('should update computed style binding when item is replaced', async () => {
            let componentInstance
            wildflower.component('reactive-style-test', {
                state: {
                    bars: [
                        { label: 'Bar 1', progress: 25 },
                        { label: 'Bar 2', progress: 75 }
                    ]
                },
                computed: {
                    barStyle(bar) {
                        return { width: bar.progress + '%' }
                    }
                },
                init() {
                    componentInstance = this
                }
            })

            testContainer.innerHTML = `
                <div data-component="reactive-style-test">
                    <div data-list="bars">
                        <template>
                            <div class="bar-container">
                                <div class="bar" data-bind-style="computed:barStyle"></div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            let bars = testContainer.querySelectorAll('.bar')
            expect(bars[0].style.width).toBe('25%')
            expect(bars[1].style.width).toBe('75%')

            // Replace bar 1 with updated progress
            componentInstance.state.bars.splice(0, 1, { label: 'Bar 1', progress: 50 })
            await waitForUpdate(100)

            bars = testContainer.querySelectorAll('.bar')
            expect(bars[0].style.width).toBe('50%')
            expect(bars[1].style.width).toBe('75%') // Unchanged
        })
    })

    describe('Checkbox toggle regression (sparse update fix)', () => {
        it('should preserve computed class bindings on ALL items when toggling ONE checkbox', async () => {
            // This is the exact regression scenario that was fixed
            let componentInstance
            wildflower.component('checkbox-class-test', {
                state: {
                    todos: [
                        { text: 'First task', completed: false, priority: 'High' },
                        { text: 'Second task', completed: false, priority: 'Medium' },
                        { text: 'Third task', completed: true, priority: 'Low' }
                    ]
                },
                computed: {
                    cardClass(todo) {
                        return todo.completed ? 'bg-light border-success' : 'border-primary'
                    },
                    priorityBadgeClass(todo) {
                        const classes = {
                            'High': 'bg-danger',
                            'Medium': 'bg-warning',
                            'Low': 'bg-success'
                        }
                        return classes[todo.priority] || 'bg-secondary'
                    }
                },
                init() {
                    componentInstance = this
                }
            })

            testContainer.innerHTML = `
                <div data-component="checkbox-class-test">
                    <div data-list="todos">
                        <template>
                            <div class="card" data-bind-class="computed:cardClass">
                                <input type="checkbox" data-model="completed">
                                <span class="text" data-bind="text"></span>
                                <span class="badge" data-bind-class="computed:priorityBadgeClass"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const cards = testContainer.querySelectorAll('.card')
            const badges = testContainer.querySelectorAll('.badge')
            const checkboxes = testContainer.querySelectorAll('input[type="checkbox"]')

            // Initial state verification
            expect(cards[0].classList.contains('border-primary')).toBe(true)
            expect(cards[1].classList.contains('border-primary')).toBe(true)
            expect(cards[2].classList.contains('border-success')).toBe(true)
            expect(badges[0].classList.contains('bg-danger')).toBe(true)
            expect(badges[1].classList.contains('bg-warning')).toBe(true)
            expect(badges[2].classList.contains('bg-success')).toBe(true)

            // Toggle first checkbox (complete first task)
            checkboxes[0].click()
            await waitForUpdate(100)

            // First item should update
            expect(cards[0].classList.contains('border-success')).toBe(true)
            expect(cards[0].classList.contains('border-primary')).toBe(false)

            // OTHER items should retain their classes (this was the bug!)
            expect(cards[1].classList.contains('border-primary')).toBe(true)
            expect(cards[2].classList.contains('border-success')).toBe(true)

            // Priority badges should all be preserved
            expect(badges[0].classList.contains('bg-danger')).toBe(true)
            expect(badges[1].classList.contains('bg-warning')).toBe(true)
            expect(badges[2].classList.contains('bg-success')).toBe(true)
        })

        it('should preserve computed text bindings on ALL items when replacing ONE item', async () => {
            let componentInstance
            wildflower.component('sparse-text-test', {
                state: {
                    items: [
                        { name: 'Item 1', count: 5 },
                        { name: 'Item 2', count: 10 },
                        { name: 'Item 3', count: 15 }
                    ]
                },
                computed: {
                    countLabel(item) {
                        return `Count: ${item.count}`
                    }
                },
                init() {
                    componentInstance = this
                }
            })

            testContainer.innerHTML = `
                <div data-component="sparse-text-test">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="name" data-bind="name"></span>
                                <span class="count" data-bind="computed:countLabel"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            let counts = testContainer.querySelectorAll('.count')
            expect(counts[0].textContent).toBe('Count: 5')
            expect(counts[1].textContent).toBe('Count: 10')
            expect(counts[2].textContent).toBe('Count: 15')

            // Replace just the second item (triggers reactive update)
            componentInstance.state.items.splice(1, 1, { name: 'Item 2', count: 20 })
            await waitForUpdate(100)

            // Second item should update
            counts = testContainer.querySelectorAll('.count')
            expect(counts[1].textContent).toBe('Count: 20')

            // Other items should retain their values (this was the bug with prop === '*')
            expect(counts[0].textContent).toBe('Count: 5')
            expect(counts[2].textContent).toBe('Count: 15')
        })

        it('should preserve computed HTML bindings when replacing item', async () => {
            let componentInstance
            wildflower.component('sparse-html-test', {
                state: {
                    messages: [
                        { text: 'Hello', important: true },
                        { text: 'World', important: false }
                    ]
                },
                computed: {
                    formattedText(msg) {
                        return msg.important
                            ? `<strong>${msg.text}</strong>`
                            : `<span>${msg.text}</span>`
                    }
                },
                init() {
                    componentInstance = this
                }
            })

            testContainer.innerHTML = `
                <div data-component="sparse-html-test">
                    <div data-list="messages">
                        <template>
                            <div class="message" data-bind-html="computed:formattedText"></div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            let messages = testContainer.querySelectorAll('.message')
            expect(messages[0].innerHTML).toContain('<strong>')
            expect(messages[1].innerHTML).toContain('<span>')

            // Replace first item with updated text (triggers reactive update)
            componentInstance.state.messages.splice(0, 1, { text: 'Updated', important: true })
            await waitForUpdate(100)

            // First should update
            messages = testContainer.querySelectorAll('.message')
            expect(messages[0].textContent).toBe('Updated')
            expect(messages[0].innerHTML).toContain('<strong>')

            // Second should retain original content
            expect(messages[1].textContent).toBe('World')
            expect(messages[1].innerHTML).toContain('<span>')
        })
    })

    describe('Computed with list context variables', () => {
        it('should access _index in computed property', async () => {
            wildflower.component('index-computed-test', {
                state: {
                    items: [
                        { name: 'First' },
                        { name: 'Second' },
                        { name: 'Third' }
                    ]
                },
                computed: {
                    rowLabel(item, index) {
                        return `Row ${index + 1}: ${item.name}`
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="index-computed-test">
                    <div data-list="items">
                        <template>
                            <div class="row" data-bind="computed:rowLabel"></div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const rows = testContainer.querySelectorAll('.row')
            expect(rows[0].textContent).toBe('Row 1: First')
            expect(rows[1].textContent).toBe('Row 2: Second')
            expect(rows[2].textContent).toBe('Row 3: Third')
        })

        it('should access _first and _last in computed property', async () => {
            wildflower.component('first-last-computed-test', {
                state: {
                    items: [
                        { name: 'A' },
                        { name: 'B' },
                        { name: 'C' }
                    ]
                },
                computed: {
                    positionClass(item, index, info) {
                        if (info.first) return 'first-item'
                        if (info.last) return 'last-item'
                        return 'middle-item'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="first-last-computed-test">
                    <div data-list="items">
                        <template>
                            <div class="item" data-bind-class="computed:positionClass">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            expect(items[0].classList.contains('first-item')).toBe(true)
            expect(items[1].classList.contains('middle-item')).toBe(true)
            expect(items[2].classList.contains('last-item')).toBe(true)
        })

        it('should access _length in computed property', async () => {
            wildflower.component('length-computed-test', {
                state: {
                    items: [
                        { name: 'A' },
                        { name: 'B' },
                        { name: 'C' },
                        { name: 'D' }
                    ]
                },
                computed: {
                    positionInfo(item, index, info) {
                        return `${index + 1} of ${info.length}`
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="length-computed-test">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="name" data-bind="name"></span>
                                <span class="position" data-bind="computed:positionInfo"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const positions = testContainer.querySelectorAll('.position')
            expect(positions[0].textContent).toBe('1 of 4')
            expect(positions[1].textContent).toBe('2 of 4')
            expect(positions[2].textContent).toBe('3 of 4')
            expect(positions[3].textContent).toBe('4 of 4')
        })
    })

    describe('Multiple computed bindings on same element', () => {
        it('should handle computed class and computed style on same element', async () => {
            wildflower.component('multi-computed-element-test', {
                state: {
                    items: [
                        { active: true, size: 100 },
                        { active: false, size: 50 }
                    ]
                },
                computed: {
                    activeClass(item) {
                        return item.active ? 'is-active' : 'is-inactive'
                    },
                    sizeStyle(item) {
                        return { width: item.size + 'px' }
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="multi-computed-element-test">
                    <div data-list="items">
                        <template>
                            <div class="item"
                                 data-bind-class="computed:activeClass"
                                 data-bind-style="computed:sizeStyle">
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')

            expect(items[0].classList.contains('is-active')).toBe(true)
            expect(items[0].style.width).toBe('100px')

            expect(items[1].classList.contains('is-inactive')).toBe(true)
            expect(items[1].style.width).toBe('50px')
        })

        it('should handle multiple computed properties using same item data', async () => {
            wildflower.component('multi-props-test', {
                state: {
                    products: [
                        { name: 'Widget', price: 25, quantity: 3 },
                        { name: 'Gadget', price: 50, quantity: 2 }
                    ]
                },
                computed: {
                    subtotal(p) {
                        return '$' + (p.price * p.quantity)
                    },
                    description(p) {
                        return `${p.quantity}x ${p.name}`
                    },
                    rowClass(p) {
                        return p.quantity > 2 ? 'high-qty' : 'low-qty'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="multi-props-test">
                    <div data-list="products">
                        <template>
                            <div class="product" data-bind-class="computed:rowClass">
                                <span class="desc" data-bind="computed:description"></span>
                                <span class="subtotal" data-bind="computed:subtotal"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const products = testContainer.querySelectorAll('.product')

            expect(products[0].classList.contains('high-qty')).toBe(true)
            expect(products[0].querySelector('.desc').textContent).toBe('3x Widget')
            expect(products[0].querySelector('.subtotal').textContent).toBe('$75')

            expect(products[1].classList.contains('low-qty')).toBe(true)
            expect(products[1].querySelector('.desc').textContent).toBe('2x Gadget')
            expect(products[1].querySelector('.subtotal').textContent).toBe('$100')
        })
    })

    describe('Computed with array methods on item properties', () => {
        it('should use filter/map on nested arrays in computed', async () => {
            wildflower.component('array-methods-test', {
                state: {
                    teams: [
                        {
                            name: 'Alpha',
                            members: [
                                { name: 'Alice', active: true },
                                { name: 'Bob', active: false },
                                { name: 'Carol', active: true }
                            ]
                        },
                        {
                            name: 'Beta',
                            members: [
                                { name: 'Dave', active: false },
                                { name: 'Eve', active: false }
                            ]
                        }
                    ]
                },
                computed: {
                    activeMembers(team) {
                        const members = (team && team.members) || []
                        const active = members.filter(m => m.active)
                        return active.map(m => m.name).join(', ') || 'None'
                    },
                    activeBadge(team) {
                        const members = (team && team.members) || []
                        const count = members.filter(m => m.active).length
                        return count > 0 ? 'has-active' : 'no-active'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="array-methods-test">
                    <div data-list="teams">
                        <template>
                            <div class="team" data-bind-class="computed:activeBadge">
                                <h3 data-bind="name"></h3>
                                <span class="active-list" data-bind="computed:activeMembers"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const teams = testContainer.querySelectorAll('.team')

            expect(teams[0].classList.contains('has-active')).toBe(true)
            expect(teams[0].querySelector('.active-list').textContent).toBe('Alice, Carol')

            expect(teams[1].classList.contains('no-active')).toBe(true)
            expect(teams[1].querySelector('.active-list').textContent).toBe('None')
        })

        it('should use reduce on nested arrays in computed', async () => {
            wildflower.component('reduce-test', {
                state: {
                    orders: [
                        {
                            id: 'ORD-1',
                            items: [
                                { name: 'A', price: 10 },
                                { name: 'B', price: 20 },
                                { name: 'C', price: 15 }
                            ]
                        },
                        {
                            id: 'ORD-2',
                            items: [
                                { name: 'X', price: 100 }
                            ]
                        }
                    ]
                },
                computed: {
                    orderTotal(order) {
                        const items = (order && order.items) || []
                        const total = items.reduce((sum, item) => sum + item.price, 0)
                        return '$' + total
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="reduce-test">
                    <div data-list="orders">
                        <template>
                            <div class="order">
                                <span class="order-id" data-bind="id"></span>
                                <span class="total" data-bind="computed:orderTotal"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const orders = testContainer.querySelectorAll('.order')
            expect(orders[0].querySelector('.total').textContent).toBe('$45')
            expect(orders[1].querySelector('.total').textContent).toBe('$100')
        })
    })

    describe('Component state access from list item computed', () => {
        it('should access component state properties alongside list item properties', async () => {
            wildflower.component('mixed-access-test', {
                state: {
                    currency: 'USD',
                    taxRate: 0.1,
                    products: [
                        { name: 'Item A', basePrice: 100 },
                        { name: 'Item B', basePrice: 50 }
                    ]
                },
                computed: {
                    formattedPrice(product) {
                        const tax = product.basePrice * this.state.taxRate
                        const total = product.basePrice + tax
                        return `${total} ${this.state.currency}`
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="mixed-access-test">
                    <div data-list="products">
                        <template>
                            <div class="product">
                                <span class="name" data-bind="name"></span>
                                <span class="price" data-bind="computed:formattedPrice"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const prices = testContainer.querySelectorAll('.price')
            expect(prices[0].textContent).toBe('110 USD') // 100 + 10% tax
            expect(prices[1].textContent).toBe('55 USD')  // 50 + 10% tax
        })
    })

    describe('Edge cases and error handling', () => {
        it('should handle undefined/null item properties gracefully in computed', async () => {
            wildflower.component('null-handling-test', {
                state: {
                    items: [
                        { name: 'Complete', value: 42 },
                        { name: 'Partial' }, // value is undefined
                        { name: 'Null', value: null }
                    ]
                },
                computed: {
                    displayValue(item) {
                        const val = item ? item.value : undefined
                        if (val === undefined) return 'N/A'
                        if (val === null) return 'Empty'
                        return String(val)
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="null-handling-test">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="name" data-bind="name"></span>
                                <span class="value" data-bind="computed:displayValue"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const values = testContainer.querySelectorAll('.value')
            expect(values[0].textContent).toBe('42')
            expect(values[1].textContent).toBe('N/A')
            expect(values[2].textContent).toBe('Empty')
        })

        it('should handle empty list without errors', async () => {
            wildflower.component('empty-list-test', {
                state: {
                    items: []
                },
                computed: {
                    displayValue(item) {
                        return item.value + '!'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="empty-list-test">
                    <div data-list="items">
                        <template>
                            <div class="item" data-bind="computed:displayValue"></div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(0)
        })

        it('should handle computed returning complex values', async () => {
            wildflower.component('complex-return-test', {
                state: {
                    items: [
                        { data: { nested: { value: 'deep' } } },
                        { data: { nested: { value: 'deeper' } } }
                    ]
                },
                computed: {
                    nestedValue(item) {
                        return item?.data?.nested?.value || 'fallback'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="complex-return-test">
                    <div data-list="items">
                        <template>
                            <div class="item" data-bind="computed:nestedValue"></div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            expect(items[0].textContent).toBe('deep')
            expect(items[1].textContent).toBe('deeper')
        })
    })
})
