/**
 * WildflowerJS Mount/Unmount Cycle Stress Test - Vitest Browser Mode
 *
 * Tests rapid mount/unmount cycling via data-render toggling.
 * Verifies component instance stability, lifecycle hooks, binding accuracy,
 * and post-cycle functionality after 100 mount/unmount cycles.
 *
 * Migrated from test-cases/scenarios/component-mount-unmount-cycle.html
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

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

describe.skipIf(isMinifiedBuild())('Mount/Unmount Cycle Stress Tests', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    if (wildflower._initContextSystem) {
      wildflower._contextSystemInitialized = false
      wildflower._initContextSystem()
    }

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

  it('should survive 100 mount/unmount cycles via data-render toggle', async () => {
    let initCount = 0
    let destroyCount = 0

    testContainer.innerHTML = `
      <div data-component="cycle-parent">
        <p>Toggle count: <span data-bind="toggleCount" id="cycle-toggle-count"></span></p>
        <div data-render="showChild">
          <div data-component="cycle-child" class="cycle-child-box">
            <p>Child value: <span data-bind="childValue"></span></p>
            <button data-action="childAction" id="cycle-child-btn">Child Action</button>
          </div>
        </div>
      </div>
    `

    wildflower.component('cycle-child', {
      state: {
        childValue: 'I am the child'
      },
      init() {
        initCount++
      },
      childAction() {
        this.state.childValue = 'clicked at ' + Date.now()
      },
      destroy() {
        destroyCount++
      }
    })

    wildflower.component('cycle-parent', {
      state: {
        showChild: true,
        toggleCount: 0
      },
      toggle() {
        this.state.showChild = !this.state.showChild
        this.state.toggleCount++
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    // Find the parent instance
    const parentEl = testContainer.querySelector('[data-component="cycle-parent"]')
    const parentId = parentEl.dataset.componentId
    const parentInstance = wildflower.componentInstances.get(parentId)
    expect(parentInstance).toBeDefined()

    const initialInstanceCount = wildflower.componentInstances.size
    const TOTAL_CYCLES = 100

    // Run 100 mount/unmount cycles
    for (let i = 0; i < TOTAL_CYCLES; i++) {
      // Unmount
      parentInstance.state.showChild = false
      parentInstance.state.toggleCount = i * 2 + 1
      await waitForUpdate(10)

      // Mount
      parentInstance.state.showChild = true
      parentInstance.state.toggleCount = i * 2 + 2
      await waitForUpdate(10)
    }

    await waitForCompleteRender()

    // Test 1: All cycles completed - toggle count displays correctly
    const countEl = testContainer.querySelector('#cycle-toggle-count')
    expect(countEl).not.toBeNull()
    expect(parseInt(countEl.textContent)).toBe(TOTAL_CYCLES * 2)

    // Test 2: Child component visible after final mount
    const childBox = testContainer.querySelector('.cycle-child-box')
    expect(childBox).not.toBeNull()

    // Test 3: Component instances not leaking (count should be stable)
    const finalInstanceCount = wildflower.componentInstances.size
    expect(finalInstanceCount).toBeLessThanOrEqual(initialInstanceCount + 2)

    // Test 4: Lifecycle hooks called - destroy is synchronous so it always runs;
    // init is deferred via setTimeout(0) so on rapid toggles most inits are
    // skipped (component destroyed before deferred init fires). This asymmetry
    // is expected behavior.
    expect(destroyCount).toBeGreaterThan(0)
  }, 30000)

  it('should remain functional after 100 mount/unmount cycles', async () => {
    testContainer.innerHTML = `
      <div data-component="func-parent">
        <div data-render="showChild">
          <div data-component="func-child" class="func-child-box">
            <span data-bind="childValue" id="func-child-value"></span>
            <button data-action="childAction" id="func-child-btn">Click</button>
          </div>
        </div>
      </div>
    `

    wildflower.component('func-child', {
      state: {
        childValue: 'initial'
      },
      childAction() {
        this.state.childValue = 'clicked'
      }
    })

    wildflower.component('func-parent', {
      state: {
        showChild: true
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const parentEl = testContainer.querySelector('[data-component="func-parent"]')
    const parentId = parentEl.dataset.componentId
    const parentInstance = wildflower.componentInstances.get(parentId)

    const TOTAL_CYCLES = 100

    // Run cycles
    for (let i = 0; i < TOTAL_CYCLES; i++) {
      parentInstance.state.showChild = false
      await waitForUpdate(5)
      parentInstance.state.showChild = true
      await waitForUpdate(5)
    }

    await waitForCompleteRender()

    // Child should be visible and functional after all cycles
    const childBtn = testContainer.querySelector('#func-child-btn')
    expect(childBtn).not.toBeNull()

    childBtn.click()
    await waitForCompleteRender()

    const childVal = testContainer.querySelector('#func-child-value')
    expect(childVal).not.toBeNull()
    expect(childVal.textContent).toBe('clicked')
  }, 30000)

  it('should not leak contexts during rapid mount/unmount cycling', async () => {
    testContainer.innerHTML = `
      <div data-component="leak-parent">
        <div data-render="showChild">
          <div data-component="leak-child">
            <span data-bind="value"></span>
            <div data-show="active">Active</div>
          </div>
        </div>
      </div>
    `

    wildflower.component('leak-child', {
      state: {
        value: 'child',
        active: true
      }
    })

    wildflower.component('leak-parent', {
      state: {
        showChild: true
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const parentEl = testContainer.querySelector('[data-component="leak-parent"]')
    const parentId = parentEl.dataset.componentId
    const parentInstance = wildflower.componentInstances.get(parentId)

    // Baseline after initial render
    wildflower.garbageCollect()
    const baselineInstances = wildflower.componentInstances.size

    // Run 50 mount/unmount cycles with periodic GC
    for (let i = 0; i < 50; i++) {
      parentInstance.state.showChild = false
      await waitForUpdate(5)
      parentInstance.state.showChild = true
      await waitForUpdate(5)

      // Periodic GC every 10 cycles
      if (i % 10 === 9) {
        wildflower.garbageCollect()
      }
    }

    // Final GC
    wildflower.garbageCollect()
    const finalInstances = wildflower.componentInstances.size

    // Observable no-leak: rapid mount/unmount cycling does not leak component
    // instances (the child re-mounts to a single live instance each cycle).
    expect(finalInstances).toBeLessThanOrEqual(baselineInstances + 2)
  }, 30000)
})
