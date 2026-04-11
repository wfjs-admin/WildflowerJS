/**
 * List Item Bindings Test Suite
 *
 * Tests different approaches to binding calculated values in list items:
 * 1. Pre-calculated values on item objects
 * 2. Inline expressions in data-bind
 * 3. Simple arithmetic expressions
 *
 * Also tests that incorrect usage (computed: prefix for item properties)
 * does NOT work as expected - to prevent regression if someone "fixes" it.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('List Item Bindings', () => {
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

    describe('Pre-calculated Values', () => {
        it('should bind pre-calculated lineTotal on item object', async () => {
            testContainer.innerHTML = `
                <div data-component="cart-precalc">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span data-bind="name"></span>
                                <span data-bind="quantity"></span>
                                <span class="line-total" data-bind="lineTotal"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('cart-precalc', {
                state: {
                    items: [
                        { name: 'Laptop', price: 999, quantity: 2, lineTotal: '1998.00' },
                        { name: 'Mouse', price: 25, quantity: 3, lineTotal: '75.00' }
                    ]
                }
            })

            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)

            const lineTotal1 = items[0].querySelector('.line-total')
            const lineTotal2 = items[1].querySelector('.line-total')

            expect(lineTotal1.textContent).toBe('1998.00')
            expect(lineTotal2.textContent).toBe('75.00')
        })
    })

    describe('Inline Expressions', () => {
        it('should evaluate price * quantity expression in list item', async () => {
            testContainer.innerHTML = `
                <div data-component="cart-expr">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span data-bind="name"></span>
                                <span class="line-total" data-bind="price * quantity"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('cart-expr', {
                state: {
                    items: [
                        { name: 'Laptop', price: 999, quantity: 2 },
                        { name: 'Mouse', price: 25, quantity: 3 }
                    ]
                }
            })

            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)

            const lineTotal1 = items[0].querySelector('.line-total')
            const lineTotal2 = items[1].querySelector('.line-total')

            expect(lineTotal1.textContent).toBe('1998')
            expect(lineTotal2.textContent).toBe('75')
        })

        it('should evaluate expression with toFixed method', async () => {
            testContainer.innerHTML = `
                <div data-component="cart-tofixed">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="line-total" data-bind="(price * quantity).toFixed(2)"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('cart-tofixed', {
                state: {
                    items: [
                        { name: 'Laptop', price: 999, quantity: 2 },
                        { name: 'Mouse', price: 25, quantity: 3 }
                    ]
                }
            })

            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            const lineTotal1 = items[0].querySelector('.line-total')
            const lineTotal2 = items[1].querySelector('.line-total')

            expect(lineTotal1.textContent).toBe('1998.00')
            expect(lineTotal2.textContent).toBe('75.00')
        })

        it('should evaluate ternary expressions in list items', async () => {
            testContainer.innerHTML = `
                <div data-component="cart-ternary">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="status" data-bind="inStock ? 'Available' : 'Out of Stock'"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('cart-ternary', {
                state: {
                    items: [
                        { name: 'Laptop', inStock: true },
                        { name: 'Rare Item', inStock: false }
                    ]
                }
            })

            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            const status1 = items[0].querySelector('.status')
            const status2 = items[1].querySelector('.status')

            expect(status1.textContent).toBe('Available')
            expect(status2.textContent).toBe('Out of Stock')
        })

        // Note: Comprehensive expression reactivity tests (updates after mutation)
        // are in list-expression-reactivity.test.js
    })

    describe('List Context Variables', () => {
        it('should access _index in expressions', async () => {
            testContainer.innerHTML = `
                <div data-component="cart-index">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="row-num" data-bind="_index + 1"></span>
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('cart-index', {
                state: {
                    items: [
                        { name: 'First' },
                        { name: 'Second' },
                        { name: 'Third' }
                    ]
                }
            })

            await waitForUpdate(100)

            const rowNums = testContainer.querySelectorAll('.row-num')
            expect(rowNums[0].textContent).toBe('1')
            expect(rowNums[1].textContent).toBe('2')
            expect(rowNums[2].textContent).toBe('3')
        })

        it('should access _first and _last in expressions', async () => {
            testContainer.innerHTML = `
                <div data-component="cart-first-last">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="position" data-bind="_first ? 'First!' : (_last ? 'Last!' : 'Middle')"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('cart-first-last', {
                state: {
                    items: [
                        { name: 'A' },
                        { name: 'B' },
                        { name: 'C' }
                    ]
                }
            })

            await waitForUpdate(100)

            const positions = testContainer.querySelectorAll('.position')
            expect(positions[0].textContent).toBe('First!')
            expect(positions[1].textContent).toBe('Middle')
            expect(positions[2].textContent).toBe('Last!')
        })
    })

    describe('Incorrect Usage (Negative Tests)', () => {
        it('should NOT display computed:propertyName when property is on item object', async () => {
            // This test verifies that using computed: prefix for item properties
            // does NOT work. This is intentional behavior - computed: is for
            // component-level computed properties, not item properties.
            testContainer.innerHTML = `
                <div data-component="cart-wrong">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="line-total" data-bind="computed:lineTotal"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('cart-wrong', {
                state: {
                    items: [
                        { name: 'Laptop', price: 999, quantity: 2, lineTotal: '1998.00' }
                    ]
                }
            })

            await waitForUpdate(100)

            const lineTotal = testContainer.querySelector('.line-total')
            // The element should be empty because computed:lineTotal looks for
            // a component computed property, not an item property
            expect(lineTotal.textContent).toBe('')
        })

        it('should NOT call function properties on items via computed: prefix', async () => {
            // This verifies that function properties on items are not called
            // when using computed: prefix - that pattern is not supported.
            testContainer.innerHTML = `
                <div data-component="cart-fn-wrong">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="line-total" data-bind="computed:getTotal"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('cart-fn-wrong', {
                state: {
                    items: [
                        {
                            name: 'Laptop',
                            price: 999,
                            quantity: 2,
                            getTotal: function() { return this.price * this.quantity; }
                        }
                    ]
                }
            })

            await waitForUpdate(100)

            const lineTotal = testContainer.querySelector('.line-total')
            // Should be empty - functions on items are not invoked via computed:
            expect(lineTotal.textContent).toBe('')
        })
    })

    describe('Property Access Patterns', () => {
        it('should bind nested property (user.name) in list', async () => {
            testContainer.innerHTML = `
                <div data-component="nested-prop">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="user-name" data-bind="user.name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('nested-prop', {
                state: {
                    items: [
                        { user: { name: 'Alice' } },
                        { user: { name: 'Bob' } }
                    ]
                }
            })

            await waitForUpdate(100)

            const names = testContainer.querySelectorAll('.user-name')
            expect(names[0].textContent).toBe('Alice')
            expect(names[1].textContent).toBe('Bob')
        })

        it('should bind deep nested property (user.address.city) in list', async () => {
            testContainer.innerHTML = `
                <div data-component="deep-nested">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="city" data-bind="user.address.city"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('deep-nested', {
                state: {
                    items: [
                        { user: { address: { city: 'New York' } } },
                        { user: { address: { city: 'Los Angeles' } } }
                    ]
                }
            })

            await waitForUpdate(100)

            const cities = testContainer.querySelectorAll('.city')
            expect(cities[0].textContent).toBe('New York')
            expect(cities[1].textContent).toBe('Los Angeles')
        })

        it('should bind array length property (items.length) in list', async () => {
            testContainer.innerHTML = `
                <div data-component="array-length">
                    <div data-list="categories">
                        <template>
                            <div class="category">
                                <span class="name" data-bind="name"></span>:
                                <span class="count" data-bind="items.length"></span> items
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('array-length', {
                state: {
                    categories: [
                        { name: 'Fruits', items: ['Apple', 'Banana', 'Cherry'] },
                        { name: 'Vegetables', items: ['Carrot', 'Potato'] },
                        { name: 'Empty', items: [] }
                    ]
                }
            })

            await waitForUpdate(100)

            const counts = testContainer.querySelectorAll('.count')
            expect(counts[0].textContent).toBe('3')
            expect(counts[1].textContent).toBe('2')
            expect(counts[2].textContent).toBe('0')
        })

        it('should correctly display falsy values (0, empty string) in list', async () => {
            testContainer.innerHTML = `
                <div data-component="falsy-values">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                Count: <span class="count" data-bind="count"></span>,
                                Label: <span class="label" data-bind="label"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('falsy-values', {
                state: {
                    items: [
                        { count: 0, label: '' },
                        { count: 5, label: 'Five' }
                    ]
                }
            })

            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            // Should display "0" not empty
            expect(items[0].querySelector('.count').textContent).toBe('0')
            // Empty string should render as empty
            expect(items[0].querySelector('.label').textContent).toBe('')

            expect(items[1].querySelector('.count').textContent).toBe('5')
            expect(items[1].querySelector('.label').textContent).toBe('Five')
        })
    })

    describe('Component Computed Properties in Lists', () => {
        it('should correctly use component computed properties with computed: prefix', async () => {
            // This tests the CORRECT use of computed: - for component-level
            // computed properties, not item properties
            testContainer.innerHTML = `
                <div data-component="cart-component-computed">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                    <div class="total" data-bind="computed:total"></div>
                    <div class="count" data-bind="computed:itemCount"></div>
                </div>
            `

            wildflower.component('cart-component-computed', {
                state: {
                    items: [
                        { name: 'Laptop', price: 999, quantity: 2 },
                        { name: 'Mouse', price: 25, quantity: 3 }
                    ]
                },
                computed: {
                    total() {
                        return this.state.items.reduce((sum, item) =>
                            sum + (item.price * item.quantity), 0
                        ).toFixed(2)
                    },
                    itemCount() {
                        return this.state.items.reduce((sum, item) => sum + item.quantity, 0)
                    }
                }
            })

            await waitForUpdate(100)

            const total = testContainer.querySelector('.total')
            const count = testContainer.querySelector('.count')

            expect(total.textContent).toBe('2073.00')
            expect(count.textContent).toBe('5')
        })
    })
})
