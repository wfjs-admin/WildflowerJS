/**
 * List Item Data Access Tests
 *
 * Tests for accessing list item data in templates using the correct WildflowerJS patterns:
 * 1. Direct property access: data-bind="property" or data-bind="nested.property"
 * 2. Array length: data-bind="array.length"
 * 3. Pre-computed values on data objects
 *
 * Note: WildflowerJS computed properties run at component level, not list item level.
 * For per-item calculations, use direct property access or pre-compute values on data.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to wait for complete render cycle (for lists)
async function waitForCompleteRender() {
    if (window.wildflower?._forceCompleteRender) {
        await window.wildflower._forceCompleteRender()
    }
    await new Promise(resolve => setTimeout(resolve, 50))
}

describe('List Item Data Access', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()

        // Clear the context registry to prevent cross-test contamination
        if (wildflower._contextRegistry) {
            wildflower._contextRegistry.contexts?.clear()
            wildflower._contextRegistry.contextsByType?.clear()
            wildflower._contextRegistry.contextsByComponent?.clear()
            wildflower._contextRegistry.dependencies?.clear()
            wildflower._contextRegistry._contextTypeCache?.clear()
            wildflower._contextRegistry._contextModificationCounter = 0
        }

        // Create and append test container
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        // Clean up test container
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        testContainer = null
    })

    describe('Direct property access in list context', () => {
        it('should access nested array length with .length property', async () => {
            wildflower.component('test-list-length', {
                state: {
                    items: [
                        { name: 'Item 1', values: [1, 2, 3] },
                        { name: 'Item 2', values: [10, 20] },
                        { name: 'Item 3', values: [] }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="test-list-length">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="name" data-bind="name"></span>
                                <span class="count" data-bind="values.length"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(3)

            // Check array lengths
            expect(items[0].querySelector('.count').textContent).toBe('3')
            expect(items[1].querySelector('.count').textContent).toBe('2')
            expect(items[2].querySelector('.count').textContent).toBe('0')
        })

        it('should access nested object properties with dot notation', async () => {
            wildflower.component('test-nested-props', {
                state: {
                    departments: [
                        {
                            name: 'Engineering',
                            stats: { employeeCount: 5, budget: 100000 }
                        },
                        {
                            name: 'Marketing',
                            stats: { employeeCount: 3, budget: 50000 }
                        }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="test-nested-props">
                    <div data-list="departments">
                        <template>
                            <div class="dept">
                                <span class="name" data-bind="name"></span>
                                <span class="count" data-bind="stats.employeeCount"></span>
                                <span class="budget" data-bind="stats.budget"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const depts = testContainer.querySelectorAll('.dept')
            expect(depts.length).toBe(2)

            expect(depts[0].querySelector('.count').textContent).toBe('5')
            expect(depts[0].querySelector('.budget').textContent).toBe('100000')
            expect(depts[1].querySelector('.count').textContent).toBe('3')
            expect(depts[1].querySelector('.budget').textContent).toBe('50000')
        })
    })

    describe('Pre-computed values on data', () => {
        it('should use pre-computed values on list items', async () => {
            // Pre-compute derived values on the data
            const departments = [
                {
                    name: 'Engineering',
                    employees: [
                        { name: 'Alice', salary: 100 },
                        { name: 'Bob', salary: 90 }
                    ]
                },
                {
                    name: 'Marketing',
                    employees: []
                },
                {
                    name: 'Sales',
                    employees: [
                        { name: 'Charlie', salary: 80 }
                    ]
                }
            ]

            // Pre-compute derived properties
            departments.forEach(dept => {
                dept.employeeCount = dept.employees.length
                dept.avgSalary = dept.employees.length > 0
                    ? Math.round(dept.employees.reduce((sum, emp) => sum + emp.salary, 0) / dept.employees.length)
                    : 0
                dept.isEmpty = dept.employees.length === 0
                dept.hasEmployees = dept.employees.length > 0
            })

            wildflower.component('test-precomputed', {
                state: { departments }
            })

            testContainer.innerHTML = `
                <div data-component="test-precomputed">
                    <div data-list="departments">
                        <template>
                            <div class="dept">
                                <span class="dept-name" data-bind="name"></span>
                                <span class="emp-count" data-bind="employeeCount"></span>
                                <span class="avg-salary" data-bind="avgSalary"></span>
                                <div class="has-emp" data-show="hasEmployees">Has employees</div>
                                <div class="no-emp" data-show="isEmpty">No employees</div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const depts = testContainer.querySelectorAll('.dept')
            expect(depts.length).toBe(3)

            // Engineering: 2 employees, avg salary 95
            expect(depts[0].querySelector('.emp-count').textContent).toBe('2')
            expect(depts[0].querySelector('.avg-salary').textContent).toBe('95')
            expect(depts[0].querySelector('.has-emp').style.display).not.toBe('none')
            expect(depts[0].querySelector('.no-emp').style.display).toBe('none')

            // Marketing: 0 employees, avg salary 0
            expect(depts[1].querySelector('.emp-count').textContent).toBe('0')
            expect(depts[1].querySelector('.avg-salary').textContent).toBe('0')
            expect(depts[1].querySelector('.has-emp').style.display).toBe('none')
            expect(depts[1].querySelector('.no-emp').style.display).not.toBe('none')

            // Sales: 1 employee, avg salary 80
            expect(depts[2].querySelector('.emp-count').textContent).toBe('1')
            expect(depts[2].querySelector('.avg-salary').textContent).toBe('80')
            expect(depts[2].querySelector('.has-emp').style.display).not.toBe('none')
            expect(depts[2].querySelector('.no-emp').style.display).toBe('none')
        })
    })

    // Note: _index, _length, _first, _last context variables are available in expressions
    // (e.g., data-bind-class) but not as direct data-show conditions. To conditionally
    // show/hide based on position, pre-compute boolean properties like isFirst/isLast on data.

    describe('Component-level computed properties', () => {
        it('should use component-level computed for aggregate calculations', async () => {
            wildflower.component('test-component-computed', {
                state: {
                    items: [
                        { value: 10 },
                        { value: 20 },
                        { value: 30 }
                    ]
                },
                computed: {
                    // Component-level computed - calculates over entire array
                    totalValue() {
                        return this.state.items.reduce((sum, item) => sum + item.value, 0)
                    },
                    itemCount() {
                        return this.state.items.length
                    },
                    averageValue() {
                        const total = this.state.items.reduce((sum, item) => sum + item.value, 0)
                        return this.state.items.length > 0 ? Math.round(total / this.state.items.length) : 0
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="test-component-computed">
                    <div class="summary">
                        <span class="total" data-bind="computed:totalValue"></span>
                        <span class="count" data-bind="computed:itemCount"></span>
                        <span class="average" data-bind="computed:averageValue"></span>
                    </div>
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="value" data-bind="value"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            // Check component-level computed values
            expect(testContainer.querySelector('.total').textContent).toBe('60')
            expect(testContainer.querySelector('.count').textContent).toBe('3')
            expect(testContainer.querySelector('.average').textContent).toBe('20')

            // Check list items
            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(3)
            expect(items[0].querySelector('.value').textContent).toBe('10')
            expect(items[1].querySelector('.value').textContent).toBe('20')
            expect(items[2].querySelector('.value').textContent).toBe('30')
        })
    })
})
