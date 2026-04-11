/**
 * WildflowerJS SSR Activation Timing Test Suite - Vitest Browser Mode
 *
 * Tests for SSR phase transitions, element protection, and action rebinding.
 * Migrated from unitTestSuite.js SSR Activation Timing section.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, hasFeature } from './helpers/load-framework.js'

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

// Skip entire suite if SSR not available (core/lite/spa builds don't include SSRManager)
const describeIfSSR = hasFeature('ssr') ? describe : describe.skip

describeIfSSR('SSR Activation Timing', () => {
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

  it('SSR prepareElement sets protection phase correctly', async () => {
    testContainer.innerHTML = `
      <div id="ssr-test-protect" data-component="ssr-protect-test" data-ssr="true">
        <span data-bind="name">Server Name</span>
        <ul data-list="ssrProtectItems">
          <template><li data-bind="title"></li></template>
          <li>Server Item 1</li>
          <li>Server Item 2</li>
        </ul>
      </div>
    `

    // Registering the component auto-prepares and initializes the SSR element
    wildflower.component('ssr-protect-test', {
      state: {
        name: 'Default',
        ssrProtectItems: []
      }
    })

    const element = testContainer.querySelector('#ssr-test-protect')

    // After component registration, SSR element is automatically prepared
    // Late-registered SSR components go through prepareElement automatically
    // Phase transitions to activated via setTimeout, so check protected or activated
    expect(element._ssrPhase).toBeDefined()
    expect(['protected', 'activated']).toContain(wildflower.ssrManager.getPhase(element))

    // Check list is also prepared
    const list = element.querySelector('[data-list="ssrProtectItems"]')
    expect(list._ssrPhase).toBeDefined()

    // After activation completes
    await waitForUpdate(50)
    expect(wildflower.ssrManager.getPhase(element)).toBe('activated')
  })

  it('SSR activation enables dynamic updates', async () => {
    testContainer.innerHTML = `
      <div id="ssr-test-activate" data-component="ssr-activate-test">
        <span data-bind="counter" data-type="number">0</span>
      </div>
    `

    wildflower.component('ssr-activate-test', {
      state: {
        counter: 0
      }
    })

    wildflower.scan()
    await waitForUpdate(50)

    const element = testContainer.querySelector('#ssr-test-activate')
    const instance = wildflower.componentInstances.get(element.dataset.componentId)
    const counterSpan = element.querySelector('[data-bind="counter"]')

    // Verify initial render works
    expect(counterSpan.textContent).toBe('0')

    // Simulate SSR phase being set (as if this was an SSR component)
    element._ssrPhase = 'protected' // Set to PROTECTED phase

    // Now simulate activation by transitioning to ACTIVATED phase
    element._ssrPhase = 'activated'

    // After activation, state updates should work
    instance.state.counter = 5
    await waitForCompleteRender()
    await waitForUpdate(50)

    expect(instance.state.counter).toBe(5)
    expect(counterSpan.textContent).toBe('5')
  })

  it('SSR list items receive index metadata and phase transitions correctly', async () => {
    testContainer.innerHTML = `
      <div id="ssr-test-index" data-component="ssr-index-test" data-ssr="true">
        <ul data-list="ssrIndexUsers">
          <template><li><span data-bind="name"></span><button data-action="removeUser">Remove</button></li></template>
          <li><span data-bind="name">Alice</span><button data-action="removeUser">Remove</button></li>
          <li><span data-bind="name">Bob</span><button data-action="removeUser">Remove</button></li>
          <li><span data-bind="name">Charlie</span><button data-action="removeUser">Remove</button></li>
        </ul>
      </div>
    `

    // Register component — this triggers automatic SSR preparation and initialization
    // for the data-ssr="true" element already in the DOM
    wildflower.component('ssr-index-test', {
      state: {
        ssrIndexUsers: [
          { name: 'Alice' },
          { name: 'Bob' },
          { name: 'Charlie' }
        ]
      },
      removeUser(index) {
        this.state.ssrIndexUsers.splice(index, 1)
      }
    })

    const element = testContainer.querySelector('#ssr-test-index')
    const list = element.querySelector('[data-list="ssrIndexUsers"]')

    // After component registration, SSR element is automatically prepared and activated
    // (late-registered SSR components go through the full SSR lifecycle automatically)
    await waitForUpdate(50)

    // Element should be activated, list should be complete
    expect(wildflower.ssrManager.getPhase(element)).toBe('activated')
    expect(wildflower.ssrManager.getPhase(list)).toBe('complete')

    // List items should have _listIndex property after full activation
    const listItems = Array.from(list.children).filter(child =>
      child.tagName !== 'TEMPLATE'
    )

    expect(listItems.length).toBe(3)
    expect(listItems[0]._listIndex).toBe(0)
    expect(listItems[1]._listIndex).toBe(1)
    expect(listItems[2]._listIndex).toBe(2)
  })

  it('SSR action contexts bound with correct index after activation', async () => {
    testContainer.innerHTML = `
      <div id="ssr-test-action" data-component="ssr-action-test" data-ssr="true">
        <ul data-list="ssrActionTasks">
          <template><li><span data-bind="text"></span><button data-action="complete">Done</button></li></template>
          <li><span data-bind="text">Task A</span><button data-action="complete">Done</button></li>
          <li><span data-bind="text">Task B</span><button data-action="complete">Done</button></li>
        </ul>
      </div>
    `

    let completedIndices = []

    // Register component — automatic SSR lifecycle for late-registered components
    wildflower.component('ssr-action-test', {
      state: {
        ssrActionTasks: [
          { text: 'Task A', done: false },
          { text: 'Task B', done: false }
        ]
      },
      complete(event, element, details) {
        completedIndices.push(details.index)
        if (typeof details.index !== 'undefined') {
          this.state.ssrActionTasks[details.index].done = true
        }
      }
    })

    const element = testContainer.querySelector('#ssr-test-action')

    // Wait for automatic SSR preparation, activation, and full list rendering
    await waitForUpdate(300)

    // After SSR hydration + normal list rendering, verify list items exist
    // Note: data-action is stripped after binding, so query by button element instead
    let listItems = element.querySelectorAll('li')
    expect(listItems.length).toBe(2)

    // Click second item's button (should pass index 1)
    listItems[1].querySelector('button').click()
    await waitForUpdate(100)

    expect(completedIndices.length).toBe(1)
    expect(completedIndices[0]).toBe(1)

    // Re-query after state change (list re-renders with new DOM elements)
    listItems = element.querySelectorAll('li')
    expect(listItems.length).toBe(2)

    // Click first item's button (should pass index 0)
    listItems[0].querySelector('button').click()
    await waitForUpdate(100)

    expect(completedIndices.length).toBe(2)
    expect(completedIndices[1]).toBe(0)
  })
})
