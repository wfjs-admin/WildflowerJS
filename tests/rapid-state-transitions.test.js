/**
 * WildflowerJS Rapid State Transitions Test Suite
 *
 * Tests to verify whether the "external dependency staleness" issue exists.
 * The concern: When Component A updates state that Component B reads via
 * external() or getStore(), values can be a mix of fresh and stale data
 * during rapid state transitions.
 *
 * These tests specifically target the edge case scenarios documented in TODO.md
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to get component instance from selector
function getComponentInstance(selector) {
  const el = document.querySelector(selector)
  if (el && el.dataset.componentId) {
    return window.wildflower.componentInstances.get(el.dataset.componentId)
  }
  return null
}

describe('Rapid State Transitions', () => {
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

  describe('Multiple property updates in quick succession', () => {
    it('observer sees consistent state after rapid updates to multiple properties', async () => {
      // Source component with multiple related properties
      wildflower.component('nav-source', {
        state: {
          currentPage: 'home',
          currentSection: 'intro',
          isLoading: false
        },
        // Method that updates multiple properties atomically
        navigateTo(page, section) {
          this.state.currentPage = page
          this.state.currentSection = section
        }
      })

      // Observer that reads multiple properties
      wildflower.component('nav-observer', {
        computed: {
          route() {
            const source = wildflower.getComponent('nav-source')
            if (!source) return 'unknown'
            // Both properties should be consistent
            return `${source.state.currentPage}/${source.state.currentSection}`
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="nav-source"></div>
        <div data-component="nav-observer">
          <span class="route" data-bind="computed:route"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      const routeEl = testContainer.querySelector('.route')
      expect(routeEl.textContent).toBe('home/intro')

      // Rapid navigation
      const source = getComponentInstance('[data-component="nav-source"]')
      source.navigateTo('docs', 'getting-started')
      await waitForUpdate(100)

      // Should see consistent state (not 'docs/intro' or 'home/getting-started')
      expect(routeEl.textContent).toBe('docs/getting-started')
    })

    it('handles rapid sequential updates without stale data', async () => {
      const store = wildflower.store('counter-store', {
        state: { count: 0 }
      })

      wildflower.component('counter-display', {
        computed: {
          displayCount() {
            return wildflower.getStore('counter-store').state.count
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="counter-display">
          <span class="count" data-bind="computed:displayCount"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      const countEl = testContainer.querySelector('.count')
      expect(countEl.textContent).toBe('0')

      // Rapid sequential updates
      for (let i = 1; i <= 10; i++) {
        store.state.count = i
      }
      await waitForUpdate(100)

      // Should show final value, not intermediate
      expect(countEl.textContent).toBe('10')
    })

    it('multiple observers see consistent values after rapid store update', async () => {
      const store = wildflower.store('shared-state', {
        state: {
          value: 'initial'
        }
      })

      // Create multiple observers
      wildflower.component('observer-1', {
        computed: {
          value() { return wildflower.getStore('shared-state').state.value }
        }
      })
      wildflower.component('observer-2', {
        computed: {
          value() { return wildflower.getStore('shared-state').state.value }
        }
      })
      wildflower.component('observer-3', {
        computed: {
          value() { return wildflower.getStore('shared-state').state.value }
        }
      })

      testContainer.innerHTML = `
        <div data-component="observer-1"><span class="v1" data-bind="computed:value"></span></div>
        <div data-component="observer-2"><span class="v2" data-bind="computed:value"></span></div>
        <div data-component="observer-3"><span class="v3" data-bind="computed:value"></span></div>
      `

      wildflower.scan()
      await waitForUpdate()

      // All should start with initial
      expect(testContainer.querySelector('.v1').textContent).toBe('initial')
      expect(testContainer.querySelector('.v2').textContent).toBe('initial')
      expect(testContainer.querySelector('.v3').textContent).toBe('initial')

      // Update store
      store.state.value = 'updated'
      await waitForUpdate(100)

      // All observers should see the same updated value
      expect(testContainer.querySelector('.v1').textContent).toBe('updated')
      expect(testContainer.querySelector('.v2').textContent).toBe('updated')
      expect(testContainer.querySelector('.v3').textContent).toBe('updated')
    })
  })

  describe('Cascading updates between components', () => {
    it('handles chain of dependent components (source state -> middle computed)', async () => {
      // Source -> Middle chain (direct state access works)
      wildflower.component('chain-source', {
        state: { value: 1 }
      })

      wildflower.component('chain-middle', {
        computed: {
          doubled() {
            const source = wildflower.getComponent('chain-source')
            return source ? source.state.value * 2 : 0
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="chain-source"></div>
        <div data-component="chain-middle">
          <span class="doubled" data-bind="computed:doubled"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      expect(testContainer.querySelector('.doubled').textContent).toBe('2')

      // Update source
      const source = getComponentInstance('[data-component="chain-source"]')
      source.state.value = 5
      await waitForUpdate(100)

      expect(testContainer.querySelector('.doubled').textContent).toBe('10')
    })

    it('handles computed-to-computed chain through store subscription', async () => {
      // Test if computed -> computed chains work via subscribe + this.stores
      const outerStore = wildflower.store('outer-source-store', {
        state: { base: 10 },
        computed: {
          doubled() {
            return this.state.base * 2
          }
        }
      })

      wildflower.component('outer-source', {
        subscribe: { 'outer-source-store': ['base'] },
        computed: {
          doubled() {
            return this.stores['outer-source-store'].doubled
          }
        }
      })

      wildflower.component('outer-observer', {
        subscribe: { 'outer-source-store': ['base'] },
        computed: {
          quadrupled() {
            // Access store's computed via subscribe + this.stores
            const doubled = this.stores['outer-source-store'].doubled
            return doubled ? doubled * 2 : 0
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="outer-source">
          <span class="doubled" data-bind="computed:doubled"></span>
        </div>
        <div data-component="outer-observer">
          <span class="quadrupled" data-bind="computed:quadrupled"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      expect(testContainer.querySelector('.doubled').textContent).toBe('20')
      expect(testContainer.querySelector('.quadrupled').textContent).toBe('40')

      // Update source store
      outerStore.state.base = 25
      await waitForUpdate(150)

      expect(testContainer.querySelector('.doubled').textContent).toBe('50')
      expect(testContainer.querySelector('.quadrupled').textContent).toBe('100')
    })

    it('getComponent().stateManager.evaluateComputed() now works correctly with lazy propagation', async () => {
      // Previously this pattern bypassed auto-tracking and the observer would show stale values.
      // With lazy propagation, computed properties with no tracked dependencies are always
      // considered stale, causing them to re-evaluate and pick up the latest values.
      // Use external('name', 'computed:propName') for the preferred pattern.
      wildflower.component('compute-source', {
        state: { value: 1 },
        computed: {
          doubled() { return this.state.value * 2 }
        }
      })

      wildflower.component('compute-observer', {
        computed: {
          // This pattern now works due to lazy stale checking
          quadrupled() {
            const source = wildflower.getComponent('compute-source')
            return source ? source.stateManager.evaluateComputed('doubled') * 2 : 0
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="compute-source"></div>
        <div data-component="compute-observer">
          <span class="quadrupled" data-bind="computed:quadrupled"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Initial render works
      expect(testContainer.querySelector('.quadrupled').textContent).toBe('4')

      // Update source - observer WILL update (lazy propagation fixed this!)
      const source = getComponentInstance('[data-component="compute-source"]')
      source.state.value = 5
      await waitForUpdate(100)

      // The value is now correctly updated (5 * 2 * 2 = 20)
      // This was a known limitation that lazy propagation resolved
      expect(testContainer.querySelector('.quadrupled').textContent).toBe('20')
    })
  })

  describe('Mixed store and component dependencies', () => {
    it('component reading from both store and another component stays consistent', async () => {
      // Store with user data
      const store = wildflower.store('user-store', {
        state: {
          userName: 'Alice',
          preferences: {
            theme: 'light'
          }
        }
      })

      // Component with display settings
      wildflower.component('display-settings', {
        state: {
          fontSize: 'medium'
        }
      })

      // Observer reading from both
      wildflower.component('profile-view', {
        computed: {
          profileSummary() {
            const store = wildflower.getStore('user-store')
            const settings = wildflower.getComponent('display-settings')
            const userName = store ? store.state.userName : 'Unknown'
            const theme = store ? store.state.preferences.theme : 'default'
            const fontSize = settings ? settings.state.fontSize : 'default'
            return `${userName} | ${theme} | ${fontSize}`
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="display-settings"></div>
        <div data-component="profile-view">
          <span class="summary" data-bind="computed:profileSummary"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      const summaryEl = testContainer.querySelector('.summary')
      expect(summaryEl.textContent).toBe('Alice | light | medium')

      // Update multiple sources
      store.state.userName = 'Bob'
      store.state.preferences = { theme: 'dark' }
      const settings = getComponentInstance('[data-component="display-settings"]')
      settings.state.fontSize = 'large'
      await waitForUpdate(100)

      // Should see all updates consistently
      expect(summaryEl.textContent).toBe('Bob | dark | large')
    })
  })

  describe('Stress test: High-frequency updates', () => {
    it('handles 100 rapid updates without data corruption', async () => {
      const store = wildflower.store('stress-store', {
        state: { value: 0 }
      })

      const capturedValues = []

      wildflower.component('stress-observer', {
        state: { lastSeen: 0 },
        computed: {
          currentValue() {
            const val = wildflower.getStore('stress-store').state.value
            capturedValues.push(val)
            return val
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="stress-observer">
          <span class="value" data-bind="computed:currentValue"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Perform 100 rapid updates
      for (let i = 1; i <= 100; i++) {
        store.state.value = i
      }
      await waitForUpdate(200)

      const valueEl = testContainer.querySelector('.value')

      // The DOM should show the final value
      expect(valueEl.textContent).toBe('100')

      // Verify no values were skipped in wrong order (would indicate stale reads)
      // Note: batching may skip intermediate values, which is fine
      // What we care about is that we never see a lower value after a higher one
      let maxSeen = 0
      for (const val of capturedValues) {
        expect(val).toBeGreaterThanOrEqual(maxSeen)
        maxSeen = Math.max(maxSeen, val)
      }
    })

    it('handles concurrent updates from different stores', async () => {
      const storeA = wildflower.store('concurrent-a', { state: { count: 0 } })
      const storeB = wildflower.store('concurrent-b', { state: { count: 0 } })

      wildflower.component('concurrent-observer', {
        computed: {
          sum() {
            const a = wildflower.getStore('concurrent-a').state.count
            const b = wildflower.getStore('concurrent-b').state.count
            return a + b
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="concurrent-observer">
          <span class="sum" data-bind="computed:sum"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      expect(testContainer.querySelector('.sum').textContent).toBe('0')

      // Update both stores rapidly in alternation
      for (let i = 1; i <= 50; i++) {
        storeA.state.count = i
        storeB.state.count = i
      }
      await waitForUpdate(150)

      // Should show consistent sum of final values
      expect(testContainer.querySelector('.sum').textContent).toBe('100')
    })
  })
})
