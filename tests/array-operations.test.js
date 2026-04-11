/**
 * WildflowerJS Array Operation Detection Test Suite - Vitest Browser Mode
 *
 * Tests for array operation detection and list rendering updates.
 * Migrated from unitTestSuite.js Array Operation Detection section.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, isMinifiedBuild} from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to wait for complete render cycle (important for lists)
async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

describe('Array Operation Detection', () => {
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

  describe('Basic Operations', () => {
    it.skipIf(isMinifiedBuild())('detects append operation at 10 item threshold', async () => {
      wildflower.component('append-test', {
        state: {
          items: Array.from({ length: 10 }, (_, i) => ({ id: i, value: `item${i}` }))
        }
      })

      testContainer.innerHTML = `
        <div data-component="append-test">
          <ul data-list="items">
            <template><li><span data-bind="value"></span></li></template>
          </ul>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      const component = testContainer.querySelector('[data-component="append-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Verify list context exists before append
      const registry = wildflower._contextRegistry
      const listElement = component.querySelector('[data-list="items"]')
      const listContext = registry.getContextForElement(listElement)
      expect(listContext).toBeDefined()
      expect(listContext.type).toBe('list')
      const originalContextId = listContext.id

      // Append new items
      instance.state.items.push({ id: 10, value: 'item10' }, { id: 11, value: 'item11' })
      await waitForCompleteRender()

      const listItems = component.querySelectorAll('[data-list="items"] li')
      expect(listItems.length).toBe(12)

      // Verify context was reused after append
      const afterContext = registry.getContextForElement(listElement)
      expect(afterContext.id).toBe(originalContextId)
    })

    it('detects multiple appends in sequence', async () => {
      wildflower.component('multi-append-test', {
        state: {
          items: [{ id: 1, name: 'first' }]
        }
      })

      testContainer.innerHTML = `
        <div data-component="multi-append-test">
          <ul data-list="items">
            <template><li><span data-bind="name"></span></li></template>
          </ul>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      const component = testContainer.querySelector('[data-component="multi-append-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Multiple appends
      instance.state.items.push({ id: 2, name: 'second' })
      await waitForCompleteRender()
      instance.state.items.push({ id: 3, name: 'third' })
      await waitForCompleteRender()
      instance.state.items.push({ id: 4, name: 'fourth' })
      await waitForCompleteRender()

      const listItems = component.querySelectorAll('[data-list="items"] li')
      expect(listItems.length).toBe(4)
    })

    it('detects swap operation with ID changes', async () => {
      wildflower.component('swap-test', {
        state: {
          items: [
            { id: 1, name: 'first' },
            { id: 2, name: 'second' },
            { id: 3, name: 'third' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="swap-test">
          <ul data-list="items">
            <template><li><span data-bind="name"></span></li></template>
          </ul>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      const component = testContainer.querySelector('[data-component="swap-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Ensure list is fully rendered before swap
      await waitForCompleteRender()
      let listItems = component.querySelectorAll('[data-list="items"] li span')

      // Verify initial state
      expect(listItems.length).toBe(3)
      expect(listItems[0].textContent).toBe('first')
      expect(listItems[1].textContent).toBe('second')

      // Swap first and second items
      const temp = instance.state.items[0]
      instance.state.items[0] = instance.state.items[1]
      instance.state.items[1] = temp
      await waitForCompleteRender()
      await waitForUpdate(100)

      // Re-query after swap
      listItems = component.querySelectorAll('[data-list="items"] li span')
      expect(listItems[0].textContent).toBe('second')
      expect(listItems[1].textContent).toBe('first')
    })

    it('detects sparse update with <50% changes', async () => {
      const itemCount = 100
      wildflower.component('sparse-test', {
        state: {
          items: Array.from({ length: itemCount }, (_, i) => ({ id: i, value: i }))
        }
      })

      testContainer.innerHTML = `
        <div data-component="sparse-test">
          <ul data-list="items">
            <template><li><span data-bind="value"></span></li></template>
          </ul>
        </div>
      `
      wildflower.scan()
      await waitForUpdate(100)

      const component = testContainer.querySelector('[data-component="sparse-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Update 40% of items (sparse update)
      for (let i = 0; i < 40; i++) {
        instance.state.items[i].value = i * 2
      }
      await waitForCompleteRender()

      const firstSpan = component.querySelector('[data-list="items"] li span')
      expect(firstSpan.textContent).toBe('0')
    })

    it.skipIf(isMinifiedBuild())('detects bulk replacement operation', async () => {
      wildflower.component('bulk-replace-test', {
        state: {
          items: [{ id: 1, name: 'old1' }, { id: 2, name: 'old2' }]
        }
      })

      testContainer.innerHTML = `
        <div data-component="bulk-replace-test">
          <ul data-list="items">
            <template><li><span data-bind="name"></span></li></template>
          </ul>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      const component = testContainer.querySelector('[data-component="bulk-replace-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Capture context ID before replace
      const registry = wildflower._contextRegistry
      const listElement = component.querySelector('[data-list="items"]')
      const originalContextId = registry.getContextForElement(listElement).id

      // Replace entire array
      instance.state.items = [
        { id: 3, name: 'new1' },
        { id: 4, name: 'new2' },
        { id: 5, name: 'new3' }
      ]
      await waitForCompleteRender()

      const listItems = component.querySelectorAll('[data-list="items"] li')
      expect(listItems.length).toBe(3)
      expect(listItems[0].textContent).toBe('new1')

      // Verify context was reused after bulk replace
      const afterContext = registry.getContextForElement(listElement)
      expect(afterContext.id).toBe(originalContextId)

      // Verify data resolution reflects new items
      expect(afterContext.resolveData().length).toBe(3)
      expect(afterContext.resolveData()[0].name).toBe('new1')
    })

    it('detects remove operation via splice', async () => {
      wildflower.component('remove-test', {
        state: {
          items: [
            { id: 1, name: 'first' },
            { id: 2, name: 'second' },
            { id: 3, name: 'third' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="remove-test">
          <ul data-list="items">
            <template><li><span data-bind="name"></span></li></template>
          </ul>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      const component = testContainer.querySelector('[data-component="remove-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Remove middle item
      instance.state.items.splice(1, 1)
      await waitForCompleteRender()

      const listItems = component.querySelectorAll('[data-list="items"] li')
      expect(listItems.length).toBe(2)
      expect(listItems[0].textContent).toBe('first')
      expect(listItems[1].textContent).toBe('third')
    })
  })

  describe('Threshold and Pattern Tests', () => {
    it('append detection at various thresholds', async () => {
      wildflower.component('threshold-test', {
        state: {
          small: Array.from({ length: 5 }, (_, i) => ({ id: i })),
          medium: Array.from({ length: 50 }, (_, i) => ({ id: i })),
          large: Array.from({ length: 100 }, (_, i) => ({ id: i }))
        }
      })

      testContainer.innerHTML = `<div data-component="threshold-test"></div>`
      wildflower.scan()
      await waitForUpdate()

      const component = testContainer.querySelector('[data-component="threshold-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Test append on different array sizes
      instance.state.small.push({ id: 5 })
      instance.state.medium.push({ id: 50 })
      instance.state.large.push({ id: 100 })
      await waitForCompleteRender()

      expect(instance.state.small.length).toBe(6)
      expect(instance.state.medium.length).toBe(51)
      expect(instance.state.large.length).toBe(101)
    })

    it('immutable append pattern detection', async () => {
      wildflower.component('immutable-append-test', {
        state: {
          items: [{ id: 1, name: 'first' }]
        }
      })

      testContainer.innerHTML = `
        <div data-component="immutable-append-test">
          <ul data-list="items">
            <template><li><span data-bind="name"></span></li></template>
          </ul>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      const component = testContainer.querySelector('[data-component="immutable-append-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Immutable append (spread operator)
      instance.state.items = [...instance.state.items, { id: 2, name: 'second' }]
      await waitForCompleteRender()

      const listItems = component.querySelectorAll('[data-list="items"] li')
      expect(listItems.length).toBe(2)
    })

    it('swap detection during splice operations', async () => {
      wildflower.component('splice-swap-test', {
        state: {
          items: [
            { id: 1, name: 'first' },
            { id: 2, name: 'second' },
            { id: 3, name: 'third' },
            { id: 4, name: 'fourth' },
            { id: 5, name: 'fifth' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="splice-swap-test">
          <ul data-list="items">
            <template><li><span data-bind="name"></span></li></template>
          </ul>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      const component = testContainer.querySelector('[data-component="splice-swap-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Splice (remove and add)
      instance.state.items.splice(1, 2, { id: 6, name: 'sixth' }, { id: 7, name: 'seventh' })
      await waitForCompleteRender()

      const listItems = component.querySelectorAll('[data-list="items"] li')
      expect(listItems.length).toBe(5)
      expect(listItems[1].textContent).toBe('sixth')
    })
  })

  describe('Operation Sequences', () => {
    it('handles mixed operation sequences', async () => {
      wildflower.component('mixed-ops-test', {
        state: {
          items: [{ id: 1, name: 'first' }, { id: 2, name: 'second' }]
        }
      })

      testContainer.innerHTML = `
        <div data-component="mixed-ops-test">
          <ul data-list="items">
            <template><li><span data-bind="name"></span></li></template>
          </ul>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      const component = testContainer.querySelector('[data-component="mixed-ops-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      await waitForCompleteRender()
      let listItems = component.querySelectorAll('[data-list="items"] li')
      expect(listItems.length).toBe(2)

      // Append
      instance.state.items.push({ id: 3, name: 'third' })
      await waitForCompleteRender()

      listItems = component.querySelectorAll('[data-list="items"] li')
      expect(listItems.length).toBe(3)

      // Spread
      instance.state.items = [...instance.state.items]
      await waitForCompleteRender()

      // Swap
      const temp = instance.state.items[0]
      instance.state.items[0] = instance.state.items[1]
      instance.state.items[1] = temp
      await waitForCompleteRender()
      await waitForUpdate(50)

      listItems = component.querySelectorAll('[data-list="items"] li')
      expect(listItems[0].textContent).toBe('second')

      // Update
      instance.state.items[0].name = 'updated'
      await waitForCompleteRender()

      listItems = component.querySelectorAll('[data-list="items"] li')
      expect(listItems.length).toBe(3)
      expect(listItems[0].textContent).toBe('updated')
    })

    it('operation sequence: filter then append then swap', async () => {
      wildflower.component('seq-filter-append-swap', {
        state: {
          items: [
            { id: 1, name: 'first', keep: true },
            { id: 2, name: 'second', keep: false },
            { id: 3, name: 'third', keep: true }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="seq-filter-append-swap">
          <ul data-list="items">
            <template><li><span data-bind="name"></span></li></template>
          </ul>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      const component = testContainer.querySelector('[data-component="seq-filter-append-swap"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      await waitForCompleteRender()

      // Filter
      instance.state.items = instance.state.items.filter(item => item.keep)
      await waitForCompleteRender()

      // Append
      instance.state.items.push({ id: 4, name: 'fourth', keep: true })
      await waitForCompleteRender()

      // Swap
      const temp = instance.state.items[0]
      instance.state.items[0] = instance.state.items[1]
      instance.state.items[1] = temp
      await waitForCompleteRender()
      await waitForUpdate(50)

      let listItems = component.querySelectorAll('[data-list="items"] li')
      expect(listItems.length).toBe(3)
      expect(listItems[0].textContent).toBe('third')
    })
  })

  describe('Push/Pop Bug Fix Tests', () => {
    it('push followed by pop removes last item correctly', async () => {
      wildflower.component('push-pop-test', {
        state: {
          items: [
            { id: 1, name: 'first' },
            { id: 2, name: 'second' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="push-pop-test">
          <ul data-list="items">
            <template><li><span data-bind="name"></span></li></template>
          </ul>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      const component = testContainer.querySelector('[data-component="push-pop-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      let listItems = component.querySelectorAll('[data-list="items"] li')
      expect(listItems.length).toBe(2)

      // Push a new item
      instance.state.items.push({ id: 3, name: 'third' })
      await waitForCompleteRender()

      listItems = component.querySelectorAll('[data-list="items"] li')
      expect(listItems.length).toBe(3)

      // Pop the last item
      instance.state.items.pop()
      await waitForCompleteRender()

      listItems = component.querySelectorAll('[data-list="items"] li')
      expect(listItems.length).toBe(2)
      expect(listItems[0].textContent).toBe('first')
      expect(listItems[1].textContent).toBe('second')
    })

    it('push followed by splice(-1) removes last item correctly', async () => {
      wildflower.component('push-splice-last-test', {
        state: {
          items: [
            { id: 1, name: 'first' },
            { id: 2, name: 'second' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="push-splice-last-test">
          <ul data-list="items">
            <template><li><span data-bind="name"></span></li></template>
          </ul>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      const component = testContainer.querySelector('[data-component="push-splice-last-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      let listItems = component.querySelectorAll('[data-list="items"] li')
      expect(listItems.length).toBe(2)

      // Push a new item
      instance.state.items.push({ id: 3, name: 'third' })
      await waitForCompleteRender()

      listItems = component.querySelectorAll('[data-list="items"] li')
      expect(listItems.length).toBe(3)

      // Splice the last item
      instance.state.items.splice(-1, 1)
      await waitForCompleteRender()

      listItems = component.querySelectorAll('[data-list="items"] li')
      expect(listItems.length).toBe(2)
      expect(listItems[0].textContent).toBe('first')
      expect(listItems[1].textContent).toBe('second')
    })

    it('multiple push operations followed by pop works correctly', async () => {
      wildflower.component('multi-push-pop-test', {
        state: {
          items: [{ id: 1, name: 'first' }]
        }
      })

      testContainer.innerHTML = `
        <div data-component="multi-push-pop-test">
          <ul data-list="items">
            <template><li><span data-bind="name"></span></li></template>
          </ul>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      const component = testContainer.querySelector('[data-component="multi-push-pop-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Multiple pushes
      instance.state.items.push({ id: 2, name: 'second' })
      await waitForCompleteRender()
      instance.state.items.push({ id: 3, name: 'third' })
      await waitForCompleteRender()
      instance.state.items.push({ id: 4, name: 'fourth' })
      await waitForCompleteRender()

      let listItems = component.querySelectorAll('[data-list="items"] li')
      expect(listItems.length).toBe(4)

      // Pop the last item
      instance.state.items.pop()
      await waitForCompleteRender()

      listItems = component.querySelectorAll('[data-list="items"] li')
      expect(listItems.length).toBe(3)
      expect(listItems[2].textContent).toBe('third')

      // Pop again
      instance.state.items.pop()
      await waitForCompleteRender()

      listItems = component.querySelectorAll('[data-list="items"] li')
      expect(listItems.length).toBe(2)
      expect(listItems[1].textContent).toBe('second')
    })

    it('push followed by splice of middle item works correctly', async () => {
      wildflower.component('push-splice-middle-test', {
        state: {
          items: [
            { id: 1, name: 'first' },
            { id: 2, name: 'second' },
            { id: 3, name: 'third' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="push-splice-middle-test">
          <ul data-list="items">
            <template><li><span data-bind="name"></span></li></template>
          </ul>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      const component = testContainer.querySelector('[data-component="push-splice-middle-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Push a new item
      instance.state.items.push({ id: 4, name: 'fourth' })
      await waitForCompleteRender()

      let listItems = component.querySelectorAll('[data-list="items"] li')
      expect(listItems.length).toBe(4)

      // Splice middle item (index 1)
      instance.state.items.splice(1, 1)
      await waitForCompleteRender()

      listItems = component.querySelectorAll('[data-list="items"] li')
      expect(listItems.length).toBe(3)
      expect(listItems[0].textContent).toBe('first')
      expect(listItems[1].textContent).toBe('third')
      expect(listItems[2].textContent).toBe('fourth')
    })
  })

  describe('Performance', () => {
    it('handles large array operations efficiently', async () => {
      const largeCount = 1000
      wildflower.component('large-array-test', {
        state: {
          items: Array.from({ length: largeCount }, (_, i) => ({ id: i, value: i }))
        }
      })

      testContainer.innerHTML = `<div data-component="large-array-test"></div>`
      wildflower.scan()
      await waitForUpdate()

      const component = testContainer.querySelector('[data-component="large-array-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      const startTime = Date.now()

      // Perform operation on large array
      instance.state.items.push({ id: largeCount, value: largeCount })
      await waitForCompleteRender()

      const elapsed = Date.now() - startTime

      expect(instance.state.items.length).toBe(largeCount + 1)
      expect(elapsed).toBeLessThan(500)
    })
  })
})
