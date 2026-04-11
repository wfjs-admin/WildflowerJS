/**
 * Style Binding Nested Property Tests
 *
 * Tests that data-bind-style works correctly with nested property values
 * in both regular lists and computed lists.
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

describe('Style Binding Nested Properties', () => {
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

    describe('Regular Lists - Nested Property Styles', () => {
        it('should apply styles from nested property object', async () => {
            wildflower.component('style-nested-regular', {
                state: {
                    items: [
                        {
                            name: 'Item 1',
                            appearance: {
                                style: { backgroundColor: 'red', color: 'white' }
                            }
                        },
                        {
                            name: 'Item 2',
                            appearance: {
                                style: { backgroundColor: 'blue', color: 'yellow' }
                            }
                        }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="style-nested-regular">
                    <div data-list="items">
                        <template>
                            <div class="item" data-bind-style="appearance.style">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')

            // Check first item styles
            expect(items[0].style.backgroundColor).toBe('red')
            expect(items[0].style.color).toBe('white')

            // Check second item styles
            expect(items[1].style.backgroundColor).toBe('blue')
            expect(items[1].style.color).toBe('yellow')
        })

        it('should update styles when nested property changes', async () => {
            wildflower.component('style-nested-update', {
                state: {
                    cards: [
                        {
                            id: 1,
                            config: {
                                styling: { padding: '10px', margin: '5px' }
                            }
                        }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="style-nested-update">
                    <div data-list="cards">
                        <template>
                            <div class="card" data-bind-style="config.styling">
                                <span data-bind="id"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="style-nested-update"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            const card = testContainer.querySelector('.card')
            expect(card.style.padding).toBe('10px')
            expect(card.style.margin).toBe('5px')

            // Update via array reassignment for proper reactivity
            instance.state.cards = [
                {
                    id: 1,
                    config: {
                        styling: { padding: '20px', margin: '15px' }
                    }
                }
            ]
            await waitForCompleteRender()

            expect(card.style.padding).toBe('20px')
            expect(card.style.margin).toBe('15px')
        })

        it('should handle deeply nested style properties', async () => {
            wildflower.component('style-deep-nested', {
                state: {
                    widgets: [
                        {
                            name: 'Widget',
                            theme: {
                                colors: {
                                    style: {
                                        borderColor: 'green',
                                        borderWidth: '2px',
                                        borderStyle: 'solid'
                                    }
                                }
                            }
                        }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="style-deep-nested">
                    <div data-list="widgets">
                        <template>
                            <div class="widget" data-bind-style="theme.colors.style">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const widget = testContainer.querySelector('.widget')
            expect(widget.style.borderColor).toBe('green')
            expect(widget.style.borderWidth).toBe('2px')
            expect(widget.style.borderStyle).toBe('solid')
        })
    })

    describe('Computed Lists - Nested Property Styles', () => {
        it('should apply styles from nested property in computed list', async () => {
            wildflower.component('style-nested-computed', {
                state: {
                    products: [
                        {
                            name: 'Product A',
                            display: { styles: { fontWeight: 'bold' } },
                            featured: true
                        },
                        {
                            name: 'Product B',
                            display: { styles: { fontWeight: 'normal' } },
                            featured: false
                        },
                        {
                            name: 'Product C',
                            display: { styles: { fontWeight: 'bold', fontStyle: 'italic' } },
                            featured: true
                        }
                    ]
                },
                computed: {
                    featuredProducts() {
                        return this.state.products.filter(p => p.featured)
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="style-nested-computed">
                    <div data-list="computed:featuredProducts">
                        <template>
                            <div class="product" data-bind-style="display.styles">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const products = testContainer.querySelectorAll('.product')
            expect(products.length).toBe(2) // Only featured

            // Product A
            expect(products[0].style.fontWeight).toBe('bold')

            // Product C
            expect(products[1].style.fontWeight).toBe('bold')
            expect(products[1].style.fontStyle).toBe('italic')
        })

        it('should update computed list item nested styles', async () => {
            wildflower.component('style-nested-computed-update', {
                state: {
                    alerts: [
                        {
                            id: 1,
                            visual: { css: { backgroundColor: 'yellow' } },
                            active: true
                        },
                        {
                            id: 2,
                            visual: { css: { backgroundColor: 'orange' } },
                            active: true
                        }
                    ]
                },
                computed: {
                    activeAlerts() {
                        return this.state.alerts.filter(a => a.active)
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="style-nested-computed-update">
                    <div data-list="computed:activeAlerts">
                        <template>
                            <div class="alert" data-bind-style="visual.css">
                                <span data-bind="id"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="style-nested-computed-update"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            let alerts = testContainer.querySelectorAll('.alert')
            expect(alerts[0].style.backgroundColor).toBe('yellow')
            expect(alerts[1].style.backgroundColor).toBe('orange')

            // Update via array reassignment
            instance.state.alerts = [
                {
                    id: 1,
                    visual: { css: { backgroundColor: 'green' } },
                    active: true
                },
                {
                    id: 2,
                    visual: { css: { backgroundColor: 'purple' } },
                    active: true
                }
            ]
            await waitForCompleteRender()

            alerts = testContainer.querySelectorAll('.alert')
            expect(alerts[0].style.backgroundColor).toBe('green')
            expect(alerts[1].style.backgroundColor).toBe('purple')
        })
    })

    describe('Item + Component State Comparison', () => {
        it('should apply style based on item compared to component state in regular list', async () => {
            wildflower.component('style-item-component-compare', {
                state: {
                    selectedId: 2,
                    items: [
                        { id: 1, name: 'Item 1' },
                        { id: 2, name: 'Item 2' },
                        { id: 3, name: 'Item 3' }
                    ]
                },
                computed: {
                    // This computed will be evaluated for each item in list context
                    itemStyle() {
                        // In list context, this.id comes from the item
                        const isSelected = this.id === this.state?.selectedId
                        return {
                            backgroundColor: isSelected ? 'lightblue' : 'white',
                            fontWeight: isSelected ? 'bold' : 'normal'
                        }
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="style-item-component-compare">
                    <div data-list="items">
                        <template>
                            <div class="item" data-bind-style="computed:itemStyle">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')

            // Item 1: not selected
            expect(items[0].style.backgroundColor).toBe('white')
            expect(items[0].style.fontWeight).toBe('normal')

            // Item 2: selected
            expect(items[1].style.backgroundColor).toBe('lightblue')
            expect(items[1].style.fontWeight).toBe('bold')

            // Item 3: not selected
            expect(items[2].style.backgroundColor).toBe('white')
            expect(items[2].style.fontWeight).toBe('normal')
        })

        it('should apply style based on item compared to component state in computed list', async () => {
            wildflower.component('style-item-component-computed', {
                state: {
                    highlightedCategory: 'urgent',
                    tasks: [
                        { id: 1, title: 'Task 1', category: 'normal', visible: true },
                        { id: 2, title: 'Task 2', category: 'urgent', visible: true },
                        { id: 3, title: 'Task 3', category: 'urgent', visible: true },
                        { id: 4, title: 'Task 4', category: 'normal', visible: false }
                    ]
                },
                computed: {
                    visibleTasks() {
                        return this.state.tasks.filter(t => t.visible)
                    },
                    taskStyle() {
                        const isHighlighted = this.category === this.state?.highlightedCategory
                        return {
                            borderLeft: isHighlighted ? '4px solid red' : '4px solid transparent',
                            paddingLeft: '8px'
                        }
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="style-item-component-computed">
                    <div data-list="computed:visibleTasks">
                        <template>
                            <div class="task" data-bind-style="computed:taskStyle">
                                <span data-bind="title"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const tasks = testContainer.querySelectorAll('.task')
            expect(tasks.length).toBe(3) // Only visible tasks

            // Task 1: category 'normal', not highlighted
            expect(tasks[0].style.borderLeft).toBe('4px solid transparent')

            // Task 2: category 'urgent', highlighted
            expect(tasks[1].style.borderLeft).toBe('4px solid red')

            // Task 3: category 'urgent', highlighted
            expect(tasks[2].style.borderLeft).toBe('4px solid red')
        })

        it('should update styles when component state changes', async () => {
            wildflower.component('style-component-state-change', {
                state: {
                    activeItemId: 1,
                    items: [
                        { id: 1, label: 'First' },
                        { id: 2, label: 'Second' }
                    ]
                },
                computed: {
                    dynamicStyle() {
                        const isActive = this.id === this.state?.activeItemId
                        return {
                            opacity: isActive ? '1' : '0.5'
                        }
                    }
                },
                selectItem(event, element, details) {
                    this.state.activeItemId = details.item.id
                }
            })

            testContainer.innerHTML = `
                <div data-component="style-component-state-change">
                    <div data-list="items">
                        <template>
                            <div class="item" data-bind-style="computed:dynamicStyle" data-action="selectItem">
                                <span data-bind="label"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const items = testContainer.querySelectorAll('.item')

            // Initial: Item 1 is active
            expect(items[0].style.opacity).toBe('1')
            expect(items[1].style.opacity).toBe('0.5')

            // Click second item to make it active
            items[1].click()
            await waitForCompleteRender()

            // Now Item 2 should be active
            expect(items[0].style.opacity).toBe('0.5')
            expect(items[1].style.opacity).toBe('1')
        })
    })
})
