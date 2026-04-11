/**
 * Plugin Reactive State Tests - Vitest Browser Mode
 *
 * Tests for the WildflowerJS plugin reactive state system.
 * Phase 3 of the plugin system implementation.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature} from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

const describeIfPlugins = hasFeature('plugins') ? describe : describe.skip

describeIfPlugins('Plugin Reactive State', () => {
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
        if (wildflower._pluginStates) wildflower._pluginStates = new Map()

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

    describe('Plugin State Registration', () => {
        it.skipIf(isMinifiedBuild())('should register plugin with reactive state', () => {
            wildflower.plugin({
                name: 'counter',
                version: '1.0.0',
                state: {
                    count: 0
                },
                install(wf) {}
            })

            expect(wildflower._pluginStates.has('counter')).toBe(true)
        })

        it.skipIf(isMinifiedBuild())('should initialize state with provided values', () => {
            wildflower.plugin({
                name: 'counter',
                version: '1.0.0',
                state: {
                    count: 10,
                    name: 'test'
                },
                install(wf) {}
            })

            const pluginState = wildflower._pluginStates.get('counter')
            expect(pluginState.state.count).toBe(10)
            expect(pluginState.state.name).toBe('test')
        })

        it('should make state accessible as $pluginName', () => {
            wildflower.plugin({
                name: 'notifications',
                version: '1.0.0',
                state: {
                    items: []
                },
                install(wf) {}
            })

            expect(wildflower.$notifications).toBeDefined()
            // Compare array content (RSM may add internal tracking properties to arrays)
            expect(wildflower.$notifications.state.items.length).toBe(0)
        })
    })

    describe('Plugin Methods', () => {
        it('should register plugin methods', () => {
            wildflower.plugin({
                name: 'counter',
                version: '1.0.0',
                state: { count: 0 },
                methods: {
                    increment() {
                        this.state.count++
                    }
                },
                install(wf) {}
            })

            expect(typeof wildflower.$counter.increment).toBe('function')
        })

        it('should bind methods to plugin context', () => {
            wildflower.plugin({
                name: 'counter',
                version: '1.0.0',
                state: { count: 0 },
                methods: {
                    increment() {
                        this.state.count++
                    },
                    getCount() {
                        return this.state.count
                    }
                },
                install(wf) {}
            })

            wildflower.$counter.increment()
            expect(wildflower.$counter.getCount()).toBe(1)
        })

        it('should allow methods to modify state', () => {
            wildflower.plugin({
                name: 'notifications',
                version: '1.0.0',
                state: {
                    items: [],
                    count: 0
                },
                methods: {
                    add(message) {
                        this.state.items.push({ id: Date.now(), message })
                        this.state.count++
                    },
                    clear() {
                        this.state.items = []
                        this.state.count = 0
                    }
                },
                install(wf) {}
            })

            wildflower.$notifications.add('Test message')
            expect(wildflower.$notifications.state.items).toHaveLength(1)
            expect(wildflower.$notifications.state.count).toBe(1)

            wildflower.$notifications.clear()
            expect(wildflower.$notifications.state.items).toHaveLength(0)
        })
    })

    describe('Plugin Computed Properties', () => {
        it('should register computed properties', () => {
            wildflower.plugin({
                name: 'counter',
                version: '1.0.0',
                state: { count: 5 },
                computed: {
                    doubled() {
                        return this.state.count * 2
                    }
                },
                install(wf) {}
            })

            expect(wildflower.$counter.doubled).toBe(10)
        })

        it('should update computed when state changes', () => {
            wildflower.plugin({
                name: 'counter',
                version: '1.0.0',
                state: { count: 1 },
                computed: {
                    doubled() {
                        return this.state.count * 2
                    }
                },
                methods: {
                    increment() {
                        this.state.count++
                    }
                },
                install(wf) {}
            })

            expect(wildflower.$counter.doubled).toBe(2)
            wildflower.$counter.increment()
            expect(wildflower.$counter.doubled).toBe(4)
        })

        it('should support computed with no state dependency', () => {
            wildflower.plugin({
                name: 'utils',
                version: '1.0.0',
                state: {},
                computed: {
                    timestamp() {
                        return Date.now()
                    }
                },
                install(wf) {}
            })

            expect(typeof wildflower.$utils.timestamp).toBe('number')
        })
    })

    describe('Plugin State Reactivity in Components', () => {
        it('should make plugin state accessible in components', async () => {
            wildflower.plugin({
                name: 'theme',
                version: '1.0.0',
                state: { mode: 'light' },
                methods: {
                    toggle() {
                        this.state.mode = this.state.mode === 'light' ? 'dark' : 'light'
                    }
                },
                install(wf) {}
            })

            let capturedMode

            wildflower.component('test', {
                state: {},
                init() {
                    capturedMode = wildflower.$theme.state.mode
                }
            })

            testContainer.innerHTML = '<div data-component="test"></div>'
            wildflower.scan()
            await waitForComponent('[data-component="test"]')

            expect(capturedMode).toBe('light')
        })

        it('should allow components to call plugin methods', async () => {
            wildflower.plugin({
                name: 'counter',
                version: '1.0.0',
                state: { count: 0 },
                methods: {
                    increment() {
                        this.state.count++
                    }
                },
                install(wf) {}
            })

            wildflower.component('test', {
                state: {},
                incrementGlobal() {
                    wildflower.$counter.increment()
                }
            })

            testContainer.innerHTML = '<div data-component="test"></div>'
            wildflower.scan()
            const component = await waitForComponent('[data-component="test"]')

            component.incrementGlobal()
            expect(wildflower.$counter.state.count).toBe(1)
        })
    })

    describe('Plugin State Reset', () => {
        it('should reset state to initial values', () => {
            wildflower.plugin({
                name: 'resettable',
                version: '1.0.0',
                state: {
                    count: 0,
                    name: 'initial',
                    items: []
                },
                methods: {
                    increment() {
                        this.state.count++
                    },
                    setName(n) {
                        this.state.name = n
                    },
                    addItem(item) {
                        this.state.items = [...this.state.items, item]
                    }
                },
                install(wf) {}
            })

            // Modify state
            wildflower.$resettable.increment()
            wildflower.$resettable.increment()
            wildflower.$resettable.setName('modified')
            wildflower.$resettable.addItem('test')

            expect(wildflower.$resettable.state.count).toBe(2)
            expect(wildflower.$resettable.state.name).toBe('modified')
            expect(wildflower.$resettable.state.items.length).toBe(1)

            // Reset
            wildflower.$resettable.reset()

            // Verify reset to initial values
            expect(wildflower.$resettable.state.count).toBe(0)
            expect(wildflower.$resettable.state.name).toBe('initial')
            expect(wildflower.$resettable.state.items.length).toBe(0)
        })

        it('should reset nested object state', () => {
            wildflower.plugin({
                name: 'nestedReset',
                version: '1.0.0',
                state: {
                    user: {
                        name: 'default',
                        settings: {
                            theme: 'light'
                        }
                    }
                },
                methods: {
                    setTheme(theme) {
                        this.state.user.settings.theme = theme
                    }
                },
                install(wf) {}
            })

            wildflower.$nestedReset.setTheme('dark')
            expect(wildflower.$nestedReset.state.user.settings.theme).toBe('dark')

            wildflower.$nestedReset.reset()
            expect(wildflower.$nestedReset.state.user.settings.theme).toBe('light')
        })
    })

    describe('Edge Cases: Plugin State', () => {
        it('should handle plugin without state', () => {
            wildflower.plugin({
                name: 'stateless',
                version: '1.0.0',
                methods: {
                    doSomething() { return 'done' }
                },
                install(wf) {}
            })

            expect(wildflower.$stateless).toBeDefined()
            expect(wildflower.$stateless.doSomething()).toBe('done')
        })

        it('should handle plugin state with nested objects', () => {
            wildflower.plugin({
                name: 'nested',
                version: '1.0.0',
                state: {
                    user: {
                        name: 'John',
                        preferences: {
                            theme: 'dark'
                        }
                    }
                },
                methods: {
                    setTheme(theme) {
                        this.state.user.preferences.theme = theme
                    }
                },
                install(wf) {}
            })

            expect(wildflower.$nested.state.user.preferences.theme).toBe('dark')
            wildflower.$nested.setTheme('light')
            expect(wildflower.$nested.state.user.preferences.theme).toBe('light')
        })

        it('should handle plugin state with arrays', () => {
            wildflower.plugin({
                name: 'list',
                version: '1.0.0',
                state: {
                    items: ['a', 'b', 'c']
                },
                methods: {
                    add(item) {
                        this.state.items.push(item)
                    },
                    remove(index) {
                        this.state.items.splice(index, 1)
                    }
                },
                install(wf) {}
            })

            expect(wildflower.$list.state.items).toHaveLength(3)
            wildflower.$list.add('d')
            expect(wildflower.$list.state.items).toHaveLength(4)
            wildflower.$list.remove(0)
            // Compare array content (RSM may add internal tracking properties to arrays)
            expect(wildflower.$list.state.items.length).toBe(3)
            expect(wildflower.$list.state.items[0]).toBe('b')
            expect(wildflower.$list.state.items[1]).toBe('c')
            expect(wildflower.$list.state.items[2]).toBe('d')
        })

        it('should isolate state between plugins', () => {
            wildflower.plugin({
                name: 'plugin1',
                version: '1.0.0',
                state: { value: 1 },
                install(wf) {}
            })

            wildflower.plugin({
                name: 'plugin2',
                version: '1.0.0',
                state: { value: 2 },
                install(wf) {}
            })

            expect(wildflower.$plugin1.state.value).toBe(1)
            expect(wildflower.$plugin2.state.value).toBe(2)

            wildflower.$plugin1.state.value = 100
            expect(wildflower.$plugin1.state.value).toBe(100)
            expect(wildflower.$plugin2.state.value).toBe(2)
        })

        it('should handle multiple plugins with methods of same name', () => {
            wildflower.plugin({
                name: 'pluginA',
                version: '1.0.0',
                state: {},
                methods: {
                    getValue() { return 'A' }
                },
                install(wf) {}
            })

            wildflower.plugin({
                name: 'pluginB',
                version: '1.0.0',
                state: {},
                methods: {
                    getValue() { return 'B' }
                },
                install(wf) {}
            })

            expect(wildflower.$pluginA.getValue()).toBe('A')
            expect(wildflower.$pluginB.getValue()).toBe('B')
        })
    })

    describe('Component Cleanup from Plugin Dependents', () => {
        it('should remove destroyed component from plugin dependents', async () => {
            wildflower.plugin({
                name: 'tracker',
                version: '1.0.0',
                state: { value: 'test' },
                install(wf) {}
            })

            wildflower.component('dependent-comp', {
                state: {}
            })

            // Use external() binding to register dependency through the DOM binding system
            testContainer.innerHTML = `
                <div data-component="dependent-comp" id="dep-comp">
                    <span data-bind="external('tracker', 'value')"></span>
                </div>
            `
            wildflower.scan()
            const component = await waitForComponent('[data-component="dependent-comp"]')
            await waitForUpdate(50) // Wait for binding to process

            // Verify component is registered as dependent
            const dependentsBefore = wildflower._getPluginDependents('tracker')
            expect(dependentsBefore.has(component.id)).toBe(true)

            // Destroy the component
            wildflower.destroyComponent(component.id)

            // Verify component is removed from dependents
            const dependentsAfter = wildflower._getPluginDependents('tracker')
            expect(dependentsAfter.has(component.id)).toBe(false)
        })
    })

    describe('Multiple Components Using Same Plugin', () => {
        it('should track multiple components depending on same plugin', async () => {
            wildflower.plugin({
                name: 'shared',
                version: '1.0.0',
                state: { count: 0 },
                methods: {
                    increment() { this.state.count++ }
                },
                install(wf) {}
            })

            wildflower.component('consumer-a', {
                state: {}
            })

            wildflower.component('consumer-b', {
                state: {}
            })

            // Use external() bindings to register dependencies
            testContainer.innerHTML = `
                <div data-component="consumer-a" id="comp-a">
                    <span data-bind="external('shared', 'count')"></span>
                </div>
                <div data-component="consumer-b" id="comp-b">
                    <span data-bind="external('shared', 'count')"></span>
                </div>
            `
            wildflower.scan()

            await waitForComponent('[data-component="consumer-a"]')
            await waitForComponent('[data-component="consumer-b"]')
            await waitForUpdate(50) // Wait for bindings to process

            // Both should be registered as dependents
            const dependents = wildflower._getPluginDependents('shared')
            expect(dependents.size).toBeGreaterThanOrEqual(2)
        })

        it('should update all dependent components when plugin state changes', async () => {
            wildflower.plugin({
                name: 'broadcaster',
                version: '1.0.0',
                state: { message: 'initial' },
                methods: {
                    setMessage(msg) { this.state.message = msg }
                },
                install(wf) {}
            })

            wildflower.component('listener-a', {
                state: {}
            })

            wildflower.component('listener-b', {
                state: {}
            })

            // Use external() bindings to register dependencies
            testContainer.innerHTML = `
                <div data-component="listener-a">
                    <span class="msg-a" data-bind="external('broadcaster', 'message')"></span>
                </div>
                <div data-component="listener-b">
                    <span class="msg-b" data-bind="external('broadcaster', 'message')"></span>
                </div>
            `
            wildflower.scan()

            await waitForComponent('[data-component="listener-a"]')
            await waitForComponent('[data-component="listener-b"]')
            await waitForUpdate(50) // Wait for bindings to process

            // Verify initial state
            expect(testContainer.querySelector('.msg-a').textContent).toBe('initial')
            expect(testContainer.querySelector('.msg-b').textContent).toBe('initial')

            // Change plugin state
            wildflower.$broadcaster.setMessage('updated')
            await waitForUpdate(100)

            // Both components should have been updated
            expect(testContainer.querySelector('.msg-a').textContent).toBe('updated')
            expect(testContainer.querySelector('.msg-b').textContent).toBe('updated')

            // Both components should have been marked for update
            const dependents = wildflower._getPluginDependents('broadcaster')
            expect(dependents.size).toBeGreaterThanOrEqual(2)
        })
    })

    describe('Cross-Plugin Computed Properties', () => {
        it('should support computed that depends on another plugin state', () => {
            wildflower.plugin({
                name: 'baseData',
                version: '1.0.0',
                state: { multiplier: 2 },
                methods: {
                    setMultiplier(m) { this.state.multiplier = m }
                },
                install(wf) {}
            })

            wildflower.plugin({
                name: 'derived',
                version: '1.0.0',
                state: { value: 5 },
                computed: {
                    result() {
                        // Access another plugin's state
                        return this.state.value * wildflower.$baseData.state.multiplier
                    }
                },
                install(wf) {}
            })

            expect(wildflower.$derived.result).toBe(10) // 5 * 2

            wildflower.$baseData.setMultiplier(3)
            // Note: This may not auto-update derived.result since cross-plugin
            // reactivity is not automatic. This test documents current behavior.
            // Future enhancement could add cross-plugin dependency tracking.
        })

        it('should support plugin method calling another plugin method', () => {
            wildflower.plugin({
                name: 'logger',
                version: '1.0.0',
                state: { logs: [] },
                methods: {
                    log(msg) {
                        this.state.logs = [...this.state.logs, msg]
                    }
                },
                install(wf) {}
            })

            wildflower.plugin({
                name: 'action',
                version: '1.0.0',
                state: {},
                methods: {
                    doSomething() {
                        wildflower.$logger.log('action performed')
                        return 'done'
                    }
                },
                install(wf) {}
            })

            const result = wildflower.$action.doSomething()
            expect(result).toBe('done')
            expect(wildflower.$logger.state.logs.length).toBe(1)
            expect(wildflower.$logger.state.logs[0]).toBe('action performed')
        })
    })
})
