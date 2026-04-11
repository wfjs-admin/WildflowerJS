/**
 * List Expression Reactivity Test Suite
 *
 * Tests that expression bindings (e.g., `price * qty`) in list items
 * properly update when their constituent properties change.
 *
 * This addresses a previously undocumented limitation where expression
 * bindings would render correctly initially but not update on direct
 * property mutations like `this.state.items[0].qty++`.
 *
 * Related fix: ListRenderer.js `_renderListSparseUpdate` now detects
 * when a changed property is used within an expression binding and
 * re-evaluates the full expression.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, waitForUpdate } from './helpers/load-framework.js'

describe('List Expression Reactivity', () => {
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

    describe('Direct Mutation Updates', () => {
        it('should update expression when property is incremented with ++', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-increment">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="qty" data-bind="qty"></span>
                                <span class="subtotal" data-bind="price * qty"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-increment', {
                state: {
                    items: [
                        { price: 10, qty: 1 },
                        { price: 20, qty: 2 }
                    ]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            expect(items[0].querySelector('.subtotal').textContent).toBe('10')
            expect(items[1].querySelector('.subtotal').textContent).toBe('40')

            // Direct mutation with ++
            instance.state.items[0].qty++
            await waitForUpdate(100)

            expect(items[0].querySelector('.qty').textContent).toBe('2')
            expect(items[0].querySelector('.subtotal').textContent).toBe('20')
            // Second item should be unchanged
            expect(items[1].querySelector('.subtotal').textContent).toBe('40')
        })

        it('should update expression when property is assigned directly', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-assign">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="subtotal" data-bind="price * qty"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-assign', {
                state: {
                    items: [{ price: 15, qty: 3 }]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const subtotal = testContainer.querySelector('.subtotal')
            expect(subtotal.textContent).toBe('45')

            // Direct assignment
            instance.state.items[0].qty = 10
            await waitForUpdate(100)

            expect(subtotal.textContent).toBe('150')
        })

        it('should update expression when property is decremented with --', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-decrement">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="subtotal" data-bind="price * qty"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-decrement', {
                state: {
                    items: [{ price: 10, qty: 5 }]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const subtotal = testContainer.querySelector('.subtotal')
            expect(subtotal.textContent).toBe('50')

            instance.state.items[0].qty--
            await waitForUpdate(100)

            expect(subtotal.textContent).toBe('40')
        })

        it('should update expression when using compound assignment +=', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-compound">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="subtotal" data-bind="price * qty"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-compound', {
                state: {
                    items: [{ price: 10, qty: 2 }]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const subtotal = testContainer.querySelector('.subtotal')
            expect(subtotal.textContent).toBe('20')

            instance.state.items[0].qty += 3
            await waitForUpdate(100)

            expect(subtotal.textContent).toBe('50')
        })
    })

    describe('Multiple Variables in Expression', () => {
        it('should update when first variable changes', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-multi-first">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="total" data-bind="price * qty"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-multi-first', {
                state: {
                    items: [{ price: 10, qty: 2 }]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const total = testContainer.querySelector('.total')
            expect(total.textContent).toBe('20')

            // Change price (first variable)
            instance.state.items[0].price = 15
            await waitForUpdate(100)

            expect(total.textContent).toBe('30')
        })

        it('should update when second variable changes', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-multi-second">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="total" data-bind="price * qty"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-multi-second', {
                state: {
                    items: [{ price: 10, qty: 2 }]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const total = testContainer.querySelector('.total')
            expect(total.textContent).toBe('20')

            // Change qty (second variable)
            instance.state.items[0].qty = 5
            await waitForUpdate(100)

            expect(total.textContent).toBe('50')
        })

        it('should update when both variables change sequentially', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-multi-both">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="total" data-bind="price * qty"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-multi-both', {
                state: {
                    items: [{ price: 10, qty: 2 }]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const total = testContainer.querySelector('.total')
            expect(total.textContent).toBe('20')

            // Change price first
            instance.state.items[0].price = 15
            await waitForUpdate(100)
            expect(total.textContent).toBe('30')

            // Then change qty
            instance.state.items[0].qty = 4
            await waitForUpdate(100)
            expect(total.textContent).toBe('60')
        })

        it('should handle three-variable expressions', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-three-var">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="total" data-bind="price * qty * discount"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-three-var', {
                state: {
                    items: [{ price: 100, qty: 2, discount: 0.9 }]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const total = testContainer.querySelector('.total')
            expect(total.textContent).toBe('180')

            // Change discount
            instance.state.items[0].discount = 0.8
            await waitForUpdate(100)
            expect(total.textContent).toBe('160')
        })
    })

    describe('Multiple Expressions Using Same Property', () => {
        it('should update all expressions that use the changed property', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-shared-prop">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="subtotal" data-bind="price * qty"></span>
                                <span class="doubled" data-bind="qty * 2"></span>
                                <span class="tripled" data-bind="qty * 3"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-shared-prop', {
                state: {
                    items: [{ price: 10, qty: 2 }]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const item = testContainer.querySelector('.item')
            expect(item.querySelector('.subtotal').textContent).toBe('20')
            expect(item.querySelector('.doubled').textContent).toBe('4')
            expect(item.querySelector('.tripled').textContent).toBe('6')

            // Change qty - should update all three expressions
            instance.state.items[0].qty = 5
            await waitForUpdate(100)

            expect(item.querySelector('.subtotal').textContent).toBe('50')
            expect(item.querySelector('.doubled').textContent).toBe('10')
            expect(item.querySelector('.tripled').textContent).toBe('15')
        })

        it('should only update expressions that use the changed property', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-selective">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="uses-qty" data-bind="qty * 10"></span>
                                <span class="uses-price" data-bind="price * 2"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-selective', {
                state: {
                    items: [{ price: 5, qty: 3 }]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const item = testContainer.querySelector('.item')
            expect(item.querySelector('.uses-qty').textContent).toBe('30')
            expect(item.querySelector('.uses-price').textContent).toBe('10')

            // Change only qty
            instance.state.items[0].qty = 7
            await waitForUpdate(100)

            expect(item.querySelector('.uses-qty').textContent).toBe('70')
            // price expression should still show same value (unchanged)
            expect(item.querySelector('.uses-price').textContent).toBe('10')
        })
    })

    describe('Action-Triggered Updates', () => {
        it('should update expression when action increments property', async () => {
            testContainer.innerHTML = `
                <div data-component="expr-action">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="subtotal" data-bind="price * qty"></span>
                                <button class="increment" data-action="increment">+</button>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-action', {
                state: {
                    items: [{ price: 10, qty: 1 }]
                },
                increment(event, element, { index }) {
                    this.state.items[index].qty++
                }
            })

            await waitForUpdate(100)

            const subtotal = testContainer.querySelector('.subtotal')
            const button = testContainer.querySelector('.increment')

            expect(subtotal.textContent).toBe('10')

            // Click increment button
            button.click()
            await waitForUpdate(100)

            expect(subtotal.textContent).toBe('20')

            // Click again
            button.click()
            await waitForUpdate(100)

            expect(subtotal.textContent).toBe('30')
        })

        it('should update expression when action modifies multiple items', async () => {
            testContainer.innerHTML = `
                <div data-component="expr-action-multi">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="subtotal" data-bind="price * qty"></span>
                                <button class="increment" data-action="increment">+</button>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-action-multi', {
                state: {
                    items: [
                        { price: 10, qty: 1 },
                        { price: 20, qty: 1 }
                    ]
                },
                increment(event, element, { index }) {
                    this.state.items[index].qty++
                }
            })

            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            const buttons = testContainer.querySelectorAll('.increment')

            expect(items[0].querySelector('.subtotal').textContent).toBe('10')
            expect(items[1].querySelector('.subtotal').textContent).toBe('20')

            // Increment first item
            buttons[0].click()
            await waitForUpdate(100)

            expect(items[0].querySelector('.subtotal').textContent).toBe('20')
            expect(items[1].querySelector('.subtotal').textContent).toBe('20') // unchanged

            // Increment second item
            buttons[1].click()
            await waitForUpdate(100)

            expect(items[0].querySelector('.subtotal').textContent).toBe('20') // unchanged
            expect(items[1].querySelector('.subtotal').textContent).toBe('40')
        })
    })

    describe('Complex Expressions', () => {
        it('should update ternary expressions', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-ternary">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="status" data-bind="qty > 0 ? 'In Stock' : 'Out of Stock'"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-ternary', {
                state: {
                    items: [{ qty: 5 }]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const status = testContainer.querySelector('.status')
            expect(status.textContent).toBe('In Stock')

            instance.state.items[0].qty = 0
            await waitForUpdate(100)

            expect(status.textContent).toBe('Out of Stock')
        })

        it('should update expressions with method calls', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-method">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="formatted" data-bind="(price * qty).toFixed(2)"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-method', {
                state: {
                    items: [{ price: 9.99, qty: 3 }]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const formatted = testContainer.querySelector('.formatted')
            expect(formatted.textContent).toBe('29.97')

            instance.state.items[0].qty = 4
            await waitForUpdate(100)

            expect(formatted.textContent).toBe('39.96')
        })

        it('should update expressions with addition', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-addition">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="total" data-bind="basePrice + shipping"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-addition', {
                state: {
                    items: [{ basePrice: 50, shipping: 10 }]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const total = testContainer.querySelector('.total')
            expect(total.textContent).toBe('60')

            instance.state.items[0].shipping = 15
            await waitForUpdate(100)

            expect(total.textContent).toBe('65')
        })

        it('should update expressions with string concatenation', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-concat">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="label" data-bind="'$' + price"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-concat', {
                state: {
                    items: [{ price: 25 }]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const label = testContainer.querySelector('.label')
            expect(label.textContent).toBe('$25')

            instance.state.items[0].price = 30
            await waitForUpdate(100)

            expect(label.textContent).toBe('$30')
        })
    })

    describe('Multiple Items', () => {
        it('should update only the affected item expression', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-multi-item">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="subtotal" data-bind="price * qty"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-multi-item', {
                state: {
                    items: [
                        { price: 10, qty: 1 },
                        { price: 20, qty: 2 },
                        { price: 30, qty: 3 }
                    ]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const subtotals = testContainer.querySelectorAll('.subtotal')
            expect(subtotals[0].textContent).toBe('10')
            expect(subtotals[1].textContent).toBe('40')
            expect(subtotals[2].textContent).toBe('90')

            // Update middle item only
            instance.state.items[1].qty = 5
            await waitForUpdate(100)

            expect(subtotals[0].textContent).toBe('10')  // unchanged
            expect(subtotals[1].textContent).toBe('100') // updated
            expect(subtotals[2].textContent).toBe('90')  // unchanged
        })

        it('should handle rapid updates to different items', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-rapid">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="subtotal" data-bind="price * qty"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-rapid', {
                state: {
                    items: [
                        { price: 10, qty: 1 },
                        { price: 10, qty: 1 },
                        { price: 10, qty: 1 }
                    ]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            // Rapid updates to different items
            instance.state.items[0].qty = 2
            instance.state.items[1].qty = 3
            instance.state.items[2].qty = 4

            await waitForUpdate(100)

            const subtotals = testContainer.querySelectorAll('.subtotal')
            expect(subtotals[0].textContent).toBe('20')
            expect(subtotals[1].textContent).toBe('30')
            expect(subtotals[2].textContent).toBe('40')
        })
    })

    describe('Edge Cases', () => {
        it('should handle expression with property that does not exist initially', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-undefined">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="result" data-bind="value * 2"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-undefined', {
                state: {
                    items: [{ value: undefined }]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const result = testContainer.querySelector('.result')
            // undefined * 2 = NaN, displayed as empty or NaN
            const initialValue = result.textContent

            instance.state.items[0].value = 5
            await waitForUpdate(100)

            expect(result.textContent).toBe('10')
        })

        it('should handle expression result becoming zero', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-zero">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="result" data-bind="price * qty"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-zero', {
                state: {
                    items: [{ price: 10, qty: 5 }]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const result = testContainer.querySelector('.result')
            expect(result.textContent).toBe('50')

            instance.state.items[0].qty = 0
            await waitForUpdate(100)

            expect(result.textContent).toBe('0')
        })

        it('should handle expression with negative results', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-negative">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="result" data-bind="balance - withdrawal"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-negative', {
                state: {
                    items: [{ balance: 100, withdrawal: 50 }]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const result = testContainer.querySelector('.result')
            expect(result.textContent).toBe('50')

            instance.state.items[0].withdrawal = 150
            await waitForUpdate(100)

            expect(result.textContent).toBe('-50')
        })

        it('should handle property name that is substring of another', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-substring">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="result" data-bind="qty * qtyMultiplier"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-substring', {
                state: {
                    items: [{ qty: 5, qtyMultiplier: 2 }]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const result = testContainer.querySelector('.result')
            expect(result.textContent).toBe('10')

            // Change qty - should update (qty is word-boundary matched)
            instance.state.items[0].qty = 10
            await waitForUpdate(100)
            expect(result.textContent).toBe('20')

            // Change qtyMultiplier - should also update
            instance.state.items[0].qtyMultiplier = 3
            await waitForUpdate(100)
            expect(result.textContent).toBe('30')
        })

        it('should correctly distinguish qty vs qty1 vs qty2 (numeric suffixes)', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-numeric-suffix">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="qty-only" data-bind="qty * 10"></span>
                                <span class="qty1-only" data-bind="qty1 * 10"></span>
                                <span class="qty2-only" data-bind="qty2 * 10"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-numeric-suffix', {
                state: {
                    items: [{ qty: 1, qty1: 2, qty2: 3 }]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const qtyOnly = testContainer.querySelector('.qty-only')
            const qty1Only = testContainer.querySelector('.qty1-only')
            const qty2Only = testContainer.querySelector('.qty2-only')

            expect(qtyOnly.textContent).toBe('10')
            expect(qty1Only.textContent).toBe('20')
            expect(qty2Only.textContent).toBe('30')

            // Change qty - should ONLY update qty-only, NOT qty1-only or qty2-only
            instance.state.items[0].qty = 5
            await waitForUpdate(100)
            expect(qtyOnly.textContent).toBe('50')
            expect(qty1Only.textContent).toBe('20') // unchanged
            expect(qty2Only.textContent).toBe('30') // unchanged

            // Change qty1 - should ONLY update qty1-only
            instance.state.items[0].qty1 = 7
            await waitForUpdate(100)
            expect(qtyOnly.textContent).toBe('50')  // unchanged
            expect(qty1Only.textContent).toBe('70')
            expect(qty2Only.textContent).toBe('30') // unchanged

            // Change qty2 - should ONLY update qty2-only
            instance.state.items[0].qty2 = 9
            await waitForUpdate(100)
            expect(qtyOnly.textContent).toBe('50')  // unchanged
            expect(qty1Only.textContent).toBe('70') // unchanged
            expect(qty2Only.textContent).toBe('90')
        })

        it('should update expression with qty + qty1 when either changes', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-combined-suffix">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="combined" data-bind="qty + qty1"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-combined-suffix', {
                state: {
                    items: [{ qty: 10, qty1: 5 }]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const combined = testContainer.querySelector('.combined')
            expect(combined.textContent).toBe('15')

            // Change qty - should update
            instance.state.items[0].qty = 20
            await waitForUpdate(100)
            expect(combined.textContent).toBe('25')

            // Change qty1 - should also update
            instance.state.items[0].qty1 = 10
            await waitForUpdate(100)
            expect(combined.textContent).toBe('30')
        })

        it('should handle complex expression with multiple similar property names', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-complex-similar">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="result" data-bind="(qty * qty1) + qty2"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-complex-similar', {
                state: {
                    items: [{ qty: 2, qty1: 3, qty2: 4 }]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const result = testContainer.querySelector('.result')
            expect(result.textContent).toBe('10') // (2*3)+4 = 10

            // Change qty
            instance.state.items[0].qty = 5
            await waitForUpdate(100)
            expect(result.textContent).toBe('19') // (5*3)+4 = 19

            // Change qty1
            instance.state.items[0].qty1 = 2
            await waitForUpdate(100)
            expect(result.textContent).toBe('14') // (5*2)+4 = 14

            // Change qty2
            instance.state.items[0].qty2 = 10
            await waitForUpdate(100)
            expect(result.textContent).toBe('20') // (5*2)+10 = 20
        })

        it('should handle expression without spaces: (qty*qty1)+qty2', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-no-spaces">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="result" data-bind="(qty*qty1)+qty2"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('expr-no-spaces', {
                state: {
                    items: [{ qty: 2, qty1: 3, qty2: 4 }]
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const result = testContainer.querySelector('.result')
            expect(result.textContent).toBe('10') // (2*3)+4 = 10

            // Change qty - should update even without spaces
            instance.state.items[0].qty = 5
            await waitForUpdate(100)
            expect(result.textContent).toBe('19') // (5*3)+4 = 19

            // Change qty1 - should update even without spaces
            instance.state.items[0].qty1 = 2
            await waitForUpdate(100)
            expect(result.textContent).toBe('14') // (5*2)+4 = 14

            // Change qty2 - should update even without spaces
            instance.state.items[0].qty2 = 10
            await waitForUpdate(100)
            expect(result.textContent).toBe('20') // (5*2)+10 = 20
        })
    })

    describe('With Computed Properties', () => {
        it('should update expression while computed total also updates', async () => {
            let instance
            testContainer.innerHTML = `
                <div data-component="expr-with-computed">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <span class="subtotal" data-bind="price * qty"></span>
                            </div>
                        </template>
                    </div>
                    <div class="total" data-bind="computed:total"></div>
                </div>
            `

            wildflower.component('expr-with-computed', {
                state: {
                    items: [
                        { price: 10, qty: 1 },
                        { price: 20, qty: 2 }
                    ]
                },
                computed: {
                    total() {
                        return this.state.items.reduce((sum, item) => sum + item.price * item.qty, 0)
                    }
                },
                init() { instance = this }
            })

            await waitForUpdate(100)

            const subtotals = testContainer.querySelectorAll('.subtotal')
            const total = testContainer.querySelector('.total')

            expect(subtotals[0].textContent).toBe('10')
            expect(subtotals[1].textContent).toBe('40')
            expect(total.textContent).toBe('50')

            // Update first item
            instance.state.items[0].qty = 3
            await waitForUpdate(100)

            // Both expression binding AND computed should update
            expect(subtotals[0].textContent).toBe('30')
            expect(total.textContent).toBe('70')
        })
    })
})
