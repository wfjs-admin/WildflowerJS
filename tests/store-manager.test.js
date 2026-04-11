/**
 * WildflowerJS Store Manager Test Suite - Vitest Browser Mode
 *
 * Tests for storeManager and store watch functionality.
 * Migrated from unitTestSuite.js Store Manager and Store Watch sections.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Store Manager', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    // Re-initialize the context system
    if (wildflower._initContextSystem) {
      wildflower._contextSystemInitialized = false
      wildflower._initContextSystem()
    }

    // Create test container
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

  describe('Basic Store Operations', () => {
    it('creates basic store component', async () => {
      const store = wildflower.storeManager.createStoreComponent('test-store', {
        state: {
          count: 0,
          message: 'hello'
        }
      })

      expect(store).toBeDefined()
      expect(store.state.count).toBe(0)
      expect(store.state.message).toBe('hello')
      expect(store.isVirtual).toBe(true)

      // Verify store has required properties
      expect(store.stateManager).toBeDefined()
      expect(store.context).toBeDefined()
      expect(typeof store.context.update).toBe('function')
      expect(typeof store.context.reset).toBe('function')
    })

    it('store with computed properties', async () => {
      const store = wildflower.storeManager.createStoreComponent('computed-store', {
        state: {
          firstName: 'John',
          lastName: 'Doe'
        },
        computed: {
          fullName() {
            return `${this.state.firstName} ${this.state.lastName}`
          }
        }
      })

      const computed = store.stateManager.evaluateComputed('fullName')
      expect(computed).toBe('John Doe')

      // Update and re-evaluate
      store.state.firstName = 'Jane'
      await waitForUpdate()

      const updated = store.stateManager.evaluateComputed('fullName')
      expect(updated).toBe('Jane Doe')
    })

    it('store with context update method', async () => {
      const store = wildflower.storeManager.createStoreComponent('update-store', {
        state: {
          x: 1,
          y: 2
        }
      })

      // Single update
      store.context.update('x', 10)
      await waitForUpdate()
      expect(store.state.x).toBe(10)

      // Batch update
      store.context.update({ x: 20, y: 30 })
      await waitForUpdate()
      expect(store.state.x).toBe(20)
      expect(store.state.y).toBe(30)
    })

    it('store with reset functionality', async () => {
      const store = wildflower.storeManager.createStoreComponent('reset-store', {
        state: {
          counter: 0,
          name: 'test'
        }
      })

      // Modify state
      store.state.counter = 100
      store.state.name = 'modified'
      await waitForUpdate()

      // Reset
      store.context.reset()
      await waitForUpdate()

      expect(store.state.counter).toBe(0)
      expect(store.state.name).toBe('test')
    })

    it('store with init hook', async () => {
      let initCalled = false

      const store = wildflower.storeManager.createStoreComponent('init-store', {
        state: {
          initialized: false
        },
        init() {
          initCalled = true
          this.state.initialized = true
        }
      })

      await waitForUpdate()

      expect(initCalled).toBe(true)
      expect(store.state.initialized).toBe(true)
    })
  })

  describe('Store Readiness', () => {
    it('createStore with readiness protocol', async () => {
      const store = wildflower.storeManager.store('ready-store', {
        state: {
          data: null
        }
      })

      await waitForUpdate()

      expect(store.isReady()).toBe(true)
      expect(store.state._internal.ready).toBe(true)
    })

    it('store isReady and waitForReady', async () => {
      const store = wildflower.storeManager.createStoreComponent('wait-store', {
        state: {
          _internal: {
            ready: false
          },
          value: 0
        }
      })

      expect(store.context.isReady()).toBe(false)

      // Set ready after delay
      setTimeout(() => {
        store.state._internal.ready = true
      }, 100)

      // Wait for ready
      await store.context.waitForReady()
      expect(store.context.isReady()).toBe(true)
    })
  })

  describe('Store Actions', () => {
    it('createStore with actions (unified paradigm - methods at top level)', async () => {
      // NEW PARADIGM: Methods are at top level, not in actions/methods blocks
      const store = wildflower.storeManager.store('action-store', {
        state: {
          count: 0,
          app: {
            isLoading: false,
            actions: {}
          }
        },
        // Methods at top level - bound BEFORE init()
        async increment() {
          this.state.count++
          return this.state.count
        }
      })

      await waitForUpdate()

      const result = await store.increment()
      await waitForUpdate()

      expect(result).toBe(1)
      expect(store.state.count).toBe(1)
    })
  })

  describe('External API', () => {
    it('external() API for cross-store access', async () => {
      const store1 = wildflower.storeManager.createStoreComponent('store-1', {
        state: {
          value: 42
        }
      })

      const store2 = wildflower.storeManager.createStoreComponent('store-2', {
        state: {
          otherValue: 0
        }
      })

      await waitForUpdate()

      // Access store1 from store2
      const externalValue = store2.context.external('store-1', 'value')
      expect(externalValue).toBe(42)
    })

    it('external() with computed properties', async () => {
      const store1 = wildflower.storeManager.createStoreComponent('computed-store-1', {
        state: {
          a: 10,
          b: 20
        },
        computed: {
          sum() {
            return this.state.a + this.state.b
          }
        }
      })

      const store2 = wildflower.storeManager.createStoreComponent('computed-store-2', {
        state: {
          result: 0
        }
      })

      await waitForUpdate()

      const computedValue = store2.context.external('computed-store-1', 'computed:sum')
      expect(computedValue).toBe(30)
    })

    it('external() with non-existent store', async () => {
      const store = wildflower.storeManager.createStoreComponent('safe-store', {
        state: {
          value: 0
        }
      })

      await waitForUpdate()

      const result = store.context.external('non-existent-store', 'value')
      expect(result).toBeNull()

      const computedResult = store.context.external('non-existent-store', 'computed:value')
      expect(computedResult).toBe(0)
    })
  })

  describe('Store Subscriptions', () => {
    it('store subscribe to state changes', async () => {
      const store = wildflower.storeManager.createStoreComponent('subscribe-store', {
        state: {
          count: 0,
          _internal: {
            ready: true
          }
        }
      })

      await waitForUpdate()

      let callCount = 0
      let lastValue = null

      const unsubscribe = store.context.subscribe('count', (value) => {
        callCount++
        lastValue = value
      })

      // Trigger change
      store.state.count = 5
      await waitForUpdate()

      expect(callCount).toBe(1)
      expect(lastValue).toBe(5)

      // Unsubscribe
      unsubscribe()
      store.state.count = 10
      await waitForUpdate()

      expect(callCount).toBe(1) // Should not increase
    })

    it('subscribe with immediate option', async () => {
      const store = wildflower.storeManager.createStoreComponent('immediate-store', {
        state: {
          value: 100,
          _internal: {
            ready: true
          }
        }
      })

      await waitForUpdate()

      let receivedValue = null

      store.context.subscribe('value', (value) => {
        receivedValue = value
      }, { immediate: true })

      await waitForUpdate()

      expect(receivedValue).toBe(100)
    })

    it('subscribe only triggers when store is ready', async () => {
      const store = wildflower.storeManager.createStoreComponent('not-ready-store', {
        state: {
          value: 0,
          _internal: {
            ready: false
          }
        }
      })

      await waitForUpdate()

      let callCount = 0

      store.context.subscribe('value', (value) => {
        callCount++
      })

      // Change value while not ready
      store.state.value = 5
      await waitForUpdate()

      expect(callCount).toBe(0)

      // Mark as ready
      store.state._internal.ready = true
      await waitForUpdate()

      // Change value when ready
      store.state.value = 10
      await waitForUpdate()

      expect(callCount).toBe(1)
    })
  })

  describe('Store Retrieval', () => {
    it('getStoreByName retrieves named stores', async () => {
      const store = wildflower.storeManager.store('named-store', {
        state: {
          id: 'test123'
        }
      })

      await waitForUpdate()

      const retrieved = wildflower.storeManager.getStoreByName('named-store')
      expect(retrieved).toBeDefined()
      expect(retrieved.state.id).toBe('test123')
    })

    it('multiple stores can coexist', async () => {
      const userStore = wildflower.storeManager.store('user-store', {
        state: {
          name: 'Alice',
          app: {
            isLoading: false,
            actions: {}
          }
        }
      })

      const cartStore = wildflower.storeManager.store('cart-store', {
        state: {
          items: [],
          app: {
            isLoading: false,
            actions: {}
          }
        }
      })

      await waitForUpdate()

      expect(userStore.state.name).toBe('Alice')
      expect(cartStore.state.items.length).toBe(0)

      // Modify one shouldn't affect the other
      userStore.state.name = 'Bob'
      await waitForUpdate()

      expect(cartStore.state.items.length).toBe(0)
    })
  })

  describe('Store Lifecycle', () => {
    it('store lifecycle - creation to cleanup', async () => {
      const store = wildflower.storeManager.createStoreComponent('lifecycle-store', {
        state: {
          value: 'initial'
        }
      })

      await waitForUpdate()

      expect(store).toBeDefined()
      expect(store.id).toBeDefined()
      expect(store.stateManager).toBeDefined()

      // Verify it's in the component instances
      const retrieved = wildflower.componentInstances.get(store.id)
      expect(retrieved).toBeDefined()
    })

    it('store with nested state updates', async () => {
      const store = wildflower.storeManager.createStoreComponent('nested-store', {
        state: {
          user: {
            profile: {
              name: 'John',
              age: 30
            }
          }
        }
      })

      await waitForUpdate()

      // Update nested property
      store.state.user.profile.age = 31
      await waitForUpdate()

      expect(store.state.user.profile.age).toBe(31)
      expect(store.state.user.profile.name).toBe('John')
    })
  })

  describe('External Binding', () => {
    it('external() DOM binding updates when store state changes', async () => {
      // Create a store with count and increment method (unified paradigm)
      const store = wildflower.storeManager.store('ext-bind-store', {
        state: {
          count: 0,
          app: {
            isLoading: false,
            actions: {}
          }
        },
        // NEW PARADIGM: Methods at top level, not in actions block
        increment() {
          this.state.count += 1
        }
      })

      await waitForUpdate(100)

      // Verify store is accessible
      const retrievedStore = wildflower.getStore('ext-bind-store')
      expect(retrievedStore).not.toBeNull()
      expect(retrievedStore.state.count).toBe(0)

      // Create a component that displays the store's count via external()
      wildflower.component('ext-binding-test', {
        state: {}
      })

      // Add component HTML with external binding
      testContainer.innerHTML = `
        <div id="ext-binding-container" data-component="ext-binding-test">
          <span id="ext-count-display" data-bind="external('ext-bind-store', 'count')">0</span>
        </div>
      `

      // Trigger component scanning
      wildflower.scan()
      await waitForUpdate(200)

      // Get the display element
      const countDisplay = document.getElementById('ext-count-display')
      expect(countDisplay).not.toBeNull()
      expect(countDisplay.textContent).toBe('0')

      // Call store action to increment
      store.increment()

      // Force render to complete
      await wildflower._forceCompleteRender()
      await waitForUpdate(100)

      // Verify the DOM binding updated
      expect(countDisplay.textContent).toBe('1')

      // Increment again to verify continued reactivity
      store.increment()
      await wildflower._forceCompleteRender()
      await waitForUpdate(100)

      expect(countDisplay.textContent).toBe('2')
    })
  })
})

describe('Store Watch Feature', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    // Framework already loaded
    await new Promise(resolve => setTimeout(resolve, 50))
  })

  beforeEach(() => {
    wildflower = window.wildflower

    // Comprehensive framework reset
    if (wildflower.componentDefinitions) {
      wildflower.componentDefinitions.clear()
    }
    if (wildflower.componentInstances) {
      wildflower.componentInstances.clear()
    }
    if (wildflower.storeManager && wildflower.storeManager._namedStores) {
      wildflower.storeManager._namedStores.clear()
    }

    // Clear template cache
    if (wildflower._templateCache) {
      if (wildflower._templateCache.general) wildflower._templateCache.general.clear()
      if (wildflower._templateCache.lists) wildflower._templateCache.lists.clear()
      if (wildflower._templateCache.compiled) wildflower._templateCache.compiled.clear()
      if (wildflower._templateCache.extracted) wildflower._templateCache.extracted.clear()
      if (wildflower._templateCache.fragmentPools) wildflower._templateCache.fragmentPools.clear()
      if (wildflower._templateCache.stats) wildflower._templateCache.stats.clear()
    }

    // Clear additional framework state
    if (wildflower.componentParents) wildflower.componentParents.clear()
    if (wildflower.componentChildren) wildflower.componentChildren.clear()
    if (wildflower.eventHandlers) wildflower.eventHandlers.clear()

    if (wildflower.domElements) {
      wildflower.domElements.bindings = []
      wildflower.domElements.conditionals = []
      wildflower.domElements.lists = []
      wildflower.domElements.models = []
      wildflower.domElements.slots = []
    }

    if (wildflower._initContextSystem) {
      wildflower._contextSystemInitialized = false
      wildflower._initContextSystem()
    }

    // Create test container
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

  it('watch with store:path syntax fires on store changes', async () => {
    // Create a store
    const store = wildflower.storeManager.createStoreComponent('watch-test-store', {
      state: {
        value: 'initial',
        _internal: {
          ready: true
        }
      }
    })

    await waitForUpdate()

    let watchCallCount = 0
    let lastReceivedValue = null
    let lastReceivedOldValue = null

    // Create a component that watches the store
    wildflower.component('store-watch-test', {
      state: {},
      watch: {
        'store:watch-test-store.value': function (newValue, oldValue) {
          watchCallCount++
          lastReceivedValue = newValue
          lastReceivedOldValue = oldValue
        }
      }
    })

    testContainer.innerHTML = `
      <div data-component="store-watch-test">
        <span>Watcher Component</span>
      </div>
    `
    wildflower.scan()
    await waitForUpdate(100)

    // Change the store value
    store.state.value = 'updated'
    await waitForUpdate(100)

    expect(watchCallCount).toBe(1)
    expect(lastReceivedValue).toBe('updated')
    expect(lastReceivedOldValue).toBe('initial')

    // Change again
    store.state.value = 'again'
    await waitForUpdate(100)

    expect(watchCallCount).toBe(2)
    expect(lastReceivedValue).toBe('again')
  })

  it('store:path watch with auto-created app-store', async () => {
    let watchCallCount = 0
    let lastValue = null

    // Component that modifies store (creates it via this.store())
    wildflower.component('store-modifier-unit', {
      state: { clickCount: 0 },
      changeStore() {
        this.state.clickCount++
        this.store('testPath.value', 'value-' + this.state.clickCount)
      }
    })

    // Component that watches the store path
    wildflower.component('store-watcher-unit', {
      state: {},
      watch: {
        'store:testPath.value': function (newValue) {
          watchCallCount++
          lastValue = newValue
        }
      }
    })

    testContainer.innerHTML = `
      <div data-component="store-modifier-unit">
        <button data-action="changeStore">Change</button>
      </div>
      <div data-component="store-watcher-unit">
        <span>Watcher</span>
      </div>
    `
    wildflower.scan()
    await waitForUpdate(100)

    // Get modifier instance and trigger store change
    const modifierEl = testContainer.querySelector('[data-component="store-modifier-unit"]')
    const modifierInstance = wildflower.componentInstances.get(modifierEl.dataset.componentId)

    // Change the store value via component action
    modifierInstance.context.changeStore()
    await waitForUpdate(100)

    expect(watchCallCount).toBe(1)
    expect(lastValue).toBe('value-1')

    // Change again
    modifierInstance.context.changeStore()
    await waitForUpdate(100)

    expect(watchCallCount).toBe(2)
    expect(lastValue).toBe('value-2')
  })

  it('store:path watch with immediate option', async () => {
    // Create a store with initial value
    const store = wildflower.storeManager.createStoreComponent('immediate-watch-store', {
      state: {
        status: 'ready',
        _internal: {
          ready: true
        }
      }
    })

    await waitForUpdate()

    let immediateCallCount = 0
    let immediateValue = null

    // Component watching with immediate
    wildflower.component('immediate-watch-test', {
      state: {},
      watch: {
        'store:immediate-watch-store.status:immediate': function (newValue) {
          immediateCallCount++
          immediateValue = newValue
        }
      }
    })

    testContainer.innerHTML = `
      <div data-component="immediate-watch-test">
        <span>Immediate Watcher</span>
      </div>
    `
    wildflower.scan()
    await waitForUpdate(100)

    // Immediate watch should fire immediately with current value
    expect(immediateCallCount).toBe(1)
    expect(immediateValue).toBe('ready')
  })

  it('store:path watch cleanup on component destroy', async () => {
    // Create a store
    const store = wildflower.storeManager.createStoreComponent('cleanup-watch-store', {
      state: {
        value: 0,
        _internal: {
          ready: true
        }
      }
    })

    await waitForUpdate()

    let watchCallCount = 0

    // Component watching the store
    wildflower.component('cleanup-watch-test', {
      state: {},
      watch: {
        'store:cleanup-watch-store.value': function (newValue) {
          watchCallCount++
        }
      }
    })

    testContainer.innerHTML = `
      <div data-component="cleanup-watch-test">
        <span>Cleanup Test</span>
      </div>
    `
    wildflower.scan()
    await waitForUpdate(100)

    // Get the component instance
    const component = testContainer.querySelector('[data-component="cleanup-watch-test"]')
    const componentId = component.dataset.componentId

    // Change store value - should trigger watch
    store.state.value = 1
    await waitForUpdate(100)

    expect(watchCallCount).toBe(1)

    // Destroy the component
    wildflower.destroyComponent(componentId)
    await waitForUpdate()

    // Change store value again - should NOT trigger watch
    const previousCallCount = watchCallCount
    store.state.value = 2
    await waitForUpdate(100)

    expect(watchCallCount).toBe(previousCallCount)
  })

  it('multiple components can watch same store path', async () => {
    // Create a store
    const store = wildflower.storeManager.createStoreComponent('shared-watch-store', {
      state: {
        message: 'hello',
        _internal: {
          ready: true
        }
      }
    })

    await waitForUpdate()

    let watcher1CallCount = 0
    let watcher2CallCount = 0

    // First component watching the store
    wildflower.component('multi-watch-1', {
      state: {},
      watch: {
        'store:shared-watch-store.message': function (newValue) {
          watcher1CallCount++
        }
      }
    })

    // Second component watching the same path
    wildflower.component('multi-watch-2', {
      state: {},
      watch: {
        'store:shared-watch-store.message': function (newValue) {
          watcher2CallCount++
        }
      }
    })

    testContainer.innerHTML = `
      <div data-component="multi-watch-1"><span>Watcher 1</span></div>
      <div data-component="multi-watch-2"><span>Watcher 2</span></div>
    `
    wildflower.scan()
    await waitForUpdate(100)

    // Change store value - both should trigger
    store.state.message = 'world'
    await waitForUpdate(100)

    expect(watcher1CallCount).toBe(1)
    expect(watcher2CallCount).toBe(1)

    // Change again
    store.state.message = 'test'
    await waitForUpdate(100)

    expect(watcher1CallCount).toBe(2)
    expect(watcher2CallCount).toBe(2)
  })
})
