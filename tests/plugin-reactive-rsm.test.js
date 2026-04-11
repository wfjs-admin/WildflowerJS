/**
 * Plugin Reactive State Manager Tests - Vitest Browser Mode
 *
 * Tests for plugins using ReactiveStateManager internally.
 * Part of the plugin-store unification effort.
 *
 * These tests will FAIL until the unification is implemented.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to wait for complete render cycle
async function waitForCompleteRender() {
    if (window.wildflower?._forceCompleteRender) {
        await window.wildflower._forceCompleteRender()
    }
    await new Promise(resolve => setTimeout(resolve, 50))
}

const describeIfPlugins = hasFeature('plugins') ? describe : describe.skip

describeIfPlugins('Plugin Reactive State Manager Integration', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()

        // Reset plugin system state
        if (wildflower._plugins) wildflower._plugins = []
        if (wildflower._pluginsByName) wildflower._pluginsByName.clear()
        if (wildflower._customDirectives) wildflower._customDirectives.clear()
        if (wildflower._hooks) wildflower._hooks.clear()
        if (wildflower._pluginStates) wildflower._pluginStates.clear()
        if (wildflower._providers) wildflower._providers = new Map()

        // Create a fresh test container
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

    // Helper to wait for component initialization
    const waitForComponent = async (selector, timeout = 2000) => {
        const start = Date.now()
        while (Date.now() - start < timeout) {
            const el = document.querySelector(selector)
            if (el && el.dataset.componentId) {
                const instance = wildflower.componentInstances.get(el.dataset.componentId)
                if (instance) return instance
            }
            await new Promise(resolve => setTimeout(resolve, 10))
        }
        throw new Error(`Component ${selector} failed to initialize within ${timeout}ms`)
    }

    describe('RSM-backed Plugin State', () => {
        it('should re-evaluate computed when state changes', () => {
            wildflower.plugin({
                name: 'counter',
                state: { count: 0 },
                computed: {
                    doubled() { return this.state.count * 2 }
                },
                methods: {
                    increment() { this.state.count++ }
                },
                install() {}
            })

            expect(wildflower.$counter.doubled).toBe(0)
            wildflower.$counter.increment()
            expect(wildflower.$counter.doubled).toBe(2)
        })

        it('should trigger DOM updates when plugin state bound to component', async () => {
            wildflower.plugin({
                name: 'user',
                state: { name: 'Alice' },
                methods: {
                    setName(name) { this.state.name = name }
                },
                install() {}
            })

            wildflower.component('user-display', {
                state: {}
            })

            // Use external() binding to access plugin state directly
            testContainer.innerHTML = `
                <div data-component="user-display">
                    <span data-bind="external('user', 'name')"></span>
                </div>
            `
            wildflower.scan()
            await waitForCompleteRender()
            await waitForUpdate(100)

            expect(testContainer.querySelector('span').textContent).toBe('Alice')

            wildflower.$user.setName('Bob')

            // Force render cycle and wait for updates
            await waitForCompleteRender()
            await waitForUpdate(100)

            expect(testContainer.querySelector('span').textContent).toBe('Bob')
        })

        it('should support subscribe() for watching state changes', () => {
            const callback = vi.fn()

            wildflower.plugin({
                name: 'notifications',
                state: { count: 0 },
                methods: {
                    add() { this.state.count++ }
                },
                install() {}
            })

            wildflower.$notifications.subscribe('count', callback)
            wildflower.$notifications.add()

            expect(callback).toHaveBeenCalledWith(1, 0, 'count')
        })

        it('should cache computed properties until dependencies change', () => {
            let evaluationCount = 0

            wildflower.plugin({
                name: 'expensive',
                state: { value: 1 },
                computed: {
                    calculated() {
                        evaluationCount++
                        return this.state.value * 100
                    }
                },
                install() {}
            })

            // First access
            expect(wildflower.$expensive.calculated).toBe(100)
            expect(evaluationCount).toBe(1)

            // Second access (should use cache)
            expect(wildflower.$expensive.calculated).toBe(100)
            expect(evaluationCount).toBe(1)

            // Change state (should invalidate cache)
            wildflower.$expensive.state.value = 2
            expect(wildflower.$expensive.calculated).toBe(200)
            expect(evaluationCount).toBe(2)
        })
    })

    describe('Lightweight Methods-Only Plugins', () => {
        it('should not create RSM for methods-only plugin', () => {
            wildflower.plugin({
                name: 'utils',
                methods: {
                    formatDate(d) { return d.toISOString() },
                    capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1) }
                },
                install() {}
            })

            // Plugin should work
            expect(wildflower.$utils.formatDate(new Date('2024-01-01'))).toBe('2024-01-01T00:00:00.000Z')
            expect(wildflower.$utils.capitalize('hello')).toBe('Hello')

            // Should not have state or RSM overhead
            expect(wildflower.$utils.state).toBeUndefined()
            expect(wildflower.$utils._stateManager).toBeUndefined()
        })
    })
})
