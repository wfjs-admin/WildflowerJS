/**
 * WildflowerJS Lists Test Suite - Vitest Browser Mode
 *
 * Tests for data-list list rendering functionality.
 * Focused behavioral tests derived from unitTestSuite.js LIST SYSTEM INTEGRATION.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, getListItems, isMinifiedBuild} from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to wait for complete render cycle (for lists)
async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

describe('List System', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    // Clear the context registry to prevent cross-test contamination
    if (wildflower._contextRegistry) {
      wildflower._contextRegistry.contexts?.clear()
      wildflower._contextRegistry.contextsByType?.clear()
      wildflower._contextRegistry.contextsByComponent?.clear()
      wildflower._contextRegistry.dependencies?.clear()
      wildflower._contextRegistry._contextTypeCache?.clear()
      wildflower._contextRegistry._contextModificationCounter = 0
    }

    // Clear list relationships
    if (wildflower._listRelationships) {
      wildflower._listRelationships.clear()
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

  describe('Basic List Rendering', () => {
    it.skipIf(isMinifiedBuild())('renders list items from array state', async () => {
      testContainer.innerHTML = `
        <div data-component="basic-list">
          <ul data-list="items">
            <template>
              <li>
                <span class="name" data-bind="name"></span>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('basic-list', {
        state: {
          items: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' },
            { id: 3, name: 'Item 3' }
          ]
        }
      })

      await waitForCompleteRender()

      const listItems = getListItems(testContainer.querySelector('[data-list="items"]'))
      expect(listItems.length).toBe(3)

      const names = listItems.map(li => li.querySelector('.name').textContent)
      expect(names).toEqual(['Item 1', 'Item 2', 'Item 3'])

      // Verify list context was created (plain object on the element)
      const listElement = testContainer.querySelector('[data-list="items"]')
      const listContext = listElement._listContext
      expect(listContext).toBeDefined()
      expect(listContext.type).toBe('list')
      expect(listContext.path).toBe('items')

      // Verify list context can resolve data
      const resolvedData = listContext.resolveData()
      expect(resolvedData.length).toBe(3)
      expect(resolvedData[0].name).toBe('Item 1')
    })

    it('renders empty list gracefully', async () => {
      testContainer.innerHTML = `
        <div data-component="empty-list">
          <ul data-list="items">
            <template>
              <li>
                <span data-bind="name"></span>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('empty-list', {
        state: {
          items: []
        }
      })

      await waitForCompleteRender()

      const listItems = getListItems(testContainer.querySelector('[data-list="items"]'))
      expect(listItems.length).toBe(0)
    })

    it('renders multiple properties per list item', async () => {
      testContainer.innerHTML = `
        <div data-component="multi-prop-list">
          <ul data-list="products">
            <template>
              <li>
                <span class="name" data-bind="name"></span>
                <span class="price" data-bind="price"></span>
                <span class="stock" data-bind="inStock"></span>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('multi-prop-list', {
        state: {
          products: [
            { id: 1, name: 'Widget', price: '$10', inStock: true },
            { id: 2, name: 'Gadget', price: '$25', inStock: false }
          ]
        }
      })

      await waitForCompleteRender()

      const listItems = getListItems(testContainer.querySelector('[data-list="products"]'))
      expect(listItems.length).toBe(2)

      const firstItem = listItems[0]
      expect(firstItem.querySelector('.name').textContent).toBe('Widget')
      expect(firstItem.querySelector('.price').textContent).toBe('$10')
      expect(firstItem.querySelector('.stock').textContent).toBe('true')
    })
  })

  describe('List Updates', () => {
    it.skipIf(isMinifiedBuild())('adds items to list', async () => {
      testContainer.innerHTML = `
        <div data-component="add-list">
          <ul data-list="items">
            <template>
              <li>
                <span data-bind="name"></span>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('add-list', {
        state: {
          items: [{ id: 1, name: 'Initial' }]
        }
      })

      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="add-list"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Capture list context ID before modification
      const listElement = component.querySelector('[data-list="items"]')
      const listContext = listElement._listContext
      const originalContextId = listContext.id

      // Add item
      instance.state.items = [...instance.state.items, { id: 2, name: 'Added' }]
      await waitForCompleteRender()

      const listItems = getListItems(testContainer.querySelector('[data-list="items"]'))
      expect(listItems.length).toBe(2)
      expect(listItems[1].querySelector('span').textContent).toBe('Added')

      // Verify list context was reused (same ID)
      const afterContext = listElement._listContext
      expect(afterContext.id).toBe(originalContextId)
    })

    it('removes items from list', async () => {
      testContainer.innerHTML = `
        <div data-component="remove-list">
          <ul data-list="items">
            <template>
              <li>
                <span data-bind="name"></span>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('remove-list', {
        state: {
          items: [
            { id: 1, name: 'First' },
            { id: 2, name: 'Second' },
            { id: 3, name: 'Third' }
          ]
        }
      })

      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="remove-list"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Remove middle item
      instance.state.items = [instance.state.items[0], instance.state.items[2]]
      await waitForCompleteRender()

      const listItems = getListItems(testContainer.querySelector('[data-list="items"]'))
      expect(listItems.length).toBe(2)

      // Use DOM structure (span is the only child) - data-bind is stripped for performance
      const names = listItems.map(li => li.querySelector('span').textContent)
      expect(names).toEqual(['First', 'Third'])
    })

    it('updates item properties', async () => {
      testContainer.innerHTML = `
        <div data-component="update-list">
          <ul data-list="tasks">
            <template>
              <li>
                <span class="name" data-bind="name"></span>
                <span class="status" data-bind="status"></span>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('update-list', {
        state: {
          tasks: [
            { id: 1, name: 'Task 1', status: 'pending' },
            { id: 2, name: 'Task 2', status: 'pending' }
          ]
        }
      })

      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="update-list"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Update first task status
      const updatedTasks = [...instance.state.tasks]
      updatedTasks[0] = { ...updatedTasks[0], status: 'completed' }
      instance.state.tasks = updatedTasks

      await waitForCompleteRender()

      const listItems = getListItems(testContainer.querySelector('[data-list="tasks"]'))
      expect(listItems[0].querySelector('.status').textContent).toBe('completed')
      expect(listItems[1].querySelector('.status').textContent).toBe('pending')
    })

    it('reorders list items', async () => {
      testContainer.innerHTML = `
        <div data-component="reorder-list">
          <ul data-list="items">
            <template>
              <li>
                <span data-bind="name"></span>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('reorder-list', {
        state: {
          items: [
            { id: 1, name: 'Alpha' },
            { id: 2, name: 'Beta' },
            { id: 3, name: 'Gamma' }
          ]
        }
      })

      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="reorder-list"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Reverse the list
      instance.state.items = [...instance.state.items].reverse()
      await waitForCompleteRender()

      const listItems = getListItems(testContainer.querySelector('[data-list="items"]'))
      // Use DOM structure (span is the only child) - data-bind is stripped for performance
      const names = listItems.map(li => li.querySelector('span').textContent)
      expect(names).toEqual(['Gamma', 'Beta', 'Alpha'])
    })

    it('clears entire list', async () => {
      testContainer.innerHTML = `
        <div data-component="clear-list">
          <ul data-list="items">
            <template>
              <li>
                <span data-bind="name"></span>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('clear-list', {
        state: {
          items: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' }
          ]
        }
      })

      await waitForCompleteRender()

      const listElement = testContainer.querySelector('[data-list="items"]')
      let listItems = getListItems(listElement)
      expect(listItems.length).toBe(2)

      const component = testContainer.querySelector('[data-component="clear-list"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Clear list
      instance.state.items = []
      await waitForCompleteRender()

      listItems = getListItems(listElement)
      expect(listItems.length).toBe(0)
    })

    it('clears list after update-then-remove sequence (regression test)', async () => {
      // This tests the specific sequence that caused a regression:
      // Create → Update → Remove → Clear
      // The bug was that _previousData stored a reference instead of a copy,
      // so splice() corrupted the "previous" state.
      testContainer.innerHTML = `
        <div data-component="sequence-clear">
          <ul data-list="rows" data-key="id">
            <template>
              <li>
                <span class="id" data-bind="id"></span>
                <span class="label" data-bind="label"></span>
              </li>
            </template>
          </ul>
        </div>
      `

      // Generate 100 items (enough to trigger optimizations)
      const items = []
      for (let i = 1; i <= 100; i++) {
        items.push({ id: i, label: `Item ${i}` })
      }

      wildflower.component('sequence-clear', {
        state: {
          rows: items
        }
      })

      await waitForCompleteRender()

      const listElement = testContainer.querySelector('[data-list="rows"]')
      let listItems = getListItems(listElement)
      expect(listItems.length).toBe(100)

      const component = testContainer.querySelector('[data-component="sequence-clear"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Step 1: Update every 10th row (triggers property update optimization)
      for (let i = 0; i < instance.state.rows.length; i += 10) {
        instance.state.rows[i].label = `Updated ${i}`
      }
      await waitForCompleteRender()

      // Verify update worked
      const firstLabel = listElement.querySelector('li .label').textContent
      expect(firstLabel).toBe('Updated 0')

      // Step 2: Remove from middle (splice mutation)
      instance.state.rows.splice(50, 1)
      await waitForCompleteRender()

      listItems = getListItems(listElement)
      expect(listItems.length).toBe(99)

      // Step 3: Clear (this is what was failing)
      instance.state.rows = []
      await waitForCompleteRender()

      listItems = getListItems(listElement)
      expect(listItems.length).toBe(0)
    })
  })

  describe('Nested Lists', () => {
    it.skipIf(isMinifiedBuild())('renders nested list structure', async () => {
      testContainer.innerHTML = `
        <div data-component="nested-list">
          <div data-list="categories">
            <template>
              <div class="category">
                <h3 class="category-name" data-bind="name"></h3>
                <ul data-list="items">
                  <template>
                    <li>
                      <span class="item-name" data-bind="name"></span>
                    </li>
                  </template>
                </ul>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('nested-list', {
        state: {
          categories: [
            {
              id: 1,
              name: 'Category A',
              items: [
                { id: 101, name: 'Item A-1' },
                { id: 102, name: 'Item A-2' }
              ]
            },
            {
              id: 2,
              name: 'Category B',
              items: [
                { id: 201, name: 'Item B-1' }
              ]
            }
          ]
        }
      })

      await waitForCompleteRender()
      await waitForUpdate(100)

      // Check categories rendered
      const outerListElement = testContainer.querySelector('[data-list="categories"]')
      const categories = getListItems(outerListElement)
      expect(categories.length).toBe(2)

      // Check first category items
      const firstCategoryItems = getListItems(categories[0].querySelector('[data-list="items"]'))
      expect(firstCategoryItems.length).toBe(2)

      // Check second category items
      const secondCategoryItems = getListItems(categories[1].querySelector('[data-list="items"]'))
      expect(secondCategoryItems.length).toBe(1)

      // Verify content
      expect(categories[0].querySelector('.category-name').textContent).toBe('Category A')
      expect(firstCategoryItems[0].querySelector('.item-name').textContent).toBe('Item A-1')

      // Verify nested list context has correct parent relationship
      const outerListContext = outerListElement._listContext
      const innerListElement = categories[0].querySelector('[data-list="items"]')
      const innerListContext = innerListElement._listContext

      expect(innerListContext).toBeDefined()
      expect(innerListContext.type).toBe('list')
      expect(innerListContext.path).toBe('items')
      expect(innerListContext.parent).toBeDefined()
      expect(innerListContext.parent.type).toBe('list')
      expect(innerListContext.parent.path).toBe('categories')

      // Verify full path construction
      expect(outerListContext.getFullPath()).toBe('categories')
      expect(innerListContext.getFullPath()).toBe('categories[0].items')

      // Verify data resolution through nested context
      const outerData = outerListContext.resolveData()
      expect(outerData.length).toBe(2)
      expect(outerData[0].name).toBe('Category A')

      const innerData = innerListContext.resolveData()
      expect(innerData.length).toBe(2)
      expect(innerData[0].name).toBe('Item A-1')
    })

    it('updates nested list items', async () => {
      testContainer.innerHTML = `
        <div data-component="nested-update">
          <div data-list="groups">
            <template>
              <div class="group">
                <ul data-list="members">
                  <template>
                    <li>
                      <span class="member-name" data-bind="name"></span>
                    </li>
                  </template>
                </ul>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('nested-update', {
        state: {
          groups: [
            {
              id: 1,
              members: [{ id: 1, name: 'Alice' }]
            }
          ]
        }
      })

      await waitForCompleteRender()
      await waitForUpdate(100)

      const component = testContainer.querySelector('[data-component="nested-update"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Add member to first group
      const updatedGroups = [{
        ...instance.state.groups[0],
        members: [...instance.state.groups[0].members, { id: 2, name: 'Bob' }]
      }]
      instance.state.groups = updatedGroups

      await waitForCompleteRender()
      await waitForUpdate(100)

      const members = testContainer.querySelectorAll('.member-name')
      expect(members.length).toBe(2)
      expect(members[1].textContent).toBe('Bob')
    })
  })

  describe('List with Actions', () => {
    it('handles actions on list items with correct index', async () => {
      testContainer.innerHTML = `
        <div data-component="list-actions">
          <ul data-list="actionItems">
            <template>
              <li>
                <span class="name" data-bind="name"></span>
                <button class="remove-btn" data-action="removeItem">Remove</button>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('list-actions', {
        state: {
          actionItems: [
            { id: 1, name: 'First' },
            { id: 2, name: 'Second' },
            { id: 3, name: 'Third' }
          ]
        },
        removeItem(event, element, details) {
          const { index } = details
          const updatedItems = [...this.state.actionItems]
          updatedItems.splice(index, 1)
          this.state.actionItems = updatedItems
        }
      })

      await waitForCompleteRender()
      await waitForUpdate(200)

      // Verify list items rendered
      const listElement = testContainer.querySelector('[data-list="actionItems"]')
      let listItems = getListItems(listElement)
      expect(listItems.length).toBe(3)

      // Click remove on second item
      const removeButtons = listItems[1].querySelectorAll('.remove-btn')
      expect(removeButtons.length).toBe(1)

      removeButtons[0].click() // Remove "Second"
      await waitForCompleteRender()
      await waitForUpdate(200)

      listItems = getListItems(listElement)
      expect(listItems.length).toBe(2)

      const names = listItems.map(li => li.querySelector('.name').textContent)
      expect(names).toEqual(['First', 'Third'])
    })
  })

  describe('List with Conditionals', () => {
    it('shows/hides elements within list items based on item properties', async () => {
      testContainer.innerHTML = `
        <div data-component="list-conditionals">
          <ul data-list="tasks">
            <template>
              <li>
                <span class="name" data-bind="name"></span>
                <span class="done-badge" data-show="done">Done</span>
                <span class="pending-badge" data-show="!done">Pending</span>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('list-conditionals', {
        state: {
          tasks: [
            { id: 1, name: 'Task 1', done: true },
            { id: 2, name: 'Task 2', done: false }
          ]
        }
      })

      await waitForCompleteRender()
      await waitForUpdate(200)

      const listItems = getListItems(testContainer.querySelector('[data-list="tasks"]'))
      expect(listItems.length).toBe(2)

      // First item (done=true)
      const doneBadge1 = listItems[0].querySelector('.done-badge')
      const pendingBadge1 = listItems[0].querySelector('.pending-badge')
      expect(doneBadge1).not.toBeNull()
      expect(pendingBadge1).not.toBeNull()
      expect(doneBadge1.style.display).not.toBe('none')
      expect(pendingBadge1.style.display).toBe('none')

      // Second item (done=false)
      const doneBadge2 = listItems[1].querySelector('.done-badge')
      const pendingBadge2 = listItems[1].querySelector('.pending-badge')
      expect(doneBadge2).not.toBeNull()
      expect(pendingBadge2).not.toBeNull()
      expect(doneBadge2.style.display).toBe('none')
      expect(pendingBadge2.style.display).not.toBe('none')
    })
  })

  describe('HTML5 Template Element', () => {
    it('supports HTML5 template element for list templates', async () => {
      testContainer.innerHTML = `
        <div data-component="html5-template">
          <div data-list="templateItems">
            <template>
              <div class="item" data-bind="name"></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('html5-template', {
        state: {
          templateItems: [
            { id: 1, name: 'Template Item 1' },
            { id: 2, name: 'Template Item 2' }
          ]
        }
      })

      await waitForCompleteRender()
      await waitForUpdate(100)

      const listItems = getListItems(testContainer.querySelector('[data-list="templateItems"]'))
      expect(listItems.length).toBe(2)
      expect(listItems[0].textContent).toBe('Template Item 1')
    })
  })

  // =============================================================
  // LIST CONTEXT VARIABLES
  // Tests for _index, _length, _first, _last in data-bind-class
  // =============================================================

  describe('List Context Variables', () => {

    it('provides _index variable in data-bind-class expressions', async () => {
      testContainer.innerHTML = `
        <div data-component="list-ctx-index-test">
          <div data-list="items">
            <template>
              <div class="item" data-bind-class="_index === 0 ? 'first' : _index === 1 ? 'second' : 'other'">
                <span data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('list-ctx-index-test', {
        state: {
          items: [
            { name: 'Item A' },
            { name: 'Item B' },
            { name: 'Item C' }
          ]
        }
      })

      await waitForCompleteRender()
      await waitForUpdate(100)

      const items = getListItems(testContainer.querySelector('[data-list="items"]'))
      expect(items.length).toBe(3)
      expect(items[0].classList.contains('first')).toBe(true)
      expect(items[1].classList.contains('second')).toBe(true)
      expect(items[2].classList.contains('other')).toBe(true)
    })

    it('provides _first and _last boolean variables', async () => {
      testContainer.innerHTML = `
        <div data-component="list-ctx-first-last-test">
          <div data-list="items">
            <template>
              <div class="item">
                <button class="up-btn btn" data-bind-class="_first || _length === 1 ? 'disabled' : 'enabled'">↑</button>
                <span data-bind="name"></span>
                <button class="down-btn btn" data-bind-class="_last || _length === 1 ? 'disabled' : 'enabled'">↓</button>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('list-ctx-first-last-test', {
        state: {
          items: [
            { name: 'First' },
            { name: 'Middle' },
            { name: 'Last' }
          ]
        }
      })

      await waitForCompleteRender()

      const items = getListItems(testContainer.querySelector('[data-list="items"]'))
      expect(items.length).toBe(3)

      // First item: up disabled, down enabled
      expect(items[0].querySelector('.up-btn').classList.contains('disabled')).toBe(true)
      expect(items[0].querySelector('.down-btn').classList.contains('enabled')).toBe(true)

      // Middle item: both enabled
      expect(items[1].querySelector('.up-btn').classList.contains('enabled')).toBe(true)
      expect(items[1].querySelector('.down-btn').classList.contains('enabled')).toBe(true)

      // Last item: up enabled, down disabled
      expect(items[2].querySelector('.up-btn').classList.contains('enabled')).toBe(true)
      expect(items[2].querySelector('.down-btn').classList.contains('disabled')).toBe(true)
    })

    it('provides _length variable for total count', async () => {
      testContainer.innerHTML = `
        <div data-component="list-ctx-length-test">
          <div data-list="items">
            <template>
              <div class="item" data-bind-class="_length > 2 ? 'many' : 'few'">
                <span data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('list-ctx-length-test', {
        state: {
          items: [
            { name: 'A' },
            { name: 'B' },
            { name: 'C' }
          ]
        }
      })

      await waitForCompleteRender()

      // With 3 items, should have 'many' class
      const items = getListItems(testContainer.querySelector('[data-list="items"]'))
      expect(items.length).toBe(3)
      expect(items[0].classList.contains('many')).toBe(true)
      expect(items[1].classList.contains('many')).toBe(true)
      expect(items[2].classList.contains('many')).toBe(true)
    })

    it('provides _length with fewer items', async () => {
      testContainer.innerHTML = `
        <div data-component="list-ctx-length-few-test">
          <div data-list="items">
            <template>
              <div class="item" data-bind-class="_length > 2 ? 'many' : 'few'">
                <span data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('list-ctx-length-few-test', {
        state: {
          items: [
            { name: 'A' },
            { name: 'B' }
          ]
        }
      })

      await waitForCompleteRender()

      // With 2 items, should have 'few' class
      const items = getListItems(testContainer.querySelector('[data-list="items"]'))
      expect(items.length).toBe(2)
      expect(items[0].classList.contains('few')).toBe(true)
      expect(items[1].classList.contains('few')).toBe(true)
    })

    it('correctly identifies first, middle, and last items', async () => {
      testContainer.innerHTML = `
        <div data-component="list-ctx-position-test">
          <div data-list="items">
            <template>
              <div class="item">
                <span class="pos" data-bind-class="_first ? 'is-first' : _last ? 'is-last' : 'is-middle'"></span>
                <span data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('list-ctx-position-test', {
        state: {
          items: [
            { name: 'A' },
            { name: 'B' },
            { name: 'C' }
          ]
        }
      })

      await waitForCompleteRender()

      const items = getListItems(testContainer.querySelector('[data-list="items"]'))
      expect(items.length).toBe(3)

      // A is first
      expect(items[0].querySelector('.pos').classList.contains('is-first')).toBe(true)
      // B is middle
      expect(items[1].querySelector('.pos').classList.contains('is-middle')).toBe(true)
      // C is last
      expect(items[2].querySelector('.pos').classList.contains('is-last')).toBe(true)
    })

    it('handles single item list (both buttons disabled)', async () => {
      testContainer.innerHTML = `
        <div data-component="list-ctx-single-item-test">
          <div data-list="items">
            <template>
              <div class="item">
                <button class="up-btn btn" data-bind-class="_first || _length === 1 ? 'disabled' : 'enabled'">↑</button>
                <span data-bind="name"></span>
                <button class="down-btn btn" data-bind-class="_last || _length === 1 ? 'disabled' : 'enabled'">↓</button>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('list-ctx-single-item-test', {
        state: {
          items: [{ name: 'Only' }]
        }
      })

      await waitForCompleteRender()

      const items = getListItems(testContainer.querySelector('[data-list="items"]'))
      expect(items.length).toBe(1)

      // Single item: BOTH buttons should be disabled (can't move the only item)
      expect(items[0].querySelector('.up-btn').classList.contains('disabled')).toBe(true)
      expect(items[0].querySelector('.down-btn').classList.contains('disabled')).toBe(true)
    })

    it('updates _first and _last when items are removed', async () => {
      testContainer.innerHTML = `
        <div data-component="list-ctx-dynamic-test">
          <div data-list="items">
            <template>
              <div class="item">
                <button class="up-btn btn" data-bind-class="_first || _length === 1 ? 'disabled' : 'enabled'">↑</button>
                <span class="name" data-bind="name"></span>
                <button class="down-btn btn" data-bind-class="_last || _length === 1 ? 'disabled' : 'enabled'">↓</button>
              </div>
            </template>
          </div>
        </div>
      `

      let component
      wildflower.component('list-ctx-dynamic-test', {
        state: {
          items: [
            { name: 'First' },
            { name: 'Second' },
            { name: 'Third' }
          ]
        },
        init() {
          component = this
        }
      })

      await waitForCompleteRender()

      // Initial state: 3 items
      const listElement = testContainer.querySelector('[data-list="items"]')
      let items = getListItems(listElement)
      expect(items.length).toBe(3)

      // First item: up disabled
      expect(items[0].querySelector('.up-btn').classList.contains('disabled')).toBe(true)
      expect(items[0].querySelector('.down-btn').classList.contains('enabled')).toBe(true)

      // Last item: down disabled
      expect(items[2].querySelector('.up-btn').classList.contains('enabled')).toBe(true)
      expect(items[2].querySelector('.down-btn').classList.contains('disabled')).toBe(true)

      // Remove the first item
      component.state.items.shift()
      await waitForCompleteRender()
      await waitForUpdate(50)

      // Now "Second" is the new first item
      items = getListItems(listElement)
      expect(items.length).toBe(2)

      // "Second" (now first): up should be disabled
      expect(items[0].querySelector('.name').textContent).toBe('Second')
      expect(items[0].querySelector('.up-btn').classList.contains('disabled')).toBe(true)
      expect(items[0].querySelector('.down-btn').classList.contains('enabled')).toBe(true)

      // "Third" (still last): down should be disabled
      expect(items[1].querySelector('.name').textContent).toBe('Third')
      expect(items[1].querySelector('.up-btn').classList.contains('enabled')).toBe(true)
      expect(items[1].querySelector('.down-btn').classList.contains('disabled')).toBe(true)
    })

    it('updates _first and _last when items are added', async () => {
      testContainer.innerHTML = `
        <div data-component="list-ctx-add-test">
          <div data-list="items">
            <template>
              <div class="item">
                <button class="up-btn btn" data-bind-class="_first || _length === 1 ? 'disabled' : 'enabled'">↑</button>
                <span class="name" data-bind="name"></span>
                <button class="down-btn btn" data-bind-class="_last || _length === 1 ? 'disabled' : 'enabled'">↓</button>
              </div>
            </template>
          </div>
        </div>
      `

      let component
      wildflower.component('list-ctx-add-test', {
        state: {
          items: [{ name: 'Only' }]
        },
        init() {
          component = this
        }
      })

      await waitForCompleteRender()

      // Initial state: 1 item, both buttons disabled
      const listElement = testContainer.querySelector('[data-list="items"]')
      let items = getListItems(listElement)
      expect(items.length).toBe(1)
      expect(items[0].querySelector('.up-btn').classList.contains('disabled')).toBe(true)
      expect(items[0].querySelector('.down-btn').classList.contains('disabled')).toBe(true)

      // Add an item at the end
      component.state.items.push({ name: 'Second' })
      await waitForCompleteRender()
      await waitForUpdate(50)

      // Now "Only" is first (up disabled, down enabled)
      items = getListItems(listElement)
      expect(items.length).toBe(2)

      expect(items[0].querySelector('.name').textContent).toBe('Only')
      expect(items[0].querySelector('.up-btn').classList.contains('disabled')).toBe(true)
      expect(items[0].querySelector('.down-btn').classList.contains('enabled')).toBe(true)

      // "Second" is last (up enabled, down disabled)
      expect(items[1].querySelector('.name').textContent).toBe('Second')
      expect(items[1].querySelector('.up-btn').classList.contains('enabled')).toBe(true)
      expect(items[1].querySelector('.down-btn').classList.contains('disabled')).toBe(true)
    })
  })
})
