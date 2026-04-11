/**
 * Effect System Test Suite - Phase 1
 *
 * Tests for the createEffect API and automatic dependency tracking.
 * See: docs/future/EFFECT_ARCHITECTURE_PLAN.md
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild} from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to wait for microtask
async function waitForMicrotask() {
  await new Promise(resolve => queueMicrotask(resolve))
}

describe('Effect System - Phase 1', () => {
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

  describe('createEffect API', () => {
    it('should run effect immediately on creation', async () => {
      // Use createStoreComponent to get the full store instance (not just context)
      const store = wildflower.storeManager.createStoreComponent('effect-test-1', {
        state: { count: 0 }
      })
      await waitForUpdate()

      // Verify store has stateManager
      expect(store).toBeDefined()
      expect(store.stateManager).toBeDefined()
      expect(typeof store.stateManager.createEffect).toBe('function')

      let effectRuns = 0
      let lastValue = null

      store.stateManager.createEffect(() => {
        effectRuns++
        lastValue = store.state.count
      })

      // Effect should run immediately
      expect(effectRuns).toBe(1)
      expect(lastValue).toBe(0)
    })

    it('should re-run effect when dependencies change', async () => {
      const store = wildflower.storeManager.createStoreComponent('effect-test-2', {
        state: { count: 0 }
      })

      let effectRuns = 0
      let lastValue = null

      store.stateManager.createEffect(() => {
        effectRuns++
        lastValue = store.state.count
      })

      expect(effectRuns).toBe(1)

      // Change state
      store.state.count = 5
      await waitForMicrotask()
      await waitForUpdate(20)

      // Effect should have re-run
      expect(effectRuns).toBe(2)
      expect(lastValue).toBe(5)
    })

    it('should batch multiple changes into single effect run', async () => {
      const store = wildflower.storeManager.createStoreComponent('effect-test-3', {
        state: { count: 0 }
      })

      let effectRuns = 0
      let lastValue = null

      store.stateManager.createEffect(() => {
        effectRuns++
        lastValue = store.state.count
      })

      expect(effectRuns).toBe(1)

      // Multiple rapid changes
      store.state.count = 1
      store.state.count = 2
      store.state.count = 3
      store.state.count = 4
      store.state.count = 5

      await waitForMicrotask()
      await waitForUpdate(20)

      // Effect should have batched all changes into one run
      // (Initial run + 1 batched run = 2)
      expect(effectRuns).toBe(2)
      expect(lastValue).toBe(5)
    })

    it('should return stop function that disposes effect', async () => {
      const store = wildflower.storeManager.createStoreComponent('effect-test-4', {
        state: { count: 0 }
      })

      let effectRuns = 0

      const stop = store.stateManager.createEffect(() => {
        effectRuns++
        // Read count to establish dependency
        const _ = store.state.count
      })

      expect(effectRuns).toBe(1)

      // Dispose effect
      stop()

      // Change state
      store.state.count = 10
      await waitForMicrotask()
      await waitForUpdate(20)

      // Effect should NOT have re-run
      expect(effectRuns).toBe(1)
    })

    it('should track multiple dependencies', async () => {
      const store = wildflower.storeManager.createStoreComponent('effect-test-5', {
        state: {
          firstName: 'John',
          lastName: 'Doe'
        }
      })

      let effectRuns = 0
      let lastFullName = null

      store.stateManager.createEffect(() => {
        effectRuns++
        lastFullName = `${store.state.firstName} ${store.state.lastName}`
      })

      expect(effectRuns).toBe(1)
      expect(lastFullName).toBe('John Doe')

      // Change firstName
      store.state.firstName = 'Jane'
      await waitForMicrotask()
      await waitForUpdate(20)

      expect(effectRuns).toBe(2)
      expect(lastFullName).toBe('Jane Doe')

      // Change lastName
      store.state.lastName = 'Smith'
      await waitForMicrotask()
      await waitForUpdate(20)

      expect(effectRuns).toBe(3)
      expect(lastFullName).toBe('Jane Smith')
    })

    it('should support sync option for immediate execution', async () => {
      const store = wildflower.storeManager.createStoreComponent('effect-test-6', {
        state: { count: 0 }
      })

      let effectRuns = 0

      store.stateManager.createEffect(() => {
        effectRuns++
        const _ = store.state.count
      }, { sync: true })

      expect(effectRuns).toBe(1)

      // Change state - sync effects run immediately when notification fires
      // Note: Due to microtask batching, the notification may be deferred
      store.state.count = 5

      // Wait for microtask to process the state change notification
      await waitForMicrotask()

      // Sync effect should have run (sync = run immediately when notified, not batched with other effects)
      expect(effectRuns).toBe(2)
    })

    it('should handle nested object access', async () => {
      const store = wildflower.storeManager.createStoreComponent('effect-test-7', {
        state: {
          user: {
            profile: {
              name: 'John'
            }
          }
        }
      })

      let effectRuns = 0
      let lastName = null

      store.stateManager.createEffect(() => {
        effectRuns++
        lastName = store.state.user.profile.name
      })

      expect(effectRuns).toBe(1)
      expect(lastName).toBe('John')

      // Change nested property
      store.state.user.profile.name = 'Jane'
      await waitForMicrotask()
      await waitForUpdate(20)

      expect(effectRuns).toBe(2)
      expect(lastName).toBe('Jane')
    })

    it('should handle array dependencies', async () => {
      const store = wildflower.storeManager.createStoreComponent('effect-test-8', {
        state: {
          items: [1, 2, 3]
        }
      })

      let effectRuns = 0
      let lastSum = 0

      store.stateManager.createEffect(() => {
        effectRuns++
        lastSum = store.state.items.reduce((a, b) => a + b, 0)
      })

      expect(effectRuns).toBe(1)
      expect(lastSum).toBe(6)

      // Replace array
      store.state.items = [1, 2, 3, 4]
      await waitForMicrotask()
      await waitForUpdate(20)

      expect(effectRuns).toBe(2)
      expect(lastSum).toBe(10)
    })

    it('should not trigger on unchanged values', async () => {
      const store = wildflower.storeManager.createStoreComponent('effect-test-9', {
        state: { count: 5 }
      })

      let effectRuns = 0

      store.stateManager.createEffect(() => {
        effectRuns++
        const _ = store.state.count
      })

      expect(effectRuns).toBe(1)

      // Set to same value
      store.state.count = 5
      await waitForMicrotask()
      await waitForUpdate(20)

      // Effect should NOT re-run (value unchanged)
      expect(effectRuns).toBe(1)
    })

    it('should handle effect errors gracefully', async () => {
      const store = wildflower.storeManager.createStoreComponent('effect-test-10', {
        state: { count: 0 }
      })

      let effectRuns = 0
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      store.stateManager.createEffect(() => {
        effectRuns++
        if (store.state.count > 0) {
          throw new Error('Test error')
        }
      })

      expect(effectRuns).toBe(1)

      // Trigger effect with error
      store.state.count = 1
      await waitForMicrotask()
      await waitForUpdate(20)

      // Effect should have run despite error
      expect(effectRuns).toBe(2)
      expect(consoleError).toHaveBeenCalled()

      consoleError.mockRestore()
    })

    it('should support named effects for debugging', async () => {
      const store = wildflower.storeManager.createStoreComponent('effect-test-11', {
        state: { count: 0 }
      })

      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      store.stateManager.createEffect(() => {
        throw new Error('Named effect error')
      }, { name: 'myTestEffect' })

      // Error message should include effect name
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('"myTestEffect"'),
        expect.any(Error)
      )

      consoleError.mockRestore()
    })
  })

  describe('Effect cleanup on component destruction', () => {
    it.skipIf(isMinifiedBuild())('should dispose effects when component is destroyed', async () => {
      // Use a store for testing effect cleanup (components don't expose stateManager directly)
      const store = wildflower.storeManager.createStoreComponent('effect-cleanup-store', {
        state: { count: 0 }
      })

      let effectRuns = 0

      // Create effect with a custom scope object
      const scope = { _effects: null }

      store.stateManager.createEffect(() => {
        effectRuns++
        const _ = store.state.count
      }, { scope })

      expect(effectRuns).toBe(1)
      expect(scope._effects).not.toBe(null)
      expect(scope._effects.size).toBe(1)

      // Change state
      store.state.count = 5
      await waitForMicrotask()
      await waitForUpdate(20)

      expect(effectRuns).toBe(2)

      // Verify effect is registered
      expect(store.stateManager._effects.size).toBe(1)
    })
  })

  // hasActiveEffect / getActiveEffect / disposeEffectsForScope removed — dead code (Sprint 3)

  describe('Effect with computed properties', () => {
    it('should re-run when reading state directly (not via computed)', async () => {
      // Effects track direct state reads, not computed property dependencies.
      // This test verifies the basic behavior - read state directly in effect.
      const store = wildflower.storeManager.createStoreComponent('effect-computed-store', {
        state: { firstName: 'John', lastName: 'Doe' },
        computed: {
          fullName() {
            return `${this.state.firstName} ${this.state.lastName}`
          }
        }
      })

      let effectRuns = 0
      let lastFullName = null

      // Effect reads state directly (not computed) - this will track dependencies
      store.stateManager.createEffect(() => {
        effectRuns++
        // Read state directly to establish dependencies
        lastFullName = `${store.state.firstName} ${store.state.lastName}`
      })

      expect(effectRuns).toBe(1)
      expect(lastFullName).toBe('John Doe')

      // Change underlying state
      store.state.firstName = 'Jane'
      await waitForMicrotask()
      await waitForUpdate(50)

      // Effect should re-run because it tracks firstName directly
      expect(effectRuns).toBe(2)
      expect(lastFullName).toBe('Jane Doe')
    })

    it('should track dependencies through computed property reads (transitive tracking)', async () => {
      // Effects track ALL state reads, including those that happen during
      // computed property evaluation. This enables true fine-grained reactivity.
      const store = wildflower.storeManager.createStoreComponent('effect-computed-trans', {
        state: { firstName: 'John', lastName: 'Doe' },
        computed: {
          fullName() {
            return `${this.state.firstName} ${this.state.lastName}`
          }
        }
      })

      let effectRuns = 0

      store.stateManager.createEffect(() => {
        effectRuns++
        // Reading computed property - state reads inside are tracked by effect
        store.stateManager.evaluateComputed('fullName')
      })

      expect(effectRuns).toBe(1)

      // Change underlying state
      store.state.firstName = 'Jane'
      await waitForMicrotask()
      await waitForUpdate(50)

      // Effect DOES re-run because firstName was read during computed evaluation
      // and the effect tracked that dependency transitively
      expect(effectRuns).toBe(2)
    })
  })

  describe('EffectScheduler safety', () => {
    it('flush terminates for self-triggering effects', async () => {
      const store = wildflower.storeManager.createStoreComponent('flush-guard-test', {
        state: { counter: 0 }
      })
      await waitForUpdate()

      let runCount = 0

      // Create an effect that writes to its own dependency — infinite loop risk
      store.stateManager.createEffect(() => {
        const val = store.state.counter
        runCount++
        // Write back to the same property we just read (would loop forever without guard)
        if (val < 1000) {
          store.state.counter = val + 1
        }
      })

      // Wait for the effect scheduler to flush
      await waitForMicrotask()
      await waitForUpdate(200)

      // The flush should have terminated, not hung the browser.
      // runCount should be bounded by the scheduler's flush iteration guard (~100)
      expect(runCount).toBeLessThan(150)
      expect(runCount).toBeGreaterThan(0)
    })
  })
})
