/**
 * WildflowerJS Reactive Methods (Item-Level Computeds) Test Suite
 *
 * Tests for the "Reactive Methods" feature that allows computed properties
 * to receive list item context via function parameters.
 *
 * Feature: When a computed property has parameters (fn.length > 0), the framework:
 * 1. Detects it as an "item-level" computed
 * 2. Passes (item, index) as arguments instead of using enhanced `this`
 * 3. Tracks store dependencies during evaluation
 * 4. Re-evaluates bindings when stores change (not the whole list)
 *
 * Signature convention: (item, index) - matches JS array method conventions
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, waitForUpdate, waitForDOM } from './helpers/load-framework.js'

describe('Reactive Methods (Item-Level Computeds)', () => {
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
    // Clean up stores created in tests
    const storeNames = ['testCart', 'tracking-test']
    storeNames.forEach(name => {
      try {
        if (wildflower.getStore(name)) {
          wildflower.destroyStore(name)
        }
      } catch (e) {
        // Store may not exist
      }
    })

    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  describe('Parameter Detection', () => {
    it('should detect parameterized computed as item-level', async () => {
      wildflower.component('param-test', {
        state: {
          items: [{ id: 1, name: 'Item 1' }]
        },
        computed: {
          // No parameter - component level
          totalCount() {
            return this.state.items.length
          },
          // Has parameter - item level
          itemLabel(item) {
            return `Label: ${item.name}`
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="param-test">
          <span id="total" data-bind="computed:totalCount"></span>
          <div data-list="items" data-key="id">
            <template>
              <span class="label" data-bind="computed:itemLabel"></span>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate()

      expect(document.getElementById('total').textContent).toBe('1')
      expect(document.querySelector('.label').textContent).toBe('Label: Item 1')
    })

    it('should pass correct item to parameterized computed', async () => {
      wildflower.component('item-pass-test', {
        state: {
          products: [
            { id: 1, name: 'A', price: 10 },
            { id: 2, name: 'B', price: 20 },
            { id: 3, name: 'C', price: 30 }
          ]
        },
        computed: {
          formattedPrice(item) {
            return `$${item.price.toFixed(2)}`
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="item-pass-test">
          <div data-list="products" data-key="id">
            <template>
              <div class="product">
                <span class="name" data-bind="name"></span>
                <span class="price" data-bind="computed:formattedPrice"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate()

      const prices = document.querySelectorAll('.price')
      expect(prices[0].textContent).toBe('$10.00')
      expect(prices[1].textContent).toBe('$20.00')
      expect(prices[2].textContent).toBe('$30.00')
    })
  })

  describe('Calling Other Item-Level Computeds', () => {
    it('should allow item-level computed to call another item-level computed', async () => {
      wildflower.store('testCart', {
        state: { items: [{ id: 1, qty: 3 }] }
      })

      wildflower.component('chained-computed-test', {
        state: {
          products: [
            { id: 1, name: 'A', price: 10 },
            { id: 2, name: 'B', price: 20 }
          ]
        },
        computed: {
          inCartQty(item) {
            const cart = wildflower.getStore('testCart')
            return cart.state.items.find(i => i.id === item.id)?.qty || 0
          },
          // Calls another item-level computed
          itemTotal(item) {
            const qty = this.computed.inCartQty(item)
            return qty * item.price
          },
          // Boolean based on another item-level computed
          hasDiscount(item) {
            return this.computed.inCartQty(item) >= 3
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="chained-computed-test">
          <div data-list="products" data-key="id">
            <template>
              <div class="product">
                <span class="total" data-bind="computed:itemTotal"></span>
                <span class="discount" data-show="computed:hasDiscount">BULK!</span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate()

      const totals = document.querySelectorAll('.total')
      const discounts = document.querySelectorAll('.discount')

      // Product 1: 3 qty * $10 = $30, has bulk discount
      expect(totals[0].textContent).toBe('30')
      expect(discounts[0].style.display).not.toBe('none')

      // Product 2: 0 qty * $20 = $0, no discount
      expect(totals[1].textContent).toBe('0')
      expect(discounts[1].style.display).toBe('none')
    })
  })

  describe('Component State Access', () => {
    it('should allow item-level computed to access component state', async () => {
      wildflower.component('state-access-test', {
        state: {
          taxRate: 0.1,
          products: [
            { id: 1, name: 'A', price: 100 },
            { id: 2, name: 'B', price: 200 }
          ]
        },
        computed: {
          priceWithTax(item) {
            // Access component state via this.state
            const tax = item.price * this.state.taxRate
            return item.price + tax
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="state-access-test">
          <div data-list="products" data-key="id">
            <template>
              <span class="price-tax" data-bind="computed:priceWithTax"></span>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate()

      const prices = document.querySelectorAll('.price-tax')
      expect(prices[0].textContent).toBe('110') // 100 + 10% tax
      expect(prices[1].textContent).toBe('220') // 200 + 10% tax
    })
  })

  describe('Mixed Component and Item-Level Computeds', () => {
    it('should handle both types in same component', async () => {
      wildflower.component('mixed-test', {
        state: {
          storeName: 'My Store',
          products: [
            { id: 1, name: 'Widget' }
          ]
        },
        computed: {
          // Component-level (no parameter)
          headerText() {
            return `Welcome to ${this.state.storeName}`
          },
          // Item-level (has parameter)
          productTitle(item) {
            return `${item.name} - from ${this.state.storeName}`
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="mixed-test">
          <h1 id="header" data-bind="computed:headerText"></h1>
          <div data-list="products" data-key="id">
            <template>
              <span class="title" data-bind="computed:productTitle"></span>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate()

      expect(document.getElementById('header').textContent).toBe('Welcome to My Store')
      expect(document.querySelector('.title').textContent).toBe('Widget - from My Store')
    })
  })

  describe('Index Parameter', () => {
    it('should pass index as second parameter', async () => {
      wildflower.component('index-test', {
        state: {
          items: [
            { id: 1, name: 'First' },
            { id: 2, name: 'Second' },
            { id: 3, name: 'Third' }
          ]
        },
        computed: {
          rowClass(item, index) {
            return index % 2 === 0 ? 'even' : 'odd'
          },
          displayPosition(item, index) {
            return `#${index + 1}: ${item.name}`
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="index-test">
          <div data-list="items" data-key="id">
            <template>
              <div class="row" data-bind-class="computed:rowClass">
                <span class="pos" data-bind="computed:displayPosition"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate()

      const rows = document.querySelectorAll('.row')
      const positions = document.querySelectorAll('.pos')

      expect(rows[0].classList.contains('even')).toBe(true)
      expect(rows[1].classList.contains('odd')).toBe(true)
      expect(rows[2].classList.contains('even')).toBe(true)

      expect(positions[0].textContent).toBe('#1: First')
      expect(positions[1].textContent).toBe('#2: Second')
      expect(positions[2].textContent).toBe('#3: Third')
    })
  })

  describe('Edge Cases', () => {
    it('should handle item-level computed returning falsy values', async () => {
      wildflower.component('falsy-test', {
        state: {
          items: [
            { id: 1, value: 0 },
            { id: 2, value: null },
            { id: 3, value: '' },
            { id: 4, value: false }
          ]
        },
        computed: {
          displayValue(item) {
            return item.value
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="falsy-test">
          <div data-list="items" data-key="id">
            <template>
              <span class="val" data-bind="computed:displayValue"></span>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate()

      const vals = document.querySelectorAll('.val')
      expect(vals[0].textContent).toBe('0')
      expect(vals[1].textContent).toBe('')      // null renders as empty
      expect(vals[2].textContent).toBe('')      // empty string
      expect(vals[3].textContent).toBe('false') // boolean false as string
    })

    it('should handle undefined computed gracefully', async () => {
      wildflower.component('undefined-test', {
        state: {
          items: [{ id: 1 }]
        },
        computed: {}
      })

      testContainer.innerHTML = `
        <div data-component="undefined-test">
          <div data-list="items" data-key="id">
            <template>
              <span class="missing" data-bind="computed:nonExistent"></span>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate()

      // Should not throw, should render empty or undefined
      const missing = document.querySelector('.missing')
      expect(missing).toBeTruthy()
    })

    it('should work with nested lists', async () => {
      wildflower.component('nested-test', {
        state: {
          categories: [
            { id: 1, name: 'Cat A', products: [{ id: 101, name: 'P1' }] },
            { id: 2, name: 'Cat B', products: [{ id: 201, name: 'P2' }] }
          ]
        },
        computed: {
          categoryLabel(item) {
            return `Category: ${item.name}`
          },
          productLabel(item) {
            return `Product: ${item.name}`
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="nested-test">
          <div data-list="categories" data-key="id">
            <template>
              <div class="category">
                <h3 class="cat-label" data-bind="computed:categoryLabel"></h3>
                <div data-list="products" data-key="id">
                  <template>
                    <span class="prod-label" data-bind="computed:productLabel"></span>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForDynamicComponents()
      await waitForUpdate()

      const catLabels = document.querySelectorAll('.cat-label')
      const prodLabels = document.querySelectorAll('.prod-label')

      expect(catLabels[0].textContent).toBe('Category: Cat A')
      expect(catLabels[1].textContent).toBe('Category: Cat B')
      expect(prodLabels[0].textContent).toBe('Product: P1')
      expect(prodLabels[1].textContent).toBe('Product: P2')
    })
  })
})
