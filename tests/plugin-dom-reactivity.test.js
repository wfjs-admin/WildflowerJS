/**
 * Plugin DOM Reactivity Tests - Vitest Browser Mode
 *
 * Tests verifying that plugin state changes automatically trigger DOM updates.
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

describeIfPlugins('Plugin DOM Reactivity', () => {
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

    describe('DOM Updates from Plugin State', () => {
        it('should update component DOM when plugin state changes', async () => {
            wildflower.plugin({
                name: 'message',
                state: { text: 'Hello' },
                methods: { setText(t) { this.state.text = t } },
                install() {}
            })

            wildflower.component('message-display', {
                state: {}
            })

            // Use external() binding to access plugin state directly
            testContainer.innerHTML = `
                <div data-component="message-display">
                    <span data-bind="external('message', 'text')"></span>
                </div>
            `
            wildflower.scan()
            await waitForCompleteRender()
            await waitForUpdate(100)

            expect(testContainer.querySelector('span').textContent).toBe('Hello')

            wildflower.$message.setText('World')

            // Force render cycle to process the change
            await waitForCompleteRender()
            await waitForUpdate(100)

            expect(testContainer.querySelector('span').textContent).toBe('World')
        })

        it('should trigger subscribe callbacks for array state changes', async () => {
            // This test verifies that plugin subscribe callbacks are called when
            // plugin array state changes. Note: RSM may fire multiple callbacks
            // for a single array change (e.g., 'items' and 'items.length')
            const subscribeCallback = vi.fn()

            wildflower.plugin({
                name: 'todos',
                state: { items: ['Task 1', 'Task 2'] },
                methods: {
                    add(item) {
                        // Use immutable update for reactivity
                        this.state.items = [...this.state.items, item]
                    },
                    remove(index) {
                        this.state.items = this.state.items.filter((_, i) => i !== index)
                    }
                },
                install() {}
            })

            // Subscribe to items changes
            wildflower.$todos.subscribe('items', subscribeCallback)

            // Initial state - callback not yet called
            expect(subscribeCallback).not.toHaveBeenCalled()

            // Add item
            wildflower.$todos.add('Task 3')

            // Callback should have been called (may be multiple times due to nested path changes)
            expect(subscribeCallback).toHaveBeenCalled()

            // Find the main 'items' path call (the one with the full array)
            const itemsCall = subscribeCallback.mock.calls.find(call => call[2] === 'items')
            expect(itemsCall).toBeDefined()
            const [newValue] = itemsCall
            expect(Array.isArray(newValue)).toBe(true)
            expect(newValue).toContain('Task 3')
            expect(newValue.length).toBe(3)

            // Verify the actual state reflects the change
            expect(wildflower.$todos.state.items).toContain('Task 3')
            expect(wildflower.$todos.state.items.length).toBe(3)

            // Remove item
            subscribeCallback.mockClear()
            wildflower.$todos.remove(0)

            // Find the main 'items' path call after remove
            const afterRemoveCall = subscribeCallback.mock.calls.find(call => call[2] === 'items')
            expect(afterRemoveCall).toBeDefined()
            const [afterRemove] = afterRemoveCall
            expect(afterRemove.length).toBe(2)
            expect(afterRemove[0]).toBe('Task 2')
        })
    })
})
