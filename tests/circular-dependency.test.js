/**
 * WildflowerJS Circular Dependency Detection Test Suite - Vitest Browser Mode
 *
 * Tests for circular dependency detection in computed properties.
 * Migrated from unitTestSuite.js Circular Dependency Detection section.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, isMinifiedBuild} from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Circular Dependency Detection', () => {
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

  it.skipIf(isMinifiedBuild())('self-referencing computed returns undefined', async () => {
    // NO DOM BINDING - just test direct access to avoid infinite DOM updates
    wildflower.component('circular-self-ref-test', {
      state: {
        count: 0
      },
      computed: {
        selfRef() {
          // Self-reference
          return this.state.selfRef + 1
        }
      }
    })

    testContainer.innerHTML = `<div data-component="circular-self-ref-test"></div>`

    // Allow component initialization
    await waitForUpdate(10)

    const component = testContainer.querySelector('[data-component="circular-self-ref-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Access the circular computed - should return undefined after detection
    const value = instance.state.selfRef

    // After circular detection, should return undefined
    expect(value).toBeUndefined()

    // Should be marked as circular in the state manager
    expect(instance.stateManager._circularDependencies?.has('selfRef')).toBe(true)
  })

  it.skipIf(isMinifiedBuild())('mutual computed dependencies return undefined', async () => {
    // NO DOM BINDING - just test direct access
    wildflower.component('mutual-circular-test', {
      state: {
        base: 10
      },
      computed: {
        computedA() {
          // A depends on B
          return this.state.computedB + 1
        },
        computedB() {
          // B depends on A (circular!)
          return this.state.computedA + 1
        }
      }
    })

    testContainer.innerHTML = `<div data-component="mutual-circular-test"></div>`

    await waitForUpdate(10)

    const component = testContainer.querySelector('[data-component="mutual-circular-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Access first property - will detect circular when it tries to access the other
    const valueA = instance.state.computedA

    // Should return undefined after circular detection
    expect(valueA).toBeUndefined()

    // At least one should be marked as circular
    const hasCircular = instance.stateManager._circularDependencies?.has('computedA') ||
                       instance.stateManager._circularDependencies?.has('computedB')

    expect(hasCircular).toBe(true)
  })

  it.skipIf(isMinifiedBuild())('three-way chain (A→B→C→A) returns undefined', async () => {
    // NO DOM BINDING - just test direct access
    wildflower.component('chain-circular-test', {
      state: {
        value: 5
      },
      computed: {
        compA() {
          // A depends on C
          return this.state.compC + 1
        },
        compB() {
          // B depends on A
          return this.state.compA + 1
        },
        compC() {
          // C depends on B (completes the circle)
          return this.state.compB + 1
        }
      }
    })

    testContainer.innerHTML = `<div data-component="chain-circular-test"></div>`

    await waitForUpdate(10)

    const component = testContainer.querySelector('[data-component="chain-circular-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Access any computed in the circular chain
    const value = instance.state.compA

    // Should return undefined after circular detection
    expect(value).toBeUndefined()

    // One of them should be marked as circular
    const hasCircular = instance.stateManager._circularDependencies?.has('compA') ||
                       instance.stateManager._circularDependencies?.has('compB') ||
                       instance.stateManager._circularDependencies?.has('compC')

    expect(hasCircular).toBe(true)
  })

  it('valid computed chain (A→B→C) computes correctly', async () => {
    testContainer.innerHTML = `
      <div data-component="valid-chain-test">
        <div id="a" data-bind="computed:compA"></div>
        <div id="b" data-bind="computed:compB"></div>
        <div id="c" data-bind="computed:compC"></div>
      </div>
    `

    wildflower.component('valid-chain-test', {
      state: {
        value: 5
      },
      computed: {
        compA() {
          // A depends on state
          return this.state.value * 2
        },
        compB() {
          // B depends on A
          return this.state.compA + 3
        },
        compC() {
          // C depends on B
          return this.state.compB + 1
        }
      }
    })

    await waitForUpdate(10)

    const component = testContainer.querySelector('[data-component="valid-chain-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Should compute correctly
    expect(instance.state.compA).toBe(10) // 5 * 2 = 10
    expect(instance.state.compB).toBe(13) // 10 + 3 = 13
    expect(instance.state.compC).toBe(14) // 13 + 1 = 14

    // Update base value
    instance.state.value = 10
    await waitForUpdate()

    expect(instance.state.compA).toBe(20) // 10 * 2 = 20
    expect(instance.state.compB).toBe(23) // 20 + 3 = 23
    expect(instance.state.compC).toBe(24) // 23 + 1 = 24
  })

  it('indirect circular through state mutation is prevented', async () => {
    // NO DOM BINDING - just test direct access
    let mutationAttempts = 0

    wildflower.component('indirect-circular-test', {
      state: {
        counter: 0
      },
      computed: {
        display() {
          mutationAttempts++
          // Computed property that tries to mutate state (anti-pattern)
          // Framework's emergency circuit breaker should stop this
          if (this.state.counter < 10) {
            this.state.counter++
          }
          return this.state.counter
        }
      }
    })

    testContainer.innerHTML = `<div data-component="indirect-circular-test"></div>`

    await waitForUpdate(10)

    const component = testContainer.querySelector('[data-component="indirect-circular-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Access computed property - emergency circuit breaker should stop it after 10 calls
    const value = instance.state.display

    // Emergency circuit breaker should have stopped it within reasonable limit
    expect(mutationAttempts).toBeLessThanOrEqual(15)
  })
})
