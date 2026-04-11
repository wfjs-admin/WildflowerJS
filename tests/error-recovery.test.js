/**
 * WildflowerJS Error Recovery Test Suite - Vitest Browser Mode
 *
 * Tests for graceful error handling and recovery scenarios.
 * Migrated from unitTestSuite.js Error Recovery section.
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

describe('Error Recovery', () => {
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

  it('handles undefined component definition gracefully', async () => {
    // Try to use a component that was never registered
    testContainer.innerHTML = `
      <div id="undefined-comp" data-component="never-registered-component">
        <span data-bind="value">Original</span>
      </div>
    `

    // Should not throw - framework should handle gracefully
    let errorThrown = false
    try {
      wildflower.scan()
      await waitForUpdate()
    } catch (e) {
      errorThrown = true
    }

    expect(errorThrown).toBe(false)

    // Element should still exist, just not initialized as component
    const element = testContainer.querySelector('#undefined-comp')
    expect(element).toBeDefined()
    expect(element.dataset.componentId).toBeUndefined()
  })

  it('handles missing binding path gracefully', async () => {
    wildflower.component('missing-path-test', {
      state: {
        someValue: 'exists'
      }
    })

    testContainer.innerHTML = `
      <div data-component="missing-path-test">
        <span id="missing-span" data-bind="nonexistent.deeply.nested.path"></span>
      </div>
    `

    let errorThrown = false
    try {
      wildflower.scan()
      await waitForUpdate()
    } catch (e) {
      errorThrown = true
    }

    expect(errorThrown).toBe(false)

    const span = testContainer.querySelector('#missing-span')
    expect(span).toBeDefined()
  })

  it('handles null/undefined state values in bindings', async () => {
    wildflower.component('null-state-test', {
      state: {
        nullValue: null,
        undefValue: undefined
      }
    })

    testContainer.innerHTML = `
      <div data-component="null-state-test">
        <span id="null-span" data-bind="nullValue"></span>
        <span id="undef-span" data-bind="undefValue"></span>
      </div>
    `

    let errorThrown = false
    try {
      wildflower.scan()
      await waitForUpdate()
    } catch (e) {
      errorThrown = true
    }

    expect(errorThrown).toBe(false)
  })

  it('handles action method that throws error', async () => {
    wildflower.component('throwing-action-test', {
      state: {
        status: 'OK'
      },
      throwingMethod() {
        throw new Error('Intentional test error')
      }
    })

    testContainer.innerHTML = `
      <div data-component="throwing-action-test">
        <button id="throw-btn" data-action="throwingMethod">Click Me</button>
        <span id="status" data-bind="status">OK</span>
      </div>
    `

    wildflower.scan()
    await waitForUpdate()

    const button = testContainer.querySelector('#throw-btn')

    // Click should not crash the entire app
    let appCrashed = false
    try {
      button.click()
      await waitForUpdate()
    } catch (e) {
      appCrashed = true
    }

    // App should continue running even if action throws
    expect(appCrashed).toBe(false)
  })

  it('handles empty list gracefully', async () => {
    wildflower.component('empty-list-test', {
      state: {
        emptyListItems: []  // Empty array
      }
    })

    testContainer.innerHTML = `
      <div data-component="empty-list-test">
        <ul data-list="emptyListItems">
          <template><li data-bind="name"></li></template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="empty-list-test"]')
    const listItems = component.querySelectorAll('[data-list="emptyListItems"] li')

    expect(listItems.length).toBe(0)

    // Should be able to add items later
    const instance = wildflower.componentInstances.get(component.dataset.componentId)
    instance.state.emptyListItems.push({ name: 'New Item' })

    await waitForCompleteRender()

    const updatedItems = component.querySelectorAll('[data-list="emptyListItems"] li')
    expect(updatedItems.length).toBe(1)
  })

  it('handles list with null/undefined items', async () => {
    wildflower.component('null-items-test', {
      state: {
        nullItemsList: [
          { name: 'Valid 1' },
          null,
          { name: 'Valid 2' },
          undefined,
          { name: 'Valid 3' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="null-items-test">
        <ul data-list="nullItemsList">
          <template><li data-bind="name"></li></template>
        </ul>
      </div>
    `

    let errorThrown = false
    try {
      wildflower.scan()
      await waitForUpdate(100)
    } catch (e) {
      errorThrown = true
    }

    expect(errorThrown).toBe(false)
  })

  it('handles invalid data-type attribute gracefully', async () => {
    wildflower.component('invalid-type-test', {
      state: {
        value: 'not-a-number-string'
      }
    })

    testContainer.innerHTML = `
      <div data-component="invalid-type-test">
        <span id="num-span" data-bind="value" data-type="number">not-a-number</span>
      </div>
    `

    let errorThrown = false
    try {
      wildflower.scan()
      await waitForUpdate()
    } catch (e) {
      errorThrown = true
    }

    expect(errorThrown).toBe(false)
  })

  it('handles missing action method gracefully', async () => {
    wildflower.component('missing-action-test', {
      state: { value: 'test' }
      // Note: nonExistentMethod is not defined
    })

    testContainer.innerHTML = `
      <div data-component="missing-action-test">
        <button id="missing-btn" data-action="nonExistentMethod">Click</button>
      </div>
    `

    wildflower.scan()
    await waitForUpdate()

    const button = testContainer.querySelector('#missing-btn')

    let errorThrown = false
    try {
      button.click()
      await waitForUpdate()
    } catch (e) {
      errorThrown = true
    }

    expect(errorThrown).toBe(false)
  })

  it('handles deeply nested undefined path access', async () => {
    wildflower.component('deep-undefined-test', {
      state: {
        a: { b: null }  // c, d, e, f, g don't exist
      }
    })

    testContainer.innerHTML = `
      <div data-component="deep-undefined-test">
        <span id="deep-span" data-bind="a.b.c.d.e.f.g"></span>
      </div>
    `

    let errorThrown = false
    try {
      wildflower.scan()
      await waitForUpdate()
    } catch (e) {
      errorThrown = true
    }

    expect(errorThrown).toBe(false)
  })

  it('handles component destroy during render', async () => {
    wildflower.component('destroy-render-test', {
      state: {
        destroyRenderItems: [{ name: 'A' }, { name: 'B' }, { name: 'C' }]
      }
    })

    testContainer.innerHTML = `
      <div data-component="destroy-render-test">
        <ul data-list="destroyRenderItems">
          <template><li data-bind="name"></li></template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="destroy-render-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)
    const componentId = component.dataset.componentId

    // Trigger a render and immediately destroy
    instance.state.destroyRenderItems.push({ name: 'D' })

    let errorThrown = false
    try {
      wildflower.destroyComponent(componentId)
      await waitForUpdate()
    } catch (e) {
      errorThrown = true
    }

    expect(errorThrown).toBe(false)
  })
})
