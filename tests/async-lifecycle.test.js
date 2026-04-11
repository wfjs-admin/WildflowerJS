/**
 * WildflowerJS Async Lifecycle Hooks Test Suite - Vitest Browser Mode
 *
 * Tests for async/await behavior in component lifecycle methods.
 * Covers async init(), async destroy(), and async data fetching patterns.
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

describe('Async Lifecycle Hooks', () => {
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

  describe('Async Init', () => {
    it('should support async init method', async () => {
      let initCompleted = false

      testContainer.innerHTML = `
        <div data-component="async-init-basic">
          <div id="status" data-bind="status"></div>
        </div>
      `

      wildflower.component('async-init-basic', {
        state: {
          status: 'loading'
        },
        async init() {
          await new Promise(resolve => setTimeout(resolve, 50))
          this.state.status = 'loaded'
          initCompleted = true
        }
      })

      wildflower.scan()

      // Wait for async init to complete
      await waitForUpdate(100)
      await waitForCompleteRender()

      expect(initCompleted).toBe(true)
      expect(testContainer.querySelector('#status').textContent).toBe('loaded')
    })

    it('should handle async data fetching simulation in init', async () => {
      testContainer.innerHTML = `
        <div data-component="async-fetch-init">
          <div id="loading" data-show="loading">Loading...</div>
          <div id="data" data-show="!loading" data-bind="data"></div>
        </div>
      `

      wildflower.component('async-fetch-init', {
        state: {
          loading: true,
          data: ''
        },
        async init() {
          // Simulate API call
          await new Promise(resolve => setTimeout(resolve, 50))
          this.state.data = 'Fetched Data'
          this.state.loading = false
        }
      })

      wildflower.scan()
      await waitForUpdate(100)
      await waitForCompleteRender()

      expect(testContainer.querySelector('#data').textContent).toBe('Fetched Data')
    })

    it('should handle async init with multiple await points', async () => {
      const steps = []

      testContainer.innerHTML = `
        <div data-component="async-multi-await">
          <div id="step" data-bind="step"></div>
        </div>
      `

      wildflower.component('async-multi-await', {
        state: {
          step: 0
        },
        async init() {
          steps.push('start')
          this.state.step = 1

          await new Promise(resolve => setTimeout(resolve, 20))
          steps.push('after-first-await')
          this.state.step = 2

          await new Promise(resolve => setTimeout(resolve, 20))
          steps.push('after-second-await')
          this.state.step = 3
        }
      })

      wildflower.scan()
      await waitForUpdate(100)
      await waitForCompleteRender()

      expect(steps).toContain('start')
      expect(steps).toContain('after-first-await')
      expect(steps).toContain('after-second-await')
      expect(testContainer.querySelector('#step').textContent).toBe('3')
    })

    it('should handle async init error gracefully', async () => {
      let errorCaught = false

      testContainer.innerHTML = `
        <div data-component="async-init-error">
          <div id="status" data-bind="status"></div>
        </div>
      `

      wildflower.component('async-init-error', {
        state: {
          status: 'loading'
        },
        async init() {
          try {
            await new Promise((_, reject) => setTimeout(() => reject(new Error('Test error')), 20))
          } catch (e) {
            errorCaught = true
            this.state.status = 'error'
          }
        }
      })

      wildflower.scan()
      await waitForUpdate(100)
      await waitForCompleteRender()

      expect(errorCaught).toBe(true)
      expect(testContainer.querySelector('#status').textContent).toBe('error')
    })

    it('should handle async init with state updates triggering DOM changes', async () => {
      testContainer.innerHTML = `
        <div data-component="async-init-dom">
          <ul data-list="items">
            <template><li data-bind="name"></li></template>
          </ul>
        </div>
      `

      wildflower.component('async-init-dom', {
        state: {
          items: []
        },
        async init() {
          await new Promise(resolve => setTimeout(resolve, 30))
          this.state.items = [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' },
            { id: 3, name: 'Item 3' }
          ]
        }
      })

      wildflower.scan()
      await waitForUpdate(100)
      await waitForCompleteRender()

      const items = testContainer.querySelectorAll('li')
      expect(items.length).toBe(3)
      expect(items[0].textContent).toBe('Item 1')
    })
  })

  describe('Async Destroy', () => {
    it('should support async destroy method', async () => {
      let destroyCompleted = false

      testContainer.innerHTML = `
        <div data-component="async-destroy-basic">
          <div data-bind="value"></div>
        </div>
      `

      wildflower.component('async-destroy-basic', {
        state: {
          value: 'test'
        },
        async destroy() {
          await new Promise(resolve => setTimeout(resolve, 30))
          destroyCompleted = true
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="async-destroy-basic"]')
      const instanceId = component.dataset.componentId

      // Destroy the component
      wildflower.destroyComponent(instanceId)
      await waitForUpdate(100)

      expect(destroyCompleted).toBe(true)
    })

    it('should handle async cleanup in destroy', async () => {
      const cleanupSteps = []

      testContainer.innerHTML = `
        <div data-component="async-cleanup">
          <div data-bind="status"></div>
        </div>
      `

      wildflower.component('async-cleanup', {
        state: {
          status: 'active'
        },
        async destroy() {
          cleanupSteps.push('cleanup-start')
          await new Promise(resolve => setTimeout(resolve, 20))
          cleanupSteps.push('resource-1-cleaned')
          await new Promise(resolve => setTimeout(resolve, 20))
          cleanupSteps.push('resource-2-cleaned')
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const component = testContainer.querySelector('[data-component="async-cleanup"]')
      const instanceId = component.dataset.componentId

      wildflower.destroyComponent(instanceId)
      await waitForUpdate(100)

      expect(cleanupSteps).toContain('cleanup-start')
      expect(cleanupSteps).toContain('resource-1-cleaned')
      expect(cleanupSteps).toContain('resource-2-cleaned')
    })
  })

  describe('Async Component Methods', () => {
    it('should support async action handlers', async () => {
      let actionResult = null

      testContainer.innerHTML = `
        <div data-component="async-action">
          <button id="btn" data-action="asyncClick">Click</button>
          <div id="result" data-bind="result"></div>
        </div>
      `

      wildflower.component('async-action', {
        state: {
          result: 'waiting'
        },
        async asyncClick() {
          this.state.result = 'processing'
          await new Promise(resolve => setTimeout(resolve, 30))
          this.state.result = 'done'
          actionResult = 'completed'
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      // Click the button
      const btn = testContainer.querySelector('#btn')
      btn.click()
      await waitForUpdate(100)
      await waitForCompleteRender()

      expect(actionResult).toBe('completed')
      expect(testContainer.querySelector('#result').textContent).toBe('done')
    })

    it('should handle async action with loading state pattern', async () => {
      testContainer.innerHTML = `
        <div data-component="async-loading-action">
          <button id="submit" data-action="submit" data-bind-disabled="loading">Submit</button>
          <div id="status" data-bind="status"></div>
        </div>
      `

      wildflower.component('async-loading-action', {
        state: {
          loading: false,
          status: 'idle'
        },
        async submit() {
          this.state.loading = true
          this.state.status = 'submitting'

          await new Promise(resolve => setTimeout(resolve, 30))

          this.state.loading = false
          this.state.status = 'submitted'
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      const btn = testContainer.querySelector('#submit')
      expect(btn.disabled).toBe(false)

      btn.click()
      await waitForUpdate(100)
      await waitForCompleteRender()

      expect(btn.disabled).toBe(false)
      expect(testContainer.querySelector('#status').textContent).toBe('submitted')
    })

    it('should handle async action errors', async () => {
      testContainer.innerHTML = `
        <div data-component="async-action-error">
          <button id="btn" data-action="riskyAction">Do Risky Thing</button>
          <div id="error" data-bind="error"></div>
        </div>
      `

      wildflower.component('async-action-error', {
        state: {
          error: ''
        },
        async riskyAction() {
          try {
            await new Promise((_, reject) => setTimeout(() => reject(new Error('Action failed')), 20))
          } catch (e) {
            this.state.error = e.message
          }
        }
      })

      wildflower.scan()
      await waitForCompleteRender()

      testContainer.querySelector('#btn').click()
      await waitForUpdate(100)
      await waitForCompleteRender()

      expect(testContainer.querySelector('#error').textContent).toBe('Action failed')
    })
  })

  describe('Async Data Fetching Patterns', () => {
    it('should handle simulated fetch with loading/error/data states', async () => {
      testContainer.innerHTML = `
        <div data-component="fetch-pattern">
          <div id="loading" data-show="loading">Loading...</div>
          <div id="error" data-show="error" data-bind="errorMessage"></div>
          <div id="data" data-show="!loading && !error" data-bind="data"></div>
        </div>
      `

      wildflower.component('fetch-pattern', {
        state: {
          loading: true,
          error: false,
          errorMessage: '',
          data: ''
        },
        async init() {
          try {
            // Simulate successful fetch
            await new Promise(resolve => setTimeout(resolve, 30))
            this.state.data = 'Success!'
          } catch (e) {
            this.state.error = true
            this.state.errorMessage = e.message
          } finally {
            this.state.loading = false
          }
        }
      })

      wildflower.scan()
      await waitForUpdate(100)
      await waitForCompleteRender()

      expect(testContainer.querySelector('#data').textContent).toBe('Success!')
    })

    it('should handle sequential async operations', async () => {
      const operationOrder = []

      testContainer.innerHTML = `
        <div data-component="sequential-async">
          <div id="status" data-bind="status"></div>
        </div>
      `

      wildflower.component('sequential-async', {
        state: {
          status: 'starting'
        },
        async init() {
          operationOrder.push('init-start')

          await this.fetchUserData()
          operationOrder.push('user-done')

          await this.fetchPreferences()
          operationOrder.push('prefs-done')

          this.state.status = 'complete'
        },
        async fetchUserData() {
          await new Promise(resolve => setTimeout(resolve, 20))
          operationOrder.push('user-fetched')
        },
        async fetchPreferences() {
          await new Promise(resolve => setTimeout(resolve, 20))
          operationOrder.push('prefs-fetched')
        }
      })

      wildflower.scan()
      await waitForUpdate(150)
      await waitForCompleteRender()

      expect(operationOrder).toEqual([
        'init-start',
        'user-fetched',
        'user-done',
        'prefs-fetched',
        'prefs-done'
      ])
      expect(testContainer.querySelector('#status').textContent).toBe('complete')
    })

    it('should handle parallel async operations with Promise.all', async () => {
      let results = []

      testContainer.innerHTML = `
        <div data-component="parallel-async">
          <div id="count" data-bind="count"></div>
        </div>
      `

      wildflower.component('parallel-async', {
        state: {
          count: 0
        },
        async init() {
          // Parallel fetch simulation
          const [data1, data2, data3] = await Promise.all([
            this.fetchData(1),
            this.fetchData(2),
            this.fetchData(3)
          ])

          results = [data1, data2, data3]
          this.state.count = results.length
        },
        async fetchData(id) {
          await new Promise(resolve => setTimeout(resolve, 20))
          return { id, value: `data-${id}` }
        }
      })

      wildflower.scan()
      await waitForUpdate(100)
      await waitForCompleteRender()

      expect(results.length).toBe(3)
      expect(testContainer.querySelector('#count').textContent).toBe('3')
    })

    it('should handle async retry pattern', async () => {
      let attempts = 0

      testContainer.innerHTML = `
        <div data-component="async-retry">
          <div id="status" data-bind="status"></div>
        </div>
      `

      wildflower.component('async-retry', {
        state: {
          status: 'retrying'
        },
        async init() {
          await this.fetchWithRetry(3)
        },
        async fetchWithRetry(maxRetries) {
          for (let i = 0; i < maxRetries; i++) {
            attempts++
            try {
              // Simulate failure on first 2 attempts
              if (attempts < 3) {
                throw new Error('Temporary failure')
              }
              this.state.status = 'success'
              return
            } catch (e) {
              if (i === maxRetries - 1) {
                this.state.status = 'failed'
              }
              await new Promise(resolve => setTimeout(resolve, 10))
            }
          }
        }
      })

      wildflower.scan()
      await waitForUpdate(150)
      await waitForCompleteRender()

      expect(attempts).toBe(3)
      expect(testContainer.querySelector('#status').textContent).toBe('success')
    })
  })

  describe('Async with Child Components', () => {
    it('should handle async init in parent and child', async () => {
      const initOrder = []

      testContainer.innerHTML = `
        <div data-component="async-parent">
          <div id="parent-status" data-bind="status"></div>
          <div data-component="async-child">
            <div id="child-status" data-bind="status"></div>
          </div>
        </div>
      `

      wildflower.component('async-parent', {
        state: { status: 'parent-loading' },
        async init() {
          initOrder.push('parent-init-start')
          await new Promise(resolve => setTimeout(resolve, 20))
          this.state.status = 'parent-ready'
          initOrder.push('parent-init-end')
        }
      })

      wildflower.component('async-child', {
        state: { status: 'child-loading' },
        async init() {
          initOrder.push('child-init-start')
          await new Promise(resolve => setTimeout(resolve, 20))
          this.state.status = 'child-ready'
          initOrder.push('child-init-end')
        }
      })

      wildflower.scan()
      await waitForUpdate(150)
      await waitForCompleteRender()

      expect(initOrder).toContain('parent-init-start')
      expect(initOrder).toContain('child-init-start')
      expect(testContainer.querySelector('#parent-status').textContent).toBe('parent-ready')
      expect(testContainer.querySelector('#child-status').textContent).toBe('child-ready')
    })
  })

  describe('Async Computed Properties', () => {
    it('should handle state updates from async operations affecting computed', async () => {
      testContainer.innerHTML = `
        <div data-component="async-computed">
          <div id="total" data-bind="computed:total"></div>
        </div>
      `

      wildflower.component('async-computed', {
        state: {
          items: []
        },
        computed: {
          total() {
            return this.state.items.reduce((sum, item) => sum + item.value, 0)
          }
        },
        async init() {
          await new Promise(resolve => setTimeout(resolve, 30))
          this.state.items = [
            { id: 1, value: 10 },
            { id: 2, value: 20 },
            { id: 3, value: 30 }
          ]
        }
      })

      wildflower.scan()
      await waitForUpdate(100)
      await waitForCompleteRender()

      expect(testContainer.querySelector('#total').textContent).toBe('60')
    })
  })

  // =========================================================================
  // C4: Destroy component before deferred init fires
  // =========================================================================
  describe('Destroy before deferred init', () => {
    it('does not call init() on a component destroyed before setTimeout fires', async () => {
      let initCalled = false

      wildflower.component('destroy-before-init', {
        state: { value: 1 },
        init() {
          initCalled = true
        }
      })

      testContainer.innerHTML = `
        <div data-component="destroy-before-init">
          <span data-bind="value"></span>
        </div>
      `

      // Scan registers the component — init is deferred via setTimeout(0)
      wildflower.scan(testContainer)

      // Destroy immediately, before the setTimeout fires
      const compEl = testContainer.querySelector('[data-component-id]')
      const compId = compEl.dataset.componentId
      expect(wildflower.componentInstances.has(compId)).toBe(true)
      wildflower.destroyComponent(compId)
      compEl.remove() // prevent MutationObserver re-scan
      expect(wildflower.componentInstances.has(compId)).toBe(false)

      // Wait for the setTimeout(0) to fire
      await waitForUpdate(50)

      expect(initCalled).toBe(false)
    })
  })
})
