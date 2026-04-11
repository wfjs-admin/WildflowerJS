/**
 * WildflowerJS Bindings Test Suite - Vitest Browser Mode
 *
 * Tests for data-bind and data-model binding functionality.
 * Migrated from unitTestSuite.js BINDING CONTEXT section.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, getListItems, isMinifiedBuild} from './helpers/load-framework.js'

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

describe('Binding Context', () => {
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

  it.skipIf(isMinifiedBuild())('Basic binding context creation and resolution', async () => {
    testContainer.innerHTML = `
      <div data-component="binding-test">
        <span data-bind="message"></span>
        <div data-bind="count"></div>
      </div>
    `

    wildflower.component('binding-test', {
      state: {
        message: 'Hello World',
        count: 42
      }
    })

    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="binding-test"]')
    const componentId = component.dataset.componentId
    const messageElement = component.querySelector('[data-bind="message"]')
    const countElement = component.querySelector('[data-bind="count"]')

    // Verify binding contexts were created
    const registry = wildflower._contextRegistry
    const messageContext = registry.getContextForElement(messageElement)
    const countContext = registry.getContextForElement(countElement)

    expect(messageContext).toBeDefined()
    expect(messageContext.type).toBe('binding')
    expect(messageContext.path).toBe('message')
    expect(messageContext.componentInstance.id).toBe(componentId)

    expect(countContext).toBeDefined()
    expect(countContext.type).toBe('binding')
    expect(countContext.path).toBe('count')

    // Verify data resolution
    expect(messageContext.resolveData()).toBe('Hello World')
    expect(countContext.resolveData()).toBe(42)

    // Verify DOM elements are updated correctly
    expect(messageElement.textContent).toBe('Hello World')
    expect(countElement.textContent).toBe('42')
  })

  it.skipIf(isMinifiedBuild())('Nested binding contexts in list items', async () => {
    testContainer.innerHTML = `
      <div data-component="list-binding-test">
        <ul data-list="bindingItems">
          <template>
            <li>
              <span class="name" data-bind="name"></span>
              <span class="value" data-bind="value"></span>
            </li>
          </template>
        </ul>
      </div>
    `

    wildflower.component('list-binding-test', {
      state: {
        bindingItems: [
          { id: 1, name: 'Item One', value: 100 },
          { id: 2, name: 'Item Two', value: 200 }
        ]
      }
    })

    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="list-binding-test"]')
    const listItems = getListItems(component.querySelector('[data-list="bindingItems"]'))

    expect(listItems.length).toBe(2)

    // Verify first item bindings
    const firstItem = listItems[0]
    expect(firstItem.querySelector('.name').textContent).toBe('Item One')
    expect(firstItem.querySelector('.value').textContent).toBe('100')

    // Verify second item bindings
    const secondItem = listItems[1]
    expect(secondItem.querySelector('.name').textContent).toBe('Item Two')
    expect(secondItem.querySelector('.value').textContent).toBe('200')

    // Verify binding contexts exist with correct parent relationship
    const registry = wildflower._contextRegistry
    const nameBinding = registry.getContextForElement(firstItem.querySelector('.name'))
    expect(nameBinding).toBeDefined()
    expect(nameBinding.type).toBe('binding')
    expect(nameBinding.path).toBe('name')
    expect(nameBinding.parent).toBeDefined()
    expect(nameBinding.parent.type).toBe('list')

    // Verify data resolution through context chain
    expect(nameBinding.resolveData()).toBe('Item One')

    // Verify second item's context resolves different data
    const secondNameBinding = registry.getContextForElement(secondItem.querySelector('.name'))
    expect(secondNameBinding.resolveData()).toBe('Item Two')
  })

  it('Expression binding contexts', async () => {
    testContainer.innerHTML = `
      <div data-component="expression-test">
        <div id="multiply" data-bind="count * 2"></div>
        <div id="conditional" data-bind="count > 5 ? 'High' : 'Low'"></div>
        <div id="concat" data-bind="message + '!'"></div>
      </div>
    `

    wildflower.component('expression-test', {
      state: {
        count: 3,
        message: 'Hello'
      }
    })

    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="expression-test"]')
    const componentId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(componentId)

    // Verify initial binding results
    expect(component.querySelector('#multiply').textContent).toBe('6')
    expect(component.querySelector('#conditional').textContent).toBe('Low')
    expect(component.querySelector('#concat').textContent).toBe('Hello!')

    // Update state and verify expressions re-evaluate
    instance.state.count = 10
    await waitForCompleteRender()

    expect(component.querySelector('#multiply').textContent).toBe('20')
    expect(component.querySelector('#conditional').textContent).toBe('High')
  })

  it.skipIf(isMinifiedBuild())('Update propagation between binding contexts (two-way binding)', async () => {
    testContainer.innerHTML = `
      <div data-component="two-way-binding">
        <input type="text" data-model="username">
        <div id="display" data-bind="username"></div>
        <div id="welcome" data-bind="'Welcome, ' + username"></div>
      </div>
    `

    wildflower.component('two-way-binding', {
      state: {
        username: 'Guest'
      }
    })

    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="two-way-binding"]')
    const componentId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(componentId)

    const inputElement = component.querySelector('[data-model="username"]')
    const displayElement = component.querySelector('#display')
    const welcomeElement = component.querySelector('#welcome')

    // Verify binding context for model input
    const registry = wildflower._contextRegistry
    const modelContext = registry.getContextForElement(inputElement)
    expect(modelContext).toBeDefined()
    expect(modelContext.type).toBe('binding')
    expect(modelContext.path).toBe('username')

    // Verify binding context for display
    const displayContext = registry.getContextForElement(displayElement)
    expect(displayContext).toBeDefined()
    expect(displayContext.type).toBe('binding')

    // Verify initial state
    expect(inputElement.value).toBe('Guest')
    expect(displayElement.textContent).toBe('Guest')
    expect(welcomeElement.textContent).toBe('Welcome, Guest')

    // Update through input element
    inputElement.value = 'John'
    inputElement.dispatchEvent(new Event('input', { bubbles: true }))

    await waitForCompleteRender()

    // Verify binding contexts updated
    expect(instance.state.username).toBe('John')
    expect(displayElement.textContent).toBe('John')
    expect(welcomeElement.textContent).toBe('Welcome, John')
  })

  it('Binding contexts with computed properties', async () => {
    testContainer.innerHTML = `
      <div data-component="computed-binding-test">
        <div id="double" data-bind="computed:doubleCount"></div>
        <div id="message" data-bind="computed:displayMessage"></div>
      </div>
    `

    wildflower.component('computed-binding-test', {
      state: {
        count: 5,
        message: 'Hello'
      },
      computed: {
        doubleCount() {
          return this.state.count * 2
        },
        displayMessage() {
          return `${this.state.message} (count: ${this.state.count})`
        }
      }
    })

    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="computed-binding-test"]')
    const componentId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(componentId)

    const doubleElement = component.querySelector('#double')
    const messageElement = component.querySelector('#message')

    // Verify initial computed values
    expect(doubleElement.textContent).toBe('10')
    expect(messageElement.textContent).toBe('Hello (count: 5)')

    // Update state
    instance.state.count = 10
    instance.state.message = 'Updated'

    await waitForUpdate()

    // Verify computed bindings update
    expect(doubleElement.textContent).toBe('20')
    expect(messageElement.textContent).toBe('Updated (count: 10)')
  })

  it('Handles falsy values correctly in bindings', async () => {
    testContainer.innerHTML = `
      <div data-component="falsy-binding-test">
        <span id="zero" data-bind="zero"></span>
        <span id="empty" data-bind="emptyString"></span>
        <span id="false" data-bind="falseValue"></span>
        <span id="null" data-bind="nullValue"></span>
      </div>
    `

    wildflower.component('falsy-binding-test', {
      state: {
        zero: 0,
        emptyString: '',
        falseValue: false,
        nullValue: null
      }
    })

    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="falsy-binding-test"]')

    // Falsy values should render correctly
    expect(component.querySelector('#zero').textContent).toBe('0')
    expect(component.querySelector('#empty').textContent).toBe('')
    expect(component.querySelector('#false').textContent).toBe('false')
    // null may render as empty string or 'null' depending on implementation
    const nullContent = component.querySelector('#null').textContent
    expect(nullContent === '' || nullContent === 'null').toBe(true)
  })

  it('Updates bindings when state changes multiple times', async () => {
    testContainer.innerHTML = `
      <div data-component="multi-update-test">
        <span id="counter" data-bind="counter"></span>
      </div>
    `

    wildflower.component('multi-update-test', {
      state: {
        counter: 0
      }
    })

    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="multi-update-test"]')
    const componentId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(componentId)
    const counterElement = component.querySelector('#counter')

    expect(counterElement.textContent).toBe('0')

    // Update multiple times
    instance.state.counter = 1
    await waitForUpdate()
    expect(counterElement.textContent).toBe('1')

    instance.state.counter = 5
    await waitForUpdate()
    expect(counterElement.textContent).toBe('5')

    instance.state.counter = 100
    await waitForUpdate()
    expect(counterElement.textContent).toBe('100')
  })

  it('Nested object property bindings', async () => {
    testContainer.innerHTML = `
      <div data-component="nested-binding-test">
        <span id="name" data-bind="user.name"></span>
        <span id="email" data-bind="user.email"></span>
        <span id="city" data-bind="user.address.city"></span>
      </div>
    `

    wildflower.component('nested-binding-test', {
      state: {
        user: {
          name: 'John Doe',
          email: 'john@example.com',
          address: {
            city: 'New York'
          }
        }
      }
    })

    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="nested-binding-test"]')
    const componentId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(componentId)

    // Verify initial nested bindings
    expect(component.querySelector('#name').textContent).toBe('John Doe')
    expect(component.querySelector('#email').textContent).toBe('john@example.com')
    expect(component.querySelector('#city').textContent).toBe('New York')

    // Update nested property
    instance.state.user = {
      ...instance.state.user,
      name: 'Jane Doe',
      address: {
        ...instance.state.user.address,
        city: 'Los Angeles'
      }
    }

    await waitForUpdate()

    expect(component.querySelector('#name').textContent).toBe('Jane Doe')
    expect(component.querySelector('#city').textContent).toBe('Los Angeles')
  })

  it.skipIf(isMinifiedBuild())('Proper DOM detachment and reattachment', async () => {
    testContainer.innerHTML = `
      <div data-component="detach-test">
        <div id="container">
          <div id="target" data-bind="message"></div>
        </div>
      </div>
    `

    wildflower.component('detach-test', {
      state: {
        message: 'Original Message'
      }
    })

    wildflower.scan()
    await waitForUpdate(10)

    const component = testContainer.querySelector('[data-component="detach-test"]')
    const componentId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(componentId)

    const container = component.querySelector('#container')
    const targetElement = component.querySelector('#target')

    // Get binding context
    const bindingContext = wildflower._contextRegistry.getContextForElement(targetElement)
    expect(bindingContext).toBeDefined()

    // Detach element (but keep the same element reference)
    container.removeChild(targetElement)

    // Update state while element is detached
    instance.state.message = 'Updated While Detached'

    await waitForCompleteRender()
    await waitForUpdate(50)

    // Verify context was updated despite element being detached
    expect(bindingContext.resolveData()).toBe('Updated While Detached')

    // Reattach the same element
    container.appendChild(targetElement)

    // Force a render cycle
    if (!wildflower._componentsToUpdate) {
      wildflower._componentsToUpdate = new Set()
    }
    wildflower._componentsToUpdate.add(componentId)
    wildflower._scheduleRender()

    // Allow render to complete
    await waitForUpdate(20)

    // Verify element content was updated
    expect(targetElement.textContent).toBe('Updated While Detached')
  })
})
