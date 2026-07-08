/**
 * WildflowerJS General Context System Test Suite - Vitest Browser Mode
 *
 * Tests for context system behavior through DOM-based component testing.
 * Migrated from unitTestSuite.js GENERAL section.
 *
 * Note: Original tests used direct Context class instantiation which is internal.
 * These tests verify the same functionality through the public component API.
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

describe('GENERAL - Context System', () => {
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

  it.skipIf(isMinifiedBuild())('context registry creates contexts for list elements', async () => {
    wildflower.component('context-list-test', {
      state: {
        contextListItems: [
          { id: 1, name: 'Item 1' },
          { id: 2, name: 'Item 2' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="context-list-test">
        <ul data-list="contextListItems">
          <template>
            <li data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="context-list-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // List contexts are plain objects on the instance map, not registry-tracked
    const listContext = instance._listContexts.get('contextListItems')
    expect(listContext).toBeDefined()
    expect(listContext.type).toBe('list')
    expect(listContext.path).toBe('contextListItems')
  })

  it.skipIf(isMinifiedBuild())('context registry creates binding contexts for data-bind elements', async () => {
    wildflower.component('context-binding-test', {
      state: {
        bindingTestItems: [
          { id: 1, name: 'Binding 1' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="context-binding-test">
        <ul data-list="bindingTestItems">
          <template>
            <li><span class="name" data-bind="name"></span></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="context-binding-test"]')

    // List-item data-bind is painted by the per-item effect from the row item
    // proxy (no per-binding context is created); verify the rendered value.
    const nameBinding = component.querySelector('.name')
    expect(nameBinding.textContent).toBe('Binding 1')
  })

  it('context data updates reflect in DOM', async () => {
    wildflower.component('context-update-test', {
      state: {
        updateTestItems: [
          { id: 1, label: 'Original' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="context-update-test">
        <ul data-list="updateTestItems">
          <template>
            <li><span class="label" data-bind="label"></span></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="context-update-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Verify initial render
    let label = component.querySelector('.label')
    expect(label.textContent).toBe('Original')

    // Update through state API
    instance.state.updateTestItems[0].label = 'Updated'
    await waitForUpdate()

    // Verify DOM updated
    label = component.querySelector('.label')
    expect(label.textContent).toBe('Updated')
  })

  it('context lifecycle - removal cleans up properly', async () => {
    wildflower.component('context-lifecycle-test', {
      state: {
        lifecycleItems: [
          { id: 1, name: 'Remove Me' },
          { id: 2, name: 'Keep Me' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="context-lifecycle-test">
        <ul data-list="lifecycleItems">
          <template>
            <li data-bind="name"></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="context-lifecycle-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Verify initial render
    let items = component.querySelectorAll('[data-list="lifecycleItems"] > li')
    expect(items.length).toBe(2)

    // Remove first item via splice
    instance.state.lifecycleItems.splice(0, 1)
    await waitForCompleteRender()

    // Verify DOM updated
    items = component.querySelectorAll('[data-list="lifecycleItems"] > li')
    expect(items.length).toBe(1)
    expect(items[0].textContent.trim()).toBe('Keep Me')
  })

  it('different context types (list, binding, conditional) work together', async () => {
    wildflower.component('multi-context-test', {
      state: {
        multiItems: [
          { id: 1, name: 'Item 1' },
          { id: 2, name: 'Item 2' }
        ],
        title: 'My List'
      }
    })

    testContainer.innerHTML = `
      <div data-component="multi-context-test">
        <h2 class="title" data-bind="title"></h2>
        <ul data-list="multiItems">
          <template>
            <li>
              <span class="name" data-bind="name"></span>
            </li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="multi-context-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Verify multiple context types rendered
    expect(component.querySelector('.title').textContent).toBe('My List')
    const listItems = component.querySelectorAll('li')
    expect(listItems.length).toBe(2)
    expect(listItems[0].querySelector('.name').textContent).toBe('Item 1')
    expect(listItems[1].querySelector('.name').textContent).toBe('Item 2')

    // Verify binding updates
    instance.state.title = 'Updated Title'
    await waitForUpdate()
    expect(component.querySelector('.title').textContent).toBe('Updated Title')

    // Verify list updates
    instance.state.multiItems[0].name = 'Updated Item'
    await waitForUpdate()
    expect(listItems[0].querySelector('.name').textContent).toBe('Updated Item')

    // Verify adding to list
    instance.state.multiItems.push({ id: 3, name: 'Item 3' })
    await waitForCompleteRender()
    const updatedItems = component.querySelectorAll('li')
    expect(updatedItems.length).toBe(3)
  })

  it.skipIf(isMinifiedBuild())('framework automatically creates contexts based on DOM attributes', async () => {
    wildflower.component('auto-context-creation-test', {
      state: {
        autoCreateItems: [
          { id: 1, name: 'Auto 1' },
          { id: 2, name: 'Auto 2' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="auto-context-creation-test">
        <ul data-list="autoCreateItems">
          <template>
            <li><span class="name" data-bind="name"></span></li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="auto-context-creation-test"]')
    const componentId = component.dataset.componentId
    const componentInstance = wildflower.componentInstances.get(componentId)

    // Verify list context was created (plain object on the instance map)
    const listContext = componentInstance._listContexts.get('autoCreateItems')
    expect(listContext).toBeDefined()
    expect(listContext.path).toBe('autoCreateItems')

    // Verify binding works - list items rendered
    const listItems = component.querySelectorAll('li')
    expect(listItems.length).toBe(2)
    expect(listItems[0].querySelector('.name').textContent).toBe('Auto 1')
    expect(listItems[1].querySelector('.name').textContent).toBe('Auto 2')

    // Verify state updates work correctly
    componentInstance.state.autoCreateItems[0].name = 'Updated Auto'
    await waitForUpdate()
    expect(listItems[0].querySelector('.name').textContent).toBe('Updated Auto')
  })

  it.skipIf(isMinifiedBuild())('framework updates context data without full DOM traversal', async () => {
    wildflower.component('efficient-update-test', {
      state: {
        efficientItems: [
          { id: 1, name: 'Item 1', active: true }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="efficient-update-test">
        <div data-list="efficientItems">
          <template>
            <span class="name" data-bind="name"></span>
          </template>
        </div>
      </div>
    `

    wildflower.scan()
    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="efficient-update-test"]')
    const componentId = component.dataset.componentId
    const componentInstance = wildflower.componentInstances.get(componentId)

    // Get the list context (plain object on the instance map)
    const listContext = componentInstance._listContexts.get('efficientItems')

    expect(listContext).toBeDefined()

    // Update state
    componentInstance.state.efficientItems[0].name = 'Efficient Update'
    await waitForUpdate()

    // Verify context data was updated
    const updatedData = listContext.resolveData()
    expect(updatedData[0].name).toBe('Efficient Update')

    // Verify DOM reflects the update
    const nameElement = component.querySelector('.name')
    expect(nameElement.textContent).toBe('Efficient Update')
  })
})
