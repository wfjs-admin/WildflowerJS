/**
 * WildflowerJS List Class Binding Reactivity Test Suite - Vitest Browser Mode
 *
 * Tests for data-bind-class reactivity within list templates, including:
 * - Component state access in list templates (e.g., id === selectedId)
 * - Nested property mutations triggering class binding updates
 * - data-bind-class reactivity when component state changes
 *
 * These tests cover regressions fixed in the session addressing hardcoded
 * class name optimizations and proper list item class binding evaluation.
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

describe('List Class Binding Reactivity', () => {
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

  // --- Component State Access in List Templates ---

  describe('Component state access in list templates', () => {
    it('data-bind-class with id === selectedId comparison (benchmark pattern)', async () => {
      wildflower.component('selection-test', {
        state: {
          selectedId: 'item-2',
          items: [
            { id: 'item-1', name: 'Item One' },
            { id: 'item-2', name: 'Item Two' },
            { id: 'item-3', name: 'Item Three' },
            { id: 'item-4', name: 'Item Four' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="selection-test">
          <div data-list="items" data-key="id">
            <template>
              <div class="item" data-bind-class="id === selectedId ? 'item selected' : 'item'">
                <span data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="selection-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Verify item-2 is selected (selectedId = 'item-2')
      let selectedItems = component.querySelectorAll('.item.selected')
      expect(selectedItems.length).toBe(1)
      expect(selectedItems[0].textContent.trim()).toBe('Item Two')

      // Change selection to item-3
      instance.state.selectedId = 'item-3'
      await waitForCompleteRender()

      // Verify item-3 is now selected
      selectedItems = component.querySelectorAll('.item.selected')
      expect(selectedItems.length).toBe(1)
      expect(selectedItems[0].textContent.trim()).toBe('Item Three')

      // Clear selection
      instance.state.selectedId = null
      await waitForCompleteRender()

      // Verify no items are selected
      selectedItems = component.querySelectorAll('.item.selected')
      expect(selectedItems.length).toBe(0)
    })

    it('data-bind-class with numeric id comparison', async () => {
      wildflower.component('numeric-selection-test', {
        state: {
          selectedId: 2,
          items: [
            { id: 1, name: 'Item A' },
            { id: 2, name: 'Item B' },
            { id: 3, name: 'Item C' },
            { id: 4, name: 'Item D' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="numeric-selection-test">
          <div data-list="items" data-key="id">
            <template>
              <div class="row" data-bind-class="id === selectedId ? 'row active' : 'row'">
                <span data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="numeric-selection-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Verify item with id=2 is active
      let activeItems = component.querySelectorAll('.row.active')
      expect(activeItems.length).toBe(1)
      expect(activeItems[0].textContent.trim()).toBe('Item B')

      // Change selection
      instance.state.selectedId = 4
      await waitForCompleteRender()

      activeItems = component.querySelectorAll('.row.active')
      expect(activeItems.length).toBe(1)
      expect(activeItems[0].textContent.trim()).toBe('Item D')
    })

    it('reactivity when component state changes (not list item property)', async () => {
      wildflower.component('state-reactivity-test', {
        state: {
          highlightedCategory: 'featured',
          products: [
            { id: 1, name: 'Product A', category: 'featured' },
            { id: 2, name: 'Product B', category: 'regular' },
            { id: 3, name: 'Product C', category: 'featured' },
            { id: 4, name: 'Product D', category: 'sale' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="state-reactivity-test">
          <div data-list="products" data-key="id">
            <template>
              <div class="product" data-bind-class="category === highlightedCategory ? 'product highlighted' : 'product'">
                <span data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="state-reactivity-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Initially 'featured' items should be highlighted
      let highlighted = component.querySelectorAll('.product.highlighted')
      expect(highlighted.length).toBe(2) // Product A and C

      // Change highlighted category to 'sale'
      instance.state.highlightedCategory = 'sale'
      await waitForCompleteRender()

      highlighted = component.querySelectorAll('.product.highlighted')
      expect(highlighted.length).toBe(1)
      expect(highlighted[0].textContent.trim()).toBe('Product D')

      // Change to 'regular'
      instance.state.highlightedCategory = 'regular'
      await waitForCompleteRender()

      highlighted = component.querySelectorAll('.product.highlighted')
      expect(highlighted.length).toBe(1)
      expect(highlighted[0].textContent.trim()).toBe('Product B')
    })
  })

  // --- Nested Property Mutation with data-bind-class ---

  describe('Nested property mutation with data-bind-class', () => {
    it('direct mutation of item.isActive triggers class update', async () => {
      wildflower.component('direct-class-mutation-test', {
        state: {
          tasks: [
            { id: 1, name: 'Task 1', isActive: false },
            { id: 2, name: 'Task 2', isActive: false },
            { id: 3, name: 'Task 3', isActive: false }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="direct-class-mutation-test">
          <div data-list="tasks" data-key="id">
            <template>
              <div class="task" data-bind-class="isActive ? 'task active' : 'task'">
                <span data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="direct-class-mutation-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Initially no tasks are active
      let activeItems = component.querySelectorAll('.task.active')
      expect(activeItems.length).toBe(0)

      // Direct mutation: set task 2 as active
      instance.state.tasks[1].isActive = true
      await waitForCompleteRender()

      activeItems = component.querySelectorAll('.task.active')
      expect(activeItems.length).toBe(1)
      expect(activeItems[0].textContent.trim()).toBe('Task 2')

      // Direct mutation: set task 1 as active too
      instance.state.tasks[0].isActive = true
      await waitForCompleteRender()

      activeItems = component.querySelectorAll('.task.active')
      expect(activeItems.length).toBe(2)

      // Direct mutation: deactivate task 2
      instance.state.tasks[1].isActive = false
      await waitForCompleteRender()

      activeItems = component.querySelectorAll('.task.active')
      expect(activeItems.length).toBe(1)
      expect(activeItems[0].textContent.trim()).toBe('Task 1')
    })

    it('map replacement updates all class bindings correctly', async () => {
      wildflower.component('map-class-mutation-test', {
        state: {
          items: [
            { id: 1, name: 'Item A', selected: false },
            { id: 2, name: 'Item B', selected: false },
            { id: 3, name: 'Item C', selected: false }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="map-class-mutation-test">
          <div data-list="items" data-key="id">
            <template>
              <div class="item" data-bind-class="selected ? 'item selected' : 'item'">
                <span data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="map-class-mutation-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Use map to select item 2
      instance.state.items = instance.state.items.map((item, index) => ({
        ...item,
        selected: index === 1
      }))
      await waitForCompleteRender()

      let selectedItems = component.querySelectorAll('.item.selected')
      expect(selectedItems.length).toBe(1)
      expect(selectedItems[0].textContent.trim()).toBe('Item B')

      // Use map to select item 3 instead
      instance.state.items = instance.state.items.map((item, index) => ({
        ...item,
        selected: index === 2
      }))
      await waitForCompleteRender()

      selectedItems = component.querySelectorAll('.item.selected')
      expect(selectedItems.length).toBe(1)
      expect(selectedItems[0].textContent.trim()).toBe('Item C')
    })
  })

  // --- data-bind with nested property mutation ---

  describe('data-bind with nested property mutation', () => {
    it('direct mutation of item.label updates DOM (benchmark pattern)', async () => {
      wildflower.component('label-mutation-test', {
        state: {
          rows: [
            { id: 1, label: 'Row 1' },
            { id: 2, label: 'Row 2' },
            { id: 3, label: 'Row 3' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="label-mutation-test">
          <div data-list="rows" data-key="id">
            <template>
              <div class="row">
                <span class="label" data-bind="label"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="label-mutation-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Verify initial render
      let rows = component.querySelectorAll('.row')
      expect(rows[0].querySelector('.label').textContent).toBe('Row 1')
      expect(rows[1].querySelector('.label').textContent).toBe('Row 2')

      // Direct mutation: update row 2's label
      instance.state.rows[1].label = 'Row 2 UPDATED!!!'
      await waitForCompleteRender()

      rows = component.querySelectorAll('.row')
      expect(rows[1].querySelector('.label').textContent).toBe('Row 2 UPDATED!!!')
      // Other rows should be unchanged
      expect(rows[0].querySelector('.label').textContent).toBe('Row 1')
      expect(rows[2].querySelector('.label').textContent).toBe('Row 3')
    })
  })

  // --- Custom class names (not hardcoded) ---

  describe('Custom class names work correctly', () => {
    it('data-bind-class with custom class names (not just selected/active)', async () => {
      wildflower.component('custom-class-test', {
        state: {
          selectedStatus: 'warning',
          alerts: [
            { id: 1, message: 'Info message', status: 'info' },
            { id: 2, message: 'Warning message', status: 'warning' },
            { id: 3, message: 'Error message', status: 'error' },
            { id: 4, message: 'Success message', status: 'success' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="custom-class-test">
          <div data-list="alerts" data-key="id">
            <template>
              <div class="alert" data-bind-class="status === selectedStatus ? 'alert highlighted-alert' : 'alert'">
                <span data-bind="message"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="custom-class-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Initially 'warning' status should be highlighted
      let highlighted = component.querySelectorAll('.alert.highlighted-alert')
      expect(highlighted.length).toBe(1)
      expect(highlighted[0].textContent.trim()).toBe('Warning message')

      // Change to 'error'
      instance.state.selectedStatus = 'error'
      await waitForCompleteRender()

      highlighted = component.querySelectorAll('.alert.highlighted-alert')
      expect(highlighted.length).toBe(1)
      expect(highlighted[0].textContent.trim()).toBe('Error message')

      // Change to 'success'
      instance.state.selectedStatus = 'success'
      await waitForCompleteRender()

      highlighted = component.querySelectorAll('.alert.highlighted-alert')
      expect(highlighted.length).toBe(1)
      expect(highlighted[0].textContent.trim()).toBe('Success message')
    })

    it('data-bind-class with complex class strings', async () => {
      wildflower.component('complex-class-test', {
        state: {
          theme: 'dark',
          cards: [
            { id: 1, name: 'Card A', cardTheme: 'dark' },
            { id: 2, name: 'Card B', cardTheme: 'light' },
            { id: 3, name: 'Card C', cardTheme: 'dark' }
          ]
        }
      })

      testContainer.innerHTML = `
        <div data-component="complex-class-test">
          <div data-list="cards" data-key="id">
            <template>
              <div class="card" data-bind-class="cardTheme === theme ? 'card card-matched theme-active' : 'card card-unmatched'">
                <span data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="complex-class-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Initially 'dark' theme - Cards A and C should match
      let matched = component.querySelectorAll('.card.card-matched.theme-active')
      expect(matched.length).toBe(2)

      let unmatched = component.querySelectorAll('.card.card-unmatched')
      expect(unmatched.length).toBe(1)
      expect(unmatched[0].textContent.trim()).toBe('Card B')

      // Change theme to 'light'
      instance.state.theme = 'light'
      await waitForCompleteRender()

      matched = component.querySelectorAll('.card.card-matched.theme-active')
      expect(matched.length).toBe(1)
      expect(matched[0].textContent.trim()).toBe('Card B')

      unmatched = component.querySelectorAll('.card.card-unmatched')
      expect(unmatched.length).toBe(2)
    })
  })
})
