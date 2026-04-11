/**
 * WildflowerJS Store Array Mutations Test Suite - Vitest Browser Mode
 *
 * Tests for array mutations in stores triggering proper updates.
 * Covers push, pop, splice, unshift, shift operations in store state.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode } from './helpers/load-framework.js'

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

describe('Store Array Mutations', () => {
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

  describe('Store Array State Changes', () => {
    it('should update store state when pushing to array', async () => {
      const store = wildflower.storeManager.createStoreComponent('push-state-store', {
        state: {
          items: [{ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' }]
        }
      })

      expect(store.state.items.length).toBe(2)

      // Push new item
      store.state.items.push({ id: 3, name: 'Item 3' })
      await waitForUpdate()

      expect(store.state.items.length).toBe(3)
      expect(store.state.items[2].name).toBe('Item 3')
    })

    it('should update store state when pushing multiple items', async () => {
      const store = wildflower.storeManager.createStoreComponent('multi-push-state-store', {
        state: {
          items: [{ id: 1, name: 'First' }]
        }
      })

      store.state.items.push(
        { id: 2, name: 'Second' },
        { id: 3, name: 'Third' },
        { id: 4, name: 'Fourth' }
      )
      await waitForUpdate()

      expect(store.state.items.length).toBe(4)
      expect(store.state.items[3].name).toBe('Fourth')
    })

    it('should update store state when popping from array', async () => {
      const store = wildflower.storeManager.createStoreComponent('pop-state-store', {
        state: {
          items: [
            { id: 1, name: 'Keep 1' },
            { id: 2, name: 'Keep 2' },
            { id: 3, name: 'Remove Me' }
          ]
        }
      })

      const removed = store.state.items.pop()
      await waitForUpdate()

      expect(removed.name).toBe('Remove Me')
      expect(store.state.items.length).toBe(2)
    })

    it('should update store state when unshifting', async () => {
      const store = wildflower.storeManager.createStoreComponent('unshift-state-store', {
        state: {
          items: [{ id: 2, name: 'Original First' }]
        }
      })

      store.state.items.unshift({ id: 1, name: 'New First' })
      await waitForUpdate()

      expect(store.state.items.length).toBe(2)
      expect(store.state.items[0].name).toBe('New First')
    })

    it('should update store state when shifting', async () => {
      const store = wildflower.storeManager.createStoreComponent('shift-state-store', {
        state: {
          items: [
            { id: 1, name: 'Remove Me' },
            { id: 2, name: 'Keep 1' },
            { id: 3, name: 'Keep 2' }
          ]
        }
      })

      const removed = store.state.items.shift()
      await waitForUpdate()

      expect(removed.name).toBe('Remove Me')
      expect(store.state.items.length).toBe(2)
      expect(store.state.items[0].name).toBe('Keep 1')
    })

    it('should update store state when splicing removes items', async () => {
      const store = wildflower.storeManager.createStoreComponent('splice-remove-store', {
        state: {
          items: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' },
            { id: 3, name: 'Item 3' },
            { id: 4, name: 'Item 4' }
          ]
        }
      })

      store.state.items.splice(1, 2)
      await waitForUpdate()

      expect(store.state.items.length).toBe(2)
      expect(store.state.items[0].name).toBe('Item 1')
      expect(store.state.items[1].name).toBe('Item 4')
    })

    it('should update store state when splicing inserts items', async () => {
      const store = wildflower.storeManager.createStoreComponent('splice-insert-store', {
        state: {
          items: [
            { id: 1, name: 'First' },
            { id: 3, name: 'Third' }
          ]
        }
      })

      store.state.items.splice(1, 0, { id: 2, name: 'Second' })
      await waitForUpdate()

      expect(store.state.items.length).toBe(3)
      expect(store.state.items[1].name).toBe('Second')
    })

    it('should update store state when assigning new array', async () => {
      const store = wildflower.storeManager.createStoreComponent('assign-state-store', {
        state: {
          items: [{ id: 1, name: 'Original' }]
        }
      })

      store.state.items = [
        { id: 10, name: 'New 1' },
        { id: 11, name: 'New 2' },
        { id: 12, name: 'New 3' }
      ]
      await waitForUpdate()

      expect(store.state.items.length).toBe(3)
      expect(store.state.items[0].name).toBe('New 1')
    })
  })

  describe('Store Array Computed Properties', () => {
    it('should update computed properties when store array changes via push', async () => {
      const store = wildflower.storeManager.createStoreComponent('computed-push-store', {
        state: {
          numbers: [1, 2, 3]
        },
        computed: {
          sum() {
            return this.state.numbers.reduce((a, b) => a + b, 0)
          },
          count() {
            return this.state.numbers.length
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="computed-push-display">
          <div id="sum" data-bind="external('computed-push-store', 'computed:sum')"></div>
          <div id="count" data-bind="external('computed-push-store', 'computed:count')"></div>
        </div>
      `

      wildflower.component('computed-push-display', {
        state: {}
      })

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelector('#sum').textContent).toBe('6')
      expect(testContainer.querySelector('#count').textContent).toBe('3')

      // Push item
      store.state.numbers.push(4)
      await waitForCompleteRender()

      expect(testContainer.querySelector('#sum').textContent).toBe('10')
      expect(testContainer.querySelector('#count').textContent).toBe('4')
    })

    it('should update computed properties when store array changes via pop', async () => {
      const store = wildflower.storeManager.createStoreComponent('computed-pop-store', {
        state: {
          numbers: [10, 20, 30]
        },
        computed: {
          sum() {
            return this.state.numbers.reduce((a, b) => a + b, 0)
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="computed-pop-display">
          <div id="sum" data-bind="external('computed-pop-store', 'computed:sum')"></div>
        </div>
      `

      wildflower.component('computed-pop-display', {
        state: {}
      })

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelector('#sum').textContent).toBe('60')

      // Pop item
      store.state.numbers.pop()
      await waitForCompleteRender()

      expect(testContainer.querySelector('#sum').textContent).toBe('30')
    })

    it('should update computed properties when store array changes via splice', async () => {
      const store = wildflower.storeManager.createStoreComponent('computed-splice-store', {
        state: {
          items: ['a', 'b', 'c']
        },
        computed: {
          joined() {
            return this.state.items.join('-')
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="computed-splice-display">
          <div id="joined" data-bind="external('computed-splice-store', 'computed:joined')"></div>
        </div>
      `

      wildflower.component('computed-splice-display', {
        state: {}
      })

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelector('#joined').textContent).toBe('a-b-c')

      // Splice - remove 'b' and add 'x', 'y'
      store.state.items.splice(1, 1, 'x', 'y')
      await waitForCompleteRender()

      expect(testContainer.querySelector('#joined').textContent).toBe('a-x-y-c')
    })

    it('should update computed properties when store array is reassigned', async () => {
      const store = wildflower.storeManager.createStoreComponent('computed-assign-store', {
        state: {
          items: [1, 2]
        },
        computed: {
          total() {
            return this.state.items.reduce((a, b) => a + b, 0)
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="computed-assign-display">
          <div id="total" data-bind="external('computed-assign-store', 'computed:total')"></div>
        </div>
      `

      wildflower.component('computed-assign-display', {
        state: {}
      })

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelector('#total').textContent).toBe('3')

      // Assign new array
      store.state.items = [10, 20, 30]
      await waitForCompleteRender()

      expect(testContainer.querySelector('#total').textContent).toBe('60')
    })
  })

  describe('Store Array with Component Mirroring', () => {
    it('should update component list when store array changes via computed', async () => {
      const store = wildflower.storeManager.createStoreComponent('mirror-store', {
        state: {
          items: [{ id: 1, name: 'Item 1' }]
        }
      })

      testContainer.innerHTML = `
        <div data-component="mirror-display">
          <ul data-list="storeItems">
            <template><li data-bind="name"></li></template>
          </ul>
        </div>
      `

      wildflower.component('mirror-display', {
        state: {},
        subscribe: { 'mirror-store': ['items'] },
        computed: {
          storeItems() {
            return this.stores['mirror-store'].items
          }
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelectorAll('li').length).toBe(1)

      // Push to store
      store.state.items.push({ id: 2, name: 'Item 2' })
      await waitForCompleteRender()

      expect(testContainer.querySelectorAll('li').length).toBe(2)
    })

    it('should handle store array clearing via component computed', async () => {
      const store = wildflower.storeManager.createStoreComponent('clear-store', {
        state: {
          items: [
            { id: 1, name: 'A' },
            { id: 2, name: 'B' },
            { id: 3, name: 'C' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="clear-display">
          <ul data-list="storeItems">
            <template><li data-bind="name"></li></template>
          </ul>
        </div>
      `

      wildflower.component('clear-display', {
        state: {},
        subscribe: { 'clear-store': ['items'] },
        computed: {
          storeItems() {
            return this.stores['clear-store'].items
          }
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelectorAll('li').length).toBe(3)

      // Clear array
      store.state.items = []
      await waitForCompleteRender()

      expect(testContainer.querySelectorAll('li').length).toBe(0)
    })

    it('should handle store array splice via component computed', async () => {
      const store = wildflower.storeManager.createStoreComponent('splice-mirror-store', {
        state: {
          items: [
            { id: 1, name: 'First' },
            { id: 2, name: 'Middle' },
            { id: 3, name: 'Last' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="splice-mirror-display">
          <ul data-list="storeItems">
            <template><li data-bind="name"></li></template>
          </ul>
        </div>
      `

      wildflower.component('splice-mirror-display', {
        state: {},
        subscribe: { 'splice-mirror-store': ['items'] },
        computed: {
          storeItems() {
            return this.stores['splice-mirror-store'].items
          }
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelectorAll('li').length).toBe(3)

      // Splice - remove middle, insert new
      store.state.items.splice(1, 1, { id: 4, name: 'New Middle' })
      await waitForCompleteRender()

      const items = testContainer.querySelectorAll('li')
      expect(items.length).toBe(3)
      expect(items[1].textContent).toBe('New Middle')
    })
  })

  describe('Multiple Stores with Arrays', () => {
    it('should handle independent array mutations in different stores', async () => {
      const store1 = wildflower.storeManager.createStoreComponent('multi-store-1', {
        state: {
          items: [1, 2]
        },
        computed: {
          count() { return this.state.items.length }
        }
      })

      const store2 = wildflower.storeManager.createStoreComponent('multi-store-2', {
        state: {
          items: [10, 20, 30]
        },
        computed: {
          count() { return this.state.items.length }
        }
      })

      testContainer.innerHTML = `
        <div data-component="multi-store-display">
          <div id="count1" data-bind="external('multi-store-1', 'computed:count')"></div>
          <div id="count2" data-bind="external('multi-store-2', 'computed:count')"></div>
        </div>
      `

      wildflower.component('multi-store-display', {
        state: {}
      })

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelector('#count1').textContent).toBe('2')
      expect(testContainer.querySelector('#count2').textContent).toBe('3')

      // Mutate store1 only
      store1.state.items.push(3)
      await waitForCompleteRender()

      expect(testContainer.querySelector('#count1').textContent).toBe('3')
      expect(testContainer.querySelector('#count2').textContent).toBe('3') // Unchanged

      // Mutate store2 only
      store2.state.items.pop()
      await waitForCompleteRender()

      expect(testContainer.querySelector('#count1').textContent).toBe('3') // Unchanged
      expect(testContainer.querySelector('#count2').textContent).toBe('2')
    })
  })

  describe('Rapid Store Array Operations', () => {
    it('should handle rapid successive pushes correctly', async () => {
      const store = wildflower.storeManager.createStoreComponent('rapid-push-store', {
        state: {
          items: []
        },
        computed: {
          count() { return this.state.items.length }
        }
      })

      testContainer.innerHTML = `
        <div data-component="rapid-push-display">
          <div id="count" data-bind="external('rapid-push-store', 'computed:count')"></div>
        </div>
      `

      wildflower.component('rapid-push-display', {
        state: {}
      })

      wildflower.scan()
      await waitForCompleteRender()

      // Rapid pushes
      for (let i = 0; i < 10; i++) {
        store.state.items.push({ id: i, name: `Item ${i}` })
      }
      await waitForCompleteRender()

      expect(store.state.items.length).toBe(10)
      expect(testContainer.querySelector('#count').textContent).toBe('10')
    })

    it('should handle interleaved push and pop operations', async () => {
      const store = wildflower.storeManager.createStoreComponent('interleaved-store', {
        state: {
          items: [{ id: 0, name: 'Initial' }]
        },
        computed: {
          count() { return this.state.items.length }
        }
      })

      testContainer.innerHTML = `
        <div data-component="interleaved-display">
          <div id="count" data-bind="external('interleaved-store', 'computed:count')"></div>
        </div>
      `

      wildflower.component('interleaved-display', {
        state: {}
      })

      wildflower.scan()
      await waitForCompleteRender()

      // Push then pop several times
      store.state.items.push({ id: 1, name: 'Added 1' })
      await waitForUpdate(10)
      store.state.items.pop()
      await waitForUpdate(10)
      store.state.items.push({ id: 2, name: 'Added 2' })
      await waitForUpdate(10)
      store.state.items.push({ id: 3, name: 'Added 3' })
      await waitForCompleteRender()

      expect(store.state.items.length).toBe(3)
      expect(testContainer.querySelector('#count').textContent).toBe('3')
    })
  })

  describe('Store Array Item Property Updates', () => {
    it('should update computed when array item property changes', async () => {
      const store = wildflower.storeManager.createStoreComponent('item-prop-store', {
        state: {
          users: [
            { id: 1, active: true },
            { id: 2, active: false },
            { id: 3, active: true }
          ]
        },
        computed: {
          activeCount() {
            return this.state.users.filter(u => u.active).length
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="item-prop-display">
          <div id="active-count" data-bind="external('item-prop-store', 'computed:activeCount')"></div>
        </div>
      `

      wildflower.component('item-prop-display', {
        state: {}
      })

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelector('#active-count').textContent).toBe('2')

      // Toggle an item's active status
      store.state.users[1].active = true
      await waitForCompleteRender()

      expect(testContainer.querySelector('#active-count').textContent).toBe('3')
    })

    it('should update computed when nested array item changes', async () => {
      const store = wildflower.storeManager.createStoreComponent('nested-item-store', {
        state: {
          items: [
            { id: 1, data: { value: 10 } },
            { id: 2, data: { value: 20 } }
          ]
        },
        computed: {
          total() {
            return this.state.items.reduce((sum, item) => sum + item.data.value, 0)
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="nested-item-display">
          <div id="total" data-bind="external('nested-item-store', 'computed:total')"></div>
        </div>
      `

      wildflower.component('nested-item-display', {
        state: {}
      })

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelector('#total').textContent).toBe('30')

      // Update nested value
      store.state.items[0].data.value = 50
      await waitForCompleteRender()

      expect(testContainer.querySelector('#total').textContent).toBe('70')
    })
  })
})
