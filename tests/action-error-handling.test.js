/**
 * WildflowerJS Action Error Handling Test Suite - Vitest Browser Mode
 *
 * Tests that action handler errors are caught gracefully and do not crash
 * the framework, leave components broken, or affect sibling components.
 *
 * Converted from test-cases/scenarios/action-throws.html
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Action Error Handling', () => {
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

  describe('Action throws - UI stays interactive', () => {
    beforeEach(async () => {
      wildflower.component('action-error-comp', {
        state: {
          counter: 0,
          status: 'ok'
        },
        safeAction() {
          this.state.counter++
          this.state.status = 'safe action fired'
        },
        dangerousAction() {
          this.state.status = 'about to throw'
          throw new Error('Intentional action error!')
        },
        anotherSafeAction() {
          this.state.counter += 10
          this.state.status = 'another safe action fired'
        }
      })

      wildflower.component('sibling-action-comp', {
        state: { sibCount: 0 },
        sibIncrement() {
          this.state.sibCount++
        }
      })

      testContainer.innerHTML = `
        <div data-component="action-error-comp">
          <span data-bind="counter" class="counter"></span>
          <span data-bind="status" class="status"></span>
          <button data-action="safeAction" class="safe-btn">Safe</button>
          <button data-action="dangerousAction" class="danger-btn">Dangerous</button>
          <button data-action="anotherSafeAction" class="safe-btn-2">Another Safe</button>
        </div>
        <div data-component="sibling-action-comp">
          <span data-bind="sibCount" class="sib-count"></span>
          <button data-action="sibIncrement" class="sib-btn">Sibling Increment</button>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(200)
    })

    it('safe action works before error', async () => {
      testContainer.querySelector('.safe-btn').click()
      await waitForUpdate(200)

      const counterEl = testContainer.querySelector('.counter')
      expect(counterEl.textContent).toBe('1')
    })

    it('dangerous action throws without crashing the page', async () => {
      // Click the dangerous button — framework should catch the error
      let pageCrashed = false
      try {
        testContainer.querySelector('.danger-btn').click()
        await waitForUpdate(200)
      } catch (e) {
        pageCrashed = true
      }

      // If we reach here, the error was handled (either caught or rethrown safely)
      expect(pageCrashed).toBe(false)
    })

    it('safe action works after error in another action', async () => {
      // First trigger the safe action
      testContainer.querySelector('.safe-btn').click()
      await waitForUpdate(200)

      // Now trigger the error
      try {
        testContainer.querySelector('.danger-btn').click()
      } catch (e) { /* framework may rethrow */ }
      await waitForUpdate(200)

      // Safe action should still work
      testContainer.querySelector('.safe-btn').click()
      await waitForUpdate(200)

      const counterEl = testContainer.querySelector('.counter')
      expect(parseInt(counterEl.textContent)).toBeGreaterThanOrEqual(2)
    })

    it('sibling component unaffected by error in other component', async () => {
      // Trigger error in the first component
      try {
        testContainer.querySelector('.danger-btn').click()
      } catch (e) { /* framework may rethrow */ }
      await waitForUpdate(200)

      // Sibling component should still work
      testContainer.querySelector('.sib-btn').click()
      await waitForUpdate(200)

      const sibEl = testContainer.querySelector('.sib-count')
      expect(sibEl.textContent).toBe('1')
    })

    it('component works after 5 consecutive action errors', async () => {
      // First do one safe action to set counter to 1
      testContainer.querySelector('.safe-btn').click()
      await waitForUpdate(200)

      // Trigger 5 consecutive errors
      for (let i = 0; i < 5; i++) {
        try {
          testContainer.querySelector('.danger-btn').click()
        } catch (e) { /* framework may rethrow */ }
      }
      await waitForUpdate(200)

      // Safe action should still work after repeated errors
      testContainer.querySelector('.safe-btn').click()
      await waitForUpdate(200)

      const counterEl = testContainer.querySelector('.counter')
      expect(parseInt(counterEl.textContent)).toBeGreaterThanOrEqual(2)
    })

    it('another safe action also works after error', async () => {
      // Safe action first
      testContainer.querySelector('.safe-btn').click()
      await waitForUpdate(200)

      // Trigger error
      try {
        testContainer.querySelector('.danger-btn').click()
      } catch (e) { /* framework may rethrow */ }
      await waitForUpdate(200)

      // Another safe action (adds 10)
      testContainer.querySelector('.safe-btn-2').click()
      await waitForUpdate(200)

      const counterEl = testContainer.querySelector('.counter')
      expect(parseInt(counterEl.textContent)).toBeGreaterThanOrEqual(11)
    })
  })
})
