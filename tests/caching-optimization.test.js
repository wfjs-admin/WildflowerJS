/**
 * WildflowerJS Caching and Resolution Optimization Test Suite - Vitest Browser Mode
 *
 * Tests for context data resolution caching and cache invalidation.
 * Migrated from unitTestSuite.js Caching and Resolution Optimization section.
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

describe.skipIf(isMinifiedBuild())('Caching and Resolution Optimization', () => {
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

  it('Context resolveData uses cache effectively', async () => {
    testContainer.innerHTML = `
      <div data-component="cache-test">
        <span id="cache-message" data-bind="message"></span>
        <div data-list="cacheItems">
          <template>
            <span class="cache-item" data-bind="name"></span>
          </template>
        </div>
      </div>
    `

    wildflower.component('cache-test', {
      state: {
        message: 'Hello',
        cacheItems: [
          { name: 'Item 1' },
          { name: 'Item 2' }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="cache-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Get contexts to test
    const bindingContexts = wildflower._contextRegistry.getContextsByType('binding')
      .filter(ctx => ctx.componentInstance && ctx.componentInstance.id === instance.id)

    const listContexts = wildflower._contextRegistry.getContextsByType('list')
      .filter(ctx => ctx.componentInstance && ctx.componentInstance.id === instance.id)

    expect(bindingContexts.length).toBeGreaterThan(0)
    expect(listContexts.length).toBeGreaterThan(0)

    const bindingContext = bindingContexts[0]
    const listContext = listContexts[0]

    // Clear caches to start fresh
    if (bindingContext._cache) bindingContext._cache.clear()
    if (listContext._cache) listContext._cache.clear()

    // Track resolution calls - only if internal methods exist
    let bindingResolutionCount = 0
    let listResolutionCount = 0

    // Override _resolveBindingData to track calls (if it exists)
    if (bindingContext._resolveBindingData) {
      const originalBindingResolve = bindingContext._resolveBindingData.bind(bindingContext)
      bindingContext._resolveBindingData = function() {
        bindingResolutionCount++
        return originalBindingResolve.apply(this, arguments)
      }
    }

    // Override _resolveListData to track calls (if it exists)
    if (listContext._resolveListData) {
      const originalListResolve = listContext._resolveListData.bind(listContext)
      listContext._resolveListData = function() {
        listResolutionCount++
        return originalListResolve.apply(this, arguments)
      }
    }

    // Call resolveData multiple times in quick succession
    const bindingResult1 = bindingContext.resolveData()
    const bindingResult2 = bindingContext.resolveData()
    const bindingResult3 = bindingContext.resolveData()

    const listResult1 = listContext.resolveData()
    const listResult2 = listContext.resolveData()
    const listResult3 = listContext.resolveData()

    // Verify cache was used - should only resolve once if caching works
    if (bindingContext._resolveBindingData) {
      expect(bindingResolutionCount).toBe(1)
    }

    if (listContext._resolveListData) {
      // List contexts with dependents may short-circuit via dependent-array-copy
      // before reaching _resolveListData, so 0 is also valid
      expect(listResolutionCount).toBeLessThanOrEqual(1)
    }

    // Verify results are consistent across multiple calls
    expect(bindingResult1).toEqual(bindingResult2)
    expect(bindingResult2).toEqual(bindingResult3)

    expect(listResult1).toEqual(listResult2)
    expect(listResult2).toEqual(listResult3)

    // Verify the data is correct
    expect(listResult1.length).toBe(2)
    expect(listResult1[0].name).toBe('Item 1')
  })

  it('Cache invalidation works correctly on state changes', async () => {
    testContainer.innerHTML = `
      <div data-component="cache-invalidation-test">
        <span id="cache-inv-message" data-bind="message"></span>
      </div>
    `

    wildflower.component('cache-invalidation-test', {
      state: {
        message: 'Initial'
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="cache-invalidation-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Get binding context
    const bindingElement = testContainer.querySelector('#cache-inv-message')
    const bindingContext = wildflower._contextRegistry.getContextForElement(bindingElement)

    expect(bindingContext).toBeDefined()

    // Verify initial state
    expect(bindingElement.textContent).toBe('Initial')

    // Get initial resolved data
    const initialData = bindingContext.resolveData()
    expect(initialData).toBe('Initial')

    // Update the state
    instance.state.message = 'Updated'

    // Wait for update to process
    await waitForCompleteRender()

    // Verify DOM reflects the update (observable behavior)
    expect(bindingElement.textContent).toBe('Updated')

    // Get the resolved data after update
    const resolvedData = bindingContext.resolveData()

    // Verify data reflects the update (cache was invalidated)
    expect(resolvedData).toBe('Updated')
  })
})
