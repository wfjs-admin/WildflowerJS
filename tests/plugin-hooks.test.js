/**
 * Plugin Lifecycle Hooks Tests - Vitest Browser Mode
 *
 * Tests for the WildflowerJS lifecycle hook system.
 * Phase 2 of the plugin system implementation.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature} from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

const describeIfPlugins = hasFeature('plugins') ? describe : describe.skip

describeIfPlugins('Plugin Lifecycle Hooks', () => {
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
        if (wildflower._globalMixins) wildflower._globalMixins = {}
        if (wildflower._hooks) wildflower._hooks.clear()

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

    describe('wildflower.hook()', () => {
        it('should register a hook handler', () => {
            const handler = vi.fn()

            wildflower.hook('component:afterInit', handler)

            expect(wildflower._hooks.get('component:afterInit')).toContain(handler)
        })

        it('should allow multiple handlers for same hook', () => {
            const handler1 = vi.fn()
            const handler2 = vi.fn()

            wildflower.hook('component:afterInit', handler1)
            wildflower.hook('component:afterInit', handler2)

            const handlers = wildflower._hooks.get('component:afterInit')
            expect(handlers).toContain(handler1)
            expect(handlers).toContain(handler2)
        })

        it('should return unsubscribe function', () => {
            const handler = vi.fn()

            const unsubscribe = wildflower.hook('component:afterInit', handler)

            expect(typeof unsubscribe).toBe('function')

            unsubscribe()

            expect(wildflower._hooks.get('component:afterInit')).not.toContain(handler)
        })
    })

    describe('component:beforeInit hook', () => {
        it('should be called before component init', async () => {
            const order = []

            wildflower.hook('component:beforeInit', () => {
                order.push('hook')
            })

            wildflower.component('test', {
                state: {},
                init() {
                    order.push('init')
                }
            })

            testContainer.innerHTML = `<div data-component="test"></div>`
            wildflower.scan()
            await waitForComponent('[data-component="test"]')

            expect(order).toEqual(['hook', 'init'])
        })

        it('should receive component instance', async () => {
            const hookFn = vi.fn()

            wildflower.hook('component:beforeInit', hookFn)

            wildflower.component('test', { state: { value: 42 } })

            testContainer.innerHTML = `<div data-component="test"></div>`
            wildflower.scan()
            await waitForComponent('[data-component="test"]')

            expect(hookFn).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'test',
                    state: expect.objectContaining({ value: 42 })
                })
            )
        })
    })

    describe('component:afterInit hook', () => {
        it('should be called after component init', async () => {
            const order = []

            wildflower.hook('component:afterInit', () => {
                order.push('hook')
            })

            wildflower.component('test', {
                state: {},
                init() {
                    order.push('init')
                }
            })

            testContainer.innerHTML = `<div data-component="test"></div>`
            wildflower.scan()
            await waitForComponent('[data-component="test"]')

            expect(order).toEqual(['init', 'hook'])
        })
    })

    describe('component:beforeUpdate hook', () => {
        it('should be called before state update', async () => {
            const hookFn = vi.fn()

            wildflower.hook('component:beforeUpdate', hookFn)

            wildflower.component('test', {
                state: { count: 0 }
            })

            testContainer.innerHTML = `<div data-component="test"></div>`
            wildflower.scan()
            const component = await waitForComponent('[data-component="test"]')

            component.state.count = 1
            await waitForUpdate()

            expect(hookFn).toHaveBeenCalledWith(
                component,
                expect.objectContaining({ path: 'count' })
            )
        })
    })

    describe('component:afterUpdate hook', () => {
        it('should be called after state update', async () => {
            const hookFn = vi.fn()

            wildflower.hook('component:afterUpdate', hookFn)

            wildflower.component('test', {
                state: { count: 0 }
            })

            testContainer.innerHTML = `<div data-component="test"></div>`
            wildflower.scan()
            const component = await waitForComponent('[data-component="test"]')

            component.state.count = 5
            await waitForUpdate()

            expect(hookFn).toHaveBeenCalledWith(
                component,
                expect.objectContaining({ path: 'count', newValue: 5 })
            )
        })
    })

    describe('component:beforeDestroy hook', () => {
        it('should be called before component destroy', async () => {
            const hookFn = vi.fn()

            wildflower.hook('component:beforeDestroy', hookFn)

            wildflower.component('test', { state: {} })

            testContainer.innerHTML = `<div data-component="test"></div>`
            wildflower.scan()
            const component = await waitForComponent('[data-component="test"]')
            const componentId = component.id

            wildflower.destroyComponent(componentId)

            expect(hookFn).toHaveBeenCalledWith(
                expect.objectContaining({ id: componentId })
            )
        })
    })

    describe('component:afterDestroy hook', () => {
        it('should be called after component destroy', async () => {
            const hookFn = vi.fn()

            wildflower.hook('component:afterDestroy', hookFn)

            wildflower.component('test', { state: {} })

            testContainer.innerHTML = `<div data-component="test"></div>`
            wildflower.scan()
            const component = await waitForComponent('[data-component="test"]')
            const componentId = component.id

            wildflower.destroyComponent(componentId)

            expect(hookFn).toHaveBeenCalledWith(componentId)
        })
    })

    describe('Hook Error Handling', () => {
        it.skipIf(isMinifiedBuild())('should catch hook errors and continue', async () => {
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
            const secondHook = vi.fn()

            wildflower.hook('component:afterInit', () => {
                throw new Error('Hook failed')
            })
            wildflower.hook('component:afterInit', secondHook)

            wildflower.component('test', { state: {} })

            testContainer.innerHTML = `<div data-component="test"></div>`
            wildflower.scan()
            await waitForComponent('[data-component="test"]')

            expect(errorSpy).toHaveBeenCalled()
            expect(secondHook).toHaveBeenCalled()

            errorSpy.mockRestore()
        })
    })

    // ============================================================
    // HOOK EDGE CASE TESTS
    // ============================================================

    describe('Edge Cases: Hook Registration', () => {
        it('should handle registering same handler multiple times', async () => {
            const handler = vi.fn()

            wildflower.hook('component:afterInit', handler)
            wildflower.hook('component:afterInit', handler)

            wildflower.component('test', { state: {} })

            testContainer.innerHTML = '<div data-component="test"></div>'
            wildflower.scan()
            await waitForComponent('[data-component="test"]')

            // Should be called twice if registered twice
            expect(handler).toHaveBeenCalledTimes(2)
        })

        it('should handle many handlers for same hook', async () => {
            const handlers = Array.from({ length: 20 }, () => vi.fn())

            handlers.forEach(h => wildflower.hook('component:afterInit', h))

            wildflower.component('test', { state: {} })

            testContainer.innerHTML = '<div data-component="test"></div>'
            wildflower.scan()
            await waitForComponent('[data-component="test"]')

            handlers.forEach(h => expect(h).toHaveBeenCalled())
        })

        it('should handle unsubscribing non-existent handler gracefully', () => {
            const handler = vi.fn()
            const unsubscribe = wildflower.hook('component:afterInit', handler)

            // Unsubscribe twice
            unsubscribe()
            expect(() => unsubscribe()).not.toThrow()
        })

        it('should handle invalid hook names', () => {
            expect(() => wildflower.hook('', vi.fn())).toThrow()
            expect(() => wildflower.hook(null, vi.fn())).toThrow()
            expect(() => wildflower.hook(undefined, vi.fn())).toThrow()
        })

        it('should handle invalid handler', () => {
            expect(() => wildflower.hook('component:afterInit', null)).toThrow()
            expect(() => wildflower.hook('component:afterInit', 'string')).toThrow()
            expect(() => wildflower.hook('component:afterInit', 123)).toThrow()
        })
    })

    describe('Edge Cases: Hook Execution Order', () => {
        it('should execute hooks in registration order', async () => {
            const order = []

            wildflower.hook('component:afterInit', () => order.push(1))
            wildflower.hook('component:afterInit', () => order.push(2))
            wildflower.hook('component:afterInit', () => order.push(3))

            wildflower.component('test', { state: {} })

            testContainer.innerHTML = '<div data-component="test"></div>'
            wildflower.scan()
            await waitForComponent('[data-component="test"]')

            expect(order).toEqual([1, 2, 3])
        })

        it('should maintain order even after unsubscription', async () => {
            const order = []

            wildflower.hook('component:afterInit', () => order.push(1))
            const unsub = wildflower.hook('component:afterInit', () => order.push(2))
            wildflower.hook('component:afterInit', () => order.push(3))

            unsub() // Remove middle handler

            wildflower.component('test', { state: {} })

            testContainer.innerHTML = '<div data-component="test"></div>'
            wildflower.scan()
            await waitForComponent('[data-component="test"]')

            expect(order).toEqual([1, 3])
        })
    })

    describe('Edge Cases: Hook with Multiple Components', () => {
        it('should fire hook for each component initialization', async () => {
            const initCalls = []

            wildflower.hook('component:afterInit', (component) => {
                initCalls.push(component.name)
            })

            wildflower.component('comp1', { state: {} })
            wildflower.component('comp2', { state: {} })

            testContainer.innerHTML = `
                <div data-component="comp1"></div>
                <div data-component="comp2"></div>
            `
            wildflower.scan()

            await waitForComponent('[data-component="comp1"]')
            await waitForComponent('[data-component="comp2"]')

            expect(initCalls).toContain('comp1')
            expect(initCalls).toContain('comp2')
        })

        it('should fire hook for nested component initialization', async () => {
            const initOrder = []

            wildflower.hook('component:afterInit', (component) => {
                initOrder.push(component.name)
            })

            wildflower.component('parent', { state: {} })
            wildflower.component('child', { state: {} })

            testContainer.innerHTML = `
                <div data-component="parent">
                    <div data-component="child"></div>
                </div>
            `
            wildflower.scan()

            await waitForComponent('[data-component="child"]')

            expect(initOrder).toContain('parent')
            expect(initOrder).toContain('child')
        })
    })

    describe('Edge Cases: Async Hooks', () => {
        it('should handle async hook handlers', async () => {
            let asyncCompleted = false

            wildflower.hook('component:afterInit', async () => {
                await new Promise(resolve => setTimeout(resolve, 10))
                asyncCompleted = true
            })

            wildflower.component('test', { state: {} })

            testContainer.innerHTML = '<div data-component="test"></div>'
            wildflower.scan()
            await waitForComponent('[data-component="test"]')

            // Wait for async handler
            await new Promise(resolve => setTimeout(resolve, 50))

            expect(asyncCompleted).toBe(true)
        })

        it('should not block component initialization for slow async hooks', async () => {
            const order = []

            wildflower.hook('component:afterInit', async () => {
                await new Promise(resolve => setTimeout(resolve, 100))
                order.push('async')
            })

            wildflower.component('test', {
                state: {},
                init() {
                    order.push('init')
                }
            })

            testContainer.innerHTML = '<div data-component="test"></div>'
            wildflower.scan()
            await waitForComponent('[data-component="test"]')

            // Init should have completed
            expect(order).toContain('init')

            // Wait for async to complete
            await new Promise(resolve => setTimeout(resolve, 150))
            expect(order).toContain('async')
        })
    })

    describe('Edge Cases: Hook Modification During Execution', () => {
        it('should handle hook unsubscribing itself', async () => {
            let callCount = 0
            let unsubscribe

            unsubscribe = wildflower.hook('component:afterInit', () => {
                callCount++
                unsubscribe()
            })

            wildflower.component('test1', { state: {} })
            wildflower.component('test2', { state: {} })

            testContainer.innerHTML = '<div data-component="test1"></div>'
            wildflower.scan()
            await waitForComponent('[data-component="test1"]')

            testContainer.innerHTML = '<div data-component="test2"></div>'
            wildflower.scan()
            await waitForUpdate()

            expect(callCount).toBe(1)
        })

        it('should handle hook adding another hook during execution', async () => {
            const calls = []

            wildflower.hook('component:afterInit', () => {
                calls.push('first')
                wildflower.hook('component:afterInit', () => {
                    calls.push('added')
                })
            })

            wildflower.component('test', { state: {} })

            testContainer.innerHTML = '<div data-component="test"></div>'
            wildflower.scan()
            await waitForComponent('[data-component="test"]')

            // First hook runs, new hook should be available for next component
            expect(calls).toContain('first')

            // Create another component to trigger the added hook
            wildflower.component('test2', { state: {} })
            testContainer.innerHTML = '<div data-component="test2"></div>'
            wildflower.scan()
            await waitForUpdate()

            expect(calls).toContain('added')
        })
    })

    describe('Edge Cases: Update Hooks with Rapid Changes', () => {
        it('should fire update hooks for rapid state changes', async () => {
            const updatePaths = []

            wildflower.hook('component:beforeUpdate', (component, changes) => {
                updatePaths.push(changes.path)
            })

            wildflower.component('test', {
                state: { count: 0 }
            })

            testContainer.innerHTML = '<div data-component="test"><span data-bind="count"></span></div>'
            wildflower.scan()
            const component = await waitForComponent('[data-component="test"]')

            // Rapid updates
            for (let i = 0; i < 5; i++) {
                component.state.count = i
            }
            await waitForUpdate()

            expect(updatePaths.length).toBeGreaterThan(0)
        })

        it('should batch update hook calls when updates are batched', async () => {
            const updateCalls = []

            wildflower.hook('component:afterUpdate', (component, changes) => {
                updateCalls.push(changes)
            })

            wildflower.component('test', {
                state: { a: 1, b: 2 }
            })

            testContainer.innerHTML = '<div data-component="test"></div>'
            wildflower.scan()
            const component = await waitForComponent('[data-component="test"]')

            component.state.a = 10
            component.state.b = 20
            await waitForUpdate()

            // Should have update calls (behavior depends on batching implementation)
            expect(updateCalls.length).toBeGreaterThan(0)
        })
    })

    describe('Edge Cases: Destroy Hooks', () => {
        it('should fire destroy hooks in correct order', async () => {
            const order = []

            wildflower.hook('component:beforeDestroy', () => order.push('before'))
            wildflower.hook('component:afterDestroy', () => order.push('after'))

            wildflower.component('test', { state: {} })

            testContainer.innerHTML = '<div data-component="test"></div>'
            wildflower.scan()
            const component = await waitForComponent('[data-component="test"]')

            wildflower.destroyComponent(component.id)

            expect(order).toEqual(['before', 'after'])
        })

        it('should handle destroying component during init hook', async () => {
            let componentIdToDestroy

            wildflower.hook('component:afterInit', (component) => {
                if (component.name === 'doomed') {
                    componentIdToDestroy = component.id
                    // This might cause issues if not handled properly
                    setTimeout(() => {
                        wildflower.destroyComponent(componentIdToDestroy)
                    }, 0)
                }
            })

            wildflower.component('doomed', { state: {} })

            testContainer.innerHTML = '<div data-component="doomed"></div>'
            wildflower.scan()

            // Should not crash
            await new Promise(resolve => setTimeout(resolve, 50))
        })
    })

    describe('Edge Cases: Custom Hook Names', () => {
        it.skipIf(isMinifiedBuild())('should support custom hook names', () => {
            const customHandler = vi.fn()

            wildflower.hook('plugin:customEvent', customHandler)

            // Manually trigger (as framework would)
            wildflower._triggerHook('plugin:customEvent', { data: 'test' })

            expect(customHandler).toHaveBeenCalledWith({ data: 'test' })
        })

        it('should handle hook names with special characters', () => {
            const handler = vi.fn()

            wildflower.hook('plugin:my-custom.event:v2', handler)

            expect(wildflower._hooks.has('plugin:my-custom.event:v2')).toBe(true)
        })

        it.skipIf(isMinifiedBuild())('should handle unknown hook names without error', () => {
            // Triggering a hook with no handlers should not throw
            expect(() => wildflower._triggerHook('unknown:event')).not.toThrow()
        })
    })
})
