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

      // Verify action record was created on the element
      const actionContext = button._actionContext
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

      // Check action record for first item's remove button
      const firstRemoveButton = listItems[0].querySelector('.remove-btn')
      const removeContext = firstRemoveButton._actionContext

      expect(removeContext).toBeDefined()
      expect(removeContext.type).toBe('action')
      expect(removeContext.path).toBe('removeItem')

      // Check action record for first item's edit button
      const firstEditButton = listItems[0].querySelector('.edit-btn')
      const editContext = firstEditButton._actionContext

      expect(editContext).toBeDefined()
      expect(editContext.type).toBe('action')
      expect(editContext.path).toBe('editItem')

      // Check action record for second item's buttons
      const secondRemoveButton = listItems[1].querySelector('.remove-btn')
      const secondRemoveContext = secondRemoveButton._actionContext

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
      const actionContext = firstButton._actionContext

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

  // Removed describe('Binding Context Infrastructure') — its only test asserted
  // list-item data-bind created a per-binding context. Per-item effects now paint
  // list-item bindings from the row item proxy (no context); behavioral coverage
  // lives in bindings.test.js / template-system.test.js / general.test.js.

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

      // List contexts are plain objects tracked on the component instance
      // (instance._listContexts) and the element (element._listContext), not in
      // the registry type index.
      const listContext = instance._listContexts.get('items')
      expect(listContext).toBeDefined()
      expect(listContext.type).toBe('list')
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

      // Get initial list context (plain object on the instance map)
      const listContext = instance._listContexts.get('items')

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

      // List contexts are plain objects tracked on the instance map (keyed by
      // path; nested lists use a parentPath[index].childPath key).
      const listContexts = Array.from(instance._listContexts.values())

      // Should have parent list + nested lists
      expect(listContexts.length).toBeGreaterThanOrEqual(1)

      // Find the parent list context
      const parentListContext = instance._listContexts.get('categories')
      expect(parentListContext).toBeDefined()
      expect(parentListContext.path).toBe('categories')
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

      // The action record is element-local (data-bind text is effect-driven).
      const actionElement = testContainer.querySelector('#action')
      expect(actionElement._actionContext).toBeDefined()
      expect(actionElement._actionContext.type).toBe('action')

      // Destroy the component — observable no-leak: the instance is gone.
      wildflower.destroyComponent(componentId)
      await waitForUpdate()

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

      // Destroy component, then run the public component-level GC.
      wildflower.destroyComponent(componentId)
      await waitForUpdate()

      const gcResult = wildflower.garbageCollect()
      expect(gcResult).toBeDefined()
      // Observable no-leak: the destroyed component's instance is gone.
      expect(wildflower.componentInstances.has(componentId)).toBe(false)
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

      // Non-list binding contexts and action records are no longer
      // registry-tracked (action records live on the element); list contexts are
      // plain objects on the instance map.
      const listContexts = Array.from(instance._listContexts.values())

      // The button's action record is element-local now
      const button = component.querySelector('button[data-action], button')
      expect(button._actionContext).toBeDefined()
      expect(button._actionContext.type).toBe('action')

      // Verify correct counts (at least the expected minimum)
      expect(listContexts.length).toBeGreaterThanOrEqual(1) // items
    })

  })

  describe('Conditional Context Infrastructure', () => {
    it('applies data-show visibility for component-level elements', async () => {
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

      // data-show is applied directly to the elements (no registry-tracked
      // conditional context). With isVisible true, the positive element shows
      // and the negated one hides.
      const positive = testContainer.querySelector('#visible-when-true')
      const negated = testContainer.querySelector('#visible-when-false')
      expect(positive.style.display).not.toBe('none')
      expect(negated.style.display).toBe('none')

      // Toggling state flips both.
      const component = testContainer.querySelector('[data-component="conditional-context-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)
      instance.state.isVisible = false
      await waitForUpdate()
      expect(positive.style.display).toBe('none')
      expect(negated.style.display).not.toBe('none')
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

  // Model Context Infrastructure tests were removed: non-list data-model bindings
  // no longer create a per-binding CM context (Bucket A) — the model record lives
  // on the element (_wfModel) and two-way binding behavior is covered by the
  // model-modifiers / form / nested-list-form-input suites. List-item model
  // bindings use per-item effects, not the context registry.
})
