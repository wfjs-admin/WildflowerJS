/**
 * WildflowerJS Initial Render Batching Test Suite
 *
 * Tests that _scheduleInitialRender batches rapid component registrations
 * into a minimal number of render passes instead of creating redundant timers.
 * Covers issue 2.7 from V1 RC1 Final Code Review.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, isMinifiedBuild } from './helpers/load-framework.js'

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

describe('Initial Render Batching', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower

    if (wildflower.componentDefinitions) {
      wildflower.componentDefinitions.clear()
    }
    if (wildflower.componentInstances) {
      wildflower.componentInstances.clear()
    }
    if (wildflower.storeManager && wildflower.storeManager._namedStores) {
      wildflower.storeManager._namedStores.clear()
    }
    if (wildflower._templateCache) {
      if (wildflower._templateCache.general) wildflower._templateCache.general.clear()
      if (wildflower._templateCache.lists) wildflower._templateCache.lists.clear()
      if (wildflower._templateCache.compiled) wildflower._templateCache.compiled.clear()
      if (wildflower._templateCache.extracted) wildflower._templateCache.extracted.clear()
      if (wildflower._templateCache.fragmentPools) wildflower._templateCache.fragmentPools.clear()
      if (wildflower._templateCache.stats) wildflower._templateCache.stats.clear()
    }

    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  it.skipIf(isMinifiedBuild())('does not create redundant timers when _scheduleInitialRender called while render is scheduled', async () => {
    // The bug: when _initialRenderScheduled is true, each call to
    // _scheduleInitialRender creates a new setTimeout(10). With N calls,
    // N redundant timers fire _performInitialRender.

    // Count how many setTimeout calls target _performInitialRender
    let timerCount = 0
    const originalSetTimeout = window.setTimeout
    window.setTimeout = function(fn, delay, ...args) {
      // Count timers set by _scheduleInitialRender (the 10ms ones from the else-if branch)
      if (delay === 10 || delay === 0) {
        const fnStr = fn.toString()
        if (fnStr.includes('_performInitialRender') || fnStr.includes('initialRender')) {
          timerCount++
        }
      }
      return originalSetTimeout.call(window, fn, delay, ...args)
    }

    try {
      // Simulate the scenario: first call sets _initialRenderScheduled = true,
      // subsequent calls should batch, not create individual timers
      wildflower._scheduleInitialRender('fake-1')  // Sets _initialRenderScheduled = true
      // Now _initialRenderScheduled is true, these should NOT each create a timer
      wildflower._scheduleInitialRender('fake-2')
      wildflower._scheduleInitialRender('fake-3')
      wildflower._scheduleInitialRender('fake-4')
      wildflower._scheduleInitialRender('fake-5')
      wildflower._scheduleInitialRender('fake-6')

      // With the fix: 1 timer (from the first call)
      // With the bug: 1 timer (first call) + 5 timers (else-if branch) = 6
      expect(timerCount).toBeLessThanOrEqual(2)
    } finally {
      window.setTimeout = originalSetTimeout
      // Clean up the queued fake IDs
      if (wildflower._initialRenderQueue) {
        wildflower._initialRenderQueue.clear()
      }
      wildflower._initialRenderScheduled = false
      await waitForCompleteRender()
    }
  })
})
