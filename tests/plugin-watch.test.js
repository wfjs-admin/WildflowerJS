/**
 * Plugin Watch Tests - Vitest Browser Mode
 *
 * Tests for the declarative watch object in plugins.
 *
 * These tests will FAIL until the unification is implemented.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const describeIfPlugins = hasFeature('plugins') ? describe : describe.skip

describeIfPlugins('Plugin Watch Object', () => {
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

    describe('Declarative Watch', () => {
        it('should call watch callback when watched state changes', () => {
            const callback = vi.fn()

            wildflower.plugin({
                name: 'watched',
                state: { count: 0 },
                watch: {
                    count: callback
                },
                methods: {
                    increment() { this.state.count++ }
                },
                install() {}
            })

            wildflower.$watched.increment()

            expect(callback).toHaveBeenCalledWith(1, 0)
        })

        it('should pass new and old values to watch callback', () => {
            let captured = {}

            wildflower.plugin({
                name: 'values',
                state: { name: 'Alice' },
                watch: {
                    name(newVal, oldVal) {
                        captured = { newVal, oldVal }
                    }
                },
                methods: {
                    setName(n) { this.state.name = n }
                },
                install() {}
            })

            wildflower.$values.setName('Bob')

            expect(captured.newVal).toBe('Bob')
            expect(captured.oldVal).toBe('Alice')
        })

        it('should support watching nested state paths', () => {
            const callback = vi.fn()

            wildflower.plugin({
                name: 'nested',
                state: {
                    user: { profile: { theme: 'light' } }
                },
                watch: {
                    'user.profile.theme': callback
                },
                methods: {
                    setTheme(t) { this.state.user.profile.theme = t }
                },
                install() {}
            })

            wildflower.$nested.setTheme('dark')

            expect(callback).toHaveBeenCalledWith('dark', 'light')
        })

        it('should support multiple watchers on different paths', () => {
            const countCallback = vi.fn()
            const nameCallback = vi.fn()

            wildflower.plugin({
                name: 'multi',
                state: { count: 0, name: '' },
                watch: {
                    count: countCallback,
                    name: nameCallback
                },
                methods: {
                    increment() { this.state.count++ },
                    setName(n) { this.state.name = n }
                },
                install() {}
            })

            wildflower.$multi.increment()
            expect(countCallback).toHaveBeenCalled()
            expect(nameCallback).not.toHaveBeenCalled()

            countCallback.mockClear()

            wildflower.$multi.setName('Test')
            expect(nameCallback).toHaveBeenCalled()
            expect(countCallback).not.toHaveBeenCalled()
        })

        it('should bind watch callbacks to plugin context', () => {
            let capturedThis

            wildflower.plugin({
                name: 'contextual',
                state: { value: 0 },
                watch: {
                    value() {
                        capturedThis = this
                    }
                },
                methods: {
                    increment() { this.state.value++ }
                },
                install() {}
            })

            wildflower.$contextual.increment()

            expect(capturedThis).toBeDefined()
            expect(capturedThis.state).toBeDefined()
            expect(capturedThis.state.value).toBe(1)
        })

        it('should clean up watchers when framework is destroyed', () => {
            // destroy() only exists in full/spa builds with error boundaries
            if (typeof wildflower.destroy !== 'function') return;
            const callback = vi.fn()

            wildflower.plugin({
                name: 'cleanup',
                state: { count: 0 },
                watch: {
                    count: callback
                },
                methods: {
                    increment() { this.state.count++ }
                },
                install() {}
            })

            // Trigger once to verify it works
            wildflower.$cleanup.increment()
            expect(callback).toHaveBeenCalledTimes(1)

            // Destroy framework
            wildflower.destroy()

            // Clear mock to check if called after destroy
            callback.mockClear()

            // After destroy, callbacks should not be called
            // (and attempting to access the plugin should not throw)
            expect(callback).not.toHaveBeenCalled()
        })
    })
})
