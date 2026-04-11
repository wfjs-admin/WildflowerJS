/**
 * WildflowerJS Error Boundaries Test Suite - Vitest Browser Mode
 *
 * Comprehensive tests for error boundary functionality including:
 * - Error catching in lifecycle hooks (init, destroy, actions, computed)
 * - Error propagation through component hierarchy
 * - Global error handlers
 * - Fallback UI display
 * - Reset/retry mechanism
 *
 * Migrated from errorBoundariesTestSuite.js
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, isMinifiedBuild } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Error Boundaries', () => {
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
  // CATEGORY 1: Basic Error Catching
  // ==========================================
  describe('Basic Error Catching', () => {
    it('catches error in component init()', async () => {
      let errorCaught = false
      let caughtError = null

      testContainer.innerHTML = `
        <div data-component="init-error-test">
          <span data-bind="message"></span>
        </div>
      `

      wildflower.component('init-error-test', {
        state: { message: 'Hello' },
        init() {
          throw new Error('Init failed!')
        },
        onError(error) {
          errorCaught = true
          caughtError = error
          return true
        }
      })

      wildflower.scan()
      await waitForUpdate()

      expect(errorCaught).toBe(true)
      expect(caughtError.message).toContain('Init failed')
    })

    it('catches error in component action', async () => {
      let errorCaught = false
      let caughtError = null

      testContainer.innerHTML = `
        <div data-component="action-error-test">
          <button data-action="triggerError" class="error-trigger">Click me</button>
        </div>
      `

      wildflower.component('action-error-test', {
        state: {},
        triggerError() {
          throw new Error('Action error!')
        },
        onError(error) {
          errorCaught = true
          caughtError = error
          return true
        }
      })

      wildflower.scan()
      await waitForUpdate()

      const button = testContainer.querySelector('.error-trigger')
      button.click()
      await waitForUpdate()

      expect(errorCaught).toBe(true)
      expect(caughtError.message).toContain('Action error')
    })

    it('catches error in computed property', async () => {
      let errorCaught = false

      testContainer.innerHTML = `
        <div data-component="computed-error-test">
          <span data-bind="computedValue" class="computed-display"></span>
        </div>
      `

      wildflower.component('computed-error-test', {
        state: { value: null },
        computed: {
          computedValue() {
            return this.state.value.toUpperCase()
          }
        },
        onError(error) {
          errorCaught = true
          this.state.fallbackValue = 'Error occurred'
          return true
        }
      })

      wildflower.scan()
      await waitForUpdate()

      expect(errorCaught).toBe(true)
    })

    it('catches error in destroy lifecycle', async () => {
      let errorCaught = false

      testContainer.innerHTML = `
        <div data-component="destroy-error-test" id="destroy-component">
          <span>Will be destroyed</span>
        </div>
      `

      wildflower.component('destroy-error-test', {
        state: {},
        destroy() {
          throw new Error('Destroy error!')
        },
        onError(error) {
          errorCaught = true
          return true
        }
      })

      wildflower.scan()
      await waitForUpdate()

      const instance = wildflower.getComponent('destroy-error-test')
      if (instance) {
        wildflower.destroyComponent(instance.id)
      }
      await waitForUpdate()

      expect(errorCaught).toBe(true)
    })
  })

  // ==========================================
  // CATEGORY 2: Error Propagation
  // ==========================================
  describe('Error Propagation', () => {
    it('error bubbles up to parent component', async () => {
      let parentCaughtError = false

      wildflower.component('parent-boundary', {
        state: {},
        onError(error) {
          parentCaughtError = true
          return true
        }
      })

      wildflower.component('child-throws', {
        state: { message: 'Child' },
        init() {
          throw new Error('Child error!')
        }
      })

      testContainer.innerHTML = `
        <div data-component="parent-boundary">
          <div data-component="child-throws">
            <span data-bind="message"></span>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      expect(parentCaughtError).toBe(true)
    })

    it('error stops at component with onError handler', async () => {
      let middleCaughtError = false
      let topCaughtError = false

      wildflower.component('top-boundary', {
        state: {},
        onError(error) {
          topCaughtError = true
          return true
        }
      })

      wildflower.component('middle-boundary', {
        state: {},
        onError(error) {
          middleCaughtError = true
          return true
        }
      })

      wildflower.component('deep-child-throws', {
        state: {},
        init() {
          throw new Error('Deep child error!')
        }
      })

      testContainer.innerHTML = `
        <div data-component="top-boundary">
          <div data-component="middle-boundary">
            <div data-component="deep-child-throws">
              <span>Deep child</span>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      expect(middleCaughtError).toBe(true)
      expect(topCaughtError).toBe(false)
    })

    it('global handler catches unhandled errors', async () => {
      let globalHandlerCalled = false
      let globalError = null

      wildflower.component('unhandled-error-test', {
        state: {},
        init() {
          throw new Error('Unhandled error!')
        }
      })

      testContainer.innerHTML = `
        <div data-component="unhandled-error-test">
          <span>Will throw</span>
        </div>
      `

      const handler = (error, component) => {
        globalHandlerCalled = true
        globalError = error
      }
      wildflower.onError(handler)

      wildflower.scan()
      await waitForUpdate()

      expect(globalHandlerCalled).toBe(true)
      expect(globalError.message).toContain('Unhandled')
    })

    it('returning false from onError propagates error', async () => {
      let childHandlerCalled = false
      let parentHandlerCalled = false

      wildflower.component('propagate-parent', {
        state: {},
        onError(error) {
          parentHandlerCalled = true
          return true
        }
      })

      wildflower.component('propagate-child', {
        state: {},
        init() {
          throw new Error('Propagated error!')
        },
        onError(error) {
          childHandlerCalled = true
          return false
        }
      })

      testContainer.innerHTML = `
        <div data-component="propagate-parent">
          <div data-component="propagate-child">
            <span>Child</span>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      expect(childHandlerCalled).toBe(true)
      expect(parentHandlerCalled).toBe(true)
    })
  })

  // ==========================================
  // CATEGORY 3: Recovery
  // ==========================================
  describe('Recovery', () => {
    it('component can recover from error state', async () => {
      let attempts = 0

      testContainer.innerHTML = `
        <div data-component="recovery-test">
          <span data-bind="status" class="status-display"></span>
          <button data-action="retry" class="retry-button">Retry</button>
        </div>
      `

      wildflower.component('recovery-test', {
        state: { status: 'loading' },
        init() {
          attempts++
          if (attempts < 2) {
            throw new Error('First attempt fails')
          }
          this.state.status = 'success'
        },
        retry() {
          this.state.status = 'retrying'
          if (attempts >= 1) {
            this.state.status = 'success'
          }
        },
        onError(error) {
          this.state.status = 'error'
          return true
        }
      })

      wildflower.scan()
      await waitForUpdate()

      const status = testContainer.querySelector('.status-display')
      expect(status.textContent).toBe('error')

      const retryButton = testContainer.querySelector('.retry-button')
      retryButton.click()
      await waitForUpdate()

      expect(status.textContent).toBe('success')
    })

    it('handles multiple errors in same component', async () => {
      let errorCount = 0

      testContainer.innerHTML = `
        <div data-component="multi-error-test">
          <button data-action="error1" class="error1">Error 1</button>
          <button data-action="error2" class="error2">Error 2</button>
          <span data-bind="errorCount" class="error-count"></span>
        </div>
      `

      wildflower.component('multi-error-test', {
        state: { errorCount: 0 },
        error1() {
          throw new Error('Error type 1')
        },
        error2() {
          throw new Error('Error type 2')
        },
        onError(error) {
          errorCount++
          this.state.errorCount = errorCount
          return true
        }
      })

      wildflower.scan()
      await waitForUpdate()

      testContainer.querySelector('.error1').click()
      await waitForUpdate()

      testContainer.querySelector('.error2').click()
      await waitForUpdate()

      expect(errorCount).toBe(2)
      expect(testContainer.querySelector('.error-count').textContent).toBe('2')
    })
  })

  // ==========================================
  // CATEGORY 4: Error Context
  // ==========================================
  describe('Error Context', () => {
    it('error handler receives component reference', async () => {
      let receivedComponent = null

      testContainer.innerHTML = `
        <div data-component="context-component-test">
          <span>Test</span>
        </div>
      `

      wildflower.component('context-component-test', {
        state: { myData: 'test data' },
        init() {
          throw new Error('Context test error')
        },
        onError(error, context) {
          receivedComponent = context?.component || this
          return true
        }
      })

      wildflower.scan()
      await waitForUpdate()

      expect(receivedComponent).toBeDefined()
      expect(receivedComponent.state.myData).toBe('test data')
    })

    it('error handler receives error stack trace', async () => {
      let receivedError = null

      testContainer.innerHTML = `
        <div data-component="stack-trace-test">
          <span>Test</span>
        </div>
      `

      wildflower.component('stack-trace-test', {
        state: {},
        init() {
          throw new Error('Stack trace test')
        },
        onError(error) {
          receivedError = error
          return true
        }
      })

      wildflower.scan()
      await waitForUpdate()

      expect(receivedError).toBeDefined()
      expect(receivedError.stack).toBeDefined()
      expect(receivedError.stack).toContain('init')
    })

    it('error handler receives triggering action name', async () => {
      let receivedContext = null

      testContainer.innerHTML = `
        <div data-component="action-context-test">
          <button data-action="myAction" class="action-button">Click</button>
        </div>
      `

      wildflower.component('action-context-test', {
        state: {},
        myAction() {
          throw new Error('Action context test')
        },
        onError(error, context) {
          receivedContext = context
          return true
        }
      })

      wildflower.scan()
      await waitForUpdate()

      testContainer.querySelector('.action-button').click()
      await waitForUpdate()

      expect(receivedContext).toBeDefined()
      expect(receivedContext.action || receivedContext.methodName).toBe('myAction')
    })
  })

  // ==========================================
  // CATEGORY 5: Fallback UI
  // ==========================================
  describe('Fallback UI', () => {
    it('displays fallback content on error', async () => {
      testContainer.innerHTML = `
        <div data-component="fallback-test" data-error-fallback=".error-fallback">
          <div class="normal-content">
            <span data-bind="message"></span>
          </div>
          <div class="error-fallback" style="display:none;">
            <p>Something went wrong!</p>
          </div>
        </div>
      `

      wildflower.component('fallback-test', {
        state: { message: 'Hello' },
        init() {
          throw new Error('Show fallback')
        }
      })

      wildflower.scan()
      await waitForUpdate()

      const fallbackContent = testContainer.querySelector('.error-fallback')
      expect(getComputedStyle(fallbackContent).display).toBe('block')
    })

    it('fallback can be a template reference', async () => {
      testContainer.innerHTML = `
        <div data-component="template-fallback-test" data-error-fallback="#error-template">
          <span data-bind="value"></span>
        </div>
        <template id="error-template">
          <div class="error-from-template">
            <h3>Error!</h3>
            <p>Please try again later.</p>
          </div>
        </template>
      `

      wildflower.component('template-fallback-test', {
        state: { value: 'Test' },
        init() {
          throw new Error('Use template fallback')
        }
      })

      wildflower.scan()
      await waitForUpdate()

      expect(testContainer.querySelector('.error-from-template')).toBeDefined()
    })

    it('fallback receives error information', async () => {
      testContainer.innerHTML = `
        <div data-component="error-info-fallback-test">
          <span data-bind="message" class="message"></span>
          <div class="error-display" data-show="hasError">
            <span data-bind="errorMessage" class="error-message"></span>
          </div>
        </div>
      `

      wildflower.component('error-info-fallback-test', {
        state: {
          message: 'Loading...',
          hasError: false,
          errorMessage: ''
        },
        init() {
          throw new Error('Specific error message')
        },
        onError(error) {
          this.state.hasError = true
          this.state.errorMessage = error.message
          return true
        }
      })

      wildflower.scan()
      await waitForUpdate()

      const errorMessage = testContainer.querySelector('.error-message')
      expect(errorMessage.textContent).toBe('Specific error message')
    })
  })

  // ==========================================
  // CATEGORY 6: Edge Cases
  // ==========================================
  describe('Edge Cases', () => {
    it('grandparent catches grandchild error (3+ levels)', async () => {
      let grandparentCaught = false

      wildflower.component('error-grandparent', {
        state: {},
        onError(error) {
          grandparentCaught = true
          return true
        }
      })

      wildflower.component('error-parent-passthrough', {
        state: {}
      })

      wildflower.component('error-grandchild', {
        state: {},
        init() {
          throw new Error('Grandchild error')
        }
      })

      testContainer.innerHTML = `
        <div data-component="error-grandparent">
          <div data-component="error-parent-passthrough">
            <div data-component="error-grandchild">
              <span>Grandchild</span>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      expect(grandparentCaught).toBe(true)
    })

    it('sibling component errors are isolated', async () => {
      let sibling1Initialized = false
      let sibling2Error = null

      wildflower.component('sibling-container', {
        state: {}
      })

      wildflower.component('good-sibling', {
        state: { status: 'ok' },
        init() {
          sibling1Initialized = true
        }
      })

      wildflower.component('bad-sibling', {
        state: {},
        init() {
          throw new Error('Bad sibling error')
        },
        onError(error) {
          sibling2Error = error
          return true
        }
      })

      testContainer.innerHTML = `
        <div data-component="sibling-container">
          <div data-component="good-sibling" class="good"></div>
          <div data-component="bad-sibling" class="bad"></div>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      expect(sibling1Initialized).toBe(true)
      expect(sibling2Error).toBeDefined()
    })

    it('undefined return from onError is treated as handled', async () => {
      let parentCaught = false

      wildflower.component('undefined-return-parent', {
        state: {},
        onError(error) {
          parentCaught = true
          return true
        }
      })

      wildflower.component('undefined-return-child', {
        state: {},
        init() {
          throw new Error('Test error')
        },
        onError(error) {
          // No explicit return - undefined
        }
      })

      testContainer.innerHTML = `
        <div data-component="undefined-return-parent">
          <div data-component="undefined-return-child"></div>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      expect(parentCaught).toBe(false)
    })

    it('error in onError handler is caught gracefully', async () => {
      let handlerAttempts = 0

      wildflower.component('bad-handler-comp', {
        state: {},
        init() {
          throw new Error('Initial error')
        },
        onError(error) {
          handlerAttempts++
          // Only throw once to avoid infinite recursion
          if (handlerAttempts === 1) {
            throw new Error('Handler error')
          }
          return true
        }
      })

      testContainer.innerHTML = `
        <div data-component="bad-handler-comp"></div>
      `

      let threw = false
      try {
        wildflower.scan()
        await waitForUpdate()
      } catch (e) {
        threw = true
      }

      // Framework should not crash even with broken handler
      expect(threw).toBe(false)
      // Handler should have been called (at least attempted)
      expect(handlerAttempts).toBeGreaterThanOrEqual(1)
    })
  })

  // ==========================================
  // CATEGORY 7: Multiple Global Handlers
  // ==========================================
  describe('Multiple Global Handlers', () => {
    it('multiple global handlers all receive errors', async () => {
      let handler1Called = false
      let handler2Called = false
      let handler3Called = false

      wildflower.component('multi-handler-test', {
        state: {},
        init() {
          throw new Error('Test error')
        }
      })

      testContainer.innerHTML = `
        <div data-component="multi-handler-test"></div>
      `

      wildflower.onError(() => { handler1Called = true })
      wildflower.onError(() => { handler2Called = true })
      wildflower.onError(() => { handler3Called = true })

      wildflower.scan()
      await waitForUpdate()

      expect(handler1Called).toBe(true)
      expect(handler2Called).toBe(true)
      expect(handler3Called).toBe(true)
    })

    it('offError correctly removes handler', async () => {
      let handler1Called = false
      let handler2Called = false

      const handler1 = () => { handler1Called = true }
      const handler2 = () => { handler2Called = true }

      wildflower.component('off-error-test', {
        state: {},
        init() {
          throw new Error('Test error')
        }
      })

      testContainer.innerHTML = `
        <div data-component="off-error-test"></div>
      `

      wildflower.onError(handler1)
      wildflower.onError(handler2)
      wildflower.offError(handler1)

      wildflower.scan()
      await waitForUpdate()

      expect(handler1Called).toBe(false)
      expect(handler2Called).toBe(true)
    })

    it('duplicate handler registration is prevented', async () => {
      let callCount = 0

      const handler = () => { callCount++ }

      wildflower.component('duplicate-handler-test', {
        state: {},
        init() {
          throw new Error('Test error')
        }
      })

      testContainer.innerHTML = `
        <div data-component="duplicate-handler-test"></div>
      `

      wildflower.onError(handler)
      wildflower.onError(handler)
      wildflower.onError(handler)

      wildflower.scan()
      await waitForUpdate()

      expect(callCount).toBe(1)
    })
  })

  // ==========================================
  // CATEGORY 8: Reset/Retry Mechanism
  // ==========================================
  describe('Reset/Retry Mechanism', () => {
    it('resetError() clears error state and restores UI', async () => {
      wildflower.component('reset-basic-test', {
        state: { message: 'Hello' },
        init() {
          throw new Error('Init error')
        },
        onError(error) {
          return true
        }
      })

      testContainer.innerHTML = `
        <div data-component="reset-basic-test" data-error-fallback=".fallback">
          <div class="normal-content">
            <span data-bind="message"></span>
          </div>
          <div class="fallback" style="display:none;">
            <p>Error occurred!</p>
            <button data-action="resetError" class="reset-btn">Retry</button>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      const instance = wildflower.getComponent('reset-basic-test')
      expect(instance._hasError).toBe(true)

      const fallback = testContainer.querySelector('.fallback')
      expect(getComputedStyle(fallback).display).toBe('block')

      instance.resetError()
      await waitForUpdate()

      expect(instance._hasError).toBe(false)
      expect(getComputedStyle(fallback).display).toBe('none')

      const normal = testContainer.querySelector('.normal-content')
      expect(normal.style.display).toBe('')
    })

    it('resetError() can be triggered via data-action', async () => {
      wildflower.component('reset-action-test', {
        state: { status: 'loading' },
        init() {
          throw new Error('Init failed')
        },
        onError(error) {
          this.state.status = 'error'
          return true
        }
      })

      testContainer.innerHTML = `
        <div data-component="reset-action-test" data-error-fallback=".error-ui">
          <div class="main-content">
            <span data-bind="status"></span>
          </div>
          <div class="error-ui" style="display:none;">
            <p>Something went wrong</p>
            <button data-action="resetError" class="retry-action">Retry</button>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      const instance = wildflower.getComponent('reset-action-test')
      expect(instance._hasError).toBe(true)

      const retryBtn = testContainer.querySelector('.retry-action')
      retryBtn.click()
      await waitForUpdate()

      expect(instance._hasError).toBe(false)
    })

    it('resetError() calls onReset callback', async () => {
      let resetCalled = false
      let resetOrder = []

      wildflower.component('reset-callback-test', {
        state: { count: 0 },
        init() {
          throw new Error('Error')
        },
        onError(error) {
          resetOrder.push('error')
          return true
        },
        onReset() {
          resetCalled = true
          resetOrder.push('reset')
          this.state.count = 0
        }
      })

      testContainer.innerHTML = `
        <div data-component="reset-callback-test" data-error-fallback=".fallback">
          <div class="content"><span data-bind="count"></span></div>
          <div class="fallback" style="display:none;">Error</div>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      const instance = wildflower.getComponent('reset-callback-test')
      instance.resetError()
      await waitForUpdate()

      expect(resetCalled).toBe(true)
      expect(resetOrder).toEqual(['error', 'reset'])
    })

    it('resetError({ rerunInit: true }) re-runs init', async () => {
      let initCount = 0
      let shouldFail = true

      wildflower.component('reset-reinit-test', {
        state: { status: 'pending' },
        init() {
          initCount++
          if (shouldFail) {
            throw new Error('First attempt fails')
          }
          this.state.status = 'success'
        },
        onError(error) {
          this.state.status = 'error'
          return true
        }
      })

      testContainer.innerHTML = `
        <div data-component="reset-reinit-test" data-error-fallback=".error">
          <span data-bind="status" class="status"></span>
          <div class="error" style="display:none;">Error</div>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      const instance = wildflower.getComponent('reset-reinit-test')
      expect(initCount).toBe(1)
      expect(instance.state.status).toBe('error')

      shouldFail = false
      instance.resetError({ rerunInit: true })
      await waitForUpdate()

      expect(initCount).toBe(2)
      expect(instance.state.status).toBe('success')
    })

    it('resetError() returns false if not in error state', async () => {
      wildflower.component('reset-no-error-test', {
        state: { value: 'ok' }
      })

      testContainer.innerHTML = `
        <div data-component="reset-no-error-test">
          <span data-bind="value"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      const instance = wildflower.getComponent('reset-no-error-test')
      const result = instance.resetError()

      expect(result).toBe(false)
    })

    it('_lastError property stores the error', async () => {
      wildflower.component('last-error-test', {
        state: {},
        init() {
          throw new Error('Specific error message 12345')
        },
        onError(error) {
          return true
        }
      })

      testContainer.innerHTML = `
        <div data-component="last-error-test" data-error-fallback=".error">
          <div class="content">Content</div>
          <div class="error" style="display:none;">Error</div>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      const instance = wildflower.getComponent('last-error-test')
      expect(instance._lastError).toBeDefined()
      expect(instance._lastError.message).toContain('12345')

      instance.resetError()
      expect(instance._lastError).toBeNull()
    })

    it('component can retry and succeed after transient error', async () => {
      let attempts = 0

      wildflower.component('transient-error-test', {
        state: {
          loaded: false,
          data: null
        },
        init() {
          this.loadData()
        },
        loadData() {
          attempts++
          if (attempts < 3) {
            throw new Error(`Attempt ${attempts} failed`)
          }
          this.state.loaded = true
          this.state.data = 'Successfully loaded!'
        },
        retry() {
          this.resetError()
          this.loadData()
        },
        onError(error) {
          this.state.loaded = false
          return true
        }
      })

      testContainer.innerHTML = `
        <div data-component="transient-error-test" data-error-fallback=".error-state">
          <div class="success-state" data-show="loaded">
            <span data-bind="data" class="data"></span>
          </div>
          <div class="error-state" style="display:none;">
            <p>Load failed</p>
            <button data-action="retry" class="retry-btn">Retry</button>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      const instance = wildflower.getComponent('transient-error-test')
      expect(instance._hasError).toBe(true)
      expect(attempts).toBe(1)

      // First retry (will fail)
      testContainer.querySelector('.retry-btn').click()
      await waitForUpdate()
      expect(attempts).toBe(2)
      expect(instance._hasError).toBe(true)

      // Second retry (will succeed)
      testContainer.querySelector('.retry-btn').click()
      await waitForUpdate()
      expect(attempts).toBe(3)
      expect(instance._hasError).toBe(false)
      expect(instance.state.loaded).toBe(true)
      expect(instance.state.data).toBe('Successfully loaded!')
    })
  })

  // ==========================================
  // C3: Destroy before context system init
  // ==========================================
  describe('Destroy before context system init', () => {
    it.skipIf(isMinifiedBuild())('destroyComponent does not throw when context system is not initialized', async () => {
      wildflower.component('early-destroy-test', {
        state: { value: 1 }
      })

      testContainer.innerHTML = `
        <div data-component="early-destroy-test">
          <span data-bind="value"></span>
        </div>
      `
      wildflower.scan(testContainer)
      await waitForUpdate(100)

      const compEl = testContainer.querySelector('[data-component-id]')
      const compId = compEl.dataset.componentId

      // Simulate pre-init state by clearing context system
      const savedInit = wildflower._contextSystemInitialized
      const savedRegistry = wildflower._contextRegistry
      wildflower._contextSystemInitialized = false
      wildflower._contextRegistry = undefined

      // Should not throw
      expect(() => {
        wildflower._notifyComponentDestroyed(compId)
      }).not.toThrow()

      // Restore
      wildflower._contextSystemInitialized = savedInit
      wildflower._contextRegistry = savedRegistry
    })
  })
})
