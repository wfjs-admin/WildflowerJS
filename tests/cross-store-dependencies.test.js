/**
 * WildflowerJS Cross-Store Dependencies Test Suite
 *
 * Tests complex multi-store scenarios including:
 * - Computed properties depending on multiple stores
 * - Cascading updates across stores
 * - Store-to-store reactive dependencies
 * - Component bridging multiple stores
 * - Circular dependency prevention
 * - Store initialization order
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Cross-Store Dependencies', () => {
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

  describe('Basic Cross-Store Access', () => {
    it('should access state from another store via subscribe + this.stores', async () => {
      // Use createStoreComponent to get access to stateManager
      const userStore = wildflower.storeManager.createStoreComponent('user-store', {
        state: { name: 'Alice', role: 'admin' }
      })

      const settingsStore = wildflower.storeManager.createStoreComponent('settings-store', {
        state: { theme: 'dark' },
        subscribe: { 'user-store': ['name'] },
        computed: {
          userThemeLabel() {
            const userName = this.stores['user-store'].name
            return `${userName}'s ${this.state.theme} theme`
          }
        }
      })

      await waitForUpdate()

      const label = settingsStore.stateManager.evaluateComputed('userThemeLabel')
      expect(label).toBe("Alice's dark theme")
    })

    it('should access computed property from another store', async () => {
      const cartStore = wildflower.storeManager.createStoreComponent('cart-store', {
        state: {
          items: [
            { name: 'Widget', price: 10, qty: 2 },
            { name: 'Gadget', price: 25, qty: 1 }
          ]
        },
        computed: {
          total() {
            return this.state.items.reduce((sum, item) => sum + item.price * item.qty, 0)
          }
        }
      })

      const checkoutStore = wildflower.storeManager.createStoreComponent('checkout-store', {
        state: { taxRate: 0.1 },
        subscribe: { 'cart-store': ['items'] },
        computed: {
          grandTotal() {
            const cartTotal = this.stores['cart-store'].total
            return cartTotal * (1 + this.state.taxRate)
          }
        }
      })

      await waitForUpdate()

      const grandTotal = checkoutStore.stateManager.evaluateComputed('grandTotal')
      expect(grandTotal).toBeCloseTo(49.5, 5) // (20 + 25) * 1.1
    })

    it('should handle non-existent store gracefully', async () => {
      const safeStore = wildflower.storeManager.createStoreComponent('safe-access-store', {
        state: { fallback: 'default' },
        subscribe: { 'non-existent-store': ['value'] },
        computed: {
          safeValue() {
            const external = this.stores['non-existent-store']?.value ?? null
            return external !== null ? external : this.state.fallback
          }
        }
      })

      await waitForUpdate()

      const value = safeStore.stateManager.evaluateComputed('safeValue')
      expect(value).toBe('default')
    })
  })

  describe('Reactive Cross-Store Updates', () => {
    it('should update component when dependent store changes', async () => {
      // Create auth store
      wildflower.storeManager.store('auth-store', {
        state: { isLoggedIn: false, username: '' }
      })

      // Create component that depends on auth store
      wildflower.component('auth-display', {
        state: {},
        subscribe: { 'auth-store': ['isLoggedIn', 'username'] },
        computed: {
          displayText() {
            const isLoggedIn = this.stores['auth-store'].isLoggedIn
            const username = this.stores['auth-store'].username
            return isLoggedIn ? `Welcome, ${username}` : 'Please log in'
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="auth-display">
          <span id="auth-text" data-bind="computed:displayText"></span>
        </div>
      `

      wildflower._scanForComponents()
      await waitForUpdate(100)

      expect(testContainer.querySelector('#auth-text').textContent).toBe('Please log in')

      // Update auth store
      const authStore = wildflower.storeManager.getStoreByName('auth-store')
      authStore.state.isLoggedIn = true
      authStore.state.username = 'Bob'
      await waitForUpdate(100)

      expect(testContainer.querySelector('#auth-text').textContent).toBe('Welcome, Bob')
    })

    it('should handle cascading updates across three stores', async () => {
      // Store A: Base data - keep reference for later update
      const storeA = wildflower.storeManager.createStoreComponent('store-a', {
        state: { baseValue: 10 }
      })

      // Store B: Depends on Store A
      wildflower.storeManager.createStoreComponent('store-b', {
        state: { multiplier: 2 },
        subscribe: { 'store-a': ['baseValue'] },
        computed: {
          derivedValue() {
            const base = this.stores['store-a'].baseValue
            return base * this.state.multiplier
          }
        }
      })

      // Store C: Depends on Store B's computed
      const storeC = wildflower.storeManager.createStoreComponent('store-c', {
        state: { offset: 5 },
        subscribe: { 'store-b': ['multiplier'] },
        computed: {
          finalValue() {
            const derived = this.stores['store-b'].derivedValue
            return derived + this.state.offset
          }
        }
      })

      await waitForUpdate()

      let finalValue = storeC.stateManager.evaluateComputed('finalValue')
      expect(finalValue).toBe(25) // (10 * 2) + 5

      // Update base store using the reference we kept
      storeA.state.baseValue = 20
      await waitForUpdate()

      finalValue = storeC.stateManager.evaluateComputed('finalValue')
      expect(finalValue).toBe(45) // (20 * 2) + 5
    })
  })

  describe('Multiple Store Subscriptions', () => {
    it('should subscribe to changes in multiple stores', async () => {
      const changes = []

      wildflower.storeManager.store('product-store', {
        state: { price: 100 }
      })

      wildflower.storeManager.store('discount-store', {
        state: { percentage: 10 }
      })

      // Component watching both stores
      wildflower.component('price-watcher', {
        state: {},
        subscribe: { 'product-store': ['price'], 'discount-store': ['percentage'] },
        watch: {
          'store:product-store.price': function(newVal) {
            changes.push({ store: 'product', value: newVal })
          },
          'store:discount-store.percentage': function(newVal) {
            changes.push({ store: 'discount', value: newVal })
          }
        },
        computed: {
          finalPrice() {
            const price = this.stores['product-store'].price
            const discount = this.stores['discount-store'].percentage
            return price * (1 - discount / 100)
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="price-watcher">
          <span id="final-price" data-bind="computed:finalPrice"></span>
        </div>
      `

      wildflower._scanForComponents()
      await waitForUpdate(100)

      expect(testContainer.querySelector('#final-price').textContent).toBe('90')

      // Update product price
      const productStore = wildflower.storeManager.getStoreByName('product-store')
      productStore.state.price = 200
      await waitForUpdate(100)

      expect(changes.some(c => c.store === 'product' && c.value === 200)).toBe(true)
      expect(testContainer.querySelector('#final-price').textContent).toBe('180')

      // Update discount
      const discountStore = wildflower.storeManager.getStoreByName('discount-store')
      discountStore.state.percentage = 20
      await waitForUpdate(100)

      expect(changes.some(c => c.store === 'discount' && c.value === 20)).toBe(true)
      expect(testContainer.querySelector('#final-price').textContent).toBe('160')
    })
  })

  describe('Component Bridging Multiple Stores', () => {
    it('should synchronize data between stores via component actions', async () => {
      // Source store
      wildflower.storeManager.store('source-store', {
        state: {
          items: [{ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' }]
        }
      })

      // Target store (selected items)
      wildflower.storeManager.store('selection-store', {
        state: {
          selectedIds: []
        }
      })

      // Bridge component
      let componentInstance
      wildflower.component('item-selector', {
        state: {},
        subscribe: { 'source-store': ['items'], 'selection-store': ['selectedIds'] },
        init() {
          componentInstance = this
        },
        computed: {
          availableItems() {
            return this.stores['source-store'].items || []
          },
          selectedCount() {
            const ids = this.stores['selection-store'].selectedIds || []
            return ids.length
          }
        },
        selectItem(id) {
          const selectionStore = wildflower.storeManager.getStoreByName('selection-store')
          if (!selectionStore.state.selectedIds.includes(id)) {
            selectionStore.state.selectedIds = [...selectionStore.state.selectedIds, id]
          }
        },
        clearSelection() {
          const selectionStore = wildflower.storeManager.getStoreByName('selection-store')
          selectionStore.state.selectedIds = []
        }
      })

      testContainer.innerHTML = `
        <div data-component="item-selector">
          <span id="selected-count" data-bind="computed:selectedCount"></span>
        </div>
      `

      wildflower._scanForComponents()
      await waitForUpdate(100)

      expect(testContainer.querySelector('#selected-count').textContent).toBe('0')

      // Select items
      componentInstance.selectItem(1)
      await waitForUpdate(100)
      expect(testContainer.querySelector('#selected-count').textContent).toBe('1')

      componentInstance.selectItem(2)
      await waitForUpdate(100)
      expect(testContainer.querySelector('#selected-count').textContent).toBe('2')

      // Clear selection
      componentInstance.clearSelection()
      await waitForUpdate(100)
      expect(testContainer.querySelector('#selected-count').textContent).toBe('0')
    })

    it('should aggregate data from multiple stores', async () => {
      wildflower.storeManager.store('orders-store', {
        state: {
          orders: [
            { id: 1, total: 50 },
            { id: 2, total: 75 }
          ]
        },
        computed: {
          orderTotal() {
            return this.state.orders.reduce((sum, o) => sum + o.total, 0)
          }
        }
      })

      wildflower.storeManager.store('shipping-store', {
        state: { cost: 10 }
      })

      wildflower.storeManager.store('tax-store', {
        state: { rate: 0.08 }
      })

      // Aggregator component
      wildflower.component('order-summary', {
        state: {},
        subscribe: { 'orders-store': ['orders'], 'shipping-store': ['cost'], 'tax-store': ['rate'] },
        computed: {
          subtotal() {
            return this.stores['orders-store'].orderTotal || 0
          },
          shipping() {
            return this.stores['shipping-store'].cost || 0
          },
          tax() {
            const subtotal = this.stores['orders-store'].orderTotal || 0
            const rate = this.stores['tax-store'].rate || 0
            return subtotal * rate
          },
          grandTotal() {
            // Avoid calling other computed properties directly - recalculate
            const subtotal = this.stores['orders-store'].orderTotal || 0
            const shipping = this.stores['shipping-store'].cost || 0
            const rate = this.stores['tax-store'].rate || 0
            const tax = subtotal * rate
            return subtotal + shipping + tax
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="order-summary">
          <span id="subtotal" data-bind="computed:subtotal"></span>
          <span id="shipping" data-bind="computed:shipping"></span>
          <span id="tax" data-bind="computed:tax"></span>
          <span id="grand-total" data-bind="computed:grandTotal"></span>
        </div>
      `

      wildflower._scanForComponents()
      await waitForUpdate(100)

      expect(testContainer.querySelector('#subtotal').textContent).toBe('125')
      expect(testContainer.querySelector('#shipping').textContent).toBe('10')
      expect(testContainer.querySelector('#tax').textContent).toBe('10')
      expect(testContainer.querySelector('#grand-total').textContent).toBe('145')
    })
  })

  describe('Store Initialization Order', () => {
    it('should handle stores created in different order', async () => {
      // Create dependent store first (before the store it depends on)
      const depStore = wildflower.storeManager.createStoreComponent('dependent-store', {
        state: { trigger: 0 },
        subscribe: { 'source-data-store': ['value'] },
        computed: {
          derivedValue() {
            // Include trigger to force re-evaluation when we need it
            const _ = this.state.trigger
            const source = this.stores['source-data-store']?.value ?? null
            return source !== null ? source * 2 : 0
          }
        }
      })

      await waitForUpdate()

      // Initially, source store doesn't exist
      let derived = depStore.stateManager.evaluateComputed('derivedValue')
      expect(derived).toBe(0)

      // Now create the source store
      wildflower.storeManager.createStoreComponent('source-data-store', {
        state: { value: 50 }
      })

      await waitForUpdate()

      // Trigger re-evaluation by changing state
      depStore.state.trigger = 1
      await waitForUpdate()

      // Computed should now work
      derived = depStore.stateManager.evaluateComputed('derivedValue')
      expect(derived).toBe(100)
    })

    it('should handle lazy store initialization with component re-render', async () => {
      // This tests that when a store is created after a component that depends on it,
      // the component can access the new store data when it re-renders
      let componentInstance
      wildflower.component('lazy-store-user', {
        state: { trigger: 0 },
        subscribe: { 'lazy-store': ['data'] },
        computed: {
          lazyValue() {
            const val = this.stores['lazy-store']?.data ?? null
            // Also read trigger to ensure computed re-evaluates
            const _ = this.state.trigger
            return val !== null ? val : 'waiting...'
          }
        },
        init() {
          componentInstance = this
        }
      })

      testContainer.innerHTML = `
        <div data-component="lazy-store-user">
          <span id="lazy-value" data-bind="computed:lazyValue"></span>
        </div>
      `

      wildflower._scanForComponents()
      await waitForUpdate(100)

      // Store doesn't exist yet
      expect(testContainer.querySelector('#lazy-value').textContent).toBe('waiting...')

      // Create store later (simulating lazy loading)
      wildflower.storeManager.createStoreComponent('lazy-store', {
        state: { data: 'loaded!' }
      })

      // Trigger a re-render by changing component state
      componentInstance.state.trigger = 1
      await waitForUpdate(100)

      // Component should now show store data
      expect(testContainer.querySelector('#lazy-value').textContent).toBe('loaded!')
    })
  })

  describe('Store Array Dependencies', () => {
    it('should handle filtered views across stores', async () => {
      wildflower.storeManager.store('all-products-store', {
        state: {
          products: [
            { id: 1, name: 'Laptop', category: 'electronics', price: 1000 },
            { id: 2, name: 'Shirt', category: 'clothing', price: 50 },
            { id: 3, name: 'Phone', category: 'electronics', price: 800 },
            { id: 4, name: 'Pants', category: 'clothing', price: 60 }
          ]
        }
      })

      wildflower.storeManager.store('filter-store', {
        state: { category: 'all', maxPrice: 1000 }
      })

      wildflower.component('filtered-products', {
        state: {},
        subscribe: { 'all-products-store': ['products'], 'filter-store': ['category', 'maxPrice'] },
        computed: {
          filteredProducts() {
            const products = this.stores['all-products-store'].products || []
            const category = this.stores['filter-store'].category
            const maxPrice = this.stores['filter-store'].maxPrice

            return products.filter(p => {
              const categoryMatch = category === 'all' || p.category === category
              const priceMatch = p.price <= maxPrice
              return categoryMatch && priceMatch
            })
          },
          productCount() {
            // Avoid calling this.filteredProducts - recalculate inline
            const products = this.stores['all-products-store'].products || []
            const category = this.stores['filter-store'].category
            const maxPrice = this.stores['filter-store'].maxPrice

            return products.filter(p => {
              const categoryMatch = category === 'all' || p.category === category
              const priceMatch = p.price <= maxPrice
              return categoryMatch && priceMatch
            }).length
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="filtered-products">
          <span id="count" data-bind="computed:productCount"></span>
        </div>
      `

      wildflower._scanForComponents()
      await waitForUpdate(100)

      expect(testContainer.querySelector('#count').textContent).toBe('4')

      // Filter by category
      const filterStore = wildflower.storeManager.getStoreByName('filter-store')
      filterStore.state.category = 'electronics'
      await waitForUpdate(100)

      expect(testContainer.querySelector('#count').textContent).toBe('2')

      // Filter by price
      filterStore.state.maxPrice = 900
      await waitForUpdate(100)

      expect(testContainer.querySelector('#count').textContent).toBe('1') // Only Phone
    })

    it('should handle list rendering from external store', async () => {
      wildflower.storeManager.store('todo-data-store', {
        state: {
          todos: [
            { id: 1, text: 'Task 1', done: false },
            { id: 2, text: 'Task 2', done: true },
            { id: 3, text: 'Task 3', done: false }
          ]
        }
      })

      wildflower.component('todo-list-view', {
        state: {},
        subscribe: { 'todo-data-store': ['todos'] },
        computed: {
          todos() {
            return this.stores['todo-data-store'].todos || []
          },
          pendingCount() {
            const todos = this.stores['todo-data-store'].todos || []
            return todos.filter(t => !t.done).length
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="todo-list-view">
          <span id="pending" data-bind="computed:pendingCount"></span>
          <div data-list="computed:todos">
            <template>
              <div class="todo-item" data-bind="text"></div>
            </template>
          </div>
        </div>
      `

      wildflower._scanForComponents()
      await waitForUpdate(100)

      expect(testContainer.querySelector('#pending').textContent).toBe('2')
      expect(testContainer.querySelectorAll('.todo-item').length).toBe(3)

      // Add todo via store
      const todoStore = wildflower.storeManager.getStoreByName('todo-data-store')
      todoStore.state.todos = [...todoStore.state.todos, { id: 4, text: 'Task 4', done: false }]
      await waitForUpdate(100)

      expect(testContainer.querySelector('#pending').textContent).toBe('3')
      expect(testContainer.querySelectorAll('.todo-item').length).toBe(4)
    })
  })

  describe('Store State Changes', () => {
    it('should update dependent components when store state is replaced', async () => {
      // Keep a reference to the store for later updates
      const mutableStore = wildflower.storeManager.createStoreComponent('mutable-store', {
        state: { value: 'initial' }
      })

      wildflower.component('store-reader', {
        state: {},
        subscribe: { 'mutable-store': ['value'] },
        computed: {
          storeValue() {
            const val = this.stores['mutable-store']?.value ?? null
            return val !== null ? val : 'no value'
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="store-reader">
          <span id="value" data-bind="computed:storeValue"></span>
        </div>
      `

      wildflower._scanForComponents()
      await waitForUpdate(100)

      expect(testContainer.querySelector('#value').textContent).toBe('initial')

      // Update the store's state using our reference
      mutableStore.state.value = 'updated'
      await waitForUpdate(100)

      // Component should reflect the change
      expect(testContainer.querySelector('#value').textContent).toBe('updated')
    })
  })
})
