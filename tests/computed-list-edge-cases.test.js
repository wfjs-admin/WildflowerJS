/**
 * Computed List Edge Cases Test Suite
 *
 * Tests edge cases for computed lists (data-list="computed:propertyName")
 * including property access patterns, reactivity, and special scenarios.
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

describe('Computed List Edge Cases', () => {
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

    // =========================================================================
    // 1. data-bind Edge Cases for Computed Lists
    // =========================================================================
    describe('data-bind Edge Cases', () => {
        it('should bind nested property (user.name) in computed list', async () => {
            wildflower.component('computed-nested-prop', {
                state: {
                    items: [
                        { user: { name: 'Alice' } },
                        { user: { name: 'Bob' } }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-nested-prop">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item">
                                <span class="user-name" data-bind="user.name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const names = testContainer.querySelectorAll('.user-name')
            expect(names.length).toBe(2)
            expect(names[0].textContent).toBe('Alice')
            expect(names[1].textContent).toBe('Bob')
        })

        it('should bind deep nested property (user.address.city) in computed list', async () => {
            wildflower.component('computed-deep-nested', {
                state: {
                    items: [
                        { user: { address: { city: 'New York' } } },
                        { user: { address: { city: 'Los Angeles' } } }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-deep-nested">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item">
                                <span class="city" data-bind="user.address.city"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const cities = testContainer.querySelectorAll('.city')
            expect(cities.length).toBe(2)
            expect(cities[0].textContent).toBe('New York')
            expect(cities[1].textContent).toBe('Los Angeles')
        })

        it('should bind array length property (items.length) in computed list', async () => {
            wildflower.component('computed-array-length', {
                state: {
                    categories: [
                        { name: 'Fruits', items: ['Apple', 'Banana', 'Cherry'] },
                        { name: 'Vegetables', items: ['Carrot'] },
                        { name: 'Empty', items: [] }
                    ]
                },
                computed: {
                    allCategories() {
                        return this.state.categories
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-array-length">
                    <div data-list="computed:allCategories">
                        <template>
                            <div class="category">
                                <span class="name" data-bind="name"></span>:
                                <span class="count" data-bind="items.length"></span> items
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const counts = testContainer.querySelectorAll('.count')
            expect(counts.length).toBe(3)
            expect(counts[0].textContent).toBe('3')
            expect(counts[1].textContent).toBe('1')
            expect(counts[2].textContent).toBe('0')
        })

        it('should access list context vars (_index, _first, _last) in computed list', async () => {
            wildflower.component('computed-context-vars', {
                state: {
                    items: [
                        { name: 'First' },
                        { name: 'Middle' },
                        { name: 'Last' }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-context-vars">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item">
                                <span class="index" data-bind="_index"></span>
                                <span class="is-first" data-bind="_first"></span>
                                <span class="is-last" data-bind="_last"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(3)

            // First item: _index=0, _first=true, _last=false
            expect(items[0].querySelector('.index').textContent).toBe('0')
            expect(items[0].querySelector('.is-first').textContent).toBe('true')
            expect(items[0].querySelector('.is-last').textContent).toBe('false')

            // Middle item: _index=1, _first=false, _last=false
            expect(items[1].querySelector('.index').textContent).toBe('1')
            expect(items[1].querySelector('.is-first').textContent).toBe('false')
            expect(items[1].querySelector('.is-last').textContent).toBe('false')

            // Last item: _index=2, _first=false, _last=true
            expect(items[2].querySelector('.index').textContent).toBe('2')
            expect(items[2].querySelector('.is-first').textContent).toBe('false')
            expect(items[2].querySelector('.is-last').textContent).toBe('true')
        })

        it('should correctly display falsy values (0, empty string) in computed list', async () => {
            wildflower.component('computed-falsy-values', {
                state: {
                    items: [
                        { count: 0, label: '' },
                        { count: 5, label: 'Five' }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-falsy-values">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item">
                                Count: <span class="count" data-bind="count"></span>,
                                Label: <span class="label" data-bind="label"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)

            // Should display "0" not empty
            expect(items[0].querySelector('.count').textContent).toBe('0')
            // Empty string should render as empty
            expect(items[0].querySelector('.label').textContent).toBe('')

            expect(items[1].querySelector('.count').textContent).toBe('5')
            expect(items[1].querySelector('.label').textContent).toBe('Five')
        })

        it('should evaluate inline expressions (price * quantity) in computed list', async () => {
            wildflower.component('computed-inline-expr', {
                state: {
                    items: [
                        { name: 'Laptop', price: 999, quantity: 2 },
                        { name: 'Mouse', price: 25, quantity: 3 }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-inline-expr">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item">
                                <span class="line-total" data-bind="price * quantity"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const totals = testContainer.querySelectorAll('.line-total')
            expect(totals.length).toBe(2)
            expect(totals[0].textContent).toBe('1998')
            expect(totals[1].textContent).toBe('75')
        })
    })

    // =========================================================================
    // 2. data-show Edge Cases for Computed Lists
    // =========================================================================
    describe('data-show Edge Cases', () => {
        it('should handle deep nested property in data-show within computed list', async () => {
            wildflower.component('computed-show-deep', {
                state: {
                    items: [
                        { config: { display: { show: true } } },
                        { config: { display: { show: false } } }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-show-deep">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item">
                                <span class="indicator" data-show="config.display.show">VISIBLE</span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)

            expect(items[0].querySelector('.indicator').style.display).not.toBe('none')
            expect(items[1].querySelector('.indicator').style.display).toBe('none')
        })

        it('should handle negation (!active) in data-show within computed list', async () => {
            wildflower.component('computed-show-negation', {
                state: {
                    items: [
                        { name: 'Item 1', active: true },
                        { name: 'Item 2', active: false }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-show-negation">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item">
                                <span class="inactive-label" data-show="!active">INACTIVE</span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)

            // Item 1: active = true, !active = false -> should be hidden
            expect(items[0].querySelector('.inactive-label').style.display).toBe('none')
            // Item 2: active = false, !active = true -> should be visible
            expect(items[1].querySelector('.inactive-label').style.display).not.toBe('none')
        })

        it('should handle nested negation (!settings.hidden) in data-show within computed list', async () => {
            wildflower.component('computed-show-nested-negation', {
                state: {
                    items: [
                        { settings: { hidden: false } },
                        { settings: { hidden: true } }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-show-nested-negation">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item">
                                <span class="visible-label" data-show="!settings.hidden">VISIBLE</span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)

            // Item 1: hidden = false, !hidden = true -> should be visible
            expect(items[0].querySelector('.visible-label').style.display).not.toBe('none')
            // Item 2: hidden = true, !hidden = false -> should be hidden
            expect(items[1].querySelector('.visible-label').style.display).toBe('none')
        })

        it('should handle expression (count > 0) in data-show within computed list', async () => {
            wildflower.component('computed-show-expression', {
                state: {
                    items: [
                        { name: 'Item 1', count: 5 },
                        { name: 'Item 2', count: 0 },
                        { name: 'Item 3', count: 10 }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-show-expression">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item">
                                <span class="has-items" data-show="count > 0">Has Items</span>
                                <span class="empty" data-show="count === 0">Empty</span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(3)

            expect(items[0].querySelector('.has-items').style.display).not.toBe('none')
            expect(items[0].querySelector('.empty').style.display).toBe('none')

            expect(items[1].querySelector('.has-items').style.display).toBe('none')
            expect(items[1].querySelector('.empty').style.display).not.toBe('none')

            expect(items[2].querySelector('.has-items').style.display).not.toBe('none')
            expect(items[2].querySelector('.empty').style.display).toBe('none')
        })
    })

    // =========================================================================
    // 3. data-model Edge Cases for Computed Lists
    // =========================================================================
    describe('data-model Edge Cases', () => {
        it('should handle number input in computed list', async () => {
            wildflower.component('computed-model-number', {
                state: {
                    items: [
                        { name: 'Item 1', quantity: 5 },
                        { name: 'Item 2', quantity: 10 }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-model-number">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item">
                                <input type="number" class="qty-input" data-model="quantity">
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="computed-model-number"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const inputs = testContainer.querySelectorAll('.qty-input')

            expect(inputs.length).toBe(2)
            expect(inputs[0].value).toBe('5')
            expect(inputs[1].value).toBe('10')

            // Change value
            inputs[0].value = '15'
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
            await waitForCompleteRender()

            expect(instance.state.items[0].quantity).toBe(15)
        })

        it('should handle select in computed list', async () => {
            wildflower.component('computed-model-select', {
                state: {
                    items: [
                        { name: 'Item 1', priority: 'high' },
                        { name: 'Item 2', priority: 'low' }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-model-select">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item">
                                <select class="priority-select" data-model="priority">
                                    <option value="low">Low</option>
                                    <option value="medium">Medium</option>
                                    <option value="high">High</option>
                                </select>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="computed-model-select"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const selects = testContainer.querySelectorAll('.priority-select')

            expect(selects.length).toBe(2)
            expect(selects[0].value).toBe('high')
            expect(selects[1].value).toBe('low')

            // Change value
            selects[0].value = 'medium'
            selects[0].dispatchEvent(new Event('change', { bubbles: true }))
            await waitForCompleteRender()

            expect(instance.state.items[0].priority).toBe('medium')
        })

        it('should handle nested property (user.email) in computed list', async () => {
            wildflower.component('computed-model-nested', {
                state: {
                    items: [
                        { user: { email: 'alice@test.com' } },
                        { user: { email: 'bob@test.com' } }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-model-nested">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item">
                                <input type="email" class="email-input" data-model="user.email">
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="computed-model-nested"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)
            const inputs = testContainer.querySelectorAll('.email-input')

            expect(inputs.length).toBe(2)
            expect(inputs[0].value).toBe('alice@test.com')
            expect(inputs[1].value).toBe('bob@test.com')

            // Change value
            inputs[0].value = 'alice.updated@test.com'
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
            await waitForCompleteRender()

            expect(instance.state.items[0].user.email).toBe('alice.updated@test.com')
        })
    })

    // =========================================================================
    // 4. data-bind-class Edge Cases for Computed Lists
    // =========================================================================
    describe('data-bind-class Edge Cases', () => {
        it('should handle nested property in class expression within computed list', async () => {
            wildflower.component('computed-class-nested', {
                state: {
                    items: [
                        { status: { active: true } },
                        { status: { active: false } }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-class-nested">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item" data-bind-class="status.active ? 'active-item' : 'inactive-item'">
                                Item
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)
            expect(items[0].classList.contains('active-item')).toBe(true)
            expect(items[1].classList.contains('inactive-item')).toBe(true)
        })

        it('should handle multiple classes in computed list', async () => {
            wildflower.component('computed-class-multiple', {
                state: {
                    items: [
                        { active: true, highlighted: true },
                        { active: false, highlighted: true }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-class-multiple">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item" data-bind-class="(active ? 'is-active ' : '') + (highlighted ? 'is-highlighted' : '')">
                                Item
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)
            expect(items[0].classList.contains('is-active')).toBe(true)
            expect(items[0].classList.contains('is-highlighted')).toBe(true)
            expect(items[1].classList.contains('is-active')).toBe(false)
            expect(items[1].classList.contains('is-highlighted')).toBe(true)
        })

        it('should handle property as class name in computed list', async () => {
            wildflower.component('computed-class-property', {
                state: {
                    items: [
                        { category: 'primary' },
                        { category: 'secondary' }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-class-property">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item" data-bind-class="category">
                                Item
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)
            expect(items[0].classList.contains('primary')).toBe(true)
            expect(items[1].classList.contains('secondary')).toBe(true)
        })

        it('should handle comparison expressions in computed list', async () => {
            wildflower.component('computed-class-comparison', {
                state: {
                    items: [
                        { score: 85 },
                        { score: 65 },
                        { score: 45 }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-class-comparison">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item" data-bind-class="score >= 70 ? 'pass' : 'fail'">
                                Score: <span data-bind="score"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(3)
            expect(items[0].classList.contains('pass')).toBe(true)
            expect(items[1].classList.contains('fail')).toBe(true)
            expect(items[2].classList.contains('fail')).toBe(true)
        })
    })

    // =========================================================================
    // 5. data-bind-style Edge Cases for Computed Lists
    // =========================================================================
    describe('data-bind-style Edge Cases', () => {
        it('should apply simple style object in computed list', async () => {
            wildflower.component('computed-style-simple', {
                state: {
                    items: [
                        { color: 'red' },
                        { color: 'blue' }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-style-simple">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item" data-bind-style="{ color: color }">
                                Colored text
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)
            expect(items[0].style.color).toBe('red')
            expect(items[1].style.color).toBe('blue')
        })

        it('should use item properties in style expression within computed list', async () => {
            wildflower.component('computed-style-item-props', {
                state: {
                    items: [
                        { width: 100, height: 50 },
                        { width: 200, height: 75 }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-style-item-props">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item" data-bind-style="{ width: width + 'px', height: height + 'px' }">
                                Box
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)
            expect(items[0].style.width).toBe('100px')
            expect(items[0].style.height).toBe('50px')
            expect(items[1].style.width).toBe('200px')
            expect(items[1].style.height).toBe('75px')
        })

        it('should update style on item property change in computed list', async () => {
            wildflower.component('computed-style-update', {
                state: {
                    items: [
                        { id: 1, opacity: 1 }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-style-update">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item" data-bind-style="{ opacity: opacity }">
                                Item
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="computed-style-update"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            const item = testContainer.querySelector('.item')
            expect(item.style.opacity).toBe('1')

            // Update opacity via array reassignment (proper reactive pattern)
            instance.state.items = [{ id: 1, opacity: 0.5 }]
            await waitForCompleteRender()

            expect(item.style.opacity).toBe('0.5')
        })
    })

    // =========================================================================
    // 6. data-bind-html Edge Cases for Computed Lists
    // =========================================================================
    describe('data-bind-html Edge Cases', () => {
        it('should bind HTML content in computed list', async () => {
            wildflower.component('computed-html-simple', {
                state: {
                    items: [
                        { content: '<strong>Bold</strong>' },
                        { content: '<em>Italic</em>' }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-html-simple">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item">
                                <div class="html-content" data-bind-html="content"></div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const contents = testContainer.querySelectorAll('.html-content')
            expect(contents.length).toBe(2)
            expect(contents[0].innerHTML).toBe('<strong>Bold</strong>')
            expect(contents[1].innerHTML).toBe('<em>Italic</em>')
        })

        it('should update HTML on item change in computed list', async () => {
            wildflower.component('computed-html-update', {
                state: {
                    items: [
                        { id: 1, content: '<span>Original</span>' }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-html-update">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item">
                                <div class="html-content" data-bind-html="content"></div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="computed-html-update"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            const content = testContainer.querySelector('.html-content')
            expect(content.innerHTML).toBe('<span>Original</span>')

            // Update content via array reassignment (proper reactive pattern)
            instance.state.items = [{ id: 1, content: '<div>Updated</div>' }]
            await waitForCompleteRender()

            expect(content.innerHTML).toBe('<div>Updated</div>')
        })
    })

    // =========================================================================
    // 7. Reactivity Edge Cases for Computed Lists
    // =========================================================================
    describe('Reactivity Edge Cases', () => {
        it('should react to replacing entire source array', async () => {
            wildflower.component('computed-react-replace', {
                state: {
                    items: [
                        { name: 'Original 1' },
                        { name: 'Original 2' }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-react-replace">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item">
                                <span class="name" data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="computed-react-replace"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            let items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)

            // Replace entire array
            instance.state.items = [
                { name: 'New 1' },
                { name: 'New 2' },
                { name: 'New 3' }
            ]
            await waitForCompleteRender()

            items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(3)
            expect(items[0].querySelector('.name').textContent).toBe('New 1')
            expect(items[1].querySelector('.name').textContent).toBe('New 2')
            expect(items[2].querySelector('.name').textContent).toBe('New 3')
        })

        it('should react to nested property change in source array', async () => {
            wildflower.component('computed-react-nested', {
                state: {
                    items: [
                        { user: { name: 'Alice' } }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-react-nested">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item">
                                <span class="name" data-bind="user.name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="computed-react-nested"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            let name = testContainer.querySelector('.name')
            expect(name.textContent).toBe('Alice')

            // Update nested property
            instance.state.items[0].user.name = 'Bob'
            await waitForCompleteRender()

            name = testContainer.querySelector('.name')
            expect(name.textContent).toBe('Bob')
        })

        it('should react to clearing entire source array', async () => {
            wildflower.component('computed-react-clear', {
                state: {
                    items: [
                        { name: 'Item 1' },
                        { name: 'Item 2' },
                        { name: 'Item 3' }
                    ]
                },
                computed: {
                    allItems() {
                        return this.state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-react-clear">
                    <div data-list="computed:allItems">
                        <template>
                            <div class="item">
                                <span class="name" data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="computed-react-clear"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            let items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(3)

            // Clear array
            instance.state.items = []
            await waitForCompleteRender()

            items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(0)
        })
    })

    // =========================================================================
    // 8. Filtered/Sorted Computed List Special Cases
    // =========================================================================
    describe('Filtered/Sorted Computed List Special Cases', () => {
        it('should correctly map index after filter', async () => {
            let capturedDetails = null

            wildflower.component('computed-filter-index', {
                state: {
                    showActive: true,
                    items: [
                        { id: 1, name: 'Item 1', active: true },
                        { id: 2, name: 'Item 2', active: false },
                        { id: 3, name: 'Item 3', active: true },
                        { id: 4, name: 'Item 4', active: false },
                        { id: 5, name: 'Item 5', active: true }
                    ]
                },
                computed: {
                    filteredItems() {
                        if (this.state.showActive) {
                            return this.state.items.filter(item => item.active)
                        }
                        return this.state.items
                    }
                },
                captureItem(event, element, details) {
                    capturedDetails = { ...details, item: { ...details.item } }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-filter-index">
                    <div data-list="computed:filteredItems">
                        <template>
                            <div class="item">
                                <span class="name" data-bind="name"></span>
                                <button class="capture-btn" data-action="captureItem">Capture</button>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            // Should show 3 items (active ones: Item 1, Item 3, Item 5)
            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(3)

            // Click on the second visible item (Item 3, which is index 1 in filtered list)
            const buttons = testContainer.querySelectorAll('.capture-btn')
            buttons[1].click()
            await waitForCompleteRender()

            expect(capturedDetails).not.toBeNull()
            expect(capturedDetails.index).toBe(1)  // Index in filtered list
            expect(capturedDetails.item.name).toBe('Item 3')
            expect(capturedDetails.item.id).toBe(3)
        })

        it('should correctly map index after sort', async () => {
            let capturedDetails = null

            wildflower.component('computed-sort-index', {
                state: {
                    items: [
                        { id: 1, name: 'Charlie', score: 75 },
                        { id: 2, name: 'Alice', score: 95 },
                        { id: 3, name: 'Bob', score: 85 }
                    ]
                },
                computed: {
                    sortedItems() {
                        // Sort by name alphabetically
                        return [...this.state.items].sort((a, b) => a.name.localeCompare(b.name))
                    }
                },
                captureItem(event, element, details) {
                    capturedDetails = { ...details, item: { ...details.item } }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-sort-index">
                    <div data-list="computed:sortedItems">
                        <template>
                            <div class="item">
                                <span class="name" data-bind="name"></span>
                                <button class="capture-btn" data-action="captureItem">Capture</button>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            // Sorted order: Alice (id:2), Bob (id:3), Charlie (id:1)
            const names = testContainer.querySelectorAll('.name')
            expect(names[0].textContent).toBe('Alice')
            expect(names[1].textContent).toBe('Bob')
            expect(names[2].textContent).toBe('Charlie')

            // Click on Bob (index 1 in sorted list)
            const buttons = testContainer.querySelectorAll('.capture-btn')
            buttons[1].click()
            await waitForCompleteRender()

            expect(capturedDetails).not.toBeNull()
            expect(capturedDetails.index).toBe(1)  // Index in sorted list
            expect(capturedDetails.item.name).toBe('Bob')
            expect(capturedDetails.item.id).toBe(3)
        })

        it('should delete from filtered list using item ID', async () => {
            wildflower.component('computed-filter-delete', {
                state: {
                    showActive: true,
                    items: [
                        { id: 1, name: 'Item 1', active: true },
                        { id: 2, name: 'Item 2', active: false },
                        { id: 3, name: 'Item 3', active: true }
                    ]
                },
                computed: {
                    filteredItems() {
                        if (this.state.showActive) {
                            return this.state.items.filter(item => item.active)
                        }
                        return this.state.items
                    }
                },
                deleteItem(event, element, details) {
                    // Use ID to find item in source array
                    const itemId = details.item.id
                    const sourceIndex = this.state.items.findIndex(i => i.id === itemId)
                    if (sourceIndex !== -1) {
                        this.state.items.splice(sourceIndex, 1)
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-filter-delete">
                    <div data-list="computed:filteredItems">
                        <template>
                            <div class="item">
                                <span class="name" data-bind="name"></span>
                                <button class="delete-btn" data-action="deleteItem">Delete</button>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="computed-filter-delete"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            // Initial: 2 visible items (Item 1, Item 3)
            let items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)

            // Delete Item 3 (second visible item)
            const buttons = testContainer.querySelectorAll('.delete-btn')
            buttons[1].click()
            await waitForCompleteRender()

            // Should now have 1 visible item
            items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(1)
            expect(items[0].querySelector('.name').textContent).toBe('Item 1')

            // Source array should have 2 items (Item 1 and Item 2)
            expect(instance.state.items.length).toBe(2)
            expect(instance.state.items[0].id).toBe(1)
            expect(instance.state.items[1].id).toBe(2)
        })

        it('should update item in sorted list and resort', async () => {
            wildflower.component('computed-sort-update', {
                state: {
                    items: [
                        { id: 1, name: 'Apple', score: 10 },
                        { id: 2, name: 'Banana', score: 20 },
                        { id: 3, name: 'Cherry', score: 15 }
                    ]
                },
                computed: {
                    sortedByScore() {
                        // Sort by score descending
                        return [...this.state.items].sort((a, b) => b.score - a.score)
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-sort-update">
                    <div data-list="computed:sortedByScore">
                        <template>
                            <div class="item">
                                <span class="name" data-bind="name"></span>
                                <span class="score" data-bind="score"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="computed-sort-update"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            // Initial order: Banana (20), Cherry (15), Apple (10)
            let names = testContainer.querySelectorAll('.name')
            expect(names[0].textContent).toBe('Banana')
            expect(names[1].textContent).toBe('Cherry')
            expect(names[2].textContent).toBe('Apple')

            // Update Apple's score to 25 (should become first)
            instance.state.items[0].score = 25
            await waitForCompleteRender()

            // New order: Apple (25), Banana (20), Cherry (15)
            names = testContainer.querySelectorAll('.name')
            expect(names[0].textContent).toBe('Apple')
            expect(names[1].textContent).toBe('Banana')
            expect(names[2].textContent).toBe('Cherry')
        })

        it('should handle sort computed re-evaluating on sort key change', async () => {
            wildflower.component('computed-sort-reevaluate', {
                state: {
                    sortBy: 'name',
                    items: [
                        { id: 1, name: 'Zebra', age: 5 },
                        { id: 2, name: 'Apple', age: 10 },
                        { id: 3, name: 'Mango', age: 3 }
                    ]
                },
                computed: {
                    sortedItems() {
                        const key = this.state.sortBy
                        return [...this.state.items].sort((a, b) => {
                            if (typeof a[key] === 'string') {
                                return a[key].localeCompare(b[key])
                            }
                            return a[key] - b[key]
                        })
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-sort-reevaluate">
                    <div data-list="computed:sortedItems">
                        <template>
                            <div class="item">
                                <span class="name" data-bind="name"></span>
                                <span class="age" data-bind="age"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="computed-sort-reevaluate"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            // Sorted by name: Apple, Mango, Zebra
            let names = testContainer.querySelectorAll('.name')
            expect(names[0].textContent).toBe('Apple')
            expect(names[1].textContent).toBe('Mango')
            expect(names[2].textContent).toBe('Zebra')

            // Change sort to age
            instance.state.sortBy = 'age'
            await waitForCompleteRender()

            // Sorted by age: Mango (3), Zebra (5), Apple (10)
            names = testContainer.querySelectorAll('.name')
            expect(names[0].textContent).toBe('Mango')
            expect(names[1].textContent).toBe('Zebra')
            expect(names[2].textContent).toBe('Apple')
        })

        it('should handle chained computed properties', async () => {
            wildflower.component('computed-chained', {
                state: {
                    searchTerm: '',
                    sortBy: 'name',
                    items: [
                        { id: 1, name: 'Apple', category: 'fruit' },
                        { id: 2, name: 'Banana', category: 'fruit' },
                        { id: 3, name: 'Carrot', category: 'vegetable' },
                        { id: 4, name: 'Broccoli', category: 'vegetable' }
                    ]
                },
                computed: {
                    // First computed: filter by search
                    searchFiltered() {
                        if (!this.state.searchTerm) {
                            return this.state.items
                        }
                        const term = this.state.searchTerm.toLowerCase()
                        return this.state.items.filter(item =>
                            item.name.toLowerCase().includes(term)
                        )
                    },
                    // Chained computed: sort the filtered results
                    filteredAndSorted() {
                        return [...this.computed.searchFiltered].sort((a, b) =>
                            a[this.state.sortBy].localeCompare(b[this.state.sortBy])
                        )
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-chained">
                    <div data-list="computed:filteredAndSorted">
                        <template>
                            <div class="item">
                                <span class="name" data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="computed-chained"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            // Initial: sorted by name (Apple, Banana, Broccoli, Carrot)
            let names = testContainer.querySelectorAll('.name')
            expect(names.length).toBe(4)
            expect(names[0].textContent).toBe('Apple')

            // Filter to only items with 'ro' in name (Broccoli, Carrot)
            instance.state.searchTerm = 'ro'
            await waitForCompleteRender()

            names = testContainer.querySelectorAll('.name')
            expect(names.length).toBe(2)
            expect(names[0].textContent).toBe('Broccoli')
            expect(names[1].textContent).toBe('Carrot')
        })
    })
})
