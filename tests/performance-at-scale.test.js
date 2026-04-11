/**
 * WildflowerJS Performance at Scale Test Suite - Vitest Browser Mode
 *
 * Tests for performance with many contexts and batch update efficiency.
 * Migrated from unitTestSuite.js Performance at Scale section.
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

describe('Performance at Scale', () => {
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

  it.skipIf(isMinifiedBuild())('Performance scales well with many contexts', async () => {
    testContainer.innerHTML = `
      <div data-component="scale-test">
        <div id="scale-item-count" data-bind="computed:itemCount"></div>
        <div data-list="scaleItems">
          <template>
            <div class="scale-item">
              <span data-bind="name"></span>
              <div data-show="active">Active</div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component('scale-test', {
      state: {
        scaleItems: Array.from({ length: 100 }, (_, i) => ({
          name: `Item ${i}`,
          active: i % 2 === 0
        }))
      },
      computed: {
        itemCount() {
          return `Total items: ${this.state.scaleItems.length}`
        }
      }
    })

    // Measure initialization time
    const startTime = performance.now()
    wildflower.scan()
    await waitForCompleteRender()
    const initTime = performance.now() - startTime

    const component = testContainer.querySelector('[data-component="scale-test"]')
    const componentId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(componentId)

    // Verify the list rendered correctly
    const listItems = component.querySelectorAll('.scale-item')
    expect(listItems.length).toBe(100)

    // Count contexts
    const allContexts = wildflower._contextRegistry.contexts.size
    const bindingContexts = wildflower._contextRegistry.getContextsByType('binding').length
    const conditionalContexts = wildflower._contextRegistry.getContextsByType('conditional').length
    const listContexts = wildflower._contextRegistry.getContextsByType('list').length

    // Update half the items and measure performance
    const updateStartTime = performance.now()

    // Create a new array as a copy of the original
    const updatedItems = [...instance.state.scaleItems]

    // Update individual items with new objects
    for (let i = 0; i < 50; i++) {
      updatedItems[i] = {
        ...updatedItems[i],
        name: `Updated ${i}`,
        active: !updatedItems[i].active
      }
    }

    // Set the entire updated array to state
    instance.state.scaleItems = updatedItems

    await waitForCompleteRender()
    const updateTime = performance.now() - updateStartTime

    // Performance assertions - update should be reasonably fast
    expect(updateTime).toBeLessThan(initTime * 3)

    // Verify some elements were updated
    const firstUpdatedItem = component.querySelector('.scale-item [data-bind="name"]')
    expect(firstUpdatedItem.textContent).toBe('Updated 0')
  })

  it('Automatic batching performance comparison', async () => {
    testContainer.innerHTML = `
      <div data-component="auto-batch-scale-test">
        <div id="auto-batch-count" data-bind="computed:itemCount"></div>
        <div data-list="autoBatchItems">
          <template>
            <div class="auto-batch-item">
              <span data-bind="name"></span>
              <div data-show="active">Active</div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component('auto-batch-scale-test', {
      state: {
        autoBatchItems: Array.from({ length: 100 }, (_, i) => ({
          name: `Item ${i}`,
          active: i % 2 === 0
        }))
      },
      computed: {
        itemCount() {
          return `Total items: ${this.state.autoBatchItems.length}`
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="auto-batch-scale-test"]')
    const componentId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(componentId)

    // First measure with automatic batching
    const autoStartTime = performance.now()

    const updatedItems = [...instance.state.autoBatchItems]
    for (let i = 0; i < 50; i++) {
      updatedItems[i] = {
        ...updatedItems[i],
        name: `Auto ${i}`,
        active: !updatedItems[i].active
      }
    }
    instance.state.autoBatchItems = updatedItems

    await waitForCompleteRender()
    const autoUpdateTime = performance.now() - autoStartTime

    // Then measure with explicit batch
    const explicitStartTime = performance.now()

    const batch = wildflower.startBatch()
    const batchUpdatedItems = [...instance.state.autoBatchItems]
    for (let i = 0; i < 50; i++) {
      batchUpdatedItems[i] = {
        ...batchUpdatedItems[i],
        name: `Batch ${i}`,
        active: !batchUpdatedItems[i].active
      }
    }
    instance.state.autoBatchItems = batchUpdatedItems
    await batch.apply()

    await waitForCompleteRender()
    const explicitUpdateTime = performance.now() - explicitStartTime

    // Both should complete without errors - we don't assert which is faster
    // Just verify both approaches work correctly
    const firstItem = component.querySelector('.auto-batch-item [data-bind="name"]')
    expect(firstItem.textContent).toBe('Batch 0')
  })

  it('Cross-component coordination with automatic vs explicit batching', async () => {
    testContainer.innerHTML = `
      <div data-component="data-provider">
        <span id="provider-status" data-bind="providerStatus"></span>

        <div data-component="consumer-a">
          <span id="consumer-a-value" data-bind="computed:derivedValueA"></span>
        </div>

        <div data-component="consumer-b">
          <span id="consumer-b-value" data-bind="computed:derivedValueB"></span>
        </div>

        <div data-component="consumer-c">
          <span id="consumer-c-value" data-bind="computed:derivedValueC"></span>
        </div>
      </div>
    `

    // Register components with dependencies
    wildflower.component('data-provider', {
      state: {
        value1: 10,
        value2: 20,
        value3: 30,
        providerStatus: 'Ready'
      }
    })

    wildflower.component('consumer-a', {
      computed: {
        derivedValueA() {
          const provider = wildflower.getComponent('data-provider')
          const val = provider ? provider.state.value1 : 0
          let result = 0
          for (let i = 0; i < 100; i++) {
            result += Math.sqrt(val * i)
          }
          return `A processed: ${result.toFixed(2)}`
        }
      }
    })

    wildflower.component('consumer-b', {
      computed: {
        derivedValueB() {
          const provider = wildflower.getComponent('data-provider')
          const val = provider ? provider.state.value2 : 0
          let result = 0
          for (let i = 0; i < 100; i++) {
            result += Math.sqrt(val * i)
          }
          return `B processed: ${result.toFixed(2)}`
        }
      }
    })

    wildflower.component('consumer-c', {
      computed: {
        derivedValueC() {
          const provider = wildflower.getComponent('data-provider')
          const val1 = provider ? provider.state.value1 : 0
          const val2 = provider ? provider.state.value2 : 0
          const val3 = provider ? provider.state.value3 : 0
          let result = 0
          for (let i = 0; i < 100; i++) {
            result += Math.sqrt((val1 + val2 + val3) * i)
          }
          return `C processed: ${result.toFixed(2)}`
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const providerEl = testContainer.querySelector('[data-component="data-provider"]')
    const provider = wildflower.componentInstances.get(providerEl.dataset.componentId)

    // TEST 1: AUTOMATIC BATCHING
    provider.state.value1 = 15
    provider.state.value2 = 25
    provider.state.value3 = 35
    provider.state.providerStatus = 'Updated via auto-batch'

    await waitForCompleteRender()

    // Check DOM updates reflect the changes
    expect(testContainer.querySelector('#provider-status').textContent).toBe('Updated via auto-batch')
    expect(testContainer.querySelector('#consumer-a-value').textContent).toContain('A processed:')
    expect(testContainer.querySelector('#consumer-b-value').textContent).toContain('B processed:')
    expect(testContainer.querySelector('#consumer-c-value').textContent).toContain('C processed:')

    // TEST 2: EXPLICIT BATCHING
    const batch = wildflower.startBatch()
    provider.state.value1 = 20
    provider.state.value2 = 30
    provider.state.value3 = 40
    provider.state.providerStatus = 'Updated via explicit batch'
    await batch.apply()

    await waitForCompleteRender()

    // Check DOM updates with explicit batching
    expect(testContainer.querySelector('#provider-status').textContent).toBe('Updated via explicit batch')
    expect(testContainer.querySelector('#consumer-a-value').textContent).toContain('A processed:')
    expect(testContainer.querySelector('#consumer-b-value').textContent).toContain('B processed:')
    expect(testContainer.querySelector('#consumer-c-value').textContent).toContain('C processed:')
  })
})
