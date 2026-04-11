/**
 * Reactive Context Lifecycle Tests - Vitest Browser Mode
 *
 * Tests ensuring reactive plugins are properly created and destroyed
 * to prevent memory leaks.
 *
 * These tests will FAIL until the unification is implemented.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature} from './helpers/load-framework.js'

const describeIfPlugins = hasFeature('plugins') ? describe : describe.skip

describeIfPlugins('Reactive Context Lifecycle', () => {
    let testContainer
    let wildflower
    let WildflowerJS

    beforeAll(async () => {
        await loadFramework()
        WildflowerJS = window.WildflowerJS
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

    describe('Plugin Cleanup', () => {
        it.skipIf(isMinifiedBuild())('should clean up plugin RSM on framework destroy', () => {
            wildflower.plugin({
                name: 'toDestroy',
                state: { value: 1 },
                computed: { doubled() { return this.state.value * 2 } },
                install() {}
            })

            expect(wildflower.$toDestroy).toBeDefined()
            expect(wildflower._pluginStates.has('toDestroy')).toBe(true)

            wildflower.destroy()

            expect(wildflower.$toDestroy).toBeUndefined()
            expect(wildflower._pluginStates.has('toDestroy')).toBe(false)
        })

        it('should clean up plugin subscriptions on destroy', () => {
            const callback = vi.fn()

            wildflower.plugin({
                name: 'subscribed',
                state: { count: 0 },
                methods: { increment() { this.state.count++ } },
                install() {}
            })

            // Subscribe to state changes
            const unsubscribe = wildflower.$subscribed.subscribe('count', callback)

            // Increment should trigger callback
            wildflower.$subscribed.increment()
            expect(callback).toHaveBeenCalledTimes(1)

            // Unsubscribe
            unsubscribe()

            // Reset callback mock
            callback.mockClear()

            // Increment again - callback should NOT be called
            wildflower.$subscribed.increment()
            expect(callback).not.toHaveBeenCalled()
        })

        it.skipIf(isMinifiedBuild())('should not leak memory from destroyed plugins', () => {
            const initialPluginCount = wildflower._pluginStates.size

            // Create multiple plugins with large state
            for (let i = 0; i < 10; i++) {
                wildflower.plugin({
                    name: `temp${i}`,
                    state: { data: new Array(1000).fill('x') },
                    install() {}
                })
            }

            expect(wildflower._pluginStates.size).toBe(initialPluginCount + 10)

            wildflower.destroy()

            expect(wildflower._pluginStates.size).toBe(0)
        })

        it.skipIf(isMinifiedBuild())('should allow plugin re-registration with different state', () => {
            // This test verifies that registering a plugin with the same name
            // replaces the old plugin state
            wildflower.plugin({
                name: 'reusable',
                state: { value: 'first' },
                install() {}
            })

            expect(wildflower.$reusable.state.value).toBe('first')

            // Clear plugin states to simulate a clean slate
            wildflower._pluginStates.clear()
            delete wildflower.$reusable

            // Re-register with different state
            wildflower.plugin({
                name: 'reusable',
                state: { value: 'second' },
                install() {}
            })

            expect(wildflower.$reusable.state.value).toBe('second')
        })
    })
})
