/**
 * Test for computed property auto-detection in child components rendered inside lists
 *
 * This tests the fix for the issue where computed properties in child components
 * inside data-list templates required the explicit computed: prefix to update correctly.
 * The framework should auto-detect computed properties by name.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, waitForCompleteRender } from './helpers/load-framework.js'

describe('Computed Property Auto-Detection in List Child Components', () => {
    let testContainer
    let wildflower

    beforeEach(async () => {
        await resetFramework()
        wildflower = await loadFramework()
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(async () => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        await resetFramework()
    })

    it('should auto-detect computed properties in child components inside lists without explicit prefix', async () => {
        // Child component with computed property that depends on local state
        wildflower.component('item-display-simple', {
            state: {
                value: 10
            },
            computed: {
                // This computed property should auto-detect without computed: prefix
                displayValue() {
                    return this.state.value * 2
                }
            }
        })

        // Parent component with list
        wildflower.component('item-list-simple', {
            state: {},
            computed: {
                items() {
                    return [{ id: 1 }, { id: 2 }]
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="item-list-simple">
                <div data-list="computed:items" data-key="id">
                    <template>
                        <div data-component="item-display-simple">
                            <span class="value" data-bind="displayValue"></span>
                        </div>
                    </template>
                </div>
            </div>
        `

        // Trigger component scanning
        wildflower._scanForDynamicComponents()
        await waitForCompleteRender()

        // Wait for child components to render
        await new Promise(r => setTimeout(r, 150))

        // Check initial values
        const valueSpans = testContainer.querySelectorAll('.value')
        expect(valueSpans.length).toBe(2)
        expect(valueSpans[0].textContent).toBe('20') // 10 * 2
        expect(valueSpans[1].textContent).toBe('20')

        // Update the first child component's state
        for (const instance of wildflower.componentInstances.values()) {
            if (instance.name === 'item-display-simple') {
                instance.state.value = 50
                break
            }
        }

        // Wait for updates to propagate
        await new Promise(r => setTimeout(r, 150))

        // Check values after update - the key test!
        // Without the auto-detection fix, this would still show '20'
        expect(valueSpans[0].textContent).toBe('100') // 50 * 2
        expect(valueSpans[1].textContent).toBe('20')
    })

    it('should work the same with or without explicit computed: prefix', async () => {
        wildflower.component('dual-test-child', {
            state: {
                multiplier: 2
            },
            computed: {
                explicitComputed() {
                    return this.state.multiplier * 10
                },
                autoDetectedComputed() {
                    return this.state.multiplier * 20
                }
            }
        })

        wildflower.component('dual-test-parent', {
            state: {},
            computed: {
                items() {
                    return [{ id: 1 }, { id: 2 }]
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="dual-test-parent">
                <div data-list="computed:items" data-key="id">
                    <template>
                        <div data-component="dual-test-child">
                            <span class="explicit" data-bind="computed:explicitComputed"></span>
                            <span class="auto" data-bind="autoDetectedComputed"></span>
                        </div>
                    </template>
                </div>
            </div>
        `

        wildflower._scanForDynamicComponents()
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 150))

        // Both should show the same behavior
        const explicitSpans = testContainer.querySelectorAll('.explicit')
        const autoSpans = testContainer.querySelectorAll('.auto')

        expect(explicitSpans.length).toBe(2)
        expect(autoSpans.length).toBe(2)

        // Initial values
        expect(explicitSpans[0].textContent).toBe('20')
        expect(autoSpans[0].textContent).toBe('40')

        // Find a dual-test-child instance and update it
        for (const instance of wildflower.componentInstances.values()) {
            if (instance.name === 'dual-test-child') {
                instance.state.multiplier = 3
                break
            }
        }

        await new Promise(r => setTimeout(r, 150))

        // Both explicit and auto-detected should update
        expect(explicitSpans[0].textContent).toBe('30')
        expect(autoSpans[0].textContent).toBe('60')
    })

    it('should auto-detect computed properties for non-list child components too', async () => {
        // Sanity check that auto-detection works outside lists
        wildflower.component('simple-computed', {
            state: {
                base: 5
            },
            computed: {
                doubled() {
                    return this.state.base * 2
                }
            }
        })

        testContainer.innerHTML = `
            <div data-component="simple-computed">
                <span class="doubled" data-bind="doubled"></span>
            </div>
        `

        wildflower._scanForDynamicComponents()
        await waitForCompleteRender()

        const span = testContainer.querySelector('.doubled')
        expect(span.textContent).toBe('10')

        // Update state
        const instance = Array.from(wildflower.componentInstances.values())
            .find(i => i.name === 'simple-computed')
        instance.state.base = 10

        await new Promise(r => setTimeout(r, 100))
        expect(span.textContent).toBe('20')
    })
})
