/**
 * WildflowerJS Error Boundaries Comprehensive Test Suite - Vitest Browser Mode
 *
 * Additional error boundary tests NOT covered by error-boundaries.test.js.
 * Covers categories from the legacy errorBoundariesTestSuite.js:
 *   - Re-rendering after error recovery
 *   - State preservation after errors
 *   - Async/interaction error scenarios
 *   - Computed property edge cases
 *   - List context errors
 *   - Destroy lifecycle edge cases
 *
 * Migrated from tests/tests_to_convert/original/errorBoundariesTestSuite.js
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

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

describe('Error Boundaries - Comprehensive', () => {
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
    // Clean up global error handlers
    if (wildflower._globalErrorHandlers) {
      wildflower._globalErrorHandlers.length = 0
    }

    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  // ==========================================
  // Re-rendering After Error Recovery
  // ==========================================
  describe('Re-rendering After Error Recovery', () => {
    it('re-rendering after error works correctly', async () => {
      let shouldError = true

      testContainer.innerHTML = `
        <div data-component="rerender-error-test">
          <span data-bind="value" class="value-display"></span>
        </div>
      `

      wildflower.component('rerender-error-test', {
        state: {
          value: 'initial'
        },
        computed: {
          derived() {
            if (shouldError) {
              throw new Error('Computed error')
            }
            return this.state.value.toUpperCase()
          }
        },
        onError(error) {
          this.state.value = 'recovered'
          shouldError = false
          return true
        }
      })

      wildflower.scan()
      await waitForUpdate()

      const display = testContainer.querySelector('.value-display')
      // After error and recovery, should show recovered value
      expect(display.textContent).toBe('recovered')

      // Further updates should work
      const compEl = testContainer.querySelector('[data-component-id]')
      const instance = wildflower.componentInstances.get(compEl.dataset.componentId)
      instance.state.value = 'new value'

      await waitForUpdate()

      expect(display.textContent).toBe('new value')
    })
  })

  // ==========================================
  // State Preservation After Errors
  // ==========================================
  describe('State Preservation After Errors', () => {
    it('state is preserved after handled error', async () => {
      testContainer.innerHTML = `
        <div data-component="state-preserve-test">
          <span data-bind="importantData" class="data"></span>
          <span data-bind="counter" class="counter"></span>
        </div>
      `

      wildflower.component('state-preserve-test', {
        state: {
          importantData: 'preserved value',
          counter: 42
        },
        init() {
          // Set some state, then throw
          this.state.counter = 100
          throw new Error('Error after state change')
        },
        onError(error) {
          return true // Handle it
        }
      })

      wildflower.scan()
      await waitForUpdate()

      const compEl = testContainer.querySelector('[data-component-id]')
      const instance = wildflower.componentInstances.get(compEl.dataset.componentId)
      expect(instance.state.importantData).toBe('preserved value')
      expect(instance.state.counter).toBe(100)
    })
  })

  // ==========================================
  // Async / Interaction Error Scenarios
  // ==========================================
  describe('Async Error Scenarios', () => {
    it('error in action triggered by user interaction preserves state', async () => {
      let errorCaught = false
      let errorAction = null

      testContainer.innerHTML = `
        <div data-component="interaction-error-test">
          <button data-action="handleClick" class="click-btn">Click Me</button>
          <span data-bind="clicked" class="clicked-status"></span>
        </div>
      `

      wildflower.component('interaction-error-test', {
        state: { clicked: false },
        handleClick() {
          this.state.clicked = true
          throw new Error('Click handler error')
        },
        onError(error, context) {
          errorCaught = true
          errorAction = context?.methodName || context?.action
          return true
        }
      })

      wildflower.scan()
      await waitForUpdate()

      // Simulate click
      const btn = testContainer.querySelector('.click-btn')
      btn.click()
      await waitForUpdate()

      expect(errorCaught).toBe(true)
      expect(errorAction).toBe('handleClick')

      // State change before error should persist
      const compEl = testContainer.querySelector('[data-component-id]')
      const instance = wildflower.componentInstances.get(compEl.dataset.componentId)
      expect(instance.state.clicked).toBe(true)
    })

    it('errors in sequential actions are all caught', async () => {
      let errorCount = 0
      const errors = []

      testContainer.innerHTML = `
        <div data-component="sequential-errors-test">
          <button data-action="action1" class="btn1">1</button>
          <button data-action="action2" class="btn2">2</button>
          <button data-action="action3" class="btn3">3</button>
        </div>
      `

      wildflower.component('sequential-errors-test', {
        state: {},
        action1() {
          throw new Error('Error 1')
        },
        action2() {
          throw new Error('Error 2')
        },
        action3() {
          throw new Error('Error 3')
        },
        onError(error) {
          errorCount++
          errors.push(error.message)
          return true
        }
      })

      wildflower.scan()
      await waitForUpdate()

      testContainer.querySelector('.btn1').click()
      await waitForUpdate()
      testContainer.querySelector('.btn2').click()
      await waitForUpdate()
      testContainer.querySelector('.btn3').click()
      await waitForUpdate()

      expect(errorCount).toBe(3)
      expect(errors).toContain('Error 1')
      expect(errors).toContain('Error 2')
      expect(errors).toContain('Error 3')
    })
  })

  // ==========================================
  // Computed Property Edge Cases
  // ==========================================
  describe('Computed Property Edge Cases', () => {
    it('computed property error with dependency chain', async () => {
      let errorCaught = false

      testContainer.innerHTML = `
        <div data-component="computed-chain-error">
          <span data-bind="derived1" class="result"></span>
        </div>
      `

      wildflower.component('computed-chain-error', {
        state: {
          base: null
        },
        computed: {
          derived1() {
            return this.state.base.value // Will throw when base is null
          }
        },
        onError(error, context) {
          errorCaught = true
          return true
        }
      })

      wildflower.scan()
      await waitForUpdate()

      expect(errorCaught).toBe(true)
    })

    it('computed recovers when dependency becomes valid', async () => {
      let errorCount = 0

      testContainer.innerHTML = `
        <div data-component="computed-recovery-test">
          <span data-bind="result" class="processed"></span>
          <button data-action="tryComputed" class="try-btn">Try</button>
        </div>
      `

      wildflower.component('computed-recovery-test', {
        state: {
          data: null,
          result: ''
        },
        computed: {
          processed() {
            if (!this.state.data) {
              throw new Error('Data is null')
            }
            return this.state.data.toUpperCase()
          }
        },
        onError(error) {
          errorCount++
          return true
        },
        tryComputed() {
          // Manually trigger computed evaluation after data is set
          try {
            const result = this.computed.processed
            this.state.result = result
          } catch (e) {
            // Will be caught by onError
          }
        }
      })

      wildflower.scan()
      await waitForUpdate()

      // Initial error should have been caught
      expect(errorCount).toBeGreaterThanOrEqual(1)

      // Now fix the data and trigger evaluation
      const compEl = testContainer.querySelector('[data-component-id]')
      const instance = wildflower.componentInstances.get(compEl.dataset.componentId)
      instance.state.data = 'hello'
      await waitForUpdate()

      // Trigger computed evaluation via action
      testContainer.querySelector('.try-btn').click()
      await waitForUpdate()

      const display = testContainer.querySelector('.processed')
      expect(display.textContent).toBe('HELLO')
    })
  })

  // ==========================================
  // List Context Errors
  // ==========================================
  describe('List Context Errors', () => {
    it('error in list item action is caught by parent', async () => {
      let errorCaught = false

      testContainer.innerHTML = `
        <div data-component="list-error-test">
          <ul data-list="items">
            <template>
              <li>
                <span data-bind="name"></span>
                <button data-action="removeItem" class="remove-btn">Remove</button>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('list-error-test', {
        state: {
          items: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' },
            { id: 3, name: 'Item 3' }
          ]
        },
        removeItem(event, element) {
          throw new Error('Remove failed')
        },
        onError(error, context) {
          errorCaught = true
          return true
        }
      })

      wildflower.scan()
      await waitForUpdate(100)

      // Click a remove button
      const removeButtons = testContainer.querySelectorAll('.remove-btn')
      if (removeButtons.length > 1) {
        removeButtons[1].click()
        await waitForUpdate()
      }

      expect(errorCaught).toBe(true)
    })

    it('component continues working after action error in list context', async () => {
      let errorCount = 0

      testContainer.innerHTML = `
        <div data-component="action-recovery-test">
          <button data-action="failingAction" class="fail-btn">Fail</button>
          <button data-action="increment" class="inc-btn">Increment</button>
          <span data-bind="counter" class="counter"></span>
          <span data-bind="lastAction" class="last-action"></span>
        </div>
      `

      wildflower.component('action-recovery-test', {
        state: {
          counter: 0,
          lastAction: ''
        },
        failingAction() {
          throw new Error('Action failed')
        },
        increment() {
          this.state.counter++
          this.state.lastAction = 'incremented'
        },
        onError(error) {
          errorCount++
          this.state.lastAction = 'error'
          return true
        }
      })

      wildflower.scan()
      await waitForUpdate(100)

      // Verify component initialized
      const compEl = testContainer.querySelector('[data-component-id]')
      const instance = wildflower.componentInstances.get(compEl.dataset.componentId)
      expect(instance).toBeDefined()
      expect(instance.state.counter).toBe(0)

      // Trigger an error first
      testContainer.querySelector('.fail-btn').click()
      await waitForUpdate()
      expect(errorCount).toBe(1)
      expect(instance.state.lastAction).toBe('error')

      // Now increment - should still work after error
      testContainer.querySelector('.inc-btn').click()
      await waitForUpdate()

      expect(instance.state.counter).toBe(1)
      expect(instance.state.lastAction).toBe('incremented')
    })
  })

  // ==========================================
  // Destroy Lifecycle Edge Cases
  // ==========================================
  describe('Destroy Lifecycle Edge Cases', () => {
    it('error during conditional hide does not break parent component', async () => {
      let destroyErrorCaught = false

      wildflower.component('conditional-destroy-test', {
        state: {
          showChild: true
        },
        hideChild() {
          this.state.showChild = false
        }
      })

      wildflower.component('destroy-error-child', {
        state: {},
        destroy() {
          throw new Error('Destroy error')
        },
        onError(error) {
          destroyErrorCaught = true
          return true
        }
      })

      testContainer.innerHTML = `
        <div data-component="conditional-destroy-test">
          <button data-action="hideChild" class="hide-btn">Hide</button>
          <div data-render="showChild">
            <div data-component="destroy-error-child" class="child-comp">
              <span>Child content</span>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Verify child exists
      const child = testContainer.querySelector('.child-comp')
      expect(child).toBeDefined()

      // Hide child (triggers destroy)
      testContainer.querySelector('.hide-btn').click()
      await waitForUpdate(100)

      // Parent should still be functional
      const parentEl = testContainer.querySelector('[data-component="conditional-destroy-test"]')
      const parentId = parentEl.dataset.componentId
      const parent = wildflower.componentInstances.get(parentId)
      expect(parent.state.showChild).toBe(false)
    })

    it('multiple components can be destroyed with errors via data-render', async () => {
      let destroy1Called = false
      let destroy2Called = false

      wildflower.component('render-destroy-parent', {
        state: { showChildren: true },
        hideAll() {
          this.state.showChildren = false
        },
        onError(error) {
          return true
        }
      })

      wildflower.component('render-destroy-child-1', {
        state: {},
        destroy() {
          destroy1Called = true
          throw new Error('Destroy 1 error')
        }
      })

      wildflower.component('render-destroy-child-2', {
        state: {},
        destroy() {
          destroy2Called = true
          throw new Error('Destroy 2 error')
        }
      })

      testContainer.innerHTML = `
        <div data-component="render-destroy-parent">
          <button data-action="hideAll" class="hide-all">Hide All</button>
          <div data-render="showChildren">
            <div data-component="render-destroy-child-1"></div>
            <div data-component="render-destroy-child-2"></div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(100)

      // Verify children are initialized
      const child1 = wildflower.getComponent('render-destroy-child-1')
      const child2 = wildflower.getComponent('render-destroy-child-2')
      expect(child1).toBeDefined()
      expect(child2).toBeDefined()

      // Hide children via data-render (should trigger destroy)
      testContainer.querySelector('.hide-all').click()
      await waitForUpdate(150)

      expect(destroy1Called).toBe(true)
      expect(destroy2Called).toBe(true)
    })
  })
})
