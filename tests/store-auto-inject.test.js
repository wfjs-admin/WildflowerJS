/**
 * Test suite for auto-injected stores feature
 *
 * When a component declares `subscribe: { storeName: [...] }`, the store
 * should be automatically available via `this.stores.storeName` without
 * needing to call `wildflower.getStore('storeName')` repeatedly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, waitForCompleteRender, isMinifiedBuild} from './helpers/load-framework.js'

describe('Store Auto-Injection', () => {
    let testContainer
    let wildflower

    beforeEach(async () => {
        await resetFramework()
        wildflower = await loadFramework()
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(async () => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
        await resetFramework()
    })

    describe('Basic Functionality', () => {
        it('should inject subscribed store onto this.stores', async () => {
            let capturedStores = null

            wildflower.store('testStore', {
                state: { value: 42 }
            })

            wildflower.component('test-comp', {
                state: {},
                subscribe: {
                    testStore: ['value']
                },
                init() {
                    capturedStores = this.stores
                }
            })

            testContainer.innerHTML = '<div data-component="test-comp"></div>'
            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()

            expect(capturedStores).toBeDefined()
            expect(capturedStores.testStore).toBeDefined()
            expect(capturedStores.testStore.state.value).toBe(42)
        })

        it('should provide access to store state', async () => {
            let storeValue = null

            wildflower.store('counter', {
                state: { count: 100 }
            })

            wildflower.component('counter-reader', {
                state: {},
                subscribe: {
                    counter: ['count']
                },
                init() {
                    storeValue = this.stores.counter.state.count
                }
            })

            testContainer.innerHTML = '<div data-component="counter-reader"></div>'
            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()

            expect(storeValue).toBe(100)
        })

        it.skipIf(isMinifiedBuild())('should provide access to store methods', async () => {
            let incrementWorked = false

            wildflower.store('counter', {
                state: { count: 0 },
                increment() {
                    this.state.count++
                }
            })

            wildflower.component('counter-incrementer', {
                state: {},
                subscribe: {
                    counter: ['count']
                },
                init() {
                    this.stores.counter.increment()
                    incrementWorked = this.stores.counter.state.count === 1
                }
            })

            testContainer.innerHTML = '<div data-component="counter-incrementer"></div>'
            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()

            expect(incrementWorked).toBe(true)
        })
    })

    describe('Lifecycle Availability', () => {
        it('should be available in beforeInit', async () => {
            let availableInBeforeInit = false

            wildflower.store('earlyStore', {
                state: { ready: true }
            })

            wildflower.component('early-access', {
                state: {},
                subscribe: {
                    earlyStore: ['ready']
                },
                beforeInit() {
                    availableInBeforeInit = this.stores &&
                        this.stores.earlyStore &&
                        this.stores.earlyStore.state.ready === true
                }
            })

            testContainer.innerHTML = '<div data-component="early-access"></div>'
            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()

            expect(availableInBeforeInit).toBe(true)
        })

        it('should be available in init', async () => {
            let availableInInit = false

            wildflower.store('initStore', {
                state: { initialized: true }
            })

            wildflower.component('init-access', {
                state: {},
                subscribe: {
                    initStore: ['initialized']
                },
                init() {
                    availableInInit = this.stores &&
                        this.stores.initStore &&
                        this.stores.initStore.state.initialized === true
                }
            })

            testContainer.innerHTML = '<div data-component="init-access"></div>'
            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()

            expect(availableInInit).toBe(true)
        })

        it('should be available in computed properties', async () => {
            wildflower.store('dataStore', {
                state: { items: ['a', 'b', 'c'] }
            })

            wildflower.component('computed-access', {
                state: {},
                subscribe: {
                    dataStore: ['items']
                },
                computed: {
                    itemCount() {
                        return this.stores.dataStore.state.items.length
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-access">
                    <span data-bind="computed:itemCount"></span>
                </div>
            `
            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 50))

            const span = testContainer.querySelector('span')
            expect(span.textContent).toBe('3')
        })

        it('should be available in action methods', async () => {
            let actionHadAccess = false

            wildflower.store('actionStore', {
                state: { data: 'test-data' }
            })

            wildflower.component('action-access', {
                state: {},
                subscribe: {
                    actionStore: ['data']
                },
                checkAccess() {
                    actionHadAccess = this.stores &&
                        this.stores.actionStore &&
                        this.stores.actionStore.state.data === 'test-data'
                }
            })

            testContainer.innerHTML = `
                <div data-component="action-access">
                    <button data-action="checkAccess">Check</button>
                </div>
            `
            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()

            const button = testContainer.querySelector('button')
            button.click()
            await new Promise(r => setTimeout(r, 50))

            expect(actionHadAccess).toBe(true)
        })

        it('should be available in onStoreUpdate', async () => {
            let accessInOnStoreUpdate = false

            wildflower.store('updateStore', {
                state: { value: 1 },
                setValue(v) {
                    this.state.value = v
                }
            })

            wildflower.component('update-access', {
                state: {},
                subscribe: {
                    updateStore: ['value']
                },
                onStoreUpdate(storeName, path, newValue) {
                    if (storeName === 'updateStore' && path === 'value') {
                        accessInOnStoreUpdate = this.stores &&
                            this.stores.updateStore &&
                            this.stores.updateStore.state.value === newValue
                    }
                }
            })

            testContainer.innerHTML = '<div data-component="update-access"></div>'
            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()

            // Trigger store update
            wildflower.getStore('updateStore').setValue(999)
            await new Promise(r => setTimeout(r, 100))

            expect(accessInOnStoreUpdate).toBe(true)
        })
    })

    describe('Multiple Stores', () => {
        it('should inject multiple subscribed stores', async () => {
            let storeAValue = null
            let storeBValue = null

            wildflower.store('storeA', {
                state: { a: 'alpha' }
            })

            wildflower.store('storeB', {
                state: { b: 'beta' }
            })

            wildflower.component('multi-store', {
                state: {},
                subscribe: {
                    storeA: ['a'],
                    storeB: ['b']
                },
                init() {
                    storeAValue = this.stores.storeA.state.a
                    storeBValue = this.stores.storeB.state.b
                }
            })

            testContainer.innerHTML = '<div data-component="multi-store"></div>'
            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()

            expect(storeAValue).toBe('alpha')
            expect(storeBValue).toBe('beta')
        })

        it('should only inject subscribed stores, not all stores', async () => {
            let storesKeys = null

            wildflower.store('subscribedStore', {
                state: { x: 1 }
            })

            wildflower.store('unsubscribedStore', {
                state: { y: 2 }
            })

            wildflower.component('selective-store', {
                state: {},
                subscribe: {
                    subscribedStore: ['x']
                },
                init() {
                    storesKeys = Object.keys(this.stores)
                }
            })

            testContainer.innerHTML = '<div data-component="selective-store"></div>'
            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()

            expect(storesKeys).toContain('subscribedStore')
            expect(storesKeys).not.toContain('unsubscribedStore')
        })
    })

    describe('Edge Cases', () => {
        it('should have empty this.stores object when no subscriptions', async () => {
            let storesObject = null

            wildflower.component('no-subscriptions', {
                state: {},
                init() {
                    storesObject = this.stores
                }
            })

            testContainer.innerHTML = '<div data-component="no-subscriptions"></div>'
            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()

            expect(storesObject).toBeDefined()
            expect(typeof storesObject).toBe('object')
            expect(Object.keys(storesObject).length).toBe(0)
        })

        it('should handle store that does not exist gracefully', async () => {
            let errorThrown = false
            let storesObject = null

            wildflower.component('missing-store', {
                state: {},
                subscribe: {
                    nonExistentStore: ['value']
                },
                init() {
                    try {
                        storesObject = this.stores
                    } catch (e) {
                        errorThrown = true
                    }
                }
            })

            testContainer.innerHTML = '<div data-component="missing-store"></div>'
            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()

            // Should not throw, but nonExistentStore should be null (getStore returns null for missing stores)
            expect(errorThrown).toBe(false)
            expect(storesObject).toBeDefined()
            expect(storesObject.nonExistentStore).toBeNull()
        })

        it('should update this.stores when store is created after component', async () => {
            let storeAvailableLater = false

            wildflower.component('late-store', {
                state: {},
                subscribe: {
                    lateStore: ['value']
                },
                checkStore() {
                    storeAvailableLater = this.stores &&
                        this.stores.lateStore &&
                        this.stores.lateStore.state.value === 'late-value'
                }
            })

            testContainer.innerHTML = `
                <div data-component="late-store">
                    <button data-action="checkStore">Check</button>
                </div>
            `
            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()

            // Create store AFTER component initialization
            wildflower.store('lateStore', {
                state: { value: 'late-value' }
            })

            await new Promise(r => setTimeout(r, 50))

            const button = testContainer.querySelector('button')
            button.click()
            await new Promise(r => setTimeout(r, 50))

            expect(storeAvailableLater).toBe(true)
        })

        it('should work with stores in child components inside lists', async () => {
            let childStoreAccess = []

            wildflower.store('listStore', {
                state: {
                    items: [{ id: 1 }, { id: 2 }],
                    sharedValue: 'shared'
                }
            })

            wildflower.component('list-child', {
                state: {},
                subscribe: {
                    listStore: ['sharedValue']
                },
                init() {
                    if (this.stores && this.stores.listStore) {
                        childStoreAccess.push(this.stores.listStore.state.sharedValue)
                    }
                }
            })

            wildflower.component('list-parent', {
                state: {},
                computed: {
                    items() {
                        return wildflower.getStore('listStore').state.items
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="list-parent">
                    <div data-list="computed:items" data-key="id">
                        <template>
                            <div data-component="list-child"></div>
                        </template>
                    </div>
                </div>
            `
            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()
            await new Promise(r => setTimeout(r, 150))

            expect(childStoreAccess.length).toBe(2)
            expect(childStoreAccess[0]).toBe('shared')
            expect(childStoreAccess[1]).toBe('shared')
        })

        it('should maintain store reference integrity (same object)', async () => {
            let storeFromStores = null
            let storeFromGetStore = null

            wildflower.store('refStore', {
                state: { test: true }
            })

            wildflower.component('ref-check', {
                state: {},
                subscribe: {
                    refStore: ['test']
                },
                init() {
                    storeFromStores = this.stores.refStore
                    storeFromGetStore = wildflower.getStore('refStore')
                }
            })

            testContainer.innerHTML = '<div data-component="ref-check"></div>'
            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()

            expect(storeFromStores).toBe(storeFromGetStore)
        })
    })

    describe('Reactivity', () => {
        it('should reflect store state changes through this.stores', async () => {
            wildflower.store('reactiveStore', {
                state: { count: 0 },
                increment() {
                    this.state.count++
                }
            })

            let countAfterIncrement = null

            wildflower.component('reactive-check', {
                state: {},
                subscribe: {
                    reactiveStore: ['count']
                },
                onStoreUpdate() {
                    countAfterIncrement = this.stores.reactiveStore.state.count
                }
            })

            testContainer.innerHTML = '<div data-component="reactive-check"></div>'
            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()

            wildflower.getStore('reactiveStore').increment()
            await new Promise(r => setTimeout(r, 100))

            expect(countAfterIncrement).toBe(1)
        })
    })

    describe('Potential Conflicts', () => {
        it('should handle store with name "state" without conflicting with this.state', async () => {
            // A store named "state" should be accessible via this.stores.state
            // and should NOT conflict with this.state (component state)
            let componentState = null
            let storeState = null

            wildflower.store('state', {
                state: { storeValue: 'from-store' }
            })

            wildflower.component('state-conflict-test', {
                state: {
                    componentValue: 'from-component'
                },
                subscribe: {
                    state: ['storeValue']
                },
                init() {
                    componentState = this.state.componentValue
                    storeState = this.stores.state.state.storeValue
                }
            })

            testContainer.innerHTML = '<div data-component="state-conflict-test"></div>'
            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()

            expect(componentState).toBe('from-component')
            expect(storeState).toBe('from-store')
        })

        it('should handle store with name "computed" without conflicting with this.computed', async () => {
            let computedResult = null
            let storeValue = null

            wildflower.store('computed', {
                state: { value: 'store-computed' }
            })

            wildflower.component('computed-conflict-test', {
                state: { base: 10 },
                subscribe: {
                    computed: ['value']
                },
                computed: {
                    doubled() {
                        return this.state.base * 2
                    }
                },
                init() {
                    computedResult = this.computed.doubled
                    storeValue = this.stores.computed.state.value
                }
            })

            testContainer.innerHTML = '<div data-component="computed-conflict-test"></div>'
            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()

            expect(computedResult).toBe(20)
            expect(storeValue).toBe('store-computed')
        })
    })

    describe('Dynamic Subscription', () => {
        it('should NOT auto-inject stores subscribed dynamically (documents expected behavior)', async () => {
            // If a component subscribes to a store dynamically (not via subscribe: {}),
            // that store should NOT be auto-injected to this.stores.
            // This test documents the expected behavior: only declarative subscriptions
            // get auto-injected.

            let storesKeys = null

            wildflower.store('declarativeStore', {
                state: { d: 1 }
            })

            wildflower.store('dynamicStore', {
                state: { e: 2 }
            })

            wildflower.component('dynamic-sub-test', {
                state: {},
                subscribe: {
                    declarativeStore: ['d']
                },
                init() {
                    // Dynamically subscribe to another store
                    const dynStore = wildflower.getStore('dynamicStore')
                    if (dynStore && dynStore.subscribe) {
                        dynStore.subscribe('e', () => {})
                    }

                    // Capture stores keys after dynamic subscription
                    storesKeys = Object.keys(this.stores)
                }
            })

            testContainer.innerHTML = '<div data-component="dynamic-sub-test"></div>'
            wildflower._scanForDynamicComponents()
            await waitForCompleteRender()

            // Only declarative subscription should be in this.stores
            expect(storesKeys).toContain('declarativeStore')
            expect(storesKeys).not.toContain('dynamicStore')
        })
    })
})
