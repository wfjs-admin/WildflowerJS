/**
 * WildflowerJS Async Error Handling Test Suite - Vitest Browser Mode
 *
 * Tests for async/await patterns and error handling in action methods.
 * Part of the test suite gap analysis coverage expansion.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, getDistMode, isMinifiedBuild} from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Async Error Handling', () => {
  let testContainer
  let wildflower
  let consoleErrorSpy

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower

    // Simple reset
    if (wildflower.componentDefinitions) {
      wildflower.componentDefinitions.clear()
    }
    if (wildflower.componentInstances) {
      wildflower.componentInstances.clear()
    }
    if (wildflower.storeManager && wildflower.storeManager._namedStores) {
      wildflower.storeManager._namedStores.clear()
    }

    // Clear template cache
    if (wildflower._templateCache) {
      if (wildflower._templateCache.general) wildflower._templateCache.general.clear()
      if (wildflower._templateCache.lists) wildflower._templateCache.lists.clear()
      if (wildflower._templateCache.compiled) wildflower._templateCache.compiled.clear()
      if (wildflower._templateCache.extracted) wildflower._templateCache.extracted.clear()
      if (wildflower._templateCache.fragmentPools) wildflower._templateCache.fragmentPools.clear()
      if (wildflower._templateCache.stats) wildflower._templateCache.stats.clear()
    }

    // Spy on console.error to capture error handling
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

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
    consoleErrorSpy.mockRestore()
  })

  describe('Async action methods', () => {
    it('should handle async action methods', async () => {
      testContainer.innerHTML = `
        <div data-component="async-action-test">
          <button id="load-btn" data-action="loadData">Load</button>
          <div id="status" data-bind="status"></div>
          <div id="data" data-bind="data"></div>
        </div>
      `

      wildflower.component('async-action-test', {
        state: {
          status: 'idle',
          data: ''
        },
        async loadData() {
          this.state.status = 'loading'
          await new Promise(resolve => setTimeout(resolve, 50))
          this.state.data = 'loaded data'
          this.state.status = 'complete'
        }
      })

      await waitForUpdate()

      const button = testContainer.querySelector('#load-btn')
      const status = testContainer.querySelector('#status')
      const data = testContainer.querySelector('#data')

      expect(status.textContent).toBe('idle')
      expect(data.textContent).toBe('')

      // Trigger async action and wait for full completion
      button.click()
      await waitForUpdate(150)

      // Final state should be complete with data
      expect(status.textContent).toBe('complete')
      expect(data.textContent).toBe('loaded data')
    })

    it('should handle multiple async calls in sequence', async () => {
      testContainer.innerHTML = `
        <div data-component="sequential-async-test">
          <button id="fetch-btn" data-action="fetchAll">Fetch All</button>
          <div id="results" data-bind="results"></div>
        </div>
      `

      wildflower.component('sequential-async-test', {
        state: {
          results: ''
        },
        async fetchAll() {
          const result1 = await this.fetchItem(1)
          const result2 = await this.fetchItem(2)
          const result3 = await this.fetchItem(3)
          this.state.results = [result1, result2, result3].join(',')
        },
        async fetchItem(id) {
          await new Promise(resolve => setTimeout(resolve, 20))
          return `item-${id}`
        }
      })

      await waitForUpdate()

      const button = testContainer.querySelector('#fetch-btn')
      const results = testContainer.querySelector('#results')

      expect(results.textContent).toBe('')

      button.click()
      await waitForUpdate(150)

      expect(results.textContent).toBe('item-1,item-2,item-3')
    })
  })

  describe('Error handling in sync actions', () => {
    it.skipIf(isMinifiedBuild())('should handle synchronous errors in action methods', async () => {
      testContainer.innerHTML = `
        <div data-component="sync-error-test">
          <button id="error-btn" data-action="throwError">Throw Error</button>
          <div id="status" data-bind="status"></div>
        </div>
      `

      wildflower.component('sync-error-test', {
        state: {
          status: 'ok'
        },
        throwError() {
          this.state.status = 'throwing'
          throw new Error('Sync error')
        }
      })

      await waitForUpdate()

      const button = testContainer.querySelector('#error-btn')
      const status = testContainer.querySelector('#status')

      expect(status.textContent).toBe('ok')

      // Trigger error action - framework should handle the error gracefully
      button.click()
      await waitForUpdate()

      // State should have been updated before error
      expect(status.textContent).toBe('throwing')

      // Framework should have logged the error
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('should continue working after sync error', async () => {
      testContainer.innerHTML = `
        <div data-component="recovery-test">
          <button id="error-btn" data-action="throwError">Error</button>
          <button id="normal-btn" data-action="normalAction">Normal</button>
          <div id="counter" data-bind="counter"></div>
        </div>
      `

      wildflower.component('recovery-test', {
        state: {
          counter: 0
        },
        throwError() {
          throw new Error('Test error')
        },
        normalAction() {
          this.state.counter++
        }
      })

      await waitForUpdate()

      const errorBtn = testContainer.querySelector('#error-btn')
      const normalBtn = testContainer.querySelector('#normal-btn')
      const counter = testContainer.querySelector('#counter')

      // Trigger error
      errorBtn.click()
      await waitForUpdate()

      // Should still be able to trigger other actions
      normalBtn.click()
      await waitForUpdate()
      expect(counter.textContent).toBe('1')

      normalBtn.click()
      await waitForUpdate()
      expect(counter.textContent).toBe('2')
    })
  })

  describe('Error handling in async actions', () => {
    it('should handle rejected promises in async actions', async () => {
      testContainer.innerHTML = `
        <div data-component="async-error-test">
          <button id="fetch-btn" data-action="fetchData">Fetch</button>
          <div id="status" data-bind="status"></div>
          <div id="error" data-bind="errorMessage"></div>
        </div>
      `

      wildflower.component('async-error-test', {
        state: {
          status: 'idle',
          errorMessage: ''
        },
        async fetchData() {
          this.state.status = 'loading'
          try {
            await this.simulateFailedFetch()
            this.state.status = 'success'
          } catch (error) {
            this.state.status = 'error'
            this.state.errorMessage = error.message
          }
        },
        async simulateFailedFetch() {
          await new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Network error')), 30)
          })
        }
      })

      await waitForUpdate()

      const button = testContainer.querySelector('#fetch-btn')
      const status = testContainer.querySelector('#status')
      const error = testContainer.querySelector('#error')

      expect(status.textContent).toBe('idle')

      // Trigger fetch and wait for full completion (including error handling)
      button.click()
      await waitForUpdate(150)

      // Final state should show error
      expect(status.textContent).toBe('error')
      expect(error.textContent).toBe('Network error')
    })

    it('should handle errors thrown in async actions with user error handling', async () => {
      testContainer.innerHTML = `
        <div data-component="throw-error-test">
          <button id="throw-btn" data-action="throwError">Throw</button>
          <div id="status" data-bind="status"></div>
        </div>
      `

      wildflower.component('throw-error-test', {
        state: {
          status: 'pending'
        },
        async throwError() {
          this.state.status = 'started'
          try {
            await this.riskyOperation()
          } catch (error) {
            this.state.status = 'error-caught'
          }
        },
        async riskyOperation() {
          throw new Error('Async error')
        }
      })

      await waitForUpdate()

      const button = testContainer.querySelector('#throw-btn')
      const status = testContainer.querySelector('#status')

      button.click()
      await waitForUpdate(100)

      // State should reflect error was caught by user's try-catch
      expect(status.textContent).toBe('error-caught')
    })
  })

  describe('Try-catch patterns in async actions', () => {
    it('should support try-catch-finally pattern', async () => {
      testContainer.innerHTML = `
        <div data-component="try-catch-test">
          <button id="action-btn" data-action="performAction">Action</button>
          <div id="log" data-bind="log"></div>
        </div>
      `

      wildflower.component('try-catch-test', {
        state: {
          log: ''
        },
        async performAction() {
          this.state.log = 'start,'
          try {
            await new Promise((_, reject) => setTimeout(() => reject(new Error('fail')), 20))
            this.state.log += 'success,'
          } catch (error) {
            this.state.log += 'caught,'
          } finally {
            this.state.log += 'finally'
          }
        }
      })

      await waitForUpdate()

      const button = testContainer.querySelector('#action-btn')
      const log = testContainer.querySelector('#log')

      button.click()
      await waitForUpdate(100)

      expect(log.textContent).toBe('start,caught,finally')
    })

    it('should support nested try-catch', async () => {
      testContainer.innerHTML = `
        <div data-component="nested-try-test">
          <button id="nested-btn" data-action="nestedTry">Nested</button>
          <div id="result" data-bind="result"></div>
        </div>
      `

      wildflower.component('nested-try-test', {
        state: {
          result: ''
        },
        async nestedTry() {
          try {
            try {
              await Promise.reject(new Error('inner'))
            } catch (innerError) {
              this.state.result = 'inner-caught,'
              throw new Error('rethrown')
            }
          } catch (outerError) {
            this.state.result += 'outer-caught'
          }
        }
      })

      await waitForUpdate()

      const button = testContainer.querySelector('#nested-btn')
      const result = testContainer.querySelector('#result')

      button.click()
      await waitForUpdate(50)

      expect(result.textContent).toBe('inner-caught,outer-caught')
    })
  })

  describe('Loading states and UI feedback', () => {
    it('should properly track loading state for async operations', async () => {
      testContainer.innerHTML = `
        <div data-component="loading-state-test">
          <button id="load-btn" data-action="loadItems">
            Load Items
          </button>
          <div id="item-count" data-bind="itemCount"></div>
          <div id="loading-status" data-bind="isLoading ? 'loading' : 'ready'"></div>
        </div>
      `

      wildflower.component('loading-state-test', {
        state: {
          isLoading: false,
          itemCount: 0
        },
        async loadItems() {
          this.state.isLoading = true
          await new Promise(resolve => setTimeout(resolve, 50))
          this.state.itemCount = 5
          this.state.isLoading = false
        }
      })

      await waitForUpdate()

      const button = testContainer.querySelector('#load-btn')
      const itemCount = testContainer.querySelector('#item-count')
      const loadingStatus = testContainer.querySelector('#loading-status')

      // Initially not loading
      expect(loadingStatus.textContent).toBe('ready')
      expect(itemCount.textContent).toBe('0')

      // Trigger load and wait for completion
      button.click()
      await waitForUpdate(150)

      // Should show final state after loading completes
      expect(loadingStatus.textContent).toBe('ready')
      expect(itemCount.textContent).toBe('5')
    })
  })

  describe('Computed properties with async data', () => {
    it('should update computed properties after async state change', async () => {
      testContainer.innerHTML = `
        <div data-component="async-computed-test">
          <button id="load-btn" data-action="loadPrices">Load</button>
          <div id="total" data-bind="computed:total"></div>
        </div>
      `

      wildflower.component('async-computed-test', {
        state: {
          prices: []
        },
        computed: {
          total() {
            return this.state.prices.reduce((sum, p) => sum + p, 0)
          }
        },
        async loadPrices() {
          await new Promise(resolve => setTimeout(resolve, 30))
          this.state.prices = [10, 20, 30]
        }
      })

      await waitForUpdate()

      const button = testContainer.querySelector('#load-btn')
      const total = testContainer.querySelector('#total')

      expect(total.textContent).toBe('0')

      button.click()
      await waitForUpdate(100)

      expect(total.textContent).toBe('60')
    })
  })

  describe('Concurrent async operations', () => {
    it('should handle multiple concurrent async actions', async () => {
      testContainer.innerHTML = `
        <div data-component="concurrent-test">
          <button id="btn1" data-action="action1">Action 1</button>
          <button id="btn2" data-action="action2">Action 2</button>
          <div id="log" data-bind="log"></div>
        </div>
      `

      wildflower.component('concurrent-test', {
        state: {
          log: ''
        },
        async action1() {
          this.state.log += '1-start,'
          await new Promise(resolve => setTimeout(resolve, 50))
          this.state.log += '1-end,'
        },
        async action2() {
          this.state.log += '2-start,'
          await new Promise(resolve => setTimeout(resolve, 25))
          this.state.log += '2-end,'
        }
      })

      await waitForUpdate()

      const btn1 = testContainer.querySelector('#btn1')
      const btn2 = testContainer.querySelector('#btn2')
      const log = testContainer.querySelector('#log')

      // Start both actions nearly simultaneously
      btn1.click()
      btn2.click()
      await waitForUpdate()

      // Both should have started
      expect(log.textContent).toContain('1-start')
      expect(log.textContent).toContain('2-start')

      await waitForUpdate(100)

      // Both should have completed (action2 finishes first due to shorter delay)
      expect(log.textContent).toContain('1-end')
      expect(log.textContent).toContain('2-end')
    })
  })

  describe('Timeout and abort patterns', () => {
    it('should handle operation timeout patterns', async () => {
      testContainer.innerHTML = `
        <div data-component="timeout-test">
          <button id="slow-btn" data-action="slowOperation">Slow</button>
          <div id="result" data-bind="result"></div>
        </div>
      `

      wildflower.component('timeout-test', {
        state: {
          result: ''
        },
        async slowOperation() {
          const timeout = 30
          const operation = new Promise(resolve => setTimeout(() => resolve('success'), 100))
          const timer = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout))

          try {
            this.state.result = await Promise.race([operation, timer])
          } catch (error) {
            this.state.result = 'timed out'
          }
        }
      })

      await waitForUpdate()

      const button = testContainer.querySelector('#slow-btn')
      const result = testContainer.querySelector('#result')

      button.click()
      await waitForUpdate(100)

      expect(result.textContent).toBe('timed out')
    })
  })
})
