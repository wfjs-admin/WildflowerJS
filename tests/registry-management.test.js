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

  it('Context registration and lookup', async () => {
    testContainer.innerHTML = `
      <div data-component="reg-lookup-test">
        <span id="reg-binding" data-bind="message"></span>
      </div>
    `

    wildflower.component('reg-lookup-test', {
      state: {
        message: 'Hello'
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const registry = wildflower._contextRegistry

    // Verify contexts were registered
    expect(registry.contexts.size).toBeGreaterThan(0)

    // Get binding contexts
    const bindingContexts = registry.getContextsByType('binding')
    expect(bindingContexts.length).toBeGreaterThan(0)

    // Verify context can be retrieved by type
    const bindingCtx = bindingContexts.find(ctx =>
      ctx.element === testContainer.querySelector('#reg-binding')
    )
    expect(bindingCtx).toBeDefined()
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

    const registry = wildflower._contextRegistry
    const component = testContainer.querySelector('[data-component="comp-ctx-test"]')
    const componentId = component.dataset.componentId

    // Verify component context exists (getContextsForComponent removed — Sprint 3)
    const componentContexts = registry.getContextsByType('component')
    expect(componentContexts.length).toBeGreaterThan(0)
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

    const registry = wildflower._contextRegistry
    const listElement = testContainer.querySelector('#list-ctx-element')

    // Get context for list element
    const listCtx = registry.getContextForElement(listElement)
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

    // Verify list contexts exist
    const listContexts = registry.getContextsByType('list')
    expect(listContexts.length).toBeGreaterThan(0)
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

    const registry = wildflower._contextRegistry
    const component = testContainer.querySelector('[data-component="gc-reg-test"]')
    const componentId = component.dataset.componentId

    const initialCount = registry.contexts.size

    // Destroy the component
    wildflower.destroyComponent(componentId)

    // Run garbage collection
    const stats = registry.garbageCollect()

    // Verify garbage collection ran
    expect(stats).toBeDefined()
    expect(registry.contexts.size).toBeLessThan(initialCount)
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

    const registry = wildflower._contextRegistry
    const component = testContainer.querySelector('[data-component="disposal-test"]')
    const componentId = component.dataset.componentId
    const bindingElement = testContainer.querySelector('#disposal-binding')

    // Get initial context
    const initialContext = registry.getContextForElement(bindingElement)
    expect(initialContext).toBeDefined()

    // Destroy component
    wildflower.destroyComponent(componentId)

    // Context should be cleaned up
    const afterContext = registry.getContextForElement(bindingElement)
    // After disposal, context lookup should return null or undefined
    expect(afterContext === null || afterContext === undefined || !registry.contexts.has(afterContext?.id)).toBe(true)
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

    const registry = wildflower._contextRegistry
    const initialCount = registry.contexts.size

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
    const stats = registry.garbageCollect()

    // Verify contexts were cleaned up
    expect(registry.contexts.size).toBeLessThan(initialCount)

    // Verify no contexts remain for destroyed components
    const remainingContexts = Array.from(registry.contexts.values())
    const orphanedContexts = remainingContexts.filter(ctx =>
      ctx.componentInstance && (
        ctx.componentInstance.id === id1 ||
        ctx.componentInstance.id === id2 ||
        ctx.componentInstance.id === id3
      )
    )

    expect(orphanedContexts.length).toBe(0)
  })
})
