/**
 * @vitest-environment browser
 *
 * Computed Class Binding Test Suite
 *
 * Tests for data-bind-class with computed properties.
 * These tests verify that class bindings update when state changes
 * that affect computed properties.
 *
 * BUG: data-bind-class="buttonClass" (simple computed name) doesn't work
 *      but data-bind-class="computed:buttonClass" does work.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Computed Class Binding Reactivity', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower

        // Simple reset
        if (wildflower.componentDefinitions) {
            wildflower.componentDefinitions.clear()
        }
        if (wildflower.componentInstances) {
            wildflower.componentInstances.clear()
        }
        if (wildflower.storeManager && wildflower.storeManager._namedStores) {
            wildflower.storeManager._namedStores.clear()
        }

        // Clear template cache
        if (wildflower._templateCache) {
            if (wildflower._templateCache.general) wildflower._templateCache.general.clear()
            if (wildflower._templateCache.lists) wildflower._templateCache.lists.clear()
            if (wildflower._templateCache.compiled) wildflower._templateCache.compiled.clear()
            if (wildflower._templateCache.extracted) wildflower._templateCache.extracted.clear()
            if (wildflower._templateCache.fragmentPools) wildflower._templateCache.fragmentPools.clear()
            if (wildflower._templateCache.stats) wildflower._templateCache.stats.clear()
        }

        // Create test container
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        testContainer.style.position = 'absolute'
        testContainer.style.left = '-9999px'
        testContainer.style.opacity = '0'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
    })

    describe('Test 1: Simple computed property name (BUG - should fail without fix)', () => {
        it('should update class when state changes - data-bind-class="buttonClass"', async () => {
            // This pattern DOES NOT WORK in the browser test case
            // Mirrors: test-cases/computed-class-binding.html Test 1
            wildflower.component('test-simple-computed', {
                state: {
                    size: 'normal'
                },
                computed: {
                    buttonClass() {
                        const sizeClasses = {
                            'small': 'btn btn-primary btn-sm',
                            'normal': 'btn btn-primary',
                            'large': 'btn btn-primary btn-lg'
                        }
                        return sizeClasses[this.state.size] || 'btn btn-primary'
                    }
                },
                cycleSize() {
                    const sizes = ['small', 'normal', 'large']
                    const currentIndex = sizes.indexOf(this.state.size)
                    this.state.size = sizes[(currentIndex + 1) % sizes.length]
                }
            })

            testContainer.innerHTML = `
                <div data-component="test-simple-computed">
                    <button id="btn1" data-bind-class="buttonClass">
                        Button (<span data-bind="size"></span>)
                    </button>
                    <button class="btn btn-outline-info btn-sm" data-action="cycleSize">Cycle Size</button>
                </div>
            `

            await waitForUpdate()

            const btn1 = testContainer.querySelector('#btn1')
            const cycleBtn = testContainer.querySelector('[data-action="cycleSize"]')

            // Initial state: size='normal' → buttonClass='btn btn-primary'
            expect(btn1.classList.contains('btn')).toBe(true)
            expect(btn1.classList.contains('btn-primary')).toBe(true)
            expect(btn1.classList.contains('btn-lg')).toBe(false)

            // Cycle: normal(1) → large(2) → buttonClass='btn btn-primary btn-lg'
            cycleBtn.click()
            await waitForUpdate()

            // BUG: This assertion fails because class binding didn't update
            expect(btn1.classList.contains('btn-lg')).toBe(true)
        })
    })

    describe('Test 2: Expression with computed property (BUG - should fail without fix)', () => {
        it('should update class when state changes - data-bind-class="\'btn btn-primary \' + sizeClass"', async () => {
            // This pattern DOES NOT WORK in the browser test case
            // Mirrors: test-cases/computed-class-binding.html Test 2
            wildflower.component('test-expression-computed', {
                state: {
                    size: 'normal'
                },
                computed: {
                    sizeClass() {
                        const sizes = {
                            'small': 'btn-sm',
                            'normal': '',
                            'large': 'btn-lg'
                        }
                        return sizes[this.state.size] || ''
                    }
                },
                cycleSize() {
                    const sizes = ['small', 'normal', 'large']
                    const currentIndex = sizes.indexOf(this.state.size)
                    this.state.size = sizes[(currentIndex + 1) % sizes.length]
                }
            })

            testContainer.innerHTML = `
                <div data-component="test-expression-computed">
                    <button id="btn2" data-bind-class="'btn btn-primary ' + sizeClass">
                        Button (<span data-bind="size"></span>)
                    </button>
                    <button class="btn btn-outline-info btn-sm" data-action="cycleSize">Cycle Size</button>
                </div>
            `

            await waitForUpdate()

            const btn2 = testContainer.querySelector('#btn2')
            const cycleBtn = testContainer.querySelector('[data-action="cycleSize"]')

            // Initial state: size='normal' → sizeClass='' → class='btn btn-primary '
            expect(btn2.classList.contains('btn')).toBe(true)
            expect(btn2.classList.contains('btn-primary')).toBe(true)
            expect(btn2.classList.contains('btn-lg')).toBe(false)

            // Cycle: normal(1) → large(2) → sizeClass='btn-lg'
            cycleBtn.click()
            await waitForUpdate()

            // BUG: This assertion fails because class binding didn't update
            expect(btn2.classList.contains('btn-lg')).toBe(true)
        })
    })

    describe('Test 3: Computed prefix (WORKS - baseline)', () => {
        it('should update class when state changes - data-bind-class="computed:buttonClass"', async () => {
            // This pattern WORKS in the browser test case
            // Mirrors: test-cases/computed-class-binding.html Test 3
            wildflower.component('test-prefix-computed', {
                state: {
                    size: 'normal'
                },
                computed: {
                    buttonClass() {
                        const sizeClasses = {
                            'small': 'btn btn-primary btn-sm',
                            'normal': 'btn btn-primary',
                            'large': 'btn btn-primary btn-lg'
                        }
                        return sizeClasses[this.state.size] || 'btn btn-primary'
                    }
                },
                cycleSize() {
                    const sizes = ['small', 'normal', 'large']
                    const currentIndex = sizes.indexOf(this.state.size)
                    this.state.size = sizes[(currentIndex + 1) % sizes.length]
                }
            })

            testContainer.innerHTML = `
                <div data-component="test-prefix-computed">
                    <button id="btn3" data-bind-class="computed:buttonClass">
                        Button (<span data-bind="size"></span>)
                    </button>
                    <button class="btn btn-outline-info btn-sm" data-action="cycleSize">Cycle Size</button>
                </div>
            `

            await waitForUpdate()

            const btn3 = testContainer.querySelector('#btn3')
            const cycleBtn = testContainer.querySelector('[data-action="cycleSize"]')

            // Initial state: size='normal' → buttonClass='btn btn-primary'
            expect(btn3.classList.contains('btn')).toBe(true)
            expect(btn3.classList.contains('btn-primary')).toBe(true)
            expect(btn3.classList.contains('btn-lg')).toBe(false)

            // Cycle: normal(1) → large(2) → buttonClass='btn btn-primary btn-lg'
            cycleBtn.click()
            await waitForUpdate()

            // This WORKS because of the computed: prefix
            expect(btn3.classList.contains('btn-lg')).toBe(true)
        })
    })
})
