/**
 * WildflowerJS Expression Evaluation Test Suite - Vitest Browser Mode
 *
 * Tests for expression evaluation in data-show, data-render, and data-bind-class.
 * Migrated from unitTestSuite.js Expression Evaluation section.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, isMinifiedBuild} from './helpers/load-framework.js'

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

describe('Expression Evaluation', () => {
  let testContainer
  let wildflower

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

    // CRITICAL: Clear template cache to prevent cross-test contamination
    if (wildflower._templateCache) {
      if (wildflower._templateCache.general) wildflower._templateCache.general.clear()
      if (wildflower._templateCache.lists) wildflower._templateCache.lists.clear()
      if (wildflower._templateCache.compiled) wildflower._templateCache.compiled.clear()
      if (wildflower._templateCache.extracted) wildflower._templateCache.extracted.clear()
      if (wildflower._templateCache.fragmentPools) wildflower._templateCache.fragmentPools.clear()
      if (wildflower._templateCache.stats) wildflower._templateCache.stats.clear()
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

  // --- data-show expression tests ---

  describe('data-show with expressions', () => {
    it.skipIf(isMinifiedBuild())('greater-than comparison (count > 0)', async () => {
      wildflower.component('expr-gt-test', {
        state: {
          count: 0
        }
      })

      testContainer.innerHTML = `
        <div data-component="expr-gt-test">
          <div id="positive-indicator" data-show="count > 0">Has items</div>
          <span data-bind="count"></span>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const el = testContainer.querySelector('[data-component="expr-gt-test"]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)
      const indicator = testContainer.querySelector('#positive-indicator')

      // Verify conditional context was created for expression
      const registry = wildflower._contextRegistry
      const conditionalContext = registry.getContextForElement(indicator)
      expect(conditionalContext).toBeDefined()
      expect(conditionalContext.type).toBe('conditional')
      expect(conditionalContext.path).toBe('count > 0')

      // Initially count is 0, should be hidden
      expect(indicator.style.display).toBe('none')

      // Update count to positive
      instance.state.count = 5
      await waitForCompleteRender()

      expect(indicator.style.display).not.toBe('none')

      // Set back to 0
      instance.state.count = 0
      await waitForCompleteRender()

      expect(indicator.style.display).toBe('none')
    })

    it('greater-than-or-equal comparison (count >= 5)', async () => {
      wildflower.component('expr-gte-test', {
        state: {
          count: 3
        }
      })

      testContainer.innerHTML = `
        <div data-component="expr-gte-test">
          <div id="threshold-indicator" data-show="count >= 5">Threshold reached</div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const el = testContainer.querySelector('[data-component="expr-gte-test"]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)
      const indicator = testContainer.querySelector('#threshold-indicator')

      // Initially count is 3, should be hidden
      expect(indicator.style.display).toBe('none')

      // Update to exactly 5
      instance.state.count = 5
      await waitForCompleteRender()

      expect(indicator.style.display).not.toBe('none')

      // Update to 4
      instance.state.count = 4
      await waitForCompleteRender()

      expect(indicator.style.display).toBe('none')
    })

    it('less-than comparison (count < 10)', async () => {
      wildflower.component('expr-lt-test', {
        state: {
          count: 5
        }
      })

      testContainer.innerHTML = `
        <div data-component="expr-lt-test">
          <div id="under-limit" data-show="count < 10">Under limit</div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const el = testContainer.querySelector('[data-component="expr-lt-test"]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)
      const indicator = testContainer.querySelector('#under-limit')

      // Initially count is 5, should be visible
      expect(indicator.style.display).not.toBe('none')

      // Update to 10
      instance.state.count = 10
      await waitForCompleteRender()

      expect(indicator.style.display).toBe('none')
    })

    it('equality comparison (status === "active")', async () => {
      wildflower.component('expr-eq-test', {
        state: {
          status: 'pending'
        }
      })

      testContainer.innerHTML = `
        <div data-component="expr-eq-test">
          <div id="active-badge" data-show="status === 'active'">Active</div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const el = testContainer.querySelector('[data-component="expr-eq-test"]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)
      const badge = testContainer.querySelector('#active-badge')

      // Initially status is 'pending', should be hidden
      expect(badge.style.display).toBe('none')

      // Update to 'active'
      instance.state.status = 'active'
      await waitForCompleteRender()

      expect(badge.style.display).not.toBe('none')
    })

    it('inequality comparison (status !== "disabled")', async () => {
      wildflower.component('expr-neq-test', {
        state: {
          status: 'active'
        }
      })

      testContainer.innerHTML = `
        <div data-component="expr-neq-test">
          <div id="enabled-content" data-show="status !== 'disabled'">Enabled</div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const el = testContainer.querySelector('[data-component="expr-neq-test"]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)
      const content = testContainer.querySelector('#enabled-content')

      // Initially status is 'active', should be visible
      expect(content.style.display).not.toBe('none')

      // Update to 'disabled'
      instance.state.status = 'disabled'
      await waitForCompleteRender()

      expect(content.style.display).toBe('none')
    })

    it.skipIf(isMinifiedBuild())('logical AND (isReady && hasData)', async () => {
      wildflower.component('expr-and-test', {
        state: {
          isReady: false,
          hasData: false
        }
      })

      testContainer.innerHTML = `
        <div data-component="expr-and-test">
          <div id="show-content" data-show="isReady && hasData">Content ready</div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const el = testContainer.querySelector('[data-component="expr-and-test"]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)
      const content = testContainer.querySelector('#show-content')

      // Verify conditional context was created for AND expression
      const registry = wildflower._contextRegistry
      const andContext = registry.getContextForElement(content)
      expect(andContext).toBeDefined()
      expect(andContext.type).toBe('conditional')
      expect(andContext.path).toBe('isReady && hasData')

      // Both false, should be hidden
      expect(content.style.display).toBe('none')

      // Only isReady true
      instance.state.isReady = true
      await waitForCompleteRender()
      expect(content.style.display).toBe('none')

      // Both true
      instance.state.hasData = true
      await waitForCompleteRender()
      expect(content.style.display).not.toBe('none')
    })

    it('logical OR (isAdmin || isModerator)', async () => {
      wildflower.component('expr-or-test', {
        state: {
          isAdmin: false,
          isModerator: false
        }
      })

      testContainer.innerHTML = `
        <div data-component="expr-or-test">
          <div id="mod-panel" data-show="isAdmin || isModerator">Moderator Panel</div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const el = testContainer.querySelector('[data-component="expr-or-test"]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)
      const panel = testContainer.querySelector('#mod-panel')

      // Both false, should be hidden
      expect(panel.style.display).toBe('none')

      // Only isModerator true
      instance.state.isModerator = true
      await waitForCompleteRender()
      expect(panel.style.display).not.toBe('none')

      // Reset and try isAdmin
      instance.state.isModerator = false
      instance.state.isAdmin = true
      await waitForCompleteRender()
      expect(panel.style.display).not.toBe('none')
    })
  })

  // --- data-render expression tests ---

  describe('data-render with expressions', () => {
    it.skipIf(isMinifiedBuild())('greater-than comparison (count > 0)', async () => {
      wildflower.component('render-gt-test', {
        state: {
          count: 0
        }
      })

      testContainer.innerHTML = `
        <div data-component="render-gt-test">
          <div id="render-indicator" data-render="count > 0">Has items</div>
          <span data-bind="count"></span>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // Initially count is 0, should NOT be in DOM
      expect(testContainer.querySelector('#render-indicator')).toBeNull()

      const el = testContainer.querySelector('[data-component="render-gt-test"]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)

      // Update count to positive
      instance.state.count = 5
      await waitForCompleteRender()

      expect(testContainer.querySelector('#render-indicator')).not.toBeNull()

      // Set back to 0
      instance.state.count = 0
      await waitForCompleteRender()

      expect(testContainer.querySelector('#render-indicator')).toBeNull()
    })

    it('equality comparison (status === "active")', async () => {
      wildflower.component('render-eq-test', {
        state: {
          status: 'pending'
        }
      })

      testContainer.innerHTML = `
        <div data-component="render-eq-test">
          <div id="render-badge" data-render="status === 'active'">Active Badge</div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // Initially status is 'pending', should not be in DOM
      expect(testContainer.querySelector('#render-badge')).toBeNull()

      const el = testContainer.querySelector('[data-component="render-eq-test"]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)

      // Update to 'active'
      instance.state.status = 'active'
      await waitForCompleteRender()

      expect(testContainer.querySelector('#render-badge')).not.toBeNull()

      // Update to something else
      instance.state.status = 'disabled'
      await waitForCompleteRender()

      expect(testContainer.querySelector('#render-badge')).toBeNull()
    })

    it.skipIf(isMinifiedBuild())('logical AND (isReady && hasData)', async () => {
      wildflower.component('render-and-test', {
        state: {
          isReady: false,
          hasData: false
        }
      })

      testContainer.innerHTML = `
        <div data-component="render-and-test">
          <div id="render-content" data-render="isReady && hasData">Content ready</div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // Both false, should not be in DOM
      expect(testContainer.querySelector('#render-content')).toBeNull()

      const el = testContainer.querySelector('[data-component="render-and-test"]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)

      // Only isReady true
      instance.state.isReady = true
      await waitForCompleteRender()
      expect(testContainer.querySelector('#render-content')).toBeNull()

      // Both true
      instance.state.hasData = true
      await waitForCompleteRender()
      expect(testContainer.querySelector('#render-content')).not.toBeNull()

      // Set one false
      instance.state.isReady = false
      await waitForCompleteRender()
      expect(testContainer.querySelector('#render-content')).toBeNull()
    })

    it('logical OR (isAdmin || isModerator)', async () => {
      wildflower.component('render-or-test', {
        state: {
          isAdmin: false,
          isModerator: false
        }
      })

      testContainer.innerHTML = `
        <div data-component="render-or-test">
          <div id="render-panel" data-render="isAdmin || isModerator">Moderator Panel</div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // Both false, should not be in DOM
      expect(testContainer.querySelector('#render-panel')).toBeNull()

      const el = testContainer.querySelector('[data-component="render-or-test"]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)

      // Only isModerator true
      instance.state.isModerator = true
      await waitForCompleteRender()
      expect(testContainer.querySelector('#render-panel')).not.toBeNull()

      // Reset and try isAdmin
      instance.state.isModerator = false
      await waitForCompleteRender()
      expect(testContainer.querySelector('#render-panel')).toBeNull()

      instance.state.isAdmin = true
      await waitForCompleteRender()
      expect(testContainer.querySelector('#render-panel')).not.toBeNull()
    })
  })

  // --- data-bind-class expression tests ---

  describe('data-bind-class with expressions', () => {
    it('ternary expression', async () => {
      wildflower.component('class-ternary-test', {
        state: {
          isActive: false
        }
      })

      testContainer.innerHTML = `
        <div data-component="class-ternary-test">
          <div id="class-target" data-bind-class="isActive ? 'active' : 'inactive'">Target</div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const el = testContainer.querySelector('[data-component="class-ternary-test"]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)
      const target = testContainer.querySelector('#class-target')

      // Initially inactive
      expect(target.className).toBe('inactive')

      // Activate
      instance.state.isActive = true
      await waitForCompleteRender()

      expect(target.className).toBe('active')
    })

    it('simple property binding', async () => {
      wildflower.component('class-simple-test', {
        state: {
          statusClass: 'pending'
        }
      })

      testContainer.innerHTML = `
        <div data-component="class-simple-test">
          <div id="status-el" data-bind-class="statusClass">Status</div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const el = testContainer.querySelector('[data-component="class-simple-test"]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)
      const statusEl = testContainer.querySelector('#status-el')

      // Initial class
      expect(statusEl.className).toBe('pending')

      // Update status
      instance.state.statusClass = 'completed'
      await waitForCompleteRender()

      expect(statusEl.className).toBe('completed')
    })
  })

  // --- Edge cases ---

  describe('Edge cases', () => {
    it('malformed expression handles gracefully', async () => {
      wildflower.component('expr-malformed-test', {
        state: {
          count: 5
        }
      })

      // Intentionally malformed expression - should not crash
      testContainer.innerHTML = `
        <div data-component="expr-malformed-test">
          <div id="safe-content" data-show="count >=>= 5">Should handle gracefully</div>
          <div id="normal-content" data-bind="count"></div>
        </div>
      `

      // Should not throw
      let didNotCrash = true
      try {
        wildflower.scan()
        await waitForCompleteRender()
      } catch (e) {
        didNotCrash = false
      }

      expect(didNotCrash).toBe(true)

      // Normal content should still work
      const normalContent = testContainer.querySelector('#normal-content')
      expect(normalContent.textContent).toBe('5')
    })

    it('undefined property returns falsy', async () => {
      wildflower.component('expr-undefined-test', {
        state: {
          // intentionally no 'missingProp'
          existingProp: true
        }
      })

      testContainer.innerHTML = `
        <div data-component="expr-undefined-test">
          <div id="undefined-check" data-show="missingProp">Should be hidden</div>
          <div id="existing-check" data-show="existingProp">Should be visible</div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const undefinedEl = testContainer.querySelector('#undefined-check')
      const existingEl = testContainer.querySelector('#existing-check')

      // Undefined property should result in hidden
      expect(undefinedEl.style.display).toBe('none')

      // Existing true property should be visible
      expect(existingEl.style.display).not.toBe('none')
    })
  })
})
