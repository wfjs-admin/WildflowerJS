/**
 * WildflowerJS Lifecycle Hooks Test Suite - Vitest Browser Mode
 *
 * Tests for extended lifecycle hooks: beforeInit, beforeUpdate, onUpdate, beforeDestroy
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 100) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to wait for complete render cycle
async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

describe('Lifecycle Hooks', () => {
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

  // ============================================================================
  // beforeInit Hook Tests
  // ============================================================================
  describe('beforeInit Hook', () => {
    it('beforeInit is called before bindings are processed', async () => {
      const callOrder = []
      let bindingsProcessedBeforeInit = false

      wildflower.component('test-before-init', {
        state: { count: 0 },
        beforeInit() {
          callOrder.push('beforeInit')
          // Check if the binding element has been updated yet
          const bindEl = this.element.querySelector('[data-bind="count"]')
          bindingsProcessedBeforeInit = bindEl && bindEl.textContent === '0'
        },
        init() {
          callOrder.push('init')
        }
      })

      testContainer.innerHTML = `
        <div data-component="test-before-init">
          <span data-bind="count"></span>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      expect(callOrder).toEqual(['beforeInit', 'init'])
      // beforeInit should be called before bindings update the DOM
      expect(bindingsProcessedBeforeInit).toBe(false)
    })

    it('beforeInit has access to this.element', async () => {
      let elementAccess = false

      wildflower.component('test-element-access', {
        state: {},
        beforeInit() {
          elementAccess = this.element instanceof HTMLElement
        }
      })

      testContainer.innerHTML = `
        <div data-component="test-element-access"></div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      expect(elementAccess).toBe(true)
    })

    it('beforeInit has access to this.state', async () => {
      let stateAccess = null

      wildflower.component('test-state-access', {
        state: { value: 'test' },
        beforeInit() {
          stateAccess = this.state.value
        }
      })

      testContainer.innerHTML = `
        <div data-component="test-state-access"></div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      expect(stateAccess).toBe('test')
    })
  })

  // ============================================================================
  // beforeUpdate / onUpdate Hook Tests
  // ============================================================================
  describe('beforeUpdate and onUpdate Hooks', () => {
    it('beforeUpdate is called when state changes', async () => {
      let beforeUpdateCalled = false

      wildflower.component('test-before-update', {
        state: { count: 0 },
        beforeUpdate() {
          beforeUpdateCalled = true
        },
        increment() {
          this.state.count++
        }
      })

      testContainer.innerHTML = `
        <div data-component="test-before-update">
          <span data-bind="count"></span>
          <button data-action="increment">+</button>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const button = testContainer.querySelector('button')
      button.click()
      await waitForUpdate(50)

      expect(beforeUpdateCalled).toBe(true)
    })

    it('onUpdate is called after state changes', async () => {
      let onUpdateCalled = false

      wildflower.component('test-on-update', {
        state: { count: 0 },
        onUpdate() {
          onUpdateCalled = true
        },
        increment() {
          this.state.count++
        }
      })

      testContainer.innerHTML = `
        <div data-component="test-on-update">
          <span data-bind="count"></span>
          <button data-action="increment">+</button>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const button = testContainer.querySelector('button')
      button.click()
      await waitForUpdate(150) // Wait longer for async render + RAF

      expect(onUpdateCalled).toBe(true)
    })

    it('beforeUpdate is called before onUpdate', async () => {
      const callOrder = []

      wildflower.component('test-update-order', {
        state: { value: 'a' },
        beforeUpdate() {
          callOrder.push('beforeUpdate')
        },
        onUpdate() {
          callOrder.push('onUpdate')
        },
        change() {
          this.state.value = 'b'
        }
      })

      testContainer.innerHTML = `
        <div data-component="test-update-order">
          <button data-action="change">Change</button>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const button = testContainer.querySelector('button')
      button.click()
      await waitForUpdate(150)

      expect(callOrder[0]).toBe('beforeUpdate')
      expect(callOrder[1]).toBe('onUpdate')
    })

    it('multiple different state changes trigger multiple hook calls', async () => {
      let beforeUpdateCount = 0
      let onUpdateCount = 0

      wildflower.component('test-multiple-updates', {
        state: { count: 0, name: 'initial' },
        beforeUpdate() {
          beforeUpdateCount++
        },
        onUpdate() {
          onUpdateCount++
        },
        updateBoth() {
          // Change two DIFFERENT paths to ensure both trigger hooks
          // (same-path changes in the same microtask may be batched)
          this.state.count++
          this.state.name = 'updated'
        }
      })

      testContainer.innerHTML = `
        <div data-component="test-multiple-updates">
          <button data-action="updateBoth">Update</button>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const button = testContainer.querySelector('button')
      button.click()
      await waitForUpdate(200)

      // Each different path change should trigger hooks
      expect(beforeUpdateCount).toBe(2)
      expect(onUpdateCount).toBe(2)
    })
  })

  // ============================================================================
  // beforeDestroy Hook Tests
  // ============================================================================
  describe('beforeDestroy Hook', () => {
    it('beforeDestroy is called before destroy', async () => {
      const callOrder = []

      wildflower.component('test-before-destroy', {
        state: {},
        beforeDestroy() {
          callOrder.push('beforeDestroy')
        },
        destroy() {
          callOrder.push('destroy')
        }
      })

      testContainer.innerHTML = `
        <div data-component="test-before-destroy" id="destroy-target"></div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // Get the component instance
      const element = testContainer.querySelector('#destroy-target')
      const componentId = element.dataset.componentId

      // Destroy the component
      wildflower.destroyComponent(componentId)
      await waitForUpdate(50)

      expect(callOrder).toEqual(['beforeDestroy', 'destroy'])
    })

    it('beforeDestroy has access to component state and element', async () => {
      let elementAccess = false
      let stateAccess = null

      wildflower.component('test-destroy-access', {
        state: { value: 'test-value' },
        beforeDestroy() {
          elementAccess = this.element instanceof HTMLElement
          stateAccess = this.state.value
        }
      })

      testContainer.innerHTML = `
        <div data-component="test-destroy-access" id="destroy-access-target"></div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const element = testContainer.querySelector('#destroy-access-target')
      const componentId = element.dataset.componentId

      wildflower.destroyComponent(componentId)
      await waitForUpdate(50)

      expect(elementAccess).toBe(true)
      expect(stateAccess).toBe('test-value')
    })
  })

  // ============================================================================
  // Complete Lifecycle Order Tests
  // ============================================================================
  describe('Complete Lifecycle Order', () => {
    it('hooks are called in correct order during full lifecycle', async () => {
      const callOrder = []

      wildflower.component('test-full-lifecycle', {
        state: { count: 0 },
        beforeInit() {
          callOrder.push('beforeInit')
        },
        init() {
          callOrder.push('init')
        },
        beforeUpdate() {
          callOrder.push('beforeUpdate')
        },
        onUpdate() {
          callOrder.push('onUpdate')
        },
        beforeDestroy() {
          callOrder.push('beforeDestroy')
        },
        destroy() {
          callOrder.push('destroy')
        },
        increment() {
          this.state.count++
        }
      })

      testContainer.innerHTML = `
        <div data-component="test-full-lifecycle" id="lifecycle-target">
          <button data-action="increment">+</button>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // Should have called beforeInit and init
      expect(callOrder).toContain('beforeInit')
      expect(callOrder).toContain('init')
      expect(callOrder.indexOf('beforeInit')).toBeLessThan(callOrder.indexOf('init'))

      // Trigger an update
      const button = testContainer.querySelector('button')
      button.click()
      await waitForUpdate(150)

      // Should have called beforeUpdate and onUpdate
      expect(callOrder).toContain('beforeUpdate')
      expect(callOrder).toContain('onUpdate')

      // Destroy the component
      const element = testContainer.querySelector('#lifecycle-target')
      const componentId = element.dataset.componentId
      wildflower.destroyComponent(componentId)
      await waitForUpdate(50)

      // Should have called beforeDestroy and destroy
      expect(callOrder).toContain('beforeDestroy')
      expect(callOrder).toContain('destroy')
      expect(callOrder.indexOf('beforeDestroy')).toBeLessThan(callOrder.indexOf('destroy'))
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================
  describe('Edge Cases', () => {
    it('missing hooks do not cause errors', async () => {
      wildflower.component('test-no-hooks', {
        state: { count: 0 },
        increment() {
          this.state.count++
        }
        // No lifecycle hooks defined
      })

      testContainer.innerHTML = `
        <div data-component="test-no-hooks" id="no-hooks-target">
          <button data-action="increment">+</button>
        </div>
      `

      // Should not throw
      wildflower.scan()
      await waitForCompleteRender()

      const button = testContainer.querySelector('button')
      button.click()
      await waitForUpdate(50)

      const element = testContainer.querySelector('#no-hooks-target')
      const componentId = element.dataset.componentId
      wildflower.destroyComponent(componentId)
      await waitForUpdate(50)

      // If we get here without error, the test passes
      expect(true).toBe(true)
    })

    it('errors in hooks are handled gracefully', async () => {
      let initCalled = false

      wildflower.component('test-hook-error', {
        state: {},
        beforeInit() {
          throw new Error('Test error in beforeInit')
        },
        init() {
          initCalled = true
        }
      })

      testContainer.innerHTML = `
        <div data-component="test-hook-error"></div>
      `

      // Should not throw, error should be caught
      wildflower.scan()
      await waitForCompleteRender()

      // init should still be called despite beforeInit error
      expect(initCalled).toBe(true)
    })
  })
})
