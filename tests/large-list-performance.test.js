/**
 * WildflowerJS Large List Performance Test Suite - Vitest Browser Mode
 *
 * Tests for list rendering and manipulation at scale (1000+ items).
 * Validates that the framework handles large lists efficiently.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to wait for complete render cycle
async function waitForCompleteRender(ms = 100) {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper for large list renders that need extra time
async function waitForLargeListRender() {
  await waitForCompleteRender(200)
}

// Helper to measure execution time
function measureTime(fn) {
  const start = performance.now()
  const result = fn()
  const end = performance.now()
  return { result, time: end - start }
}

describe('Large List Performance', () => {
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

  describe('Initial Render Performance', () => {
    it('should render 1000 items', async () => {
      const items = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        value: i * 10
      }))

      testContainer.innerHTML = `
        <div data-component="large-render-test">
          <ul data-list="items">
            <template>
              <li>
                <span class="name" data-bind="name"></span>
                <span class="value" data-bind="value"></span>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('large-render-test', {
        state: { items }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const listItems = testContainer.querySelectorAll('li')
      expect(listItems.length).toBe(1000)

      // Verify first and last items rendered correctly
      expect(listItems[0].querySelector('.name').textContent).toBe('Item 0')
      expect(listItems[999].querySelector('.name').textContent).toBe('Item 999')
    })

    it('should render 500 items with multiple bindings each', async () => {
      const items = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        description: `Description for item ${i}`,
        price: (i * 1.99).toFixed(2),
        quantity: i % 10,
        active: i % 2 === 0
      }))

      testContainer.innerHTML = `
        <div data-component="multi-binding-test">
          <ul data-list="items">
            <template>
              <li>
                <span class="name" data-bind="name"></span>
                <span class="desc" data-bind="description"></span>
                <span class="price" data-bind="price"></span>
                <span class="qty" data-bind="quantity"></span>
                <span class="status" data-bind="active ? 'Active' : 'Inactive'"></span>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('multi-binding-test', {
        state: { items }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const listItems = testContainer.querySelectorAll('li')
      expect(listItems.length).toBe(500)

      // Verify bindings work
      expect(listItems[0].querySelector('.name').textContent).toBe('Item 0')
      expect(listItems[0].querySelector('.status').textContent).toBe('Active')
      expect(listItems[1].querySelector('.status').textContent).toBe('Inactive')
    })
  })

  describe('List Mutation Performance', () => {
    it('should efficiently append items to a 1000 item list', async () => {
      const items = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `Item ${i}`
      }))

      testContainer.innerHTML = `
        <div data-component="append-test">
          <ul data-list="items">
            <template><li data-bind="name"></li></template>
          </ul>
        </div>
      `

      wildflower.component('append-test', {
        state: { items }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="append-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      expect(testContainer.querySelectorAll('li').length).toBe(1000)

      // Append items using spread (single operation triggers one update)
      const newItems = Array.from({ length: 100 }, (_, i) => ({
        id: 1000 + i,
        name: `Item ${1000 + i}`
      }))
      instance.state.items.push(...newItems)
      await waitForLargeListRender()

      expect(testContainer.querySelectorAll('li').length).toBe(1100)
      expect(testContainer.querySelectorAll('li')[1099].textContent).toBe('Item 1099')
    })

    it('should efficiently remove items from a large list', async () => {
      const items = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        name: `Item ${i}`
      }))

      testContainer.innerHTML = `
        <div data-component="remove-test">
          <ul data-list="items">
            <template><li data-bind="name"></li></template>
          </ul>
        </div>
      `

      wildflower.component('remove-test', {
        state: { items }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="remove-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      expect(testContainer.querySelectorAll('li').length).toBe(500)

      // Remove every other item (250 removals)
      for (let i = 498; i >= 0; i -= 2) {
        instance.state.items.splice(i, 1)
      }
      await waitForCompleteRender()

      expect(testContainer.querySelectorAll('li').length).toBe(250)
    })

    it('should efficiently update items in a large list', async () => {
      const items = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        updated: false
      }))

      testContainer.innerHTML = `
        <div data-component="update-test">
          <ul data-list="items">
            <template>
              <li>
                <span class="name" data-bind="name"></span>
                <span class="status" data-bind="updated ? 'Updated' : 'Original'"></span>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('update-test', {
        state: { items }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="update-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Update every 10th item
      for (let i = 0; i < 500; i += 10) {
        instance.state.items[i].name = `Updated Item ${i}`
        instance.state.items[i].updated = true
      }
      await waitForCompleteRender()

      const listItems = testContainer.querySelectorAll('li')
      expect(listItems[0].querySelector('.status').textContent).toBe('Updated')
      expect(listItems[1].querySelector('.status').textContent).toBe('Original')
      expect(listItems[10].querySelector('.status').textContent).toBe('Updated')
    })

    it('should handle clearing a large list', async () => {
      const items = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        name: `Item ${i}`
      }))

      testContainer.innerHTML = `
        <div data-component="clear-large-test">
          <ul data-list="items">
            <template><li data-bind="name"></li></template>
          </ul>
        </div>
      `

      wildflower.component('clear-large-test', {
        state: { items }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="clear-large-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      expect(testContainer.querySelectorAll('li').length).toBe(500)

      // Clear via splice
      instance.state.items.splice(0, instance.state.items.length)
      await waitForLargeListRender()

      expect(testContainer.querySelectorAll('li').length).toBe(0)
    })
  })

  describe('Computed with Large Lists', () => {
    it('should efficiently compute aggregates over large list', async () => {
      const items = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        value: i,
        active: i % 3 === 0
      }))

      testContainer.innerHTML = `
        <div data-component="computed-large-test">
          <div id="count" data-bind="computed:itemCount"></div>
          <div id="sum" data-bind="computed:totalValue"></div>
          <div id="active" data-bind="computed:activeCount"></div>
        </div>
      `

      wildflower.component('computed-large-test', {
        state: { items },
        computed: {
          itemCount() {
            return this.state.items.length
          },
          totalValue() {
            return this.state.items.reduce((sum, item) => sum + item.value, 0)
          },
          activeCount() {
            return this.state.items.filter(item => item.active).length
          }
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelector('#count').textContent).toBe('1000')
      // Sum of 0..999 = 499500
      expect(testContainer.querySelector('#sum').textContent).toBe('499500')
      // Every 3rd item (0, 3, 6, ... 999) = 334 items
      expect(testContainer.querySelector('#active').textContent).toBe('334')
    })

    it('should update computed when large list changes', async () => {
      const items = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        value: 1
      }))

      testContainer.innerHTML = `
        <div data-component="computed-update-test">
          <div id="sum" data-bind="computed:total"></div>
        </div>
      `

      wildflower.component('computed-update-test', {
        state: { items },
        computed: {
          total() {
            return this.state.items.reduce((sum, item) => sum + item.value, 0)
          }
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelector('#sum').textContent).toBe('500')

      const component = testContainer.querySelector('[data-component="computed-update-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Add more items
      for (let i = 0; i < 100; i++) {
        instance.state.items.push({ id: 500 + i, value: 2 })
      }
      await waitForCompleteRender()

      expect(testContainer.querySelector('#sum').textContent).toBe('700')
    })
  })

  describe('Filtering Large Lists', () => {
    it('should filter large list by appending to source array', async () => {
      // Start with smaller filtered items
      const specialItems = Array.from({ length: 200 }, (_, i) => ({
        id: i * 5,
        name: `Special Item ${i}`,
        category: 'special'
      }))

      testContainer.innerHTML = `
        <div data-component="filter-test">
          <ul data-list="items">
            <template><li data-bind="name"></li></template>
          </ul>
        </div>
      `

      wildflower.component('filter-test', {
        state: {
          items: [...specialItems]
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      // Should show special items
      expect(testContainer.querySelectorAll('li').length).toBe(200)

      const component = testContainer.querySelector('[data-component="filter-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Add more items using push
      const normalItems = Array.from({ length: 100 }, (_, i) => ({
        id: 1000 + i,
        name: `Normal Item ${i}`,
        category: 'normal'
      }))
      instance.state.items.push(...normalItems)
      await waitForLargeListRender()

      expect(testContainer.querySelectorAll('li').length).toBe(300)
    })

    it('should compute derived values from large list', async () => {
      const items = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        category: i % 5 === 0 ? 'special' : 'normal'
      }))

      testContainer.innerHTML = `
        <div data-component="filter-computed-test">
          <div id="special-count" data-bind="computed:specialCount"></div>
          <div id="normal-count" data-bind="computed:normalCount"></div>
        </div>
      `

      wildflower.component('filter-computed-test', {
        state: { items },
        computed: {
          specialCount() {
            return this.state.items.filter(item => item.category === 'special').length
          },
          normalCount() {
            return this.state.items.filter(item => item.category === 'normal').length
          }
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelector('#special-count').textContent).toBe('200')
      expect(testContainer.querySelector('#normal-count').textContent).toBe('800')
    })
  })

  describe('Memory Efficiency', () => {
    it('should clean up when large list is cleared', async () => {
      const items = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        name: `Item ${i}`
      }))

      testContainer.innerHTML = `
        <div data-component="clear-test">
          <ul data-list="items">
            <template><li data-bind="name"></li></template>
          </ul>
        </div>
      `

      wildflower.component('clear-test', {
        state: { items }
      })

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelectorAll('li').length).toBe(500)

      const component = testContainer.querySelector('[data-component="clear-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Clear the list
      instance.state.items = []
      await waitForCompleteRender()

      expect(testContainer.querySelectorAll('li').length).toBe(0)
    })

    it('should handle repeated add/clear cycles', async () => {
      testContainer.innerHTML = `
        <div data-component="cycle-test">
          <ul data-list="items">
            <template><li data-bind="name"></li></template>
          </ul>
        </div>
      `

      wildflower.component('cycle-test', {
        state: { items: [] }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="cycle-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Perform 5 cycles of adding 200 items then clearing
      for (let cycle = 0; cycle < 5; cycle++) {
        instance.state.items = Array.from({ length: 200 }, (_, i) => ({
          id: cycle * 200 + i,
          name: `Cycle ${cycle} Item ${i}`
        }))
        await waitForCompleteRender()
        expect(testContainer.querySelectorAll('li').length).toBe(200)

        instance.state.items = []
        await waitForCompleteRender()
        expect(testContainer.querySelectorAll('li').length).toBe(0)
      }

      // Final state should be empty and stable
      expect(testContainer.querySelectorAll('li').length).toBe(0)
    })
  })
})
