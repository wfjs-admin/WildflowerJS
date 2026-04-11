/**
 * WildflowerJS Computed Error Handling Test Suite - Vitest Browser Mode
 *
 * Tests that computed property errors are caught gracefully, do not break
 * sibling computeds, and that computeds recover when the error condition clears.
 *
 * Converted from test-cases/scenarios/computed-throws.html
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Computed Error Handling', () => {
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

  describe('Computed that throws - sibling computed and recovery', () => {
    beforeEach(async () => {
      wildflower.component('computed-error-comp', {
        state: {
          counter: 0,
          shouldThrow: false
        },
        computed: {
          safeComputed() {
            return 'Safe: ' + this.state.counter
          },
          dangerousComputed() {
            if (this.state.shouldThrow) {
              throw new Error('Intentional computed error!')
            }
            return 'OK: ' + this.state.counter
          }
        },
        increment() {
          this.state.counter++
        },
        triggerError() {
          this.state.shouldThrow = true
          this.state.counter++
        },
        clearError() {
          this.state.shouldThrow = false
          this.state.counter++
        }
      })

      testContainer.innerHTML = `
        <div data-component="computed-error-comp">
          <span data-bind="safeComputed" class="safe"></span>
          <span data-bind="dangerousComputed" class="dangerous"></span>
          <span data-bind="counter" class="counter"></span>
          <button data-action="increment" class="inc-btn">Increment</button>
          <button data-action="triggerError" class="err-btn">Trigger Error</button>
          <button data-action="clearError" class="clear-btn">Clear Error</button>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(200)
    })

    it('safe computed renders correctly', async () => {
      const safeEl = testContainer.querySelector('.safe')
      expect(safeEl.textContent).toBe('Safe: 0')
    })

    it('dangerous computed works when not throwing', async () => {
      const dangerEl = testContainer.querySelector('.dangerous')
      expect(dangerEl.textContent).toBe('OK: 0')
    })

    it('safe computed still works after sibling throws', async () => {
      // Trigger the error (sets shouldThrow=true and increments counter to 1)
      testContainer.querySelector('.err-btn').click()
      await waitForUpdate(300)

      // Safe computed should reflect the new counter value
      const safeEl = testContainer.querySelector('.safe')
      expect(safeEl.textContent).toBe('Safe: 1')
    })

    it('actions still work after computed error', async () => {
      // Trigger error first
      testContainer.querySelector('.err-btn').click()
      await waitForUpdate(300)

      // Increment should still work (counter goes from 1 to 2)
      testContainer.querySelector('.inc-btn').click()
      await waitForUpdate(300)

      const counterEl = testContainer.querySelector('.counter')
      expect(counterEl.textContent).toBe('2')
    })

    it('computed recovers after error condition clears', async () => {
      // Trigger error (counter becomes 1, shouldThrow = true)
      testContainer.querySelector('.err-btn').click()
      await waitForUpdate(300)

      // Increment (counter becomes 2, still throwing)
      testContainer.querySelector('.inc-btn').click()
      await waitForUpdate(300)

      // Clear error (shouldThrow = false, counter becomes 3)
      testContainer.querySelector('.clear-btn').click()
      await waitForUpdate(300)

      const recoveredEl = testContainer.querySelector('.dangerous')
      expect(recoveredEl.textContent).toBe('OK: 3')
    })
  })
})
