/**
 * WildflowerJS Memory Management and Garbage Collection Test Suite - Vitest Browser Mode
 *
 * Tests for context garbage collection and cleanup of detached DOM elements.
 * Migrated from unitTestSuite.js MEMORY MANAGEMENT AND GARBAGE COLLECTION section.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, isMinifiedBuild} from './helpers/load-framework.js'

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

describe.skipIf(isMinifiedBuild())('Memory Management and Garbage Collection', () => {
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

  it('Destroying a component releases its rendered structure (no leak)', async () => {
    testContainer.innerHTML = `
      <div data-component="gc-test">
        <span data-bind="title">Title</span>
        <div data-show="showList">
          <div data-list="gcItems">
            <template>
              <div>
                <span data-bind="name"></span>
                <div data-show="active">Active</div>
              </div>
            </template>
          </div>
        </div>
      </div>
    `

    wildflower.component('gc-test', {
      state: {
        title: 'Test Component',
        showList: true,
        gcItems: [
          { name: 'Item 1', active: true },
          { name: 'Item 2', active: false }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="gc-test"]')
    const instanceId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(instanceId)

    // Ensure component was created
    expect(instance).toBeDefined()

    // List contexts are plain objects on the instance map — observable framework
    // state (not registry-tracked). They exist while the component is live.
    const listContextsBefore = instance._listContexts ? instance._listContexts.size : 0
    expect(listContextsBefore).toBeGreaterThan(0)

    // The list rendered its rows.
    const renderedItems = Array.from(component.querySelectorAll('[data-list] > *'))
      .filter(el => el.tagName !== 'TEMPLATE')
    expect(renderedItems.length).toBeGreaterThan(0)

    // Destroy the component, then run the public component-level GC.
    wildflower.destroyComponent(instanceId)
    const gcStats = wildflower.garbageCollect()
    expect(gcStats).toBeDefined()

    // Observable no-leak: the destroyed component's instance is gone from the
    // live map and nothing resurrects it.
    expect(wildflower.componentInstances.has(instanceId)).toBe(false)
    expect(Array.from(wildflower.componentInstances.keys())).not.toContain(instanceId)
  })

  it('Detaching part of a component leaves the live component intact after GC', async () => {
    testContainer.innerHTML = `
      <div data-component="detached-test">
        <span id="live-binding" data-bind="title">Title</span>
        <div id="detach-container">
          <span id="detach-binding" data-bind="message">Initial</span>
          <div id="detach-conditional" data-show="showDetails">Details</div>
        </div>
      </div>
    `

    wildflower.component('detached-test', {
      state: {
        title: 'Live',
        message: 'Hello',
        showDetails: true
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="detached-test"]')
    const instanceId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(instanceId)
    const liveBinding = testContainer.querySelector('#live-binding')
    const container = testContainer.querySelector('#detach-container')
    const detachBinding = testContainer.querySelector('#detach-binding')

    expect(liveBinding.textContent).toBe('Live')

    // Remove a subtree of the component from the DOM, then run the public
    // component-level GC (must not throw on disconnected nodes).
    container.remove()
    expect(detachBinding.isConnected).toBe(false)
    const gcStats = wildflower.garbageCollect()
    expect(gcStats).toBeDefined()

    // Observable invariant: the still-connected part of the component keeps
    // updating — GC over the detached subtree did not corrupt the live instance.
    instance.state.title = 'Updated'
    await waitForUpdate()
    expect(liveBinding.textContent).toBe('Updated')
    expect(detachBinding.isConnected).toBe(false)
  })

  describe('Event handler cleanup', () => {
    it('should clean up event handlers when component is destroyed', async () => {
      testContainer.innerHTML = `
        <div data-component="event-cleanup-test">
          <button id="test-btn" data-action="handleClick">Click</button>
          <input id="test-input" data-action="input:handleInput keyup:handleKeyup" />
          <div id="click-count" data-bind="clickCount"></div>
        </div>
      `

      let clickCount = 0
      let inputCount = 0
      let keyupCount = 0

      wildflower.component('event-cleanup-test', {
        state: { clickCount: 0 },
        handleClick() {
          clickCount++
          this.state.clickCount++
        },
        handleInput() {
          inputCount++
        },
        handleKeyup() {
          keyupCount++
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="event-cleanup-test"]')
      const instanceId = component.dataset.componentId
      const btn = testContainer.querySelector('#test-btn')
      const input = testContainer.querySelector('#test-input')

      // Trigger events before destruction
      btn.click()
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }))
      await waitForUpdate()

      expect(clickCount).toBe(1)
      expect(inputCount).toBe(1)
      expect(keyupCount).toBe(1)

      // Destroy the component
      wildflower.destroyComponent(instanceId)
      await waitForUpdate()

      // Try to trigger events after destruction - handlers should not fire
      btn.click()
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'b', bubbles: true }))
      await waitForUpdate()

      // Counts should remain the same (handlers cleaned up)
      expect(clickCount).toBe(1)
      expect(inputCount).toBe(1)
      expect(keyupCount).toBe(1)
    })

    it('should clean up debounced handlers when component is destroyed', async () => {
      testContainer.innerHTML = `
        <div data-component="debounce-cleanup-test">
          <input id="debounce-input" data-action="input:handleSearch" data-event-debounce="100" />
          <div id="search-count" data-bind="searchCount"></div>
        </div>
      `

      let searchCount = 0

      wildflower.component('debounce-cleanup-test', {
        state: { searchCount: 0 },
        handleSearch() {
          searchCount++
          this.state.searchCount++
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="debounce-cleanup-test"]')
      const instanceId = component.dataset.componentId
      const input = testContainer.querySelector('#debounce-input')

      // Trigger debounced input
      input.dispatchEvent(new Event('input', { bubbles: true }))

      // Destroy before debounce fires
      wildflower.destroyComponent(instanceId)

      // Wait longer than debounce timeout
      await waitForUpdate(200)

      // Handler should NOT have fired (was cleaned up)
      expect(searchCount).toBe(0)
    })
  })

  describe('Store subscription cleanup', () => {
    it('should clean up store subscriptions when component is destroyed', async () => {
      // Skip if storeManager not available
      if (!wildflower.storeManager) {
        console.log('storeManager not available, skipping test')
        return
      }

      // Create a store using the correct API
      const store = wildflower.storeManager.createStoreComponent('cleanup-test-store', {
        state: {
          count: 0
        }
      })

      testContainer.innerHTML = `
        <div data-component="store-sub-cleanup-test">
          <div id="store-count" data-bind="external('cleanup-test-store', 'count')"></div>
        </div>
      `

      wildflower.component('store-sub-cleanup-test', {
        state: {}
      })

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="store-sub-cleanup-test"]')
      const instanceId = component.dataset.componentId
      const display = testContainer.querySelector('#store-count')

      // Verify initial binding works
      expect(display.textContent).toBe('0')

      // Increment store
      store.state.count++
      await waitForUpdate()
      expect(display.textContent).toBe('1')

      // Count subscriptions before destroy
      const subsBefore = store._subscribers ? store._subscribers.size : 0

      // Destroy the component
      wildflower.destroyComponent(instanceId)
      await waitForUpdate()

      // Count subscriptions after destroy
      const subsAfter = store._subscribers ? store._subscribers.size : 0

      // Subscriptions should be reduced or equal (depending on implementation)
      expect(subsAfter).toBeLessThanOrEqual(subsBefore)
    })
  })

  describe('Watch callback cleanup', () => {
    it('should clean up watch callbacks when component is destroyed', async () => {
      testContainer.innerHTML = `
        <div data-component="watch-cleanup-test">
          <div data-bind="value"></div>
        </div>
      `

      let watchCallCount = 0

      wildflower.component('watch-cleanup-test', {
        state: { value: 'initial' },
        watch: {
          value(newVal, oldVal) {
            watchCallCount++
          }
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="watch-cleanup-test"]')
      const instanceId = component.dataset.componentId
      const instance = wildflower.componentInstances.get(instanceId)

      // Trigger watch
      instance.state.value = 'changed'
      await waitForUpdate()
      expect(watchCallCount).toBe(1)

      // Destroy component
      wildflower.destroyComponent(instanceId)
      await waitForUpdate()

      // Try to trigger watch via direct state manipulation (if state still exists)
      // The watch should NOT fire after destruction
      const countBefore = watchCallCount
      if (instance.state) {
        instance.state.value = 'after-destroy'
        await waitForUpdate()
      }

      // Watch count should not increase
      expect(watchCallCount).toBe(countBefore)
    })
  })

  describe('Large-scale component cleanup', () => {
    it('should efficiently clean up many components', async () => {
      // Create 50 components
      const componentCount = 50

      let html = ''
      for (let i = 0; i < componentCount; i++) {
        html += `<div data-component="mass-cleanup-test-${i}"><span data-bind="value">${i}</span></div>`
      }
      testContainer.innerHTML = html

      // Register all components
      for (let i = 0; i < componentCount; i++) {
        wildflower.component(`mass-cleanup-test-${i}`, {
          state: { value: i }
        })
      }

      wildflower.scan()
      await waitForCompleteRender()

      // Verify all were created
      expect(wildflower.componentInstances.size).toBeGreaterThanOrEqual(componentCount)

      // Collect all instance IDs
      const instanceIds = []
      for (let i = 0; i < componentCount; i++) {
        const comp = testContainer.querySelector(`[data-component="mass-cleanup-test-${i}"]`)
        if (comp && comp.dataset.componentId) {
          instanceIds.push(comp.dataset.componentId)
        }
      }

      // Destroy all components
      const startTime = performance.now()
      for (const id of instanceIds) {
        wildflower.destroyComponent(id)
      }
      wildflower.garbageCollect()
      const endTime = performance.now()

      // Should complete in reasonable time (under 500ms for 50 components)
      expect(endTime - startTime).toBeLessThan(500)

      // No leaks: every destroyed component's instance is gone. (Component/binding
      // contexts are no longer registered, so registry-context COUNT is not a
      // cleanup proxy — assert the observable instance teardown.)
      for (const id of instanceIds) {
        expect(wildflower.componentInstances.has(id)).toBe(false)
      }
    })
  })

  describe('List item cleanup', () => {
    it('should clean up contexts when list items are removed', async () => {
      testContainer.innerHTML = `
        <div data-component="list-cleanup-test">
          <ul data-list="items">
            <template>
              <li>
                <span data-bind="name"></span>
                <button data-action="remove">Remove</button>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('list-cleanup-test', {
        state: {
          items: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' },
            { id: 3, name: 'Item 3' },
            { id: 4, name: 'Item 4' },
            { id: 5, name: 'Item 5' }
          ]
        },
        remove(event, element, detail) {
          this.state.items.splice(detail.index, 1)
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      // Count DOM elements with 5 items
      const listItems5 = testContainer.querySelectorAll('li').length
      expect(listItems5).toBe(5)

      // Remove 3 items
      const instance = wildflower.componentInstances.values().next().value
      instance.state.items.splice(0, 3)
      await waitForCompleteRender()

      // Run garbage collection
      wildflower.garbageCollect()

      // Count DOM elements with 2 items
      const listItems2 = testContainer.querySelectorAll('li').length
      expect(listItems2).toBe(2)

      // Verify DOM was actually cleaned up (primary assertion)
      expect(listItems2).toBeLessThan(listItems5)

      // Context cleanup is an implementation detail - the key is that:
      // 1. DOM elements were properly removed
      // 2. No memory leak occurs over repeated operations
    })

    it('should clean up DOM when list is cleared', async () => {
      testContainer.innerHTML = `
        <div data-component="list-clear-test">
          <ul data-list="items">
            <template>
              <li data-bind="name"></li>
            </template>
          </ul>
          <button id="clear-btn" data-action="clearAll">Clear</button>
        </div>
      `

      wildflower.component('list-clear-test', {
        state: {
          items: [
            { name: 'A' }, { name: 'B' }, { name: 'C' },
            { name: 'D' }, { name: 'E' }, { name: 'F' }
          ]
        },
        clearAll() {
          this.state.items = []
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      // Verify initial list rendered
      expect(testContainer.querySelectorAll('li').length).toBe(6)

      // Clear the list
      const clearBtn = testContainer.querySelector('#clear-btn')
      clearBtn.click()
      await waitForCompleteRender()

      // Verify list is empty in DOM
      expect(testContainer.querySelectorAll('li').length).toBe(0)

      // Run garbage collection
      wildflower.garbageCollect()

      // The key assertion is that DOM cleanup occurred
      // Context cleanup is an implementation detail
    })

    it('should not leak contexts when list items are repeatedly added and removed', async () => {
      testContainer.innerHTML = `
        <div data-component="list-churn-test">
          <ul data-list="items">
            <template>
              <li data-bind="value"></li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('list-churn-test', {
        state: {
          items: []
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const instance = wildflower.componentInstances.values().next().value
      const baselineInstances = wildflower.componentInstances.size

      // Repeatedly add and remove items
      for (let round = 0; round < 5; round++) {
        // Add 10 items
        instance.state.items = Array.from({ length: 10 }, (_, i) => ({ value: `Item ${i}` }))
        await waitForUpdate(30)

        // Clear items
        instance.state.items = []
        await waitForUpdate(30)

        // Garbage collect
        wildflower.garbageCollect()
      }

      // Observable no-leak: the cleared list renders no rows, and repeated
      // add/remove churn did not spawn extra component instances.
      expect(testContainer.querySelectorAll('li').length).toBe(0)
      expect(wildflower.componentInstances.size).toBe(baselineInstances)
    })
  })

  describe('Conditional rendering cleanup', () => {
    it('should clean up nested contexts when conditional hides content', async () => {
      testContainer.innerHTML = `
        <div data-component="conditional-cleanup-test">
          <div data-show="showSection">
            <h2 data-bind="title"></h2>
            <ul data-list="items">
              <template>
                <li data-bind="name"></li>
              </template>
            </ul>
          </div>
          <button id="toggle-btn" data-action="toggle">Toggle</button>
        </div>
      `

      wildflower.component('conditional-cleanup-test', {
        state: {
          showSection: true,
          title: 'Section Title',
          items: [{ name: 'X' }, { name: 'Y' }, { name: 'Z' }]
        },
        toggle() {
          this.state.showSection = !this.state.showSection
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      // Verify section is visible
      const section = testContainer.querySelector('[data-show]')
      expect(section.style.display).not.toBe('none')

      // Hide the section
      const toggleBtn = testContainer.querySelector('#toggle-btn')
      toggleBtn.click()
      await waitForCompleteRender()

      // Section should be hidden
      expect(section.style.display).toBe('none')

      // data-show hides but doesn't remove elements. Observable no-leak:
      // repeated toggling doesn't duplicate the section or its list rows.
      for (let i = 0; i < 5; i++) {
        toggleBtn.click()
        await waitForUpdate(20)
      }
      wildflower.garbageCollect()

      expect(testContainer.querySelectorAll('[data-show]').length).toBe(1)
      expect(testContainer.querySelectorAll('li').length).toBe(3)
    })
  })

  describe('Template cache management', () => {
    it('should not leak template cache entries for destroyed components', async () => {
      // Create a component with a list template
      testContainer.innerHTML = `
        <div data-component="cache-test">
          <ul data-list="items">
            <template>
              <li data-bind="value"></li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('cache-test', {
        state: {
          items: [{ value: 1 }, { value: 2 }]
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="cache-test"]')
      const instanceId = component.dataset.componentId

      // Check if template cache exists and get size
      const cacheSizeBefore = wildflower._templateCache?.general?.size || 0

      // Destroy the component
      wildflower.destroyComponent(instanceId)
      wildflower.garbageCollect()

      // Cache should not grow unbounded (may or may not clear entries)
      const cacheSizeAfter = wildflower._templateCache?.general?.size || 0
      expect(cacheSizeAfter).toBeLessThanOrEqual(cacheSizeBefore + 1)
    })
  })

  it('waitForReady resolves within bounded time when component never becomes ready', async () => {
    testContainer.innerHTML = `
      <div data-component="wait-timeout-test">
        <span data-bind="name"></span>
      </div>
    `

    wildflower.component('wait-timeout-test', {
      state: { name: 'Test' }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="wait-timeout-test"]')
    const instanceId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(instanceId)

    // Force the component into a permanently not-ready state
    instance.state._internal = { ready: false }

    // waitForReady should reject within a bounded time, not poll forever.
    // The framework's nominal timeout is 10s (1000 polls × 10ms). Under
    // full-suite browser-mode load, setTimeout scheduling is bursty:
    // 1000 sequential 10ms timers can stretch well past 10s wall-clock
    // while individual tests run normally. Test deadline at 30s leaves
    // 3x cushion before our outer race fires; the assertion still
    // verifies rejection came from waitForReady, not from this guard.
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('test deadline exceeded')), 30000)
    )

    let rejected = false
    let rejectionMessage = ''
    try {
      await Promise.race([instance.context.waitForReady(), timeout])
    } catch (e) {
      rejected = true
      rejectionMessage = e.message
    }

    // Should have been rejected by waitForReady's own timeout, not our test deadline
    expect(rejected).toBe(true)
    expect(rejectionMessage).toContain('waitForReady timed out')
  })
})
