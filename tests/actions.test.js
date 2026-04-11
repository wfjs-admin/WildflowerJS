/**
 * WildflowerJS Actions Test Suite - Vitest Browser Mode
 *
 * Tests for data-action event handling.
 * Migrated from unitTestSuite.js ACTION CONTEXT section.
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

describe('Action Context', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower

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

  it.skipIf(isMinifiedBuild())('Basic action handling', async () => {
    testContainer.innerHTML = `
      <div data-component="action-test">
        <button id="increment-button" data-action="incrementCount">Increment</button>
        <div id="count-display" data-bind="count"></div>
      </div>
    `

    let actionCallCount = 0
    wildflower.component('action-test', {
      state: {
        count: 0
      },
      incrementCount(event, element) {
        this.state.count++
        actionCallCount++
      }
    })

    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="action-test"]')
    const button = component.querySelector('#increment-button')
    const display = component.querySelector('#count-display')

    // Verify action context was created
    const registry = wildflower._contextRegistry
    const actionContext = registry.getContextForElement(button)
    expect(actionContext).toBeDefined()
    expect(actionContext.type).toBe('action')
    expect(actionContext.path).toBe('incrementCount')

    // Test initial state
    expect(display.textContent).toBe('0')
    expect(actionCallCount).toBe(0)

    // Trigger the action
    button.click()
    await waitForUpdate()

    // Test state after action
    expect(display.textContent).toBe('1')
    expect(actionCallCount).toBe(1)

    // Trigger again
    button.click()
    await waitForUpdate()

    // Test final state
    expect(display.textContent).toBe('2')
    expect(actionCallCount).toBe(2)
  })

  it.skipIf(isMinifiedBuild())('Event type specification in actions', async () => {
    testContainer.innerHTML = `
      <div data-component="event-action-test">
        <input id="name-input" data-action="input:updateName" value="">
        <button id="reset-button" data-action="click:resetName">Reset</button>
        <div id="name-display" data-bind="name"></div>
      </div>
    `

    wildflower.component('event-action-test', {
      state: {
        name: ''
      },
      updateName(event, element) {
        this.state.name = element.value
      },
      resetName() {
        this.state.name = ''
      }
    })

    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="event-action-test"]')
    const input = component.querySelector('#name-input')
    const resetButton = component.querySelector('#reset-button')
    const display = component.querySelector('#name-display')

    // Verify action contexts were created with correct event types
    const registry = wildflower._contextRegistry
    const inputContext = registry.getContextForElement(input)
    const buttonContext = registry.getContextForElement(resetButton)

    expect(inputContext).toBeDefined()
    expect(inputContext.type).toBe('action')
    expect(inputContext.data.event).toBe('input')

    expect(buttonContext).toBeDefined()
    expect(buttonContext.type).toBe('action')
    expect(buttonContext.data.event).toBe('click')

    // Test initial state
    expect(display.textContent).toBe('')

    // Trigger input action
    input.value = 'Test Name'
    input.dispatchEvent(new Event('input'))
    await waitForUpdate()

    // Test state after input
    expect(display.textContent).toBe('Test Name')

    // Trigger reset action
    resetButton.click()
    await waitForUpdate()

    // Test state after reset
    expect(display.textContent).toBe('')
  })

  it.skipIf(isMinifiedBuild())('Multiple actions on one element', async () => {
    testContainer.innerHTML = `
      <div data-component="multi-action-test">
        <div id="interaction-area"
             data-action="click:handleClick mouseover:handleMouseOver mouseout:handleMouseOut">
          Interact with me
        </div>
        <div id="event-display" data-bind="lastEvent"></div>
      </div>
    `

    wildflower.component('multi-action-test', {
      state: {
        lastEvent: 'none'
      },
      handleClick() {
        this.state.lastEvent = 'click'
      },
      handleMouseOver() {
        this.state.lastEvent = 'mouseover'
      },
      handleMouseOut() {
        this.state.lastEvent = 'mouseout'
      }
    })

    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="multi-action-test"]')
    const componentId = component.dataset.componentId
    const interactionArea = component.querySelector('#interaction-area')
    const display = component.querySelector('#event-display')

    // Verify action contexts were created for all event types
    const registry = wildflower._contextRegistry
    const actionContexts = registry.getContextsByType('action')
      .filter(ctx => ctx.componentInstance && ctx.componentInstance.id === componentId)

    expect(actionContexts.length).toBe(3)

    const clickContext = actionContexts.find(ctx => ctx.data && ctx.data.event === 'click')
    const mouseoverContext = actionContexts.find(ctx => ctx.data && ctx.data.event === 'mouseover')
    const mouseoutContext = actionContexts.find(ctx => ctx.data && ctx.data.event === 'mouseout')

    expect(clickContext).toBeDefined()
    expect(mouseoverContext).toBeDefined()
    expect(mouseoutContext).toBeDefined()

    // Test initial state
    expect(display.textContent).toBe('none')

    // Trigger click event
    interactionArea.click()
    await waitForUpdate()

    expect(display.textContent).toBe('click')

    // Trigger mouseover event
    interactionArea.dispatchEvent(new MouseEvent('mouseover'))
    await waitForUpdate()

    expect(display.textContent).toBe('mouseover')

    // Trigger mouseout event
    interactionArea.dispatchEvent(new MouseEvent('mouseout'))
    await waitForUpdate()

    expect(display.textContent).toBe('mouseout')
  })

  it.skipIf(isMinifiedBuild())('Actions in list items', async () => {
    testContainer.innerHTML = `
      <div data-component="list-action-test">
        <ul data-list="items">
          <template>
            <li>
              <span class="item-name" data-bind="name"></span>
              <button class="remove-button" data-action="removeItem">Remove</button>
              <button class="toggle-button" data-action="toggleActive">Toggle</button>
            </li>
          </template>
        </ul>
        <div id="item-count" data-bind="computed:itemCount"></div>
      </div>
    `

    wildflower.component('list-action-test', {
      state: {
        items: [
          { id: 1, name: 'Item 1', active: true },
          { id: 2, name: 'Item 2', active: false },
          { id: 3, name: 'Item 3', active: true }
        ]
      },
      computed: {
        itemCount() {
          return this.state.items.length
        }
      },
      removeItem(event, element, details) {
        const { index } = details
        const updatedItems = [...this.state.items]
        updatedItems.splice(index, 1)
        this.state.items = updatedItems
      },
      toggleActive(event, element, details) {
        const { index } = details
        const updatedItems = [...this.state.items]
        updatedItems[index] = {
          ...updatedItems[index],
          active: !updatedItems[index].active
        }
        this.state.items = updatedItems
      }
    })

    await waitForCompleteRender()
    await waitForUpdate(100)

    const component = testContainer.querySelector('[data-component="list-action-test"]')
    const componentId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(componentId)

    const itemCount = component.querySelector('#item-count')
    const listElement = component.querySelector('[data-list="items"]')
    let listItems = getListItems(listElement)

    expect(listItems.length).toBe(3)
    expect(itemCount.textContent).toBe('3')

    // Get first item's remove button
    const firstRemoveButton = listItems[0].querySelector('.remove-button')

    // Verify action context in list item exists with correct properties
    const registry = wildflower._contextRegistry
    const actionContext = registry.getContextForElement(firstRemoveButton)
    expect(actionContext).toBeDefined()
    expect(actionContext.type).toBe('action')
    expect(actionContext.path).toBe('removeItem')

    // Verify parent-child relationship
    expect(actionContext.parent).toBeDefined()
    expect(actionContext.parent.type).toBe('list')

    // Click the button
    firstRemoveButton.click()

    await waitForCompleteRender()
    await waitForUpdate(100)

    // Verify item was removed
    listItems = getListItems(listElement)
    expect(listItems.length).toBe(2)
    expect(itemCount.textContent).toBe('2')

    // Test toggle action on the new first item
    const firstToggleButton = listItems[0].querySelector('.toggle-button')
    const firstItemActive = instance.state.items[0].active

    firstToggleButton.click()
    await waitForUpdate()

    // Verify item was toggled
    expect(instance.state.items[0].active).toBe(!firstItemActive)
  })

  it.skipIf(isMinifiedBuild())('Action context cleanup on component destruction', async () => {
    testContainer.innerHTML = `
      <div data-component="cleanup-action-test">
        <button id="test-button" data-action="testAction">Test Action</button>
      </div>
    `

    let actionCallCount = 0

    wildflower.component('cleanup-action-test', {
      state: {},
      testAction() {
        actionCallCount++
      }
    })

    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="cleanup-action-test"]')
    const componentId = component.dataset.componentId
    const button = component.querySelector('#test-button')

    // Verify action context was created
    const registry = wildflower._contextRegistry
    const initialActionContexts = registry.getContextsByType('action')
      .filter(ctx => ctx.componentInstance && ctx.componentInstance.id === componentId)

    expect(initialActionContexts.length).toBe(1)

    // Test action handler works
    button.click()
    expect(actionCallCount).toBe(1)

    // Destroy the component
    wildflower.destroyComponent(componentId)
    await waitForUpdate()

    // Verify component is destroyed
    expect(wildflower.componentInstances.has(componentId)).toBe(false)

    // Verify context was removed
    const remainingActionContexts = registry.getContextsByType('action')
      .filter(ctx => ctx.componentInstance && ctx.componentInstance.id === componentId)
    expect(remainingActionContexts.length).toBe(0)

    // Try to trigger action again - should not increment
    // (button may still be in DOM but handler should be detached)
    if (button.parentNode) {
      button.click()
      // Action should not have been called again
      expect(actionCallCount).toBe(1)
    }
  })
})
