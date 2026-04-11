/**
 * WildflowerJS Store-Component Automatic Dependency Tracking Test Suite
 *
 * Tests for the automatic dependency tracking feature that eliminates
 * the need for manual _v state hacks when components read from stores.
 *
 * Feature: When a component's computed property accesses store data via
 * wildflower.getStore(), the framework automatically:
 * 1. Detects the access during computed evaluation
 * 2. Registers the component as dependent on the store
 * 3. Re-evaluates the computed when store data changes
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild} from './helpers/load-framework.js'

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

describe('Store-Component Automatic Dependency Tracking', () => {
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

  describe('Tracking Context Setup', () => {
    it.skipIf(isMinifiedBuild())('sets tracking context during computed evaluation', async () => {
      // Create a store
      wildflower.store('tracking-test', {
        state: { value: 42 }
      })

      // Register component with computed that accesses store
      wildflower.component('tracking-observer', {
        computed: {
          storeValue() {
            // During this evaluation, _computedTrackingContext should be set
            const store = wildflower.getStore('tracking-test')
            return store.state.value
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="tracking-observer">
          <span data-bind="computed:storeValue"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      const instance = getComponentInstance('[data-component="tracking-observer"]')
      expect(instance).toBeDefined()

      // Verify the computed was evaluated
      const value = instance.stateManager.evaluateComputed('storeValue')
      expect(value).toBe(42)

      // Tracking context should be null outside of evaluation
      expect(wildflower._computedTrackingContext).toBeNull()
    })

    it.skipIf(isMinifiedBuild())('tracking context does not leak after computed evaluation', async () => {
      // The behavioral concern: after a computed that reads a store finishes
      // evaluating, subsequent non-computed store access should NOT accidentally
      // register as a computed dependency.
      wildflower.store('leak-test', {
        state: { value: 'initial' }
      })
      wildflower.store('unrelated-store', {
        state: { other: 'data' }
      })

      wildflower.component('leak-checker', {
        subscribe: { 'leak-test': ['value'] },
        computed: {
          derived() {
            return this.stores['leak-test']?.value + '!'
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="leak-checker">
          <span id="derived" data-bind="computed:derived"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      expect(testContainer.querySelector('#derived').textContent).toBe('initial!')

      // After computed eval completes, tracking context should be cleared
      expect(wildflower._computedTrackingContext).toBeNull()

      // Non-computed store access should not pollute dependencies
      const unrelated = wildflower.getStore('unrelated-store')
      const val = unrelated.state.other
      expect(val).toBe('data')

      // Update the subscribed store — component should still react
      const store = wildflower.getStore('leak-test')
      store.state.value = 'updated'
      await waitForUpdate()

      expect(testContainer.querySelector('#derived').textContent).toBe('updated!')
    })
  })

  describe('Automatic Dependency Registration', () => {
    it.skipIf(isMinifiedBuild())('automatically registers component as dependent when accessing store.state', async () => {
      const store = wildflower.store('auto-dep-store', {
        state: { count: 0 }
      })

      wildflower.component('auto-dep-component', {
        computed: {
          currentCount() {
            // This should automatically register the dependency
            return wildflower.getStore('auto-dep-store').state.count
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="auto-dep-component">
          <span class="count-display" data-bind="computed:currentCount"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()
      const instance = getComponentInstance('[data-component="auto-dep-component"]')

      // Verify initial render
      const countDisplay = testContainer.querySelector('.count-display')
      expect(countDisplay.textContent).toBe('0')

      // Get the store instance to find its ID
      const storeInstance = wildflower.storeManager._namedStores.get('auto-dep-store')
      expect(storeInstance).toBeDefined()

      // Verify dependency was registered
      const dependents = wildflower._getEntityDependents(storeInstance.id)
      expect(dependents.has(instance.id)).toBe(true)
    })

    it.skipIf(isMinifiedBuild())('automatically registers component as dependent when accessing store.computed', async () => {
      wildflower.store('computed-dep-store', {
        state: { items: [1, 2, 3] },
        computed: {
          itemCount() {
            return this.state.items.length
          }
        }
      })

      wildflower.component('computed-dep-component', {
        computed: {
          displayCount() {
            return wildflower.getStore('computed-dep-store').computed.itemCount
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="computed-dep-component">
          <span class="item-count" data-bind="computed:displayCount"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()
      const instance = getComponentInstance('[data-component="computed-dep-component"]')

      // Verify initial render
      const itemCount = testContainer.querySelector('.item-count')
      expect(itemCount.textContent).toBe('3')

      // Verify dependency was registered
      const storeInstance = wildflower.storeManager._namedStores.get('computed-dep-store')
      const dependents = wildflower._getEntityDependents(storeInstance.id)
      expect(dependents.has(instance.id)).toBe(true)
    })
  })

  describe('Automatic Reactivity Without Manual Subscription', () => {
    it('component computed updates when store state changes (no manual subscribe)', async () => {
      const store = wildflower.store('reactive-store', {
        state: { message: 'Hello' }
      })

      // Component WITHOUT manual _v hack or subscribe()
      wildflower.component('reactive-component', {
        computed: {
          greeting() {
            return wildflower.getStore('reactive-store').state.message
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="reactive-component">
          <span class="greeting" data-bind="computed:greeting"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Verify initial render
      const greeting = testContainer.querySelector('.greeting')
      expect(greeting.textContent).toBe('Hello')

      // Update store state
      store.state.message = 'World'
      await waitForUpdate(100)

      // Computed should automatically re-evaluate
      expect(greeting.textContent).toBe('World')
    })

    it('component computed updates when store computed changes', async () => {
      const store = wildflower.store('derived-store', {
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

      wildflower.component('derived-component', {
        computed: {
          displayName() {
            return wildflower.getStore('derived-store').computed.fullName
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="derived-component">
          <span class="name" data-bind="computed:displayName"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Verify initial render
      const name = testContainer.querySelector('.name')
      expect(name.textContent).toBe('John Doe')

      // Update store state
      store.state.firstName = 'Jane'
      await waitForUpdate(100)

      // Computed should automatically re-evaluate
      expect(name.textContent).toBe('Jane Doe')
    })

    it('multiple components react to same store changes', async () => {
      const store = wildflower.store('shared-store', {
        state: { value: 100 }
      })

      wildflower.component('observer-a', {
        computed: {
          doubled() {
            return wildflower.getStore('shared-store').state.value * 2
          }
        }
      })

      wildflower.component('observer-b', {
        computed: {
          tripled() {
            return wildflower.getStore('shared-store').state.value * 3
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="observer-a">
          <span class="doubled" data-bind="computed:doubled"></span>
        </div>
        <div data-component="observer-b">
          <span class="tripled" data-bind="computed:tripled"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Verify initial render
      expect(testContainer.querySelector('.doubled').textContent).toBe('200')
      expect(testContainer.querySelector('.tripled').textContent).toBe('300')

      // Update store
      store.state.value = 50
      await waitForUpdate(100)

      // Both components should update
      expect(testContainer.querySelector('.doubled').textContent).toBe('100')
      expect(testContainer.querySelector('.tripled').textContent).toBe('150')
    })
  })

  describe('Nested Property Access Tracking', () => {
    it('tracks nested state property access', async () => {
      const store = wildflower.store('nested-store', {
        state: {
          user: {
            profile: {
              name: 'Alice'
            }
          }
        }
      })

      wildflower.component('nested-observer', {
        computed: {
          userName() {
            return wildflower.getStore('nested-store').state.user.profile.name
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="nested-observer">
          <span class="user-name" data-bind="computed:userName"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Verify initial render
      expect(testContainer.querySelector('.user-name').textContent).toBe('Alice')

      // Update nested property
      store.state.user = { profile: { name: 'Bob' } }
      await waitForUpdate(100)

      // Should update
      expect(testContainer.querySelector('.user-name').textContent).toBe('Bob')
    })
  })

  describe('Store Method Calls During Computed', () => {
    it('store methods remain callable through tracking proxy', async () => {
      wildflower.store('method-store', {
        state: { items: ['a', 'b', 'c'] },
        getItemAt(args) {
          return this.state.items[args.index]
        }
      })

      wildflower.component('method-caller', {
        computed: {
          secondItem() {
            const store = wildflower.getStore('method-store')
            return store.getItemAt({ index: 1 })
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="method-caller">
          <span class="item" data-bind="computed:secondItem"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Verify method call works through proxy
      expect(testContainer.querySelector('.item').textContent).toBe('b')
    })
  })

  describe('Edge Cases', () => {
    it('handles store accessed in multiple computed properties', async () => {
      const store = wildflower.store('multi-computed-store', {
        state: { x: 10, y: 20 }
      })

      wildflower.component('multi-computed', {
        computed: {
          sumX() {
            return wildflower.getStore('multi-computed-store').state.x + 5
          },
          sumY() {
            return wildflower.getStore('multi-computed-store').state.y + 5
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="multi-computed">
          <span class="sum-x" data-bind="computed:sumX"></span>
          <span class="sum-y" data-bind="computed:sumY"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      expect(testContainer.querySelector('.sum-x').textContent).toBe('15')
      expect(testContainer.querySelector('.sum-y').textContent).toBe('25')

      // Update x
      store.state.x = 100
      await waitForUpdate(100)
      expect(testContainer.querySelector('.sum-x').textContent).toBe('105')

      // Update y
      store.state.y = 200
      await waitForUpdate(100)
      expect(testContainer.querySelector('.sum-y').textContent).toBe('205')
    })

    it('does not interfere with non-computed store access', async () => {
      const store = wildflower.store('action-store', {
        state: { count: 0 }
      })

      let actionCalled = false

      wildflower.component('action-component', {
        state: { localCount: 0 },
        incrementStore() {
          // This should NOT trigger tracking (not in computed)
          const store = wildflower.getStore('action-store')
          store.state.count++
          actionCalled = true
        }
      })

      testContainer.innerHTML = `
        <div data-component="action-component">
          <button data-action="incrementStore">Increment</button>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()
      const instance = getComponentInstance('[data-component="action-component"]')

      // Call the action
      instance.incrementStore()
      await waitForUpdate()

      expect(actionCalled).toBe(true)
      expect(store.state.count).toBe(1)
    })

    it('handles store not found gracefully', async () => {
      wildflower.component('missing-store-component', {
        computed: {
          safeValue() {
            const store = wildflower.getStore('nonexistent-store')
            return store ? store.state.value : 'default'
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="missing-store-component">
          <span class="value" data-bind="computed:safeValue"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Should handle gracefully
      expect(testContainer.querySelector('.value').textContent).toBe('default')
    })
  })

  describe('Real-world Scenarios', () => {
    it('task manager pattern: stats component reads from tasks store', async () => {
      // Create tasks store
      wildflower.store('tasks', {
        state: {
          items: [
            { id: 1, title: 'Task 1', completed: true },
            { id: 2, title: 'Task 2', completed: false },
            { id: 3, title: 'Task 3', completed: false }
          ]
        },
        computed: {
          totalCount() {
            return this.state.items.length
          },
          completedCount() {
            return this.state.items.filter(t => t.completed).length
          },
          activeCount() {
            return this.state.items.filter(t => !t.completed).length
          }
        }
      })

      // Stats component - NO _v hack, NO subscribe
      wildflower.component('stats-bar', {
        computed: {
          total() {
            return wildflower.getStore('tasks').computed.totalCount
          },
          completed() {
            return wildflower.getStore('tasks').computed.completedCount
          },
          active() {
            return wildflower.getStore('tasks').computed.activeCount
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="stats-bar">
          <span class="total" data-bind="computed:total"></span>
          <span class="completed" data-bind="computed:completed"></span>
          <span class="active" data-bind="computed:active"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Verify initial values
      expect(testContainer.querySelector('.total').textContent).toBe('3')
      expect(testContainer.querySelector('.completed').textContent).toBe('1')
      expect(testContainer.querySelector('.active').textContent).toBe('2')

      // Add a task
      const store = wildflower.getStore('tasks')
      store.state.items = [...store.state.items, { id: 4, title: 'Task 4', completed: false }]
      await waitForUpdate(100)

      // Stats should auto-update
      expect(testContainer.querySelector('.total').textContent).toBe('4')
      expect(testContainer.querySelector('.active').textContent).toBe('3')

      // Complete a task
      store.state.items = store.state.items.map(t =>
        t.id === 2 ? { ...t, completed: true } : t
      )
      await waitForUpdate(100)

      expect(testContainer.querySelector('.completed').textContent).toBe('2')
      expect(testContainer.querySelector('.active').textContent).toBe('2')
    })

    it('view switching pattern: app component reads ui store', async () => {
      wildflower.store('ui', {
        state: { view: 'home' }
      })

      // App component - NO _v hack, NO subscribe
      wildflower.component('app-view', {
        computed: {
          showHome() {
            return wildflower.getStore('ui').state.view === 'home'
          },
          showSettings() {
            return wildflower.getStore('ui').state.view === 'settings'
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="app-view">
          <div class="home" data-show="computed:showHome">Home View</div>
          <div class="settings" data-show="computed:showSettings">Settings View</div>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Verify initial state
      expect(testContainer.querySelector('.home').style.display).not.toBe('none')
      expect(testContainer.querySelector('.settings').style.display).toBe('none')

      // Change view
      const store = wildflower.getStore('ui')
      store.state.view = 'settings'
      await waitForUpdate(100)

      // Views should auto-update
      expect(testContainer.querySelector('.home').style.display).toBe('none')
      expect(testContainer.querySelector('.settings').style.display).not.toBe('none')
    })
  })
})
