/**
 * @vitest-environment browser
 *
 * Tests for computed property caching behavior
 * Verifies that computed properties are cached and only recalculate when dependencies change
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to get component after DOM setup
async function setupComponent(wildflower, testContainer, html) {
    testContainer.innerHTML = html
    wildflower.scan()
    await waitForUpdate()
    const componentEl = testContainer.querySelector('[data-component]')
    const componentId = componentEl?.dataset?.componentId
    return componentId ? wildflower.componentInstances.get(componentId) : null
}

describe('Computed Property Caching', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower

        // Reset framework state
        if (wildflower.componentDefinitions) {
            wildflower.componentDefinitions.clear()
        }
        if (wildflower.componentInstances) {
            wildflower.componentInstances.clear()
        }

        // Create test container
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
    })

    describe('Basic caching behavior', () => {
        it('should only calculate computed property once on first access', async () => {
            let calcCount = 0

            wildflower.component('cache-test-1', {
                state: {
                    numbers: [10, 20, 30]
                },
                computed: {
                    sum() {
                        calcCount++
                        return this.state.numbers.reduce((a, b) => a + b, 0)
                    }
                }
            })

            const component = await setupComponent(wildflower, testContainer, `
                <div data-component="cache-test-1">
                    <span data-bind="computed:sum"></span>
                </div>
            `)

            expect(component).not.toBeNull()

            // Reset counter after initial render
            calcCount = 0

            // First explicit access - should be CACHED from initial render
            const v1 = component.context.computed.sum
            expect(v1).toBe(60)
            expect(calcCount).toBe(0) // Cached from render, no new calculation

            // Second access should be cached
            const v2 = component.context.computed.sum
            expect(v2).toBe(60)
            expect(calcCount).toBe(0) // Should NOT have increased

            // Third access should still be cached
            const v3 = component.context.computed.sum
            expect(v3).toBe(60)
            expect(calcCount).toBe(0) // Should NOT have increased
        })

        it('should recalculate when dependency changes', async () => {
            let calcCount = 0

            wildflower.component('cache-test-2', {
                state: {
                    multiplier: 2
                },
                computed: {
                    doubled() {
                        calcCount++
                        return this.state.multiplier * 2
                    }
                }
            })

            const component = await setupComponent(wildflower, testContainer, `
                <div data-component="cache-test-2">
                    <span data-bind="computed:doubled"></span>
                </div>
            `)

            expect(component).not.toBeNull()

            // Reset after render
            calcCount = 0

            // First access - cached from initial render
            expect(component.context.computed.doubled).toBe(4)
            expect(calcCount).toBe(0) // Cached, no new calculation

            // Second access (cached)
            expect(component.context.computed.doubled).toBe(4)
            expect(calcCount).toBe(0) // Still cached

            // Change dependency (use context.state to ensure reactive pathway)
            component.context.state.multiplier = 5
            await waitForUpdate()

            // Next access should recalculate - cache was invalidated
            expect(component.context.computed.doubled).toBe(10)
            // Note: Multiple recalculations may occur due to binding updates
            expect(calcCount).toBeGreaterThan(0) // Should have recalculated
        })

        it('should cache after dependency change recalculation', async () => {
            let calcCount = 0

            wildflower.component('cache-test-3', {
                state: {
                    value: 10
                },
                computed: {
                    squared() {
                        calcCount++
                        return this.state.value * this.state.value
                    }
                }
            })

            const component = await setupComponent(wildflower, testContainer, `
                <div data-component="cache-test-3">
                    <span data-bind="computed:squared"></span>
                </div>
            `)

            expect(component).not.toBeNull()

            // Change value (use context.state)
            component.context.state.value = 7
            await waitForUpdate()

            // Reset counter
            calcCount = 0

            // First access after change - should recalculate
            expect(component.context.computed.squared).toBe(49)
            const countAfterFirst = calcCount

            // Second access should be cached
            expect(component.context.computed.squared).toBe(49)
            expect(calcCount).toBe(countAfterFirst)

            // Third access should still be cached
            expect(component.context.computed.squared).toBe(49)
            expect(calcCount).toBe(countAfterFirst)
        })
    })

    describe('Chained computed properties', () => {
        it('should cache chained computed properties correctly', async () => {
            let sumCalcCount = 0
            let avgCalcCount = 0

            wildflower.component('cache-test-chain', {
                state: {
                    numbers: [10, 20, 30]
                },
                computed: {
                    sum() {
                        sumCalcCount++
                        return this.state.numbers.reduce((a, b) => a + b, 0)
                    },
                    average() {
                        avgCalcCount++
                        return this.state.numbers.length > 0
                            ? this.computed.sum / this.state.numbers.length
                            : 0
                    }
                }
            })

            const component = await setupComponent(wildflower, testContainer, `
                <div data-component="cache-test-chain">
                    <span class="sum" data-bind="computed:sum"></span>
                    <span class="avg" data-bind="computed:average"></span>
                </div>
            `)

            expect(component).not.toBeNull()

            // Reset counters after render - both are evaluated during render via data-bind
            sumCalcCount = 0
            avgCalcCount = 0

            // Access average (which depends on sum) - should be cached from render
            const avg = component.context.computed.average
            expect(avg).toBe(20)

            // Both should be cached, no new calculations
            expect(sumCalcCount).toBe(0) // Cached
            expect(avgCalcCount).toBe(0) // Cached

            // Access sum directly - should be cached
            const sum = component.context.computed.sum
            expect(sum).toBe(60)
            expect(sumCalcCount).toBe(0) // Still cached

            // Access average again - should be cached
            const avg2 = component.context.computed.average
            expect(avg2).toBe(20)
            expect(avgCalcCount).toBe(0) // Still cached
            expect(sumCalcCount).toBe(0) // Sum also still cached
        })
    })

    describe('Array dependency changes', () => {
        it('should recalculate when array is replaced', async () => {
            let calcCount = 0

            wildflower.component('cache-test-array', {
                state: {
                    items: [1, 2, 3]
                },
                computed: {
                    total() {
                        calcCount++
                        return this.state.items.reduce((a, b) => a + b, 0)
                    }
                }
            })

            const component = await setupComponent(wildflower, testContainer, `
                <div data-component="cache-test-array">
                    <span data-bind="computed:total"></span>
                </div>
            `)

            expect(component).not.toBeNull()

            // Reset
            calcCount = 0

            // First access - cached from initial render
            expect(component.context.computed.total).toBe(6)
            expect(calcCount).toBe(0) // Cached

            // Cached access
            expect(component.context.computed.total).toBe(6)
            expect(calcCount).toBe(0) // Still cached

            // Replace array (use context.state)
            component.context.state.items = [10, 20, 30]
            await waitForUpdate()

            // Should recalculate (value is correct)
            expect(component.context.computed.total).toBe(60)
            // Note: Multiple recalculations may occur due to array change + binding update
            // The important thing is the value is correct and subsequent access is cached
            expect(calcCount).toBeGreaterThan(0) // Recalculated at least once

            // Reset and verify caching still works
            calcCount = 0
            expect(component.context.computed.total).toBe(60)
            expect(calcCount).toBe(0) // Cached after the update
        })
    })

    describe('Multiple computed properties independence', () => {
        it('should not recalculate unrelated computed properties', async () => {
            let sumCalcCount = 0
            let productCalcCount = 0

            wildflower.component('cache-test-independent', {
                state: {
                    a: 5,
                    b: 10
                },
                computed: {
                    sum() {
                        sumCalcCount++
                        return this.state.a + this.state.b
                    },
                    product() {
                        productCalcCount++
                        return this.state.a * this.state.b
                    }
                }
            })

            const component = await setupComponent(wildflower, testContainer, `
                <div data-component="cache-test-independent">
                    <span class="sum" data-bind="computed:sum"></span>
                    <span class="product" data-bind="computed:product"></span>
                </div>
            `)

            expect(component).not.toBeNull()

            // Reset counters - both computed should have been evaluated during render
            // (due to data-bind in template)
            sumCalcCount = 0
            productCalcCount = 0

            // Access sum only - should be cached from render
            expect(component.context.computed.sum).toBe(15)
            expect(sumCalcCount).toBe(0) // Cached from render
            expect(productCalcCount).toBe(0) // Product not accessed

            // Access sum again (cached)
            expect(component.context.computed.sum).toBe(15)
            expect(sumCalcCount).toBe(0) // Still cached
            expect(productCalcCount).toBe(0) // Product still not accessed

            // Access product - should be cached from render
            expect(component.context.computed.product).toBe(50)
            expect(productCalcCount).toBe(0) // Cached from render
            expect(sumCalcCount).toBe(0) // Sum not recalculated
        })
    })
})
