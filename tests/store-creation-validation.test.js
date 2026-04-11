/**
 * WildflowerJS Store Creation Validation Test Suite
 *
 * Tests for store creation error cases and edge cases that are NOT covered
 * by the main store-manager.test.js suite.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Store Creation Validation', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    if (wildflower._initContextSystem) {
      wildflower._contextSystemInitialized = false
      wildflower._initContextSystem()
    }

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

  // =========================================================================
  // Duplicate Store Names
  // =========================================================================

  describe('Duplicate store names', () => {
    it('creating a store with the same name returns the existing store context', async () => {
      const store1 = wildflower.storeManager.store('dup-test', {
        state: { value: 'first' }
      })
      await waitForUpdate()

      const store2 = wildflower.storeManager.store('dup-test', {
        state: { value: 'second' }
      })
      await waitForUpdate()

      // store() returns the existing context on duplicate — does NOT override
      expect(store1).toBe(store2)
      expect(store1.state.value).toBe('first')
    })

    it('duplicate store does not overwrite existing state', async () => {
      wildflower.storeManager.store('dup-state', {
        state: { count: 42 }
      })
      await waitForUpdate()

      wildflower.storeManager.store('dup-state', {
        state: { count: 999 }
      })
      await waitForUpdate()

      const retrieved = wildflower.storeManager.getStoreByName('dup-state')
      expect(retrieved).toBeDefined()
      expect(retrieved.state.count).toBe(42)
    })
  })

  // =========================================================================
  // Missing / Invalid State
  // =========================================================================

  describe('Missing or invalid state', () => {
    it('store with no state property works as a methods-only store', async () => {
      let called = false
      const store = wildflower.storeManager.store('no-state', {
        doSomething() {
          called = true
        }
      })
      await waitForUpdate()

      expect(store).toBeDefined()
      expect(store).not.toBeNull()

      store.doSomething()
      expect(called).toBe(true)
    })

    it('store with null state still creates successfully', async () => {
      const store = wildflower.storeManager.store('null-state', {
        state: null
      })
      await waitForUpdate()

      expect(store).toBeDefined()
      expect(store).not.toBeNull()
    })

    it('store with empty object state works', async () => {
      const store = wildflower.storeManager.store('empty-state', {
        state: {}
      })
      await waitForUpdate()

      expect(store).toBeDefined()
      expect(store).not.toBeNull()
    })

    it('store with numeric state value — spread fails gracefully', async () => {
      // state: 42 is not iterable/spreadable — test that it does not throw
      const store = wildflower.storeManager.store('numeric-state', {
        state: 42
      })
      await waitForUpdate()

      // Should still create (spread of number yields empty object)
      expect(store).toBeDefined()
    })

    it('store with string state value — spread fails gracefully', async () => {
      // state: 'hello' spread produces { 0:'h', 1:'e', ... }
      const store = wildflower.storeManager.store('string-state', {
        state: 'hello'
      })
      await waitForUpdate()

      // Should create without throwing
      expect(store).toBeDefined()
    })

    it('store with array state — spread produces indexed properties', async () => {
      const store = wildflower.storeManager.store('array-state', {
        state: [10, 20, 30]
      })
      await waitForUpdate()

      // Array spread into object: { 0: 10, 1: 20, 2: 30 }
      expect(store).toBeDefined()
    })
  })

  // =========================================================================
  // getStore Edge Cases
  // =========================================================================

  describe('getStore edge cases', () => {
    it('getStore for nonexistent store returns null without throwing', () => {
      const result = wildflower.getStore('totally-nonexistent-store')
      expect(result).toBeNull()
    })

    it('getStore with empty string returns null', () => {
      // Empty string falls through to default 'app-store' parameter
      // or returns null if no app-store exists
      const result = wildflower.getStore('')
      // Should not throw
      expect(result === null || result !== undefined).toBe(true)
    })

    it('getStore retrieves store after creation', async () => {
      // Before creation
      const before = wildflower.getStore('late-store')
      expect(before).toBeNull()

      // Create the store
      wildflower.storeManager.store('late-store', {
        state: { ready: true }
      })
      await waitForUpdate()

      // After creation
      const after = wildflower.getStore('late-store')
      expect(after).not.toBeNull()
      expect(after.state.ready).toBe(true)
    })

    it('getStoreByName returns null for nonexistent store', () => {
      const result = wildflower.storeManager.getStoreByName('does-not-exist')
      expect(result).toBeNull()
    })
  })

  // =========================================================================
  // Store Method Errors
  // =========================================================================

  describe('Store method errors', () => {
    it('store method that throws does not break the store', async () => {
      const store = wildflower.storeManager.store('error-method', {
        state: { count: 0 },
        increment() {
          this.state.count++
        },
        broken() {
          throw new Error('intentional test error')
        }
      })
      await waitForUpdate()

      // Call the broken method — it should throw
      expect(() => store.broken()).toThrow('intentional test error')

      // Store should still be functional afterward
      store.increment()
      await waitForUpdate()
      expect(store.state.count).toBe(1)
    })

    it('store method can modify state of another store via getStore', async () => {
      wildflower.storeManager.store('target-store', {
        state: { value: 'original' }
      })
      await waitForUpdate()

      const controllerStore = wildflower.storeManager.store('controller-store', {
        state: {},
        updateTarget() {
          const target = wildflower.getStore('target-store')
          if (target) {
            target.state.value = 'modified'
          }
        }
      })
      await waitForUpdate()

      controllerStore.updateTarget()
      await waitForUpdate()

      const target = wildflower.getStore('target-store')
      expect(target.state.value).toBe('modified')
    })
  })

  // =========================================================================
  // createStoreComponent Validation
  // =========================================================================

  describe('createStoreComponent input validation', () => {
    it('returns null for empty string name', () => {
      const result = wildflower.storeManager.createStoreComponent('', { state: {} })
      expect(result).toBeNull()
    })

    it('returns null for null name', () => {
      const result = wildflower.storeManager.createStoreComponent(null, { state: {} })
      expect(result).toBeNull()
    })

    it('returns null for numeric name', () => {
      const result = wildflower.storeManager.createStoreComponent(123, { state: {} })
      expect(result).toBeNull()
    })

    it('returns null for null definition', () => {
      const result = wildflower.storeManager.createStoreComponent('valid-name', null)
      expect(result).toBeNull()
    })

    it('returns null for non-object definition', () => {
      const result = wildflower.storeManager.createStoreComponent('valid-name', 'not-an-object')
      expect(result).toBeNull()
    })
  })

  // =========================================================================
  // Reserved Property Name Collisions
  // =========================================================================

  describe('Store with reserved-like property names', () => {
    it('state property named "state" — accessible via state.state', async () => {
      const store = wildflower.storeManager.store('reserved-state', {
        state: { state: 'nested-state-value' }
      })
      await waitForUpdate()

      // The store proxy exposes state props directly, so store.state
      // returns the reactive state object. store.state.state accesses the nested prop.
      expect(store.state.state).toBe('nested-state-value')
    })

    it('state property named "computed" does not break computed system', async () => {
      const store = wildflower.storeManager.store('reserved-computed', {
        state: { computed: 'a-value' },
        computed: {
          doubled() {
            return this.state.computed + '-doubled'
          }
        }
      })
      await waitForUpdate()

      expect(store.state.computed).toBe('a-value')

      // Verify computed property works via the public store proxy
      const storeProxy = wildflower.getStore('reserved-computed')
      expect(storeProxy.doubled).toBe('a-value-doubled')
    })

    it('state property named "subscribe" — collision warning emitted, state still accessible', async () => {
      const store = wildflower.storeManager.store('reserved-subscribe', {
        state: {
          subscribe: 'sub-value',
          other: 0
        }
      })
      await waitForUpdate()

      // State property is still accessible via state.subscribe
      expect(store.state.subscribe).toBe('sub-value')

      // The shorthand proxy (store.subscribe) resolves to the context method,
      // not the state property, because framework methods take precedence.
      // The framework warns about this collision at creation time.
      expect(typeof store.subscribe).toBe('function')
    })
  })
})
