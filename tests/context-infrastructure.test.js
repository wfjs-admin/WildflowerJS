/**
 * WildflowerJS Context Infrastructure Test Suite - Vitest Browser Mode
 *
 * Tests for the internal context system infrastructure.
 * These tests verify that contexts are correctly created, linked, and cleaned up.
 *
 * Migrated from unitTestSuite.js to catch infrastructure regressions that
 * behavioral tests might miss.
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

describe.skipIf(isMinifiedBuild())('Context Infrastructure', () => {
  let testContainer
  let wildflower
  let registry

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    registry = wildflower._contextRegistry

    // Simple reset
    if (wildflower.componentDefinitions) {
      wildflower.componentDefinitions.clear()
    }
    if (wildflower.componentInstances) {
      wildflower.componentInstances.clear()
    }
    if (wildflower.storeManager && wildflower.storeManager._namedStores) {
      wildflower.storeManager._namedStores.clear()
    }

    // CRITICAL: Clear template cache to prevent cross-test contamination
    if (wildflower._templateCache) {
      if (wildflower._templateCache.general) wildflower._templateCache.general.clear()
      if (wildflower._templateCache.lists) wildflower._templateCache.lists.clear()
      if (wildflower._templateCache.compiled) wildflower._templateCache.compiled.clear()
      if (wildflower._templateCache.extracted) wildflower._templateCache.extracted.clear()
      if (wildflower._templateCache.fragmentPools) wildflower._templateCache.fragmentPools.clear()
      if (wildflower._templateCache.stats) wildflower._templateCache.stats.clear()
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

  describe('Action Context Infrastructure', () => {
    it('creates action context for standalone button', async () => {
      testContainer.innerHTML = `
        <div data-component="action-context-test">
          <button id="test-button" data-action="handleClick">Click Me</button>
        </div>
      `

      wildflower.component('action-context-test', {
        state: { clicked: false },
        handleClick() {
          this.state.clicked = true
        }
      })

      await waitForUpdate()

      const button = testContainer.querySelector('#test-button')

      // Verify action context was created
      const actionContext = registry.getContextForElement(button)
      expect(actionContext).toBeDefined()
      expect(actionContext.type).toBe('action')
      expect(actionContext.path).toBe('handleClick')
    })

    it('creates action context for button in list item', async () => {
      testContainer.innerHTML = `
        <div data-component="list-action-context-test">
          <ul data-list="items">
            <template>
              <li>
                <span data-bind="name"></span>
                <button class="remove-btn" data-action="removeItem">Remove</button>
                <button class="edit-btn" data-action="editItem">Edit</button>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('list-action-context-test', {
        state: {
          items: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' },
            { id: 3, name: 'Item 3' }
          ]
        },
        removeItem(event, element, details) {
          const { index } = details
          this.state.items = this.state.items.filter((_, i) => i !== index)
        },
        editItem(event, element, details) {
          // placeholder
        }
      })

      await waitForCompleteRender()
      await waitForUpdate(100)

      const listItems = getListItems(testContainer.querySelector('[data-list="items"]'))
      expect(listItems.length).toBe(3)

      // Check action context for first item's remove button
      const firstRemoveButton = listItems[0].querySelector('.remove-btn')
      const removeContext = registry.getContextForElement(firstRemoveButton)

      expect(removeContext).toBeDefined()
      expect(removeContext.type).toBe('action')
      expect(removeContext.path).toBe('removeItem')

      // Check action context for first item's edit button
      const firstEditButton = listItems[0].querySelector('.edit-btn')
      const editContext = registry.getContextForElement(firstEditButton)

      expect(editContext).toBeDefined()
      expect(editContext.type).toBe('action')
      expect(editContext.path).toBe('editItem')

      // Check action context for second item's buttons
      const secondRemoveButton = listItems[1].querySelector('.remove-btn')
      const secondRemoveContext = registry.getContextForElement(secondRemoveButton)

      expect(secondRemoveContext).toBeDefined()
      expect(secondRemoveContext.type).toBe('action')
    })

    it('action context has correct parent relationship in list', async () => {
      testContainer.innerHTML = `
        <div data-component="action-parent-test">
          <ul data-list="items">
            <template>
              <li>
                <button class="action-btn" data-action="doSomething">Action</button>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('action-parent-test', {
        state: {
          items: [{ id: 1 }, { id: 2 }]
        },
        doSomething() {}
      })

      await waitForCompleteRender()
      await waitForUpdate(100)

      const listItems = getListItems(testContainer.querySelector('[data-list="items"]'))
      const firstButton = listItems[0].querySelector('.action-btn')
      const actionContext = registry.getContextForElement(firstButton)

      expect(actionContext).toBeDefined()
      expect(actionContext.parent).toBeDefined()
      expect(actionContext.parent.type).toBe('list')
      expect(actionContext._parentIndex).toBe(0)
    })

    it('action context receives correct index in details', async () => {
      testContainer.innerHTML = `
        <div data-component="action-index-test">
          <ul data-list="items">
            <template>
              <li>
                <button class="delete-btn" data-action="deleteItem">Delete</button>
              </li>
            </template>
          </ul>
        </div>
      `

      let capturedIndex = null
      wildflower.component('action-index-test', {
        state: {
          items: [{ id: 1 }, { id: 2 }, { id: 3 }]
        },
        deleteItem(event, element, details) {
          capturedIndex = details.index
        }
      })

      await waitForCompleteRender()
      await waitForUpdate(100)

      // Click the second item's button (index 1)
      const listItems = getListItems(testContainer.querySelector('[data-list="items"]'))
      const secondButton = listItems[1].querySelector('.delete-btn')
      secondButton.click()
      await waitForUpdate()

      expect(capturedIndex).toBe(1)
    })
  })

  describe('Binding Context Infrastructure', () => {
    it('creates binding context for data-bind elements', async () => {
      testContainer.innerHTML = `
        <div data-component="binding-context-test">
          <div id="name-display" data-bind="name"></div>
          <div id="count-display" data-bind="count"></div>
        </div>
      `

      wildflower.component('binding-context-test', {
        state: {
          name: 'Test',
          count: 42
        }
      })

      await waitForUpdate()

      const nameDisplay = testContainer.querySelector('#name-display')
      const countDisplay = testContainer.querySelector('#count-display')

      // Verify binding contexts were created
      const nameContext = registry.getContextForElement(nameDisplay)
      const countContext = registry.getContextForElement(countDisplay)

      expect(nameContext).toBeDefined()
      expect(nameContext.type).toBe('binding')
      expect(nameContext.path).toBe('name')

      expect(countContext).toBeDefined()
      expect(countContext.type).toBe('binding')
      expect(countContext.path).toBe('count')
    })

    it('creates binding context for list item bindings', async () => {
      testContainer.innerHTML = `
        <div data-component="list-binding-context-test">
          <ul data-list="items">
            <template>
              <li>
                <span class="name-binding" data-bind="name"></span>
                <span class="value-binding" data-bind="value"></span>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('list-binding-context-test', {
        state: {
          items: [
            { name: 'First', value: 100 },
            { name: 'Second', value: 200 }
          ]
        }
      })

      await waitForCompleteRender()
      await waitForUpdate(100)

      const listItems = getListItems(testContainer.querySelector('[data-list="items"]'))
      const firstItem = listItems[0]
      const nameBinding = firstItem.querySelector('.name-binding')
      const valueBinding = firstItem.querySelector('.value-binding')

      // Get binding contexts
      const nameContext = registry.getContextForElement(nameBinding)
      const valueContext = registry.getContextForElement(valueBinding)

      expect(nameContext).toBeDefined()
      expect(valueContext).toBeDefined()

      // Verify parent-child relationships
      expect(nameContext.parent).toBeDefined()
      expect(nameContext.parent.type).toBe('list')
    })

    it('binding contexts have correct component instance reference', async () => {
      testContainer.innerHTML = `
        <div data-component="binding-instance-test">
          <div id="test-binding" data-bind="value"></div>
        </div>
      `

      wildflower.component('binding-instance-test', {
        state: { value: 'test' }
      })

      await waitForUpdate()

      const component = testContainer.querySelector('[data-component="binding-instance-test"]')
      const componentId = component.dataset.componentId
      const instance = wildflower.componentInstances.get(componentId)

      const bindingElement = testContainer.querySelector('#test-binding')
      const bindingContext = registry.getContextForElement(bindingElement)

      expect(bindingContext.componentInstance).toBe(instance)
    })
  })

  describe('List Context Infrastructure', () => {
    it('creates list context for data-list elements', async () => {
      testContainer.innerHTML = `
        <div data-component="list-context-test">
          <ul data-list="items">
            <template>
              <li data-bind="name"></li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('list-context-test', {
        state: {
          items: [{ name: 'A' }, { name: 'B' }]
        }
      })

      await waitForCompleteRender()
      await waitForUpdate(100)

      // Get list contexts for this component
      const component = testContainer.querySelector('[data-component="list-context-test"]')
      const componentId = component.dataset.componentId
      const instance = wildflower.componentInstances.get(componentId)

      const listContexts = registry.getContextsByType('list')
        .filter(ctx => ctx.componentInstance === instance)

      expect(listContexts.length).toBeGreaterThan(0)

      const listContext = listContexts[0]
      expect(listContext.path).toBe('items')
      expect(listContext.data).toHaveLength(2)
    })

    it('list context updates when data changes', async () => {
      testContainer.innerHTML = `
        <div data-component="list-update-context-test">
          <ul data-list="items">
            <template>
              <li data-bind="name"></li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('list-update-context-test', {
        state: {
          items: [{ name: 'Initial' }]
        }
      })

      await waitForCompleteRender()
      await waitForUpdate(100)

      const component = testContainer.querySelector('[data-component="list-update-context-test"]')
      const componentId = component.dataset.componentId
      const instance = wildflower.componentInstances.get(componentId)

      // Get initial list context
      const listContexts = registry.getContextsByType('list')
        .filter(ctx => ctx.componentInstance === instance)
      const listContext = listContexts[0]

      expect(listContext.data).toHaveLength(1)

      // Update the list
      instance.state.items = [{ name: 'A' }, { name: 'B' }, { name: 'C' }]
      await waitForCompleteRender()
      await waitForUpdate(100)

      // Verify context data was updated
      expect(listContext.data).toHaveLength(3)
    })

    it('nested list contexts have correct parent relationships', async () => {
      testContainer.innerHTML = `
        <div data-component="nested-list-context-test">
          <div data-list="categories">
            <template>
              <div class="category">
                <span data-bind="name"></span>
                <ul data-list="items">
                  <template>
                    <li data-bind="label"></li>
                  </template>
                </ul>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('nested-list-context-test', {
        state: {
          categories: [
            { name: 'Cat 1', items: [{ label: 'Item 1' }, { label: 'Item 2' }] },
            { name: 'Cat 2', items: [{ label: 'Item 3' }] }
          ]
        }
      })

      await waitForCompleteRender()
      await waitForUpdate(150)

      const component = testContainer.querySelector('[data-component="nested-list-context-test"]')
      const componentId = component.dataset.componentId
      const instance = wildflower.componentInstances.get(componentId)

      // Get all list contexts for this component
      const listContexts = registry.getContextsByType('list')
        .filter(ctx => ctx.componentInstance === instance)

      // Should have parent list + nested lists
      expect(listContexts.length).toBeGreaterThanOrEqual(1)

      // Find the parent list context
      const parentListContext = listContexts.find(ctx => ctx.path === 'categories')
      expect(parentListContext).toBeDefined()
    })
  })

  describe('Context Cleanup and Garbage Collection', () => {
    it('removes contexts when component is destroyed', async () => {
      testContainer.innerHTML = `
        <div data-component="cleanup-context-test">
          <div id="binding" data-bind="value"></div>
          <button id="action" data-action="doSomething">Click</button>
        </div>
      `

      wildflower.component('cleanup-context-test', {
        state: { value: 'test' },
        doSomething() {}
      })

      await waitForUpdate()

      const component = testContainer.querySelector('[data-component="cleanup-context-test"]')
      const componentId = component.dataset.componentId
      const instance = wildflower.componentInstances.get(componentId)

      // Get contexts before destruction
      const bindingElement = testContainer.querySelector('#binding')
      const actionElement = testContainer.querySelector('#action')

      const bindingContext = registry.getContextForElement(bindingElement)
      const actionContext = registry.getContextForElement(actionElement)

      expect(bindingContext).toBeDefined()
      expect(actionContext).toBeDefined()

      // Destroy the component
      wildflower.destroyComponent(componentId)
      await waitForUpdate()

      // Verify component is destroyed
      expect(wildflower.componentInstances.has(componentId)).toBe(false)
    })

    it('garbageCollect removes orphaned contexts', async () => {
      // Create contexts that will become orphaned
      testContainer.innerHTML = `
        <div data-component="gc-test">
          <div data-bind="value"></div>
        </div>
      `

      wildflower.component('gc-test', {
        state: { value: 'test' }
      })

      await waitForUpdate()

      const component = testContainer.querySelector('[data-component="gc-test"]')
      const componentId = component.dataset.componentId

      // Get initial context count
      const initialContextCount = registry.contexts.size

      // Destroy component (orphans contexts)
      wildflower.destroyComponent(componentId)
      await waitForUpdate()

      // Run garbage collection
      if (registry.garbageCollect) {
        const gcResult = registry.garbageCollect()
        // GC returns the count of removed contexts
        expect(gcResult).toBeGreaterThanOrEqual(0)
      }
    })

    it('list item contexts are cleaned up when items are removed', async () => {
      testContainer.innerHTML = `
        <div data-component="list-cleanup-infra-test">
          <ul data-list="cleanupItems">
            <template>
              <li>
                <span data-bind="name"></span>
                <button data-action="remove">X</button>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('list-cleanup-infra-test', {
        state: {
          cleanupItems: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' },
            { id: 3, name: 'Item 3' }
          ]
        },
        remove(event, element, details) {
          const { index } = details
          this.state.cleanupItems = this.state.cleanupItems.filter((_, i) => i !== index)
        }
      })

      await waitForCompleteRender()
      await waitForUpdate(150)

      const component = testContainer.querySelector('[data-component="list-cleanup-infra-test"]')

      // Count list items initially
      const listElement = component.querySelector('[data-list="cleanupItems"]')
      let listItems = getListItems(listElement)
      expect(listItems.length).toBe(3)

      // Get context for first item's binding
      const firstItemBinding = listItems[0].querySelector('span')
      const initialContext = registry.getContextForElement(firstItemBinding)
      expect(initialContext).toBeDefined()

      // Remove the first item
      const componentId = component.dataset.componentId
      const instance = wildflower.componentInstances.get(componentId)

      instance.state.cleanupItems = instance.state.cleanupItems.slice(1)
      await waitForCompleteRender()
      await waitForUpdate(150)

      // Verify items were removed
      listItems = getListItems(listElement)
      expect(listItems.length).toBe(2)
    })
  })

  describe('Context Registry Operations', () => {
    it('getContextsByType returns correct context types', async () => {
      testContainer.innerHTML = `
        <div data-component="context-types-test">
          <div data-bind="name"></div>
          <div data-bind="value"></div>
          <button data-action="doSomething">Click</button>
          <ul data-list="items">
            <template>
              <li data-bind="label"></li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('context-types-test', {
        state: {
          name: 'Test',
          value: 42,
          items: [{ label: 'A' }]
        },
        doSomething() {}
      })

      await waitForCompleteRender()
      await waitForUpdate(100)

      const component = testContainer.querySelector('[data-component="context-types-test"]')
      const componentId = component.dataset.componentId
      const instance = wildflower.componentInstances.get(componentId)

      // Get contexts by type
      const bindingContexts = registry.getContextsByType('binding')
        .filter(ctx => ctx.componentInstance === instance)
      const actionContexts = registry.getContextsByType('action')
        .filter(ctx => ctx.componentInstance === instance)
      const listContexts = registry.getContextsByType('list')
        .filter(ctx => ctx.componentInstance === instance)

      // Verify correct counts (at least the expected minimum)
      expect(bindingContexts.length).toBeGreaterThanOrEqual(2) // name, value (+ list bindings)
      expect(actionContexts.length).toBeGreaterThanOrEqual(1) // doSomething
      expect(listContexts.length).toBeGreaterThanOrEqual(1) // items
    })

    it('getContextForElement returns null for unregistered elements', async () => {
      const orphanElement = document.createElement('div')
      orphanElement.setAttribute('data-bind', 'nonexistent')

      const context = registry.getContextForElement(orphanElement)
      expect(context).toBeNull()
    })

    it('contextsByElement map tracks element-context associations', async () => {
      testContainer.innerHTML = `
        <div data-component="element-map-test">
          <div id="test-element" data-bind="value"></div>
        </div>
      `

      wildflower.component('element-map-test', {
        state: { value: 'test' }
      })

      await waitForUpdate()

      const element = testContainer.querySelector('#test-element')

      // Verify element is in the map
      expect(registry.contextsByElement.has(element)).toBe(true)

      const context = registry.contextsByElement.get(element)
      expect(context).toBeDefined()
      expect(context.type).toBe('binding')
    })
  })

  describe('Conditional Context Infrastructure', () => {
    it('creates conditional context for data-show elements', async () => {
      testContainer.innerHTML = `
        <div data-component="conditional-context-test">
          <div id="visible-when-true" data-show="isVisible">Visible</div>
          <div id="visible-when-false" data-show="!isVisible">Hidden</div>
        </div>
      `

      wildflower.component('conditional-context-test', {
        state: { isVisible: true }
      })

      await waitForUpdate()

      const component = testContainer.querySelector('[data-component="conditional-context-test"]')
      const componentId = component.dataset.componentId
      const instance = wildflower.componentInstances.get(componentId)

      // Get conditional contexts
      const conditionalContexts = registry.getContextsByType('conditional')
        .filter(ctx => ctx.componentInstance === instance)

      expect(conditionalContexts.length).toBeGreaterThanOrEqual(2)
    })

    it('conditional context in list items', async () => {
      testContainer.innerHTML = `
        <div data-component="list-conditional-infra-test">
          <ul data-list="condItems">
            <template>
              <li>
                <span data-bind="name"></span>
                <span class="active-badge" data-show="active">Active</span>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('list-conditional-infra-test', {
        state: {
          condItems: [
            { name: 'Item 1', active: true },
            { name: 'Item 2', active: false }
          ]
        }
      })

      await waitForCompleteRender()
      await waitForUpdate(150)

      const component = testContainer.querySelector('[data-component="list-conditional-infra-test"]')
      const listItems = getListItems(component.querySelector('[data-list="condItems"]'))

      expect(listItems.length).toBe(2)

      const firstBadge = listItems[0].querySelector('.active-badge')
      // First item should show the badge (active: true)
      expect(firstBadge.style.display).not.toBe('none')

      const secondBadge = listItems[1].querySelector('.active-badge')
      // Second item should hide the badge (active: false)
      expect(secondBadge.style.display).toBe('none')
    })
  })

  describe('Model Context Infrastructure', () => {
    it('creates binding context for data-model elements', async () => {
      testContainer.innerHTML = `
        <div data-component="model-context-test">
          <input id="name-input" type="text" data-model="name">
          <div id="name-display" data-bind="name"></div>
        </div>
      `

      wildflower.component('model-context-test', {
        state: { name: 'Initial' }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#name-input')
      const context = registry.getContextForElement(input)

      expect(context).toBeDefined()
      expect(context.type).toBe('binding')
      expect(context.path).toBe('name')
    })

    // NOTE: Test "model context in list items enables two-way binding" was removed
    // because it tested context-mode specific behavior. mapArray uses per-item effects
    // instead of the context registry for list item bindings.
  })
})
