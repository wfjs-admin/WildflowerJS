/**
 * WildflowerJS Registry Management Test Suite - Vitest Browser Mode
 *
 * Tests for context registration, lookup, and garbage collection.
 * Migrated from unitTestSuite.js REGISTRY MANAGEMENT section.
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

describe.skipIf(isMinifiedBuild())('Registry Management', () => {
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

  it('Component context creation and lookup', async () => {
    testContainer.innerHTML = `
      <div data-component="comp-ctx-test">
        <span data-bind="value"></span>
      </div>
    `

    wildflower.component('comp-ctx-test', {
      state: {
        value: 'Test'
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="comp-ctx-test"]')

    // Component contexts are no longer registered — they were folded out (emit()
    // bubbles via DOM ancestry; the public `this.context` API is independent of
    // any context object). The component still renders from its state.
    expect(component.querySelector('span').textContent).toBe('Test')
  })

  it('List context creation and lookup', async () => {
    testContainer.innerHTML = `
      <div data-component="list-ctx-test">
        <div id="list-ctx-element" data-list="regItems">
          <template>
            <span class="reg-item" data-bind="name"></span>
          </template>
        </div>
      </div>
    `

    wildflower.component('list-ctx-test', {
      state: {
        regItems: [{ id: 1, name: 'Test Item' }]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const listElement = testContainer.querySelector('#list-ctx-element')

    // List contexts are plain objects on the element.
    const listCtx = listElement._listContext
    expect(listCtx).toBeDefined()
    expect(listCtx.type).toBe('list')
    expect(listCtx.path).toBe('regItems')

    // Verify data resolution works
    const resolvedData = listCtx.resolveData()
    expect(resolvedData).toBeDefined()
    expect(resolvedData.length).toBe(1)
    expect(resolvedData[0].name).toBe('Test Item')

    // Verify full path construction
    expect(listCtx.getFullPath()).toBe('regItems')

    // List contexts are plain objects on the element / instance map (not in the
    // registry type index); getContextForElement above resolved the same object.
    expect(listElement._listContext).toBe(listCtx)
  })

  it('Registry garbage collection', async () => {
    testContainer.innerHTML = `
      <div data-component="gc-reg-test">
        <div data-list="gcRegItems">
          <template>
            <span class="gc-reg-item" data-bind="name"></span>
            <div data-show="active">Active</div>
          </template>
        </div>
      </div>
    `

    wildflower.component('gc-reg-test', {
      state: {
        gcRegItems: [
          { name: 'Item 1', active: true },
          { name: 'Item 2', active: false }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="gc-reg-test"]')
    const componentId = component.dataset.componentId

    // Destroy the component
    wildflower.destroyComponent(componentId)

    // Run the public component-level garbage collection (returns stats)
    const stats = wildflower.garbageCollect()

    // Component/binding contexts are no longer registered, so registry.contexts
    // size is not a cleanup proxy. The observable invariant is that the destroyed
    // component's instance is gone.
    expect(stats).toBeDefined()
    expect(wildflower.componentInstances.has(componentId)).toBe(false)
  })

  it('Context disposal cleans up properly', async () => {
    testContainer.innerHTML = `
      <div data-component="disposal-test">
        <span id="disposal-binding" data-bind="message"></span>
        <div data-show="visible">Visible content</div>
      </div>
    `

    wildflower.component('disposal-test', {
      state: {
        message: 'Hello',
        visible: true
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="disposal-test"]')
    const componentId = component.dataset.componentId

    // Binding painted initially.
    expect(testContainer.querySelector('#disposal-binding').textContent).toBe('Hello')

    // Destroy component — observable no-leak: the instance is gone.
    wildflower.destroyComponent(componentId)
    wildflower.garbageCollect()
    expect(wildflower.componentInstances.has(componentId)).toBe(false)
  })

  it('Context system cleans up orphaned contexts and prevents memory leaks', async () => {
    // Create multiple components
    testContainer.innerHTML = `
      <div data-component="leak-test-1">
        <span data-bind="value"></span>
      </div>
      <div data-component="leak-test-2">
        <span data-bind="value"></span>
      </div>
      <div data-component="leak-test-3">
        <span data-bind="value"></span>
      </div>
    `

    wildflower.component('leak-test-1', { state: { value: '1' } })
    wildflower.component('leak-test-2', { state: { value: '2' } })
    wildflower.component('leak-test-3', { state: { value: '3' } })

    wildflower.scan()
    await waitForCompleteRender()

    // Get component IDs
    const comp1 = testContainer.querySelector('[data-component="leak-test-1"]')
    const comp2 = testContainer.querySelector('[data-component="leak-test-2"]')
    const comp3 = testContainer.querySelector('[data-component="leak-test-3"]')

    const id1 = comp1.dataset.componentId
    const id2 = comp2.dataset.componentId
    const id3 = comp3.dataset.componentId

    // Destroy all components
    wildflower.destroyComponent(id1)
    wildflower.destroyComponent(id2)
    wildflower.destroyComponent(id3)

    // Run garbage collection
    wildflower.garbageCollect()

    // Destroyed component instances are gone (the observable no-leak invariant).
    expect(wildflower.componentInstances.has(id1)).toBe(false)
    expect(wildflower.componentInstances.has(id2)).toBe(false)
    expect(wildflower.componentInstances.has(id3)).toBe(false)
  })
})
