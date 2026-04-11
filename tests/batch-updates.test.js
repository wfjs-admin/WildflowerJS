/**
 * WildflowerJS Batch Update Processing Test Suite - Vitest Browser Mode
 *
 * Tests for batch update processing and DOM operation minimization.
 * Migrated from unitTestSuite.js BATCH UPDATE PROCESSING section.
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

    // Track DOM updates
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

    // Reset counter after initial render
    textContentSetCount = 0

    // Make multiple updates in batch
    const batch = wildflower.startBatch()
    instance.state.counter = 1
    instance.state.counter = 2
    instance.state.counter = 3
    instance.state.counter = 3 // Redundant - shouldn't cause extra DOM update
    await batch.apply()
    await waitForCompleteRender()

    // There should only be one DOM update even with multiple state changes
    expect(textContentSetCount).toBe(1)

    // Verify the final value is correct
    expect(originalDescriptor.get.call(bindingElement)).toBe('3')
  })
})
