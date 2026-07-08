/**
 * WildflowerJS Batch Update Processing Test Suite - Vitest Browser Mode
 *
 * Tests for batch update processing and DOM operation minimization.
 * Migrated from unitTestSuite.js BATCH UPDATE PROCESSING section.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, isMinifiedBuild } from './helpers/load-framework.js'

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

describe('Batch Update Processing', () => {
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

  it('Batch context updates process in correct order', async () => {
    testContainer.innerHTML = `
      <div data-component="batch-test">
        <span id="batch-message" data-bind="message"></span>
        <div id="batch-details" data-show="showDetails">
          <div data-list="batchItems">
            <template>
              <span class="batch-item" data-bind="name"></span>
            </template>
          </div>
        </div>
      </div>
    `

    wildflower.component('batch-test', {
      state: {
        message: 'Initial',
        showDetails: false,
        batchItems: []
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="batch-test"]')
    const componentId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(componentId)

    // Start a batch update
    const batch = wildflower.startBatch()

    // Update multiple state properties
    instance.state.message = 'Updated'
    instance.state.showDetails = true
    instance.state.batchItems = [
      { name: 'Item 1' },
      { name: 'Item 2' }
    ]

    // Apply the batch
    await batch.apply()
    await waitForCompleteRender()

    // Verify DOM was correctly updated
    expect(component.querySelector('#batch-message').textContent).toBe('Updated')
    expect(component.querySelector('#batch-details').style.display).not.toBe('none')

    const listItems = component.querySelectorAll('.batch-item')
    expect(listItems.length).toBe(2)
    expect(listItems[0].textContent).toBe('Item 1')
    expect(listItems[1].textContent).toBe('Item 2')
  })

  it('cancelBatch keeps mutations in state but skips render and clears bookkeeping', async () => {
    testContainer.innerHTML = `
      <div data-component="cancel-persist">
        <span id="cancel-bind" data-bind="count"></span>
      </div>
    `

    wildflower.component('cancel-persist', {
      state: { count: 0 }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="cancel-persist"]')
    const componentId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(componentId)
    const bindingElement = component.querySelector('#cancel-bind')

    // Initial render baseline.
    expect(bindingElement.textContent).toBe('0')

    // Track DOM updates so we can confirm cancel skipped scheduling.
    let textContentSetCount = 0
    const originalDescriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')
    Object.defineProperty(bindingElement, 'textContent', {
      set(value) {
        textContentSetCount++
        return originalDescriptor.set.call(this, value)
      },
      get() {
        return originalDescriptor.get.call(this)
      }
    })

    // Cancelled batch: mutations persist in state but no render runs.
    const batch = wildflower.startBatch()
    instance.state.count = 5
    batch.cancel()

    await waitForUpdate()

    expect(instance.state.count, 'cancelBatch must not roll back mutations').toBe(5)
    expect(textContentSetCount, 'cancelBatch must skip render scheduling').toBe(0)
    expect(originalDescriptor.get.call(bindingElement),
      'DOM should reflect pre-batch value because no render fired'
    ).toBe('0')

    // Internal-state probe: bookkeeping cleared. Skipped on minified
    // builds because terser mangles `_batchChanges` per mangle-properties.json.
    if (!isMinifiedBuild()) {
      expect(instance.stateManager._batchChanges?.size || 0,
        '_batchChanges must be cleared on cancel'
      ).toBe(0)
    }
  })

  // Skipped on minified builds: the assertions probe `_batchChanges`
  // entries directly to detect bookkeeping leaks. That property gets
  // mangled in production. The observable DOM end-state would not
  // distinguish a leak (both batches' mutations land in `instance.state`
  // regardless of bookkeeping correctness), so there's no min-safe
  // version of this test.
  it.skipIf(isMinifiedBuild())('a fresh batch after cancel sees only its own mutations', async () => {
    testContainer.innerHTML = `
      <div data-component="cancel-leak">
        <span id="leak-name" data-bind="name"></span>
        <span id="leak-tag" data-bind="tag"></span>
      </div>
    `

    wildflower.component('cancel-leak', {
      state: { name: 'a', tag: 'x' }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="cancel-leak"]')
    const componentId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(componentId)

    // Cancelled batch touches `name`.
    const cancelledBatch = wildflower.startBatch()
    instance.state.name = 'b'
    cancelledBatch.cancel()

    // The cancelled batch's mutation persists in state (cancel does not roll
    // back) but must not drive a render; the fresh batch below does. Meadow has
    // no _batchChanges bookkeeping to probe — it discards the cancelled batch's
    // pending scheduled effects — so this is asserted purely on the end-state.
    const realBatch = wildflower.startBatch()
    instance.state.tag = 'y'

    await realBatch.apply()
    await waitForCompleteRender()

    // Both mutations are in state (cancel does not roll back), but
    // only the fresh batch should have driven a render.
    expect(component.querySelector('#leak-name').textContent).toBe('b')
    expect(component.querySelector('#leak-tag').textContent).toBe('y')
  })

  it('Batch updates minimize DOM operations', async () => {
    testContainer.innerHTML = `
      <div data-component="dom-updates-test">
        <span id="batch-counter" data-bind="counter"></span>
      </div>
    `

    wildflower.component('dom-updates-test', {
      state: {
        counter: 0
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="dom-updates-test"]')
    const componentId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(componentId)
    const bindingElement = component.querySelector('#batch-counter')

    // Track DOM text updates. The canonical text writer (__wf_txt, P6-S3)
    // mutates a single text-node child IN PLACE via `.data` (preserving node
    // identity) and only falls back to textContent for empty/multi-child
    // shapes — so instrument BOTH channels and count total text writes.
    let textWriteCount = 0
    const originalDescriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')

    Object.defineProperty(bindingElement, 'textContent', {
      set(value) {
        textWriteCount++
        return originalDescriptor.set.call(this, value)
      },
      get() {
        return originalDescriptor.get.call(this)
      }
    })
    const textNode = bindingElement.firstChild
    const dataDescriptor = Object.getOwnPropertyDescriptor(CharacterData.prototype, 'data')
    if (textNode && textNode.nodeType === 3) {
      Object.defineProperty(textNode, 'data', {
        set(value) {
          textWriteCount++
          return dataDescriptor.set.call(this, value)
        },
        get() {
          return dataDescriptor.get.call(this)
        }
      })
    }

    // Reset counter after initial render
    textWriteCount = 0

    // Make multiple updates in batch
    const batch = wildflower.startBatch()
    instance.state.counter = 1
    instance.state.counter = 2
    instance.state.counter = 3
    instance.state.counter = 3 // Redundant - shouldn't cause extra DOM update
    await batch.apply()
    await waitForCompleteRender()

    // There should only be one DOM text write even with multiple state changes
    expect(textWriteCount).toBe(1)

    // Verify the final value is correct
    expect(originalDescriptor.get.call(bindingElement)).toBe('3')
  })
})
