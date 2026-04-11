/**
 * WildflowerJS Cross-Component Dependencies Test Suite - Vitest Browser Mode
 *
 * Tests for external() API and cross-component data propagation.
 * Migrated from unitTestSuite.js Cross-Component Dependencies section.
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

describe('Cross-Component Dependencies', () => {
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

  it('Updates propagate efficiently through component dependencies', async () => {
    testContainer.innerHTML = `
      <div data-component="parent-component">
        <span id="parent-shared-data" data-bind="sharedData"></span>
        <div data-component="child-component">
          <span id="child-derived-data" data-bind="computed:derivedData"></span>
        </div>
      </div>
    `

    wildflower.component('parent-component', {
      state: {
        sharedData: 'Initial'
      }
    })

    wildflower.component('child-component', {
      computed: {
        parentData() {
          const parent = wildflower.getComponent('parent-component')
          return parent ? parent.state.sharedData : ''
        },
        derivedData() {
          return `Child received: ${this.computed.parentData}`
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const parentComponent = testContainer.querySelector('[data-component="parent-component"]')
    const childComponent = testContainer.querySelector('[data-component="child-component"]')

    const parentInstance = wildflower.componentInstances.get(parentComponent.dataset.componentId)
    const childInstance = wildflower.componentInstances.get(childComponent.dataset.componentId)

    // Verify initial value
    const initialValue = childInstance.context.computed.parentData
    expect(initialValue).toBe('Initial')

    // Update parent state
    parentInstance.state.sharedData = 'Updated'
    await waitForCompleteRender()

    // Verify computed property reflects updated value
    const updatedValue = childInstance.context.computed.parentData
    expect(updatedValue).toBe('Updated')

    // Verify derived value
    const derivedValue = childInstance.context.computed.derivedData
    expect(derivedValue).toBe('Child received: Updated')

    // Test batch updates
    const batch = wildflower.startBatch()
    parentInstance.state.sharedData = 'Update 1'
    parentInstance.state.sharedData = 'Update 2'
    parentInstance.state.sharedData = 'Final Update'
    await batch.apply()
    await waitForCompleteRender()

    // Check final value propagated correctly
    const finalResult = childInstance.context.computed.derivedData
    expect(finalResult).toBe('Child received: Final Update')
  })

  it('Context dependency graph optimizes complex relationships', async () => {
    testContainer.innerHTML = `
      <div data-component="data-source">
        <span id="source-data" data-bind="sourceData"></span>
        <div data-component="intermediate-component">
          <span id="processed-data" data-bind="computed:processedData"></span>
        </div>
        <div data-component="consumer-component">
          <span id="final-data" data-bind="computed:finalData"></span>
        </div>
      </div>
    `

    wildflower.component('data-source', {
      state: {
        sourceData: 'Original'
      }
    })

    wildflower.component('intermediate-component', {
      computed: {
        processedData() {
          const source = wildflower.getComponent('data-source')
          return `Processed: ${source ? source.state.sourceData : ''}`
        }
      }
    })

    wildflower.component('consumer-component', {
      computed: {
        finalData() {
          const intermediate = wildflower.getComponent('intermediate-component')
          const processed = intermediate ? intermediate.stateManager.evaluateComputed('processedData') : ''
          return `Final: ${processed}`
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const sourceComp = testContainer.querySelector('[data-component="data-source"]')
    const consumerComp = testContainer.querySelector('[data-component="consumer-component"]')

    const sourceInstance = wildflower.componentInstances.get(sourceComp.dataset.componentId)
    const consumerInstance = wildflower.componentInstances.get(consumerComp.dataset.componentId)

    // Update source data
    sourceInstance.state.sourceData = 'Updated'
    await waitForCompleteRender()

    // Verify dependency chain
    const finalResult = consumerInstance.context.computed.finalData
    expect(finalResult).toBe('Final: Processed: Updated')

    // Do batch updates
    const batch = wildflower.startBatch()
    sourceInstance.state.sourceData = 'Batch 1'
    sourceInstance.state.sourceData = 'Batch 2'
    sourceInstance.state.sourceData = 'Batch 3'
    await batch.apply()
    await waitForCompleteRender()

    // Verify final batch result
    const batchResult = consumerInstance.context.computed.finalData
    expect(batchResult).toBe('Final: Processed: Batch 3')
  })

  it('external() in data-bind renders initial value from another component', async () => {
    wildflower.component('ext-publisher', {
      state: {
        message: 'Hello from publisher'
      }
    })

    wildflower.component('ext-subscriber', {
      state: {}
    })

    testContainer.innerHTML = `
      <div data-component="ext-publisher"></div>
      <div data-component="ext-subscriber">
        <span id="ext-message-display" data-bind="external('ext-publisher', 'message')"></span>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()
    await waitForUpdate(100)

    const messageDisplay = testContainer.querySelector('#ext-message-display')
    expect(messageDisplay).not.toBeNull()
    expect(messageDisplay.textContent).toBe('Hello from publisher')
  })

  it('external() in data-bind updates when source component state changes', async () => {
    wildflower.component('ext-pub-update', {
      state: {
        counter: 0
      }
    })

    wildflower.component('ext-sub-update', {
      state: {}
    })

    testContainer.innerHTML = `
      <div data-component="ext-pub-update"></div>
      <div data-component="ext-sub-update">
        <span id="ext-counter-display" data-bind="external('ext-pub-update', 'counter')"></span>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()
    await waitForUpdate(100)

    const counterDisplay = testContainer.querySelector('#ext-counter-display')
    expect(counterDisplay.textContent).toBe('0')

    // Get publisher instance and update state
    const publisherEl = testContainer.querySelector('[data-component="ext-pub-update"]')
    const publisherInstance = wildflower.componentInstances.get(publisherEl.dataset.componentId)

    publisherInstance.state.counter = 42
    await waitForCompleteRender()
    await waitForUpdate(100)

    expect(counterDisplay.textContent).toBe('42')
  })

  it('external() in data-bind with computed property', async () => {
    wildflower.component('ext-pub-computed', {
      state: {
        firstName: 'John',
        lastName: 'Doe'
      },
      computed: {
        fullName() {
          return `${this.state.firstName} ${this.state.lastName}`
        }
      }
    })

    wildflower.component('ext-sub-computed', {
      state: {}
    })

    testContainer.innerHTML = `
      <div data-component="ext-pub-computed"></div>
      <div data-component="ext-sub-computed">
        <span id="ext-fullname-display" data-bind="external('ext-pub-computed', 'computed:fullName')"></span>
      </div>
    `

    wildflower.scan()
    await waitForCompleteRender()
    await waitForUpdate(100)

    const fullNameDisplay = testContainer.querySelector('#ext-fullname-display')
    expect(fullNameDisplay.textContent).toBe('John Doe')

    // Update source state
    const publisherEl = testContainer.querySelector('[data-component="ext-pub-computed"]')
    const publisherInstance = wildflower.componentInstances.get(publisherEl.dataset.componentId)

    publisherInstance.state.firstName = 'Jane'
    await waitForCompleteRender()
    await waitForUpdate(100)

    expect(fullNameDisplay.textContent).toBe('Jane Doe')
  })

  // =========================================================================
  // P2-1: Nested computed evaluation preserves _isEvaluatingComputed flag
  // =========================================================================
  it('nested computed-to-computed with store reads does not corrupt evaluation flags', async () => {
    let evalOrder = []

    wildflower.store('p2-data', {
      state: { x: 10, y: 20 }
    })

    wildflower.component('p2-nested-computed', {
      state: { local: 1 },
      computed: {
        // computedB reads from the store (will go through _evaluateComputedFull on first eval)
        innerValue() {
          evalOrder.push('innerValue-start')
          const val = this.external('p2-data', 'y')
          evalOrder.push('innerValue-end')
          return val * 2
        },
        // computedA reads store, then triggers computedB, then reads store again
        outerValue() {
          evalOrder.push('outerValue-start')
          const x = this.external('p2-data', 'x')
          const inner = this.innerValue  // triggers nested computed eval
          const y = this.external('p2-data', 'y') // second store read — should still be deferred
          evalOrder.push('outerValue-end')
          return x + inner + y
        }
      }
    })

    testContainer.innerHTML = `
      <div data-component="p2-nested-computed">
        <span id="p2-result" data-bind="outerValue"></span>
      </div>
    `
    wildflower.scan(testContainer)
    await waitForCompleteRender()
    await waitForUpdate(150)

    // outerValue = x(10) + innerValue(y*2=40) + y(20) = 70
    const resultEl = testContainer.querySelector('#p2-result')
    expect(resultEl.textContent).toBe('70')

    // Update store — both computeds should re-evaluate cleanly
    const store = wildflower.getStore('p2-data')
    store.x = 100
    store.y = 200
    await waitForCompleteRender()
    await waitForUpdate(150)

    // outerValue = x(100) + innerValue(y*2=400) + y(200) = 700
    expect(resultEl.textContent).toBe('700')
  })
})
