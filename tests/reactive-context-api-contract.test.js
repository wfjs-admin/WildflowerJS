/**
 * Reactive Context API Contract Tests - Vitest Browser Mode
 *
 * Tests ensuring plugins and stores produce entities with consistent,
 * reactive behavior after the unification.
 *
 * These tests will FAIL until the unification is implemented.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const describeIfPlugins = hasFeature('plugins') ? describe : describe.skip

describeIfPlugins('Reactive Context API Contract', () => {
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

    describe('Store and Plugin API Consistency', () => {
        it('should expose identical API for store and reactive plugin', () => {
            // Create a store using storeManager
            const store = wildflower.storeManager.createStoreComponent('apiStore', {
                state: { value: 0 },
                computed: { doubled() { return this.state.value * 2 } }
            })

            // Create equivalent plugin
            wildflower.plugin({
                name: 'apiPlugin',
                state: { value: 0 },
                computed: { doubled() { return this.state.value * 2 } },
                methods: { increment() { this.state.value++ } },
                install() {}
            })

            const plugin = wildflower.$apiPlugin

            // Core APIs should be present on plugin
            // Note: computed properties resolve via ContextProxy GET trap,
            // so we use 'in' operator (which uses the proxy's has trap)
            // rather than Object.keys() (which only lists own properties)
            expect('state' in plugin).toBe(true)
            expect('doubled' in plugin).toBe(true)
            expect('increment' in plugin).toBe(true)
            expect('subscribe' in plugin).toBe(true)
            expect('reset' in plugin).toBe(true)
        })

        it('should have consistent state proxy behavior', () => {
            // Create store using storeManager
            const store = wildflower.storeManager.createStoreComponent('proxyStore', {
                state: { items: [] }
            })

            // Create equivalent plugin
            wildflower.plugin({ name: 'proxyPlugin', state: { items: [] }, install() {} })

            // Both should support array operations reactively
            store.state.items.push('a')
            wildflower.$proxyPlugin.state.items.push('a')

            // Compare array contents (length and values) rather than deep equality
            // since RSM may add internal tracking properties to arrays
            expect(store.state.items.length).toBe(1)
            expect(store.state.items[0]).toBe('a')
            expect(wildflower.$proxyPlugin.state.items.length).toBe(1)
            expect(wildflower.$proxyPlugin.state.items[0]).toBe('a')

            // Both should support further mutations
            store.state.items.push('b')
            wildflower.$proxyPlugin.state.items.push('b')

            expect(store.state.items.length).toBe(2)
            expect(store.state.items[0]).toBe('a')
            expect(store.state.items[1]).toBe('b')
            expect(wildflower.$proxyPlugin.state.items.length).toBe(2)
            expect(wildflower.$proxyPlugin.state.items[0]).toBe('a')
            expect(wildflower.$proxyPlugin.state.items[1]).toBe('b')
        })
    })
})
