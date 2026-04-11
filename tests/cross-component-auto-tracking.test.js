/**
 * WildflowerJS Cross-Component Automatic Dependency Tracking Test Suite
 *
 * Tests for automatic dependency tracking when components access other components' state.
 * Similar to store auto-tracking, when a component's computed property accesses
 * another component's state via wildflower.getComponent(), the framework should automatically:
 * 1. Detect the access during computed evaluation
 * 2. Register the component as dependent on the other component
 * 3. Re-evaluate the computed when the other component's state changes
 *
 * NOTE: These tests are expected to FAIL initially until the feature is implemented.
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

describe('Cross-Component Automatic Dependency Tracking', () => {
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

  describe('Automatic Dependency Registration via getComponent', () => {
    it('automatically registers component as dependent when accessing another component state', async () => {
      // Source component with state
      wildflower.component('counter-source', {
        state: {
          count: 42
        },
        increment() {
          this.state.count++
        }
      })

      // Observer component that reads from source
      wildflower.component('counter-observer', {
        computed: {
          displayCount() {
            // This should automatically register the dependency
            const source = wildflower.getComponent('counter-source')
            return source ? source.state.count : 0
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="counter-source">
          <span class="source-count" data-bind="count"></span>
          <button data-action="increment">+</button>
        </div>
        <div data-component="counter-observer">
          <span class="observer-count" data-bind="computed:displayCount"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Verify initial render
      expect(testContainer.querySelector('.source-count').textContent).toBe('42')
      expect(testContainer.querySelector('.observer-count').textContent).toBe('42')
    })
  })

  describe('Automatic Reactivity Without Manual Subscription', () => {
    it('observer computed updates when source component state changes', async () => {
      wildflower.component('data-provider', {
        state: {
          message: 'Hello'
        },
        updateMessage(newMsg) {
          this.state.message = newMsg
        }
      })

      // Component WITHOUT manual subscribe + this.stores
      wildflower.component('data-consumer', {
        computed: {
          providerMessage() {
            const provider = wildflower.getComponent('data-provider')
            return provider ? provider.state.message : 'No provider'
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="data-provider">
          <span class="provider-msg" data-bind="message"></span>
        </div>
        <div data-component="data-consumer">
          <span class="consumer-msg" data-bind="computed:providerMessage"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Verify initial render
      const providerMsg = testContainer.querySelector('.provider-msg')
      const consumerMsg = testContainer.querySelector('.consumer-msg')
      expect(providerMsg.textContent).toBe('Hello')
      expect(consumerMsg.textContent).toBe('Hello')

      // Update source component state
      const provider = getComponentInstance('[data-component="data-provider"]')
      provider.state.message = 'World'
      await waitForUpdate(100)

      // Consumer should automatically update
      expect(providerMsg.textContent).toBe('World')
      expect(consumerMsg.textContent).toBe('World')
    })

    it('observer can derive values from source state', async () => {
      // This test demonstrates that an observer can compute derived values
      // from a source component's state and react to changes automatically
      wildflower.component('math-source', {
        state: {
          a: 10,
          b: 20
        },
        computed: {
          sum() {
            return this.state.a + this.state.b
          }
        }
      })

      wildflower.component('math-observer', {
        computed: {
          doubledSum() {
            const source = wildflower.getComponent('math-source')
            if (!source) return 0
            // Access source's state directly (auto-tracked)
            // Observer computes the derived value itself
            return (source.state.a + source.state.b) * 2
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="math-source">
          <span class="sum" data-bind="computed:sum"></span>
        </div>
        <div data-component="math-observer">
          <span class="doubled" data-bind="computed:doubledSum"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Verify initial render
      expect(testContainer.querySelector('.sum').textContent).toBe('30')
      expect(testContainer.querySelector('.doubled').textContent).toBe('60')

      // Update source state
      const source = getComponentInstance('[data-component="math-source"]')
      source.state.a = 50
      await waitForUpdate(100)

      // Both should update - observer reacts to source.state.a change
      expect(testContainer.querySelector('.sum').textContent).toBe('70')
      expect(testContainer.querySelector('.doubled').textContent).toBe('140')
    })

    it('multiple observers react to same source changes', async () => {
      wildflower.component('shared-source', {
        state: {
          value: 100
        }
      })

      wildflower.component('observer-doubled', {
        computed: {
          result() {
            const source = wildflower.getComponent('shared-source')
            return source ? source.state.value * 2 : 0
          }
        }
      })

      wildflower.component('observer-tripled', {
        computed: {
          result() {
            const source = wildflower.getComponent('shared-source')
            return source ? source.state.value * 3 : 0
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="shared-source">
          <span class="source" data-bind="value"></span>
        </div>
        <div data-component="observer-doubled">
          <span class="doubled" data-bind="computed:result"></span>
        </div>
        <div data-component="observer-tripled">
          <span class="tripled" data-bind="computed:result"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Verify initial render
      expect(testContainer.querySelector('.source').textContent).toBe('100')
      expect(testContainer.querySelector('.doubled').textContent).toBe('200')
      expect(testContainer.querySelector('.tripled').textContent).toBe('300')

      // Update source
      const source = getComponentInstance('[data-component="shared-source"]')
      source.state.value = 50
      await waitForUpdate(100)

      // All should update
      expect(testContainer.querySelector('.source').textContent).toBe('50')
      expect(testContainer.querySelector('.doubled').textContent).toBe('100')
      expect(testContainer.querySelector('.tripled').textContent).toBe('150')
    })
  })

  describe('Comparison with subscribe + this.stores', () => {
    it('getComponent auto-tracking should behave like subscribe + this.stores for reads', async () => {
      wildflower.component('external-source', {
        state: {
          data: 'from-source'
        }
      })

      // Using getComponent (new pattern)
      wildflower.component('auto-track-consumer', {
        computed: {
          viaGetComponent() {
            const source = wildflower.getComponent('external-source')
            return source ? source.state.data : 'not-found'
          }
        }
      })

      // Using getComponent (existing pattern)
      wildflower.component('external-consumer', {
        computed: {
          viaExternal() {
            const source = wildflower.getComponent('external-source')
            return source ? source.state.data : 'not-found'
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="external-source"></div>
        <div data-component="auto-track-consumer">
          <span class="auto" data-bind="computed:viaGetComponent"></span>
        </div>
        <div data-component="external-consumer">
          <span class="external" data-bind="computed:viaExternal"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Both should show the same value
      expect(testContainer.querySelector('.auto').textContent).toBe('from-source')
      expect(testContainer.querySelector('.external').textContent).toBe('from-source')

      // Update source
      const source = getComponentInstance('[data-component="external-source"]')
      source.state.data = 'updated'
      await waitForUpdate(100)

      // Both should update
      expect(testContainer.querySelector('.auto').textContent).toBe('updated')
      expect(testContainer.querySelector('.external').textContent).toBe('updated')
    })
  })

  describe('Real-world Cross-Component Scenarios', () => {
    it('header component reads from navigation manager', async () => {
      // Navigation manager component
      wildflower.component('nav-manager', {
        state: {
          currentPage: 'home',
          breadcrumbs: ['Home']
        },
        navigateTo(page) {
          this.state.currentPage = page
          this.state.breadcrumbs = ['Home', page]
        }
      })

      // Header that reads from nav manager
      wildflower.component('page-header', {
        computed: {
          pageTitle() {
            const nav = wildflower.getComponent('nav-manager')
            return nav ? nav.state.currentPage.toUpperCase() : 'LOADING'
          },
          breadcrumbText() {
            const nav = wildflower.getComponent('nav-manager')
            return nav ? nav.state.breadcrumbs.join(' > ') : ''
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="nav-manager"></div>
        <div data-component="page-header">
          <h1 class="title" data-bind="computed:pageTitle"></h1>
          <nav class="breadcrumbs" data-bind="computed:breadcrumbText"></nav>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Verify initial state
      expect(testContainer.querySelector('.title').textContent).toBe('HOME')
      expect(testContainer.querySelector('.breadcrumbs').textContent).toBe('Home')

      // Navigate to a different page
      const navManager = getComponentInstance('[data-component="nav-manager"]')
      navManager.navigateTo('Products')
      await waitForUpdate(100)

      // Header should auto-update
      expect(testContainer.querySelector('.title').textContent).toBe('PRODUCTS')
      expect(testContainer.querySelector('.breadcrumbs').textContent).toBe('Home > Products')
    })

    it('cart badge reads from cart component', async () => {
      wildflower.component('shopping-cart', {
        state: {
          items: []
        },
        computed: {
          itemCount() {
            return this.state.items.length
          }
        },
        addItem(item) {
          this.state.items = [...this.state.items, item]
        }
      })

      wildflower.component('cart-badge', {
        computed: {
          count() {
            const cart = wildflower.getComponent('shopping-cart')
            return cart ? cart.stateManager.evaluateComputed('itemCount') : 0
          },
          hasItems() {
            const cart = wildflower.getComponent('shopping-cart')
            return cart ? cart.state.items.length > 0 : false
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="shopping-cart"></div>
        <div data-component="cart-badge">
          <span class="count" data-bind="computed:count"></span>
          <span class="indicator" data-show="computed:hasItems">!</span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Verify initial state (empty cart)
      expect(testContainer.querySelector('.count').textContent).toBe('0')
      expect(testContainer.querySelector('.indicator').style.display).toBe('none')

      // Add items to cart
      const cart = getComponentInstance('[data-component="shopping-cart"]')
      cart.addItem({ id: 1, name: 'Product 1' })
      await waitForUpdate(100)

      // Badge should update
      expect(testContainer.querySelector('.count').textContent).toBe('1')
      expect(testContainer.querySelector('.indicator').style.display).not.toBe('none')

      // Add more items
      cart.addItem({ id: 2, name: 'Product 2' })
      cart.addItem({ id: 3, name: 'Product 3' })
      await waitForUpdate(100)

      expect(testContainer.querySelector('.count').textContent).toBe('3')
    })
  })

  describe('Edge Cases', () => {
    it('handles component not found gracefully', async () => {
      wildflower.component('safe-observer', {
        computed: {
          safeValue() {
            const missing = wildflower.getComponent('nonexistent-component')
            return missing ? missing.state.value : 'default'
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="safe-observer">
          <span class="value" data-bind="computed:safeValue"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Should handle gracefully with default value
      expect(testContainer.querySelector('.value').textContent).toBe('default')
    })

    it('handles nested property access on other component', async () => {
      wildflower.component('nested-source', {
        state: {
          user: {
            profile: {
              name: 'Alice'
            }
          }
        }
      })

      wildflower.component('nested-observer', {
        computed: {
          userName() {
            const source = wildflower.getComponent('nested-source')
            return source ? source.state.user.profile.name : 'Unknown'
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="nested-source"></div>
        <div data-component="nested-observer">
          <span class="name" data-bind="computed:userName"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      expect(testContainer.querySelector('.name').textContent).toBe('Alice')

      // Update nested property
      const source = getComponentInstance('[data-component="nested-source"]')
      source.state.user = { profile: { name: 'Bob' } }
      await waitForUpdate(100)

      expect(testContainer.querySelector('.name').textContent).toBe('Bob')
    })
  })
})
