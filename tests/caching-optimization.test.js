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

  // Removed "Context resolveData uses cache effectively" — it asserted the
  // prototype resolveData 50ms cache on binding + list contexts. List-item
  // binding contexts are no longer created (per-item effects paint), and list
  // contexts use the FrameworkInit resolveData which bypasses that cache, so
  // there is no binding/list cache behavior left to assert. (The cache is now a
  // conditional-context concern, exercised by data-show/data-render tests.)

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
    const bindingElement = testContainer.querySelector('#cache-inv-message')

    // Verify initial state
    expect(bindingElement.textContent).toBe('Initial')

    // Update the state
    instance.state.message = 'Updated'

    // Wait for update to process
    await waitForCompleteRender()

    // Verify DOM reflects the update — a stale cached value would still show 'Initial'
    expect(bindingElement.textContent).toBe('Updated')
  })
})
