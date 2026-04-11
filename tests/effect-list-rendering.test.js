/**
 * Effect-Based List Rendering Test Suite - Phase 2
 *
 * Tests for the Effect-based list item rendering system.
 * See: docs/future/EFFECT_PHASE2_LIST_RENDERING_PLAN.md
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

describe('Effect-Based List Rendering - Phase 2', () => {
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

  describe('_createItemEffect', () => {
    it('should create an Effect for a list item', async () => {
      // Register component with list
      wildflower.component('effect-list-test-1', {
        state: {
          items: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-list-test-1">
          <div data-list="items">
            <template>
              <div class="item">
                <span class="name" data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      // Get the component instance
      const component = wildflower.componentInstances.values().next().value
      expect(component).toBeDefined()
      expect(component.stateManager).toBeDefined()
      expect(typeof component.stateManager.createEffect).toBe('function')

      // Get the list element and compiled metadata
      const listEl = testContainer.querySelector('[data-list="items"]')
      expect(listEl).toBeDefined()

      // Get list items
      const items = listEl.querySelectorAll('.item')
      expect(items.length).toBe(2)

      // Verify initial render - use class selector instead of attribute
      expect(items[0].querySelector('.name').textContent).toBe('Item 1')
      expect(items[1].querySelector('.name').textContent).toBe('Item 2')
    })

    it('should re-render when item data changes via direct mutation', async () => {
      wildflower.component('effect-list-test-2', {
        state: {
          items: [
            { id: 1, name: 'Original Name' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-list-test-2">
          <div data-list="items">
            <template>
              <div class="item">
                <span class="name" data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      const component = wildflower.componentInstances.values().next().value
      const listEl = testContainer.querySelector('[data-list="items"]')
      const nameSpan = listEl.querySelector('.name')

      expect(nameSpan.textContent).toBe('Original Name')

      // Mutate the item directly
      component.state.items[0].name = 'Updated Name'
      await waitForMicrotask()
      await waitForUpdate(50)

      // The binding should update
      expect(nameSpan.textContent).toBe('Updated Name')
    })

    it('should handle data-show bindings reactively', async () => {
      wildflower.component('effect-list-test-3', {
        state: {
          items: [
            { id: 1, name: 'Item 1', visible: true },
            { id: 2, name: 'Item 2', visible: false }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-list-test-3">
          <div data-list="items">
            <template>
              <div class="item" data-show="visible">
                <span data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      const items = testContainer.querySelectorAll('.item')
      expect(items[0].style.display).not.toBe('none')
      expect(items[1].style.display).toBe('none')

      // Toggle visibility
      const component = wildflower.componentInstances.values().next().value
      component.state.items[1].visible = true
      await waitForMicrotask()
      await waitForUpdate(50)

      expect(items[1].style.display).not.toBe('none')
    })

    it('should handle data-bind-class bindings reactively', async () => {
      wildflower.component('effect-list-test-4', {
        state: {
          items: [
            { id: 1, name: 'Item 1', status: 'active' },
            { id: 2, name: 'Item 2', status: 'inactive' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-list-test-4">
          <div data-list="items">
            <template>
              <div class="item" data-bind-class="status">
                <span data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      const items = testContainer.querySelectorAll('.item')
      expect(items[0].classList.contains('active')).toBe(true)
      expect(items[1].classList.contains('inactive')).toBe(true)

      // Change status
      const component = wildflower.componentInstances.values().next().value
      component.state.items[0].status = 'completed'
      await waitForMicrotask()
      await waitForUpdate(50)

      expect(items[0].classList.contains('completed')).toBe(true)
    })
  })

  describe('ItemEffect disposal', () => {
    it('should dispose Effects when items are removed', async () => {
      wildflower.component('effect-list-dispose-1', {
        state: {
          items: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' },
            { id: 3, name: 'Item 3' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-list-dispose-1">
          <div data-list="items">
            <template>
              <div class="item">
                <span class="name" data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      const component = wildflower.componentInstances.values().next().value
      let items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(3)

      // Remove an item
      component.state.items.splice(1, 1) // Remove middle item
      await waitForMicrotask()
      await waitForUpdate(100)

      items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(2)
      expect(items[0].querySelector('.name').textContent).toBe('Item 1')
      expect(items[1].querySelector('.name').textContent).toBe('Item 3')
    })
  })

  describe('Effect batching', () => {
    it('should batch multiple item updates into single render cycle', async () => {
      wildflower.component('effect-list-batch-1', {
        state: {
          items: [
            { id: 1, name: 'A', count: 0 },
            { id: 2, name: 'B', count: 0 },
            { id: 3, name: 'C', count: 0 }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-list-batch-1">
          <div data-list="items">
            <template>
              <div class="item">
                <span data-bind="name"></span>
                <span class="count" data-bind="count"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      const component = wildflower.componentInstances.values().next().value

      // Update multiple items rapidly
      component.state.items[0].count = 1
      component.state.items[1].count = 2
      component.state.items[2].count = 3
      component.state.items[0].count = 10
      component.state.items[1].count = 20
      component.state.items[2].count = 30

      await waitForMicrotask()
      await waitForUpdate(50)

      // Final values should be correct (batched)
      const counts = testContainer.querySelectorAll('.count')
      expect(counts[0].textContent).toBe('10')
      expect(counts[1].textContent).toBe('20')
      expect(counts[2].textContent).toBe('30')
    })
  })

  describe('Opt-in Effect rendering via data-list-mode="maparray"', () => {
    it.skipIf(isMinifiedBuild())('should create ItemEffects when data-list-mode="maparray" is set', async () => {
      wildflower.component('effect-optin-test-1', {
        state: {
          items: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-optin-test-1">
          <div data-list="items" data-list-mode="maparray">
            <template>
              <div class="item">
                <span class="name" data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      const listEl = testContainer.querySelector('[data-list="items"]')
      const items = listEl.querySelectorAll('.item')

      // Verify items are rendered
      expect(items.length).toBe(2)
      expect(items[0].querySelector('.name').textContent).toBe('Item 1')
      expect(items[1].querySelector('.name').textContent).toBe('Item 2')

      // Verify ItemEffects are attached (mapArray creates dispose functions)
      expect(items[0]._wfDisposeEffect).toBeDefined()
      expect(typeof items[0]._wfDisposeEffect).toBe('function')
      expect(items[1]._wfDisposeEffect).toBeDefined()

      // Verify list is initialized with mapArray
      expect(listEl._mapArrayInitialized).toBe(true)
    })

    it('should update bindings reactively via ItemEffects', async () => {
      wildflower.component('effect-optin-test-2', {
        state: {
          items: [
            { id: 1, name: 'Original' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-optin-test-2">
          <div data-list="items" data-list-mode="maparray">
            <template>
              <div class="item">
                <span class="name" data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      const component = wildflower.componentInstances.values().next().value
      const nameSpan = testContainer.querySelector('.name')

      expect(nameSpan.textContent).toBe('Original')

      // Change data - should trigger Effect re-run
      component.state.items[0].name = 'Updated via Effect'
      await waitForMicrotask()
      await waitForUpdate(50)

      expect(nameSpan.textContent).toBe('Updated via Effect')
    })

    it.skipIf(isMinifiedBuild())('should dispose ItemEffects when items are removed', async () => {
      wildflower.component('effect-optin-test-3', {
        state: {
          items: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' },
            { id: 3, name: 'Item 3' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-optin-test-3">
          <div data-list="items" data-list-mode="maparray">
            <template>
              <div class="item">
                <span class="name" data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      const component = wildflower.componentInstances.values().next().value
      let items = testContainer.querySelectorAll('.item')

      // Store reference to second item's dispose function
      const secondItemDisposeRef = items[1]._wfDisposeEffect
      expect(secondItemDisposeRef).toBeDefined()

      // Remove second item
      component.state.items.splice(1, 1)
      await waitForMicrotask()
      await waitForUpdate(100)

      // Verify item was removed
      items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(2)
      expect(items[0].querySelector('.name').textContent).toBe('Item 1')
      expect(items[1].querySelector('.name').textContent).toBe('Item 3')
    })

    it.skipIf(isMinifiedBuild())('should create ItemEffects for appended items', async () => {
      wildflower.component('effect-optin-test-4', {
        state: {
          items: [
            { id: 1, name: 'Item 1' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-optin-test-4">
          <div data-list="items" data-list-mode="maparray">
            <template>
              <div class="item">
                <span class="name" data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      const component = wildflower.componentInstances.values().next().value
      let items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(1)
      expect(items[0]._wfDisposeEffect).toBeDefined()

      // Append a new item
      component.state.items.push({ id: 2, name: 'Item 2' })
      await waitForMicrotask()
      await waitForUpdate(100)

      items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(2)
      expect(items[1].querySelector('.name').textContent).toBe('Item 2')

      // Verify the new item has an ItemEffect
      expect(items[1]._wfDisposeEffect).toBeDefined()
      expect(typeof items[1]._wfDisposeEffect).toBe('function')

      // Verify the new item's Effect works reactively
      component.state.items[1].name = 'Updated Item 2'
      await waitForMicrotask()
      await waitForUpdate(50)

      expect(items[1].querySelector('.name').textContent).toBe('Updated Item 2')
    })
  })

  // Direct _createItemEffect usage tests removed — dead code (Sprint 3)

  describe('Expression bindings in Effects', () => {
    it('should handle expression bindings reactively', async () => {
      wildflower.component('effect-list-expr-1', {
        state: {
          items: [
            { id: 1, price: 10, qty: 2 },
            { id: 2, price: 20, qty: 3 }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-list-expr-1">
          <div data-list="items">
            <template>
              <div class="item">
                <span class="total" data-bind="price * qty"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      const totals = testContainer.querySelectorAll('.total')
      expect(totals[0].textContent).toBe('20')
      expect(totals[1].textContent).toBe('60')

      // Update a value
      const component = wildflower.componentInstances.values().next().value
      component.state.items[0].qty = 5
      await waitForMicrotask()
      await waitForUpdate(50)

      expect(totals[0].textContent).toBe('50')
    })

    it('should handle _index list context variable', async () => {
      wildflower.component('effect-list-index-1', {
        state: {
          items: [
            { id: 1, name: 'A' },
            { id: 2, name: 'B' },
            { id: 3, name: 'C' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="effect-list-index-1">
          <div data-list="items">
            <template>
              <div class="item">
                <span class="index" data-bind="_index"></span>
                <span data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate(100)

      const indices = testContainer.querySelectorAll('.index')
      expect(indices[0].textContent).toBe('0')
      expect(indices[1].textContent).toBe('1')
      expect(indices[2].textContent).toBe('2')
    })
  })
})
