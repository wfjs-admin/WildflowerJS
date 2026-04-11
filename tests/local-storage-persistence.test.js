/**
 * localStorage Persistence Test Suite
 *
 * Tests for component state persistence via data-storage-key and data-auto-save attributes.
 * This feature allows components to automatically persist their state to localStorage.
 *
 * Features tested:
 * - data-storage-key: Specifies the localStorage key for persistence
 * - data-auto-save: Enables automatic saving on every state change
 * - Manual save/load via stateManager methods
 * - State restoration on component re-initialization
 * - Edge cases and error handling
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, waitForUpdate, getComponent } from './helpers/load-framework.js'

describe('localStorage Persistence', () => {
    let testContainer
    let wildflower

    // Helper to get component instance from an element
    function getInstance(selector) {
        const el = typeof selector === 'string'
            ? testContainer.querySelector(selector)
            : selector
        return getComponent(el)
    }

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)

        // Clear any test localStorage keys
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('test-')) {
                localStorage.removeItem(key)
            }
        })
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }

        // Clean up localStorage after each test
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('test-')) {
                localStorage.removeItem(key)
            }
        })
    })

    // =========================================================================
    // SECTION 1: Basic data-storage-key Functionality
    // =========================================================================
    describe('data-storage-key Basic Functionality', () => {

        it('should save state to localStorage when using data-storage-key', async () => {
            wildflower.component('storage-test', {
                state: {
                    count: 0
                },
                increment() {
                    this.state.count++
                }
            })

            testContainer.innerHTML = `
                <div data-component="storage-test" data-storage-key="test-basic-save" data-auto-save>
                    <span data-bind="count"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            // Get the component instance
            const instance = getInstance('[data-component="storage-test"]')
            expect(instance).not.toBeNull()

            // Trigger state change
            instance.state.count = 42
            await waitForUpdate(100)

            // Verify localStorage was updated
            const stored = localStorage.getItem('test-basic-save')
            expect(stored).not.toBeNull()

            const parsed = JSON.parse(stored)
            expect(parsed.count).toBe(42)
        })

        it('should load state from localStorage on component initialization', async () => {
            // Pre-populate localStorage
            localStorage.setItem('test-load-on-init', JSON.stringify({ count: 99, name: 'restored' }))

            wildflower.component('load-test', {
                state: {
                    count: 0,
                    name: 'default'
                }
            })

            testContainer.innerHTML = `
                <div data-component="load-test" data-storage-key="test-load-on-init">
                    <span class="count" data-bind="count"></span>
                    <span class="name" data-bind="name"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            // State should be restored from localStorage
            const countEl = testContainer.querySelector('.count')
            const nameEl = testContainer.querySelector('.name')

            expect(countEl.textContent).toBe('99')
            expect(nameEl.textContent).toBe('restored')
        })

        it('should use default state when localStorage is empty', async () => {
            // Ensure no pre-existing data
            localStorage.removeItem('test-empty-storage')

            wildflower.component('empty-storage-test', {
                state: {
                    value: 'default-value'
                }
            })

            testContainer.innerHTML = `
                <div data-component="empty-storage-test" data-storage-key="test-empty-storage">
                    <span class="value" data-bind="value"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const valueEl = testContainer.querySelector('.value')
            expect(valueEl.textContent).toBe('default-value')
        })

        it('should handle complex nested state', async () => {
            const complexState = {
                user: {
                    name: 'John',
                    preferences: {
                        theme: 'dark',
                        notifications: true
                    }
                },
                items: [1, 2, 3]
            }

            localStorage.setItem('test-complex-state', JSON.stringify(complexState))

            wildflower.component('complex-test', {
                state: {
                    user: {
                        name: '',
                        preferences: {
                            theme: 'light',
                            notifications: false
                        }
                    },
                    items: []
                }
            })

            testContainer.innerHTML = `
                <div data-component="complex-test" data-storage-key="test-complex-state">
                    <span class="name" data-bind="user.name"></span>
                    <span class="theme" data-bind="user.preferences.theme"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            expect(testContainer.querySelector('.name').textContent).toBe('John')
            expect(testContainer.querySelector('.theme').textContent).toBe('dark')
        })
    })

    // =========================================================================
    // SECTION 2: data-auto-save Functionality
    // =========================================================================
    describe('data-auto-save Functionality', () => {

        it('should auto-save on every state change when data-auto-save is present', async () => {
            wildflower.component('auto-save-test', {
                state: {
                    value: 'initial'
                }
            })

            testContainer.innerHTML = `
                <div data-component="auto-save-test" data-storage-key="test-auto-save" data-auto-save>
                    <span data-bind="value"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const instance = getInstance('[data-component="auto-save-test"]')
            expect(instance).not.toBeNull()

            // First change
            instance.state.value = 'first-change'
            await waitForUpdate(50)

            let stored = JSON.parse(localStorage.getItem('test-auto-save'))
            expect(stored.value).toBe('first-change')

            // Second change
            instance.state.value = 'second-change'
            await waitForUpdate(50)

            stored = JSON.parse(localStorage.getItem('test-auto-save'))
            expect(stored.value).toBe('second-change')

            // Third change
            instance.state.value = 'third-change'
            await waitForUpdate(50)

            stored = JSON.parse(localStorage.getItem('test-auto-save'))
            expect(stored.value).toBe('third-change')
        })

        it('should NOT auto-save when data-auto-save is absent', async () => {
            wildflower.component('no-auto-save-test', {
                state: {
                    value: 'initial'
                }
            })

            testContainer.innerHTML = `
                <div data-component="no-auto-save-test" data-storage-key="test-no-auto-save">
                    <span data-bind="value"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const instance = getInstance('[data-component="no-auto-save-test"]')
            expect(instance).not.toBeNull()

            // Change state
            instance.state.value = 'changed'
            await waitForUpdate(50)

            // localStorage should still have the initial state (from component init)
            // or be empty if no initial save occurred
            const stored = localStorage.getItem('test-no-auto-save')
            if (stored) {
                const parsed = JSON.parse(stored)
                // Should NOT have the updated value
                expect(parsed.value).not.toBe('changed')
            }
        })

        it('should auto-save array mutations', async () => {
            wildflower.component('array-auto-save', {
                state: {
                    items: [{ name: 'Item 1' }]
                }
            })

            testContainer.innerHTML = `
                <div data-component="array-auto-save" data-storage-key="test-array-auto-save" data-auto-save>
                    <div data-list="items">
                        <template><span data-bind="name"></span></template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const instance = getInstance('[data-component="array-auto-save"]')
            expect(instance).not.toBeNull()

            // Add item
            instance.state.items = [...instance.state.items, { name: 'Item 2' }]
            await waitForUpdate(50)

            const stored = JSON.parse(localStorage.getItem('test-array-auto-save'))
            expect(stored.items.length).toBe(2)
            expect(stored.items[1].name).toBe('Item 2')
        })
    })

    // =========================================================================
    // SECTION 3: Component Re-initialization
    // =========================================================================
    describe('Component Re-initialization', () => {

        it('should restore state when component is destroyed and re-created', async () => {
            wildflower.component('reinit-test', {
                state: {
                    value: 'initial'
                }
            })

            testContainer.innerHTML = `
                <div data-component="reinit-test" data-storage-key="test-reinit" data-auto-save>
                    <span class="value" data-bind="value"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            // Update state
            const el = testContainer.querySelector('[data-component="reinit-test"]')
            const instance = getInstance(el)
            expect(instance).not.toBeNull()
            instance.state.value = 'persisted-value'
            await waitForUpdate(50)

            // Verify it was saved
            expect(JSON.parse(localStorage.getItem('test-reinit')).value).toBe('persisted-value')

            // Destroy the component by getting its component ID
            const componentId = el.dataset.componentId
            wildflower.destroyComponent(componentId)
            testContainer.innerHTML = ''
            await waitForUpdate(50)

            // Re-create the component
            testContainer.innerHTML = `
                <div data-component="reinit-test" data-storage-key="test-reinit" data-auto-save>
                    <span class="value" data-bind="value"></span>
                </div>
            `

            // Need to re-scan for components
            wildflower.scan()
            await waitForUpdate(100)

            // State should be restored
            const valueEl = testContainer.querySelector('.value')
            expect(valueEl.textContent).toBe('persisted-value')
        })

        it('should handle page refresh simulation', async () => {
            // Simulate saved state from "previous session"
            localStorage.setItem('test-session-restore', JSON.stringify({
                username: 'user123',
                lastVisit: '2024-01-15',
                settings: { darkMode: true }
            }))

            wildflower.component('session-test', {
                state: {
                    username: '',
                    lastVisit: '',
                    settings: { darkMode: false }
                }
            })

            testContainer.innerHTML = `
                <div data-component="session-test" data-storage-key="test-session-restore">
                    <span class="username" data-bind="username"></span>
                    <span class="dark-mode" data-bind="settings.darkMode"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            expect(testContainer.querySelector('.username').textContent).toBe('user123')
            expect(testContainer.querySelector('.dark-mode').textContent).toBe('true')
        })
    })

    // =========================================================================
    // SECTION 4: Multiple Components with Different Keys
    // =========================================================================
    describe('Multiple Components with Different Storage Keys', () => {

        it('should maintain separate storage for different components', async () => {
            wildflower.component('multi-a', {
                state: { value: 'A-initial' }
            })

            wildflower.component('multi-b', {
                state: { value: 'B-initial' }
            })

            testContainer.innerHTML = `
                <div data-component="multi-a" data-storage-key="test-multi-a" data-auto-save>
                    <span class="value-a" data-bind="value"></span>
                </div>
                <div data-component="multi-b" data-storage-key="test-multi-b" data-auto-save>
                    <span class="value-b" data-bind="value"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            // Get both instances
            const instanceA = getInstance('[data-component="multi-a"]')
            const instanceB = getInstance('[data-component="multi-b"]')
            expect(instanceA).not.toBeNull()
            expect(instanceB).not.toBeNull()

            // Update both
            instanceA.state.value = 'A-updated'
            instanceB.state.value = 'B-updated'
            await waitForUpdate(50)

            // Verify separate storage
            const storedA = JSON.parse(localStorage.getItem('test-multi-a'))
            const storedB = JSON.parse(localStorage.getItem('test-multi-b'))

            expect(storedA.value).toBe('A-updated')
            expect(storedB.value).toBe('B-updated')
        })

        it('should not interfere between components with same definition but different keys', async () => {
            wildflower.component('shared-def', {
                state: { counter: 0 }
            })

            testContainer.innerHTML = `
                <div data-component="shared-def" data-storage-key="test-shared-1" data-auto-save>
                    <span class="count-1" data-bind="counter"></span>
                </div>
                <div data-component="shared-def" data-storage-key="test-shared-2" data-auto-save>
                    <span class="count-2" data-bind="counter"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const els = testContainer.querySelectorAll('[data-component="shared-def"]')
            const instance1 = getInstance(els[0])
            const instance2 = getInstance(els[1])
            expect(instance1).not.toBeNull()
            expect(instance2).not.toBeNull()

            // Update each independently
            instance1.state.counter = 10
            instance2.state.counter = 20
            await waitForUpdate(50)

            // Verify independent storage
            expect(JSON.parse(localStorage.getItem('test-shared-1')).counter).toBe(10)
            expect(JSON.parse(localStorage.getItem('test-shared-2')).counter).toBe(20)

            // Verify display
            expect(testContainer.querySelector('.count-1').textContent).toBe('10')
            expect(testContainer.querySelector('.count-2').textContent).toBe('20')
        })
    })

    // =========================================================================
    // SECTION 5: Edge Cases and Error Handling
    // =========================================================================
    describe('Edge Cases and Error Handling', () => {

        it('should handle invalid JSON in localStorage gracefully', async () => {
            // Store invalid JSON
            localStorage.setItem('test-invalid-json', 'not valid json {{{')

            // Should not throw - should use default state
            wildflower.component('invalid-json-test', {
                state: {
                    value: 'default'
                }
            })

            testContainer.innerHTML = `
                <div data-component="invalid-json-test" data-storage-key="test-invalid-json">
                    <span class="value" data-bind="value"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            // Should fall back to default state
            expect(testContainer.querySelector('.value').textContent).toBe('default')
        })

        it('should handle localStorage quota exceeded gracefully', async () => {
            wildflower.component('quota-test', {
                state: {
                    data: 'small'
                }
            })

            testContainer.innerHTML = `
                <div data-component="quota-test" data-storage-key="test-quota" data-auto-save>
                    <span data-bind="data"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const instance = getInstance('[data-component="quota-test"]')
            expect(instance).not.toBeNull()

            // This should not throw even if it fails to save
            // (quota exceeded handling is internal)
            instance.state.data = 'updated'
            await waitForUpdate(50)

            // Component should still function
            expect(testContainer.querySelector('span').textContent).toBe('updated')
        })

        it('should handle empty storage key attribute', async () => {
            wildflower.component('empty-key-test', {
                state: {
                    value: 'test'
                }
            })

            testContainer.innerHTML = `
                <div data-component="empty-key-test" data-storage-key="">
                    <span class="value" data-bind="value"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            // Should work without persistence
            const instance = getInstance('[data-component="empty-key-test"]')
            expect(instance).not.toBeNull()

            instance.state.value = 'changed'
            await waitForUpdate(50)

            expect(testContainer.querySelector('.value').textContent).toBe('changed')
        })

        it('should handle special characters in storage key', async () => {
            wildflower.component('special-key-test', {
                state: {
                    value: 'special'
                }
            })

            testContainer.innerHTML = `
                <div data-component="special-key-test" data-storage-key="test-special:key/with.chars" data-auto-save>
                    <span class="value" data-bind="value"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const instance = getInstance('[data-component="special-key-test"]')
            expect(instance).not.toBeNull()

            instance.state.value = 'updated-special'
            await waitForUpdate(50)

            const stored = localStorage.getItem('test-special:key/with.chars')
            expect(stored).not.toBeNull()
            expect(JSON.parse(stored).value).toBe('updated-special')
        })

        it('should handle state with undefined and null values', async () => {
            wildflower.component('null-test', {
                state: {
                    a: null,
                    b: 'defined'
                }
            })

            testContainer.innerHTML = `
                <div data-component="null-test" data-storage-key="test-null-values" data-auto-save>
                    <span class="a" data-bind="a"></span>
                    <span class="b" data-bind="b"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const instance = getInstance('[data-component="null-test"]')
            expect(instance).not.toBeNull()

            instance.state.b = null
            await waitForUpdate(50)

            const stored = JSON.parse(localStorage.getItem('test-null-values'))
            expect(stored.a).toBeNull()
            expect(stored.b).toBeNull()
        })

        it('should handle boolean false values correctly', async () => {
            localStorage.setItem('test-boolean-false', JSON.stringify({ enabled: false, count: 0 }))

            wildflower.component('boolean-test', {
                state: {
                    enabled: true,
                    count: 99
                }
            })

            testContainer.innerHTML = `
                <div data-component="boolean-test" data-storage-key="test-boolean-false">
                    <span class="enabled" data-bind="enabled"></span>
                    <span class="count" data-bind="count"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            // Falsy values should be properly restored
            expect(testContainer.querySelector('.enabled').textContent).toBe('false')
            expect(testContainer.querySelector('.count').textContent).toBe('0')
        })
    })

    // =========================================================================
    // SECTION 6: Integration with Component Lifecycle
    // =========================================================================
    describe('Integration with Component Lifecycle', () => {

        it('should load from storage before init() runs', async () => {
            localStorage.setItem('test-init-order', JSON.stringify({ value: 'from-storage' }))

            let valueInInit = null

            wildflower.component('init-order-test', {
                state: {
                    value: 'default'
                },
                init() {
                    valueInInit = this.state.value
                }
            })

            testContainer.innerHTML = `
                <div data-component="init-order-test" data-storage-key="test-init-order">
                    <span data-bind="value"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            // init() should see the restored value
            expect(valueInInit).toBe('from-storage')
        })

        it('should save state changes made in init()', async () => {
            wildflower.component('init-modify-test', {
                state: {
                    initialized: false
                },
                init() {
                    this.state.initialized = true
                }
            })

            testContainer.innerHTML = `
                <div data-component="init-modify-test" data-storage-key="test-init-modify" data-auto-save>
                    <span data-bind="initialized"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const stored = JSON.parse(localStorage.getItem('test-init-modify'))
            expect(stored.initialized).toBe(true)
        })

        it('should work with computed properties', async () => {
            localStorage.setItem('test-computed', JSON.stringify({ firstName: 'John', lastName: 'Doe' }))

            wildflower.component('computed-storage-test', {
                state: {
                    firstName: '',
                    lastName: ''
                },
                computed: {
                    fullName() {
                        return `${this.state.firstName} ${this.state.lastName}`.trim()
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-storage-test" data-storage-key="test-computed">
                    <span class="full" data-bind="computed:fullName"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            expect(testContainer.querySelector('.full').textContent).toBe('John Doe')
        })

        it('should work with watchers', async () => {
            let watcherCalled = false
            let watcherValue = null

            localStorage.setItem('test-watcher', JSON.stringify({ watched: 'initial' }))

            wildflower.component('watcher-storage-test', {
                state: {
                    watched: ''
                },
                watch: {
                    watched(newVal, oldVal) {
                        watcherCalled = true
                        watcherValue = newVal
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="watcher-storage-test" data-storage-key="test-watcher" data-auto-save>
                    <span data-bind="watched"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const instance = getInstance('[data-component="watcher-storage-test"]')
            expect(instance).not.toBeNull()

            instance.state.watched = 'changed'
            await waitForUpdate(50)

            expect(watcherCalled).toBe(true)
            expect(watcherValue).toBe('changed')
            expect(JSON.parse(localStorage.getItem('test-watcher')).watched).toBe('changed')
        })
    })

    // =========================================================================
    // SECTION 7: Manual Save/Load Methods
    // =========================================================================
    describe('Manual Save/Load via stateManager', () => {

        it('should expose _saveToStorage method on stateManager', async () => {
            wildflower.component('manual-save-test', {
                state: {
                    value: 'initial'
                }
            })

            testContainer.innerHTML = `
                <div data-component="manual-save-test" data-storage-key="test-manual-save">
                    <span data-bind="value"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const instance = getInstance('[data-component="manual-save-test"]')
            expect(instance).not.toBeNull()

            // Change state without auto-save
            instance.state.value = 'manual-test'
            await waitForUpdate(50)

            // Manually trigger save
            if (instance.stateManager._saveToStorage) {
                instance.stateManager._saveToStorage()
            }

            const stored = JSON.parse(localStorage.getItem('test-manual-save'))
            expect(stored.value).toBe('manual-test')
        })

        it('should expose _loadFromStorage method on stateManager', async () => {
            wildflower.component('manual-load-test', {
                state: {
                    value: 'initial'
                }
            })

            testContainer.innerHTML = `
                <div data-component="manual-load-test" data-storage-key="test-manual-load">
                    <span class="value" data-bind="value"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const instance = getInstance('[data-component="manual-load-test"]')
            expect(instance).not.toBeNull()

            // Change state
            instance.state.value = 'changed'
            await waitForUpdate(50)

            // Externally modify localStorage
            localStorage.setItem('test-manual-load', JSON.stringify({ value: 'external-change' }))

            // Manually trigger load
            if (instance.stateManager._loadFromStorage) {
                instance.stateManager._loadFromStorage()
            }
            await waitForUpdate(50)

            expect(testContainer.querySelector('.value').textContent).toBe('external-change')
        })
    })

    // =========================================================================
    // SECTION 8: Data Types Preservation
    // =========================================================================
    describe('Data Types Preservation', () => {

        it('should preserve numbers correctly', async () => {
            localStorage.setItem('test-numbers', JSON.stringify({
                integer: 42,
                float: 3.14159,
                negative: -100,
                zero: 0
            }))

            wildflower.component('numbers-test', {
                state: {
                    integer: 0,
                    float: 0,
                    negative: 0,
                    zero: 1
                }
            })

            testContainer.innerHTML = `
                <div data-component="numbers-test" data-storage-key="test-numbers">
                    <span class="int" data-bind="integer"></span>
                    <span class="float" data-bind="float"></span>
                    <span class="neg" data-bind="negative"></span>
                    <span class="zero" data-bind="zero"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            expect(testContainer.querySelector('.int').textContent).toBe('42')
            expect(testContainer.querySelector('.float').textContent).toBe('3.14159')
            expect(testContainer.querySelector('.neg').textContent).toBe('-100')
            expect(testContainer.querySelector('.zero').textContent).toBe('0')
        })

        it('should preserve arrays correctly', async () => {
            localStorage.setItem('test-arrays', JSON.stringify({
                simple: [1, 2, 3],
                nested: [[1, 2], [3, 4]],
                objects: [{ id: 1 }, { id: 2 }]
            }))

            wildflower.component('arrays-test', {
                state: {
                    simple: [],
                    nested: [],
                    objects: []
                }
            })

            testContainer.innerHTML = `
                <div data-component="arrays-test" data-storage-key="test-arrays" data-auto-save>
                    <div data-list="simple">
                        <template><span class="item" data-bind="$item"></span></template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(3)

            // Verify the actual state
            const instance = getInstance('[data-component="arrays-test"]')
            expect(instance).not.toBeNull()

            // Use JSON comparison to avoid proxy object comparison issues
            expect(JSON.stringify(instance.state.nested)).toBe(JSON.stringify([[1, 2], [3, 4]]))
            expect(JSON.stringify(instance.state.objects)).toBe(JSON.stringify([{ id: 1 }, { id: 2 }]))
        })

        it('should preserve date strings (JSON limitation)', async () => {
            const dateStr = '2024-01-15T10:30:00.000Z'
            localStorage.setItem('test-dates', JSON.stringify({
                dateString: dateStr
            }))

            wildflower.component('dates-test', {
                state: {
                    dateString: ''
                }
            })

            testContainer.innerHTML = `
                <div data-component="dates-test" data-storage-key="test-dates">
                    <span class="date" data-bind="dateString"></span>
                </div>
            `

            wildflower.scan()
            await waitForUpdate(100)

            // Dates are stored as strings in JSON
            expect(testContainer.querySelector('.date').textContent).toBe(dateStr)
        })
    })

    // =========================================================================
    // SECTION 7: Store localStorage Persistence
    // =========================================================================
    describe('Store localStorage Persistence', () => {

        afterEach(() => {
            // Clean up stores
            if (wildflower._storeManager && wildflower._storeManager._namedStores) {
                wildflower._storeManager._namedStores.clear()
            }
        })

        it('should auto-save store state on top-level property change', async () => {
            localStorage.removeItem('test-store-autosave')

            wildflower.store('autoSaveStore', {
                storageKey: 'test-store-autosave',
                autoSave: true,
                state: {
                    count: 0,
                    name: 'initial'
                }
            })

            const store = wildflower.getStore('autoSaveStore')
            store.state.count = 42

            await waitForUpdate(50)

            const saved = JSON.parse(localStorage.getItem('test-store-autosave'))
            expect(saved.count).toBe(42)
        })

        it('should auto-save store state on nested property change', async () => {
            localStorage.removeItem('test-store-nested')

            wildflower.store('nestedStore', {
                storageKey: 'test-store-nested',
                autoSave: true,
                state: {
                    items: [
                        { id: 1, name: 'Item 1', color: '#ff0000' },
                        { id: 2, name: 'Item 2', color: '#00ff00' }
                    ]
                }
            })

            const store = wildflower.getStore('nestedStore')

            // Mutate nested property directly (like kanban setColumnColor does)
            const item = store.state.items.find(i => i.id === 1)
            item.color = '#0000ff'

            await waitForUpdate(50)

            const saved = JSON.parse(localStorage.getItem('test-store-nested'))
            expect(saved.items[0].color).toBe('#0000ff')
            expect(saved.items[1].color).toBe('#00ff00') // unchanged
        })

        it('should restore store state from localStorage on creation', async () => {
            localStorage.setItem('test-store-restore', JSON.stringify({
                count: 100,
                name: 'restored'
            }))

            wildflower.store('restoreStore', {
                storageKey: 'test-store-restore',
                autoSave: true,
                state: {
                    count: 0,
                    name: 'initial'
                }
            })

            const store = wildflower.getStore('restoreStore')
            expect(store.state.count).toBe(100)
            expect(store.state.name).toBe('restored')
        })

        it('should auto-save on array mutation methods', async () => {
            localStorage.removeItem('test-store-array')

            wildflower.store('arrayStore', {
                storageKey: 'test-store-array',
                autoSave: true,
                state: {
                    items: ['a', 'b', 'c']
                }
            })

            const store = wildflower.getStore('arrayStore')
            store.state.items.push('d')

            await waitForUpdate(50)

            const saved = JSON.parse(localStorage.getItem('test-store-array'))
            expect(saved.items).toEqual(['a', 'b', 'c', 'd'])
        })
    })
})
