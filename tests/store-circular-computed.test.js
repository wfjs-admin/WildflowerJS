/**
 * WildflowerJS Store Circular Computed Test Suite - Vitest Browser Mode
 *
 * Tests that circular computed property dependencies are detected and handled
 * gracefully without causing infinite loops or crashing the framework.
 *
 * Converted from test-cases/scenarios/store-circular-computed.html
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Store Circular Computed Properties', () => {
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

  describe('Circular dependency detection and graceful handling', () => {
    let circularWarnings
    let origWarn
    let origError
    let componentInitialized

    // Detect either the keyword-bearing dev diagnostic OR the prod error code
    // (WF-202 = CIRCULAR_DEPENDENCY). Production builds strip the human-readable
    // message via the __DEV__ guard in wfError(), emitting only the code + doc
    // URL to console.error — no console.warn fires at all. Intercepting both
    // channels keeps this test meaningful across dev/raw/min builds.
    function matches(msg) {
      return msg.includes('circular') || msg.includes('Circular') ||
             msg.includes('infinite') || msg.includes('exceeded') ||
             msg.includes('WF-202')
    }

    beforeEach(() => {
      circularWarnings = 0
      componentInitialized = false

      origWarn = console.warn
      console.warn = function () {
        if (matches(Array.from(arguments).join(' '))) circularWarnings++
        origWarn.apply(console, arguments)
      }
      origError = console.error
      console.error = function () {
        if (matches(Array.from(arguments).join(' '))) circularWarnings++
        origError.apply(console, arguments)
      }
    })

    afterEach(() => {
      console.warn = origWarn
      console.error = origError
    })

    it('component initializes despite circular computed properties', async () => {
      wildflower.component('circular-test-init', {
        state: { counter: 0, base: 10 },
        computed: {
          valueA() { return this.computed.valueB + 1 },
          valueB() { return this.computed.valueA + 1 },
          safeValue() { return this.state.base * 2 }
        },
        init() {
          componentInitialized = true
        },
        increment() {
          this.state.counter++
        }
      })

      testContainer.innerHTML = `
        <div data-component="circular-test-init">
          <span data-bind="valueA" class="val-a"></span>
          <span data-bind="valueB" class="val-b"></span>
          <span data-bind="safeValue" class="safe"></span>
          <span data-bind="counter" class="counter"></span>
          <button data-action="increment" class="inc-btn">Increment</button>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(500)

      expect(componentInitialized).toBe(true)
    })

    it('framework handles circular dependency without infinite loop', async () => {
      wildflower.component('circular-test-detect', {
        state: { base: 10 },
        computed: {
          valueA() { return this.computed.valueB + 1 },
          valueB() { return this.computed.valueA + 1 }
        }
      })

      testContainer.innerHTML = `
        <div data-component="circular-test-detect">
          <span data-bind="valueA" class="val-a"></span>
          <span data-bind="valueB" class="val-b"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(500)

      // If we reach here without hanging, the circular dependency was handled gracefully
      // Verify the component actually processed by checking the DOM was bound
      const valA = testContainer.querySelector('.val-a')
      const valB = testContainer.querySelector('.val-b')
      expect(valA).not.toBeNull()
      expect(valB).not.toBeNull()
      // At least one warning should have been emitted for circular dependency
      expect(circularWarnings).toBeGreaterThan(0)
    })

    it('circular computed A does not cause infinite loop', async () => {
      wildflower.component('circular-test-a', {
        state: {},
        computed: {
          valueA() { return this.computed.valueB + 1 },
          valueB() { return this.computed.valueA + 1 }
        }
      })

      testContainer.innerHTML = `
        <div data-component="circular-test-a">
          <span data-bind="valueA" class="val-a"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(500)

      // Element exists and page did not hang — that is the assertion
      const valA = testContainer.querySelector('.val-a')
      expect(valA).not.toBeNull()
    })

    it('circular computed B does not cause infinite loop', async () => {
      wildflower.component('circular-test-b', {
        state: {},
        computed: {
          valueA() { return this.computed.valueB + 1 },
          valueB() { return this.computed.valueA + 1 }
        }
      })

      testContainer.innerHTML = `
        <div data-component="circular-test-b">
          <span data-bind="valueB" class="val-b"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(500)

      const valB = testContainer.querySelector('.val-b')
      expect(valB).not.toBeNull()
    })

    it('non-circular computed still works alongside circular ones', async () => {
      wildflower.component('circular-test-safe', {
        state: { base: 10 },
        computed: {
          valueA() { return this.computed.valueB + 1 },
          valueB() { return this.computed.valueA + 1 },
          safeValue() { return this.state.base * 2 }
        }
      })

      testContainer.innerHTML = `
        <div data-component="circular-test-safe">
          <span data-bind="valueA"></span>
          <span data-bind="valueB"></span>
          <span data-bind="safeValue" class="safe"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(500)

      const safeEl = testContainer.querySelector('.safe')
      expect(safeEl.textContent).toBe('20')
    })

    it('actions still work after circular computed evaluation', async () => {
      wildflower.component('circular-test-actions', {
        state: { counter: 0, base: 10 },
        computed: {
          valueA() { return this.computed.valueB + 1 },
          valueB() { return this.computed.valueA + 1 }
        },
        increment() {
          this.state.counter++
        }
      })

      testContainer.innerHTML = `
        <div data-component="circular-test-actions">
          <span data-bind="valueA"></span>
          <span data-bind="valueB"></span>
          <span data-bind="counter" class="counter"></span>
          <button data-action="increment" class="inc-btn">Increment</button>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(500)

      const incBtn = testContainer.querySelector('.inc-btn')
      incBtn.click()
      await waitForUpdate(300)

      const counterEl = testContainer.querySelector('.counter')
      expect(counterEl.textContent).toBe('1')
    })
  })
})
