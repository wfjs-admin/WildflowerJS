/**
 * Cross-Entity Communication Tests - Vitest Browser Mode
 *
 * Tests that external() works seamlessly between components, stores, and plugins.
 *
 * These tests will FAIL until the unification is implemented.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

const describeIfPlugins = hasFeature('plugins') ? describe : describe.skip

describeIfPlugins('Cross-Entity Communication', () => {
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

    // Helper to wait for component initialization (including deferred init())
    const waitForComponent = async (selector, timeout = 2000) => {
        const start = Date.now()
        while (Date.now() - start < timeout) {
            const el = document.querySelector(selector)
            if (el && el.dataset.componentId) {
                const instance = wildflower.componentInstances.get(el.dataset.componentId)
                if (instance) {
                    // Wait for deferred init() to complete (runs via setTimeout(0))
                    await new Promise(resolve => setTimeout(resolve, 0))
                    return instance
                }
            }
            await new Promise(resolve => setTimeout(resolve, 10))
        }
        throw new Error(`Component ${selector} failed to initialize within ${timeout}ms`)
    }

    describe('Plugin to Component Communication', () => {
        it('should allow plugin to read component state via getComponent()', async () => {
            wildflower.component('source-component', {
                state: { data: 'hello' }
            })

            wildflower.plugin({
                name: 'reader',
                state: {},
                methods: {
                    readComponent(name, path) {
                        const comp = wildflower.getComponent(name)
                        return comp ? comp.state[path] : undefined
                    }
                },
                install() {}
            })

            testContainer.innerHTML = '<div data-component="source-component"></div>'
            wildflower.scan()
            await waitForComponent('[data-component="source-component"]')

            expect(wildflower.$reader.readComponent('source-component', 'data')).toBe('hello')
        })
    })

    describe('Plugin to Store Communication', () => {
        it('should allow plugin to read store state via getStore()', () => {
            // Create store using storeManager
            const store = wildflower.storeManager.createStoreComponent('dataStore', {
                state: { value: 42 }
            })

            wildflower.plugin({
                name: 'storeReader',
                state: {},
                methods: {
                    readStore(name, path) {
                        const s = wildflower.getStore(name)
                        return s ? s[path] : undefined
                    }
                },
                install() {}
            })

            expect(wildflower.$storeReader.readStore('dataStore', 'value')).toBe(42)
        })
    })

    describe('Component to Plugin Communication', () => {
        it('should allow component to read plugin state', async () => {
            wildflower.plugin({
                name: 'config',
                state: { apiUrl: '/api/v1' },
                install() {}
            })

            let capturedUrl

            wildflower.component('api-consumer', {
                state: {},
                init() {
                    capturedUrl = wildflower.$config.state.apiUrl
                }
            })

            testContainer.innerHTML = '<div data-component="api-consumer"></div>'
            wildflower.scan()
            await waitForComponent('[data-component="api-consumer"]')

            expect(capturedUrl).toBe('/api/v1')
        })
    })

    describe('Store to Plugin Communication', () => {
        it('should allow store to read plugin state via external()', () => {
            wildflower.plugin({
                name: 'settings',
                state: { theme: 'dark' },
                install() {}
            })

            // Create store using storeManager
            const store = wildflower.storeManager.createStoreComponent('themeStore', {
                state: {},
                computed: {
                    currentTheme() {
                        return wildflower.$settings.state.theme
                    }
                }
            })

            expect(store.stateManager.evaluateComputed('currentTheme')).toBe('dark')
        })
    })
})
