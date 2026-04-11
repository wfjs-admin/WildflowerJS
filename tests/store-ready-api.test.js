/**
 * WildflowerJS Store Ready API Test Suite
 *
 * Tests for the store.isReady() and store.waitForReady() APIs.
 * These APIs help components coordinate initialization timing with stores.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to get component instance from selector
function getComponentInstance(selector) {
  const el = document.querySelector(selector)
  if (el && el.dataset.componentId) {
    return window.wildflower.componentInstances.get(el.dataset.componentId)
  }
  return null
}

describe('Store Ready API', () => {
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

  describe('isReady()', () => {
    it('returns true for a fully initialized store', async () => {
      const store = wildflower.store('ready-test-1', {
        state: { value: 42 }
      })

      expect(store.isReady()).toBe(true)
    })

    it('returns true immediately after createStore completes', () => {
      const store = wildflower.store('ready-test-2', {
        state: { items: [] },
        computed: {
          itemCount() { return this.state.items.length }
        },
        addItem(args) {
          this.state.items = [...this.state.items, args.item]
        }
      })

      // Should be ready immediately
      expect(store.isReady()).toBe(true)
    })

    it('store with init hook is ready after init completes', async () => {
      let initCompleted = false

      const store = wildflower.store('ready-test-3', {
        state: { initialized: false },
        init() {
          this.state.initialized = true
          initCompleted = true
        }
      })

      // Init should have run synchronously
      expect(initCompleted).toBe(true)
      expect(store.state.initialized).toBe(true)
      expect(store.isReady()).toBe(true)
    })
  })

  describe('waitForReady()', () => {
    it('resolves immediately for an already-ready store', async () => {
      const store = wildflower.store('wait-test-1', {
        state: { value: 'test' }
      })

      const startTime = Date.now()
      await store.waitForReady()
      const elapsed = Date.now() - startTime

      // Should resolve almost immediately (less than 50ms)
      expect(elapsed).toBeLessThan(50)
    })

    it('returns a Promise that resolves', async () => {
      const store = wildflower.store('wait-test-2', {
        state: { data: [] }
      })

      const result = store.waitForReady()

      // Should return a Promise
      expect(result).toBeInstanceOf(Promise)

      // Should resolve
      await expect(result).resolves.toBeUndefined()
    })

    it('multiple waitForReady calls all resolve', async () => {
      const store = wildflower.store('wait-test-3', {
        state: { count: 0 }
      })

      // Call waitForReady multiple times
      const promises = [
        store.waitForReady(),
        store.waitForReady(),
        store.waitForReady()
      ]

      // All should resolve
      await Promise.all(promises)

      // All resolved successfully
      expect(true).toBe(true)
    })
  })

  describe('Component waiting for store', () => {
    it('component can await store.waitForReady() in init', async () => {
      let componentInitialized = false
      let storeValueDuringInit = null

      // Create store first
      const store = wildflower.store('component-wait-store', {
        state: { config: 'ready-value' }
      })

      // Component that waits for store
      wildflower.component('store-awaiter', {
        state: {
          ready: false,
          configValue: ''
        },
        async init() {
          const store = wildflower.getStore('component-wait-store')
          await store.waitForReady()

          storeValueDuringInit = store.state.config
          this.state.configValue = store.state.config
          this.state.ready = true
          componentInitialized = true
        }
      })

      testContainer.innerHTML = `
        <div data-component="store-awaiter">
          <span class="ready" data-bind="ready"></span>
          <span class="config" data-bind="configValue"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(100)

      expect(componentInitialized).toBe(true)
      expect(storeValueDuringInit).toBe('ready-value')

      const instance = getComponentInstance('[data-component="store-awaiter"]')
      expect(instance.state.ready).toBe(true)
      expect(instance.state.configValue).toBe('ready-value')
    })

    it('component can safely access store after waitForReady', async () => {
      const store = wildflower.store('safe-access-store', {
        state: {
          users: ['Alice', 'Bob', 'Charlie']
        },
        computed: {
          userCount() {
            return this.state.users.length
          }
        }
      })

      let accessedCount = null

      wildflower.component('safe-accessor', {
        state: { count: 0 },
        async init() {
          const store = wildflower.getStore('safe-access-store')
          await store.waitForReady()

          // Access computed property
          accessedCount = store.computed.userCount
          this.state.count = accessedCount
        }
      })

      testContainer.innerHTML = `
        <div data-component="safe-accessor">
          <span class="count" data-bind="count"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(100)

      expect(accessedCount).toBe(3)
      expect(testContainer.querySelector('.count').textContent).toBe('3')
    })
  })

  describe('Multiple stores coordination', () => {
    it('component can wait for multiple stores', async () => {
      const storeA = wildflower.store('multi-store-a', {
        state: { valueA: 'A' }
      })
      const storeB = wildflower.store('multi-store-b', {
        state: { valueB: 'B' }
      })

      let combinedValue = ''

      wildflower.component('multi-store-consumer', {
        state: { combined: '' },
        async init() {
          const [a, b] = await Promise.all([
            wildflower.getStore('multi-store-a').waitForReady().then(() => wildflower.getStore('multi-store-a')),
            wildflower.getStore('multi-store-b').waitForReady().then(() => wildflower.getStore('multi-store-b'))
          ])

          combinedValue = `${a.state.valueA}-${b.state.valueB}`
          this.state.combined = combinedValue
        }
      })

      testContainer.innerHTML = `
        <div data-component="multi-store-consumer">
          <span class="combined" data-bind="combined"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(100)

      expect(combinedValue).toBe('A-B')
      expect(testContainer.querySelector('.combined').textContent).toBe('A-B')
    })
  })

  describe('Store event: wildflower:store-ready', () => {
    it('dispatches wildflower:store-ready event when store is created', async () => {
      let eventReceived = false
      let eventStoreName = null

      // Listen for the event (dispatched on document, not window)
      document.addEventListener('wildflower:store-ready', (e) => {
        eventReceived = true
        eventStoreName = e.detail.storeName
      }, { once: true })

      wildflower.store('event-test-store', {
        state: { value: 1 }
      })

      await waitForUpdate()

      expect(eventReceived).toBe(true)
      expect(eventStoreName).toBe('event-test-store')
    })
  })

  describe('Edge cases', () => {
    it('getStore returns null for non-existent store', () => {
      const store = wildflower.getStore('non-existent-store')
      expect(store).toBeNull()
    })

    it('isReady handles stores with complex state', async () => {
      const store = wildflower.store('complex-state-store', {
        state: {
          nested: {
            deep: {
              value: 'deep'
            }
          },
          array: [1, 2, 3],
          nullValue: null,
          undefinedValue: undefined
        }
      })

      expect(store.isReady()).toBe(true)
      expect(store.state.nested.deep.value).toBe('deep')
      expect(store.state.array.length).toBe(3)
    })
  })
})
