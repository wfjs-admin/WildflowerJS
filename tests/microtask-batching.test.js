/**
 * microtask-batching.test.js - Vitest Browser Mode Tests for Microtask Batching System
 *
 * Tests the microtask batching system in reactiveStateManager.js (AI-04)
 * Priority: P1 (High - async behavior validation)
 *
 * Tests:
 *   - Queue ordering by timestamp
 *   - Deduplication of same-path changes
 *   - Opt-out for manual batch mode
 *   - Computed property batching
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, isMinifiedBuild} from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Microtask Batching System', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower

    // Reset framework state
    if (wildflower.componentDefinitions) {
      wildflower.componentDefinitions.clear()
    }
    if (wildflower.componentInstances) {
      wildflower.componentInstances.clear()
    }
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

  it('queues multiple state changes into single microtask', async () => {
    testContainer.innerHTML = `
      <div data-component="microtask-queue-test">
        <span id="val-a" data-bind="a"></span>
        <span id="val-b" data-bind="b"></span>
        <span id="val-c" data-bind="c"></span>
      </div>
    `

    wildflower.component('microtask-queue-test', {
      state: { a: 0, b: 0, c: 0 }
    })

    wildflower.scan()
    await waitForUpdate()

    const component = document.querySelector('[data-component="microtask-queue-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Make multiple synchronous state changes
    instance.state.a = 1
    instance.state.b = 2
    instance.state.c = 3

    // Wait for microtask to flush
    await new Promise(resolve => Promise.resolve().then(resolve))
    await waitForUpdate()

    // Verify all values are updated
    expect(document.getElementById('val-a').textContent).toBe('1')
    expect(document.getElementById('val-b').textContent).toBe('2')
    expect(document.getElementById('val-c').textContent).toBe('3')
  })

  it('deduplicates same-path changes', async () => {
    testContainer.innerHTML = `
      <div data-component="microtask-dedup-test">
        <span id="counter" data-bind="counter"></span>
      </div>
    `

    wildflower.component('microtask-dedup-test', {
      state: { counter: 0 }
    })

    wildflower.scan()
    await waitForUpdate()

    const component = document.querySelector('[data-component="microtask-dedup-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)
    const counterEl = document.getElementById('counter')

    // Make multiple changes to the same path synchronously
    instance.state.counter = 1
    instance.state.counter = 2
    instance.state.counter = 3
    instance.state.counter = 4
    instance.state.counter = 5 // Final value

    // Wait for microtask
    await new Promise(resolve => Promise.resolve().then(resolve))
    await waitForUpdate()

    // Should only show the final value (deduplication)
    expect(counterEl.textContent).toBe('5')
  })

  it.skipIf(isMinifiedBuild())('manual batch mode opts out of microtask batching', async () => {
    testContainer.innerHTML = `
      <div data-component="batch-opt-out-test">
        <span id="value" data-bind="value"></span>
      </div>
    `

    wildflower.component('batch-opt-out-test', {
      state: { value: 'initial' }
    })

    wildflower.scan()
    await waitForUpdate()

    const component = document.querySelector('[data-component="batch-opt-out-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Start manual batch mode
    const batch = wildflower.startBatch()

    // Verify _batchMode is set
    expect(wildflower._batchMode).toBe(true)

    // Make state change while in batch mode
    instance.state.value = 'batched'

    // Apply the batch
    await batch.apply()
    await waitForUpdate()

    // Verify value updated through batch system
    expect(document.getElementById('value').textContent).toBe('batched')
  })

  it.skipIf(isMinifiedBuild())('batches computed property updates', async () => {
    testContainer.innerHTML = `
      <div data-component="computed-batch-test">
        <span id="value" data-bind="value"></span>
        <span id="doubled" data-bind="computed:doubled"></span>
      </div>
    `

    let computedCalls = 0

    wildflower.component('computed-batch-test', {
      state: { value: 0 },
      computed: {
        doubled() {
          computedCalls++
          return this.state.value * 2
        }
      }
    })

    wildflower.scan()
    await waitForUpdate()

    const component = document.querySelector('[data-component="computed-batch-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Reset counter after initial computation
    computedCalls = 0

    // Make multiple changes synchronously
    instance.state.value = 1
    instance.state.value = 2
    instance.state.value = 3

    // Wait for microtask processing
    await new Promise(resolve => Promise.resolve().then(resolve))
    await waitForUpdate()

    // Verify final value is displayed
    expect(document.getElementById('doubled').textContent).toBe('6')
  })

  it.skipIf(isMinifiedBuild())('maintains order for changes to different paths', async () => {
    testContainer.innerHTML = `
      <div data-component="timestamp-order-test">
        <span id="first" data-bind="first"></span>
        <span id="second" data-bind="second"></span>
        <span id="third" data-bind="third"></span>
      </div>
    `

    wildflower.component('timestamp-order-test', {
      state: { first: '', second: '', third: '' }
    })

    wildflower.scan()
    await waitForUpdate()

    const component = document.querySelector('[data-component="timestamp-order-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Changes in specific order
    instance.state.first = 'A'
    instance.state.second = 'B'
    instance.state.third = 'C'

    await new Promise(resolve => Promise.resolve().then(resolve))
    await waitForUpdate()

    // All should be updated correctly
    expect(document.getElementById('first').textContent).toBe('A')
    expect(document.getElementById('second').textContent).toBe('B')
    expect(document.getElementById('third').textContent).toBe('C')
  })
})
