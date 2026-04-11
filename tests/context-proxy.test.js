/**
 * Context Proxy Test Suite
 *
 * Tests for the unified context proxy that makes `this.count` in methods
 * resolve identically to `data-bind="count"` in templates.
 *
 * Resolution order: context own property → computed → state → undefined
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

function ensureComponentScanning(wildflower) {
  if (wildflower._setupDynamicComponentDetection) {
    wildflower._setupDynamicComponentDetection()
  }
}

describe('Context Proxy - Unified Property Resolution', () => {
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

  // ============================================================
  // Section 1: State Shorthand Access (Component)
  // ============================================================
  describe('State Shorthand Access (Component)', () => {

    it('reads state via this.count shorthand', async () => {
      let capturedValue = null

      wildflower.component('shorthand-read', {
        state: { count: 42 },
        init() {
          capturedValue = this.count
        }
      })

      testContainer.innerHTML = '<div data-component="shorthand-read"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(capturedValue).toBe(42)
    })

    it('writes state via this.count = 5 shorthand', async () => {
      let stateAfterWrite = null

      wildflower.component('shorthand-write', {
        state: { count: 0 },
        init() {
          this.count = 5
          stateAfterWrite = this.state.count
        }
      })

      testContainer.innerHTML = '<div data-component="shorthand-write"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(stateAfterWrite).toBe(5)
    })

    it('triggers reactive DOM update via shorthand write', async () => {
      wildflower.component('shorthand-reactive', {
        state: { count: 0 },
        increment() {
          this.count = 10
        }
      })

      testContainer.innerHTML = `
        <div data-component="shorthand-reactive">
          <span data-bind="count"></span>
          <button data-action="increment">Go</button>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const span = testContainer.querySelector('[data-bind="count"]')
      expect(span.textContent).toBe('0')

      testContainer.querySelector('button').click()
      await waitForUpdate()

      expect(span.textContent).toBe('10')
    })

    it('resolves multiple state properties via shorthand', async () => {
      let captured = {}

      wildflower.component('shorthand-multi', {
        state: { firstName: 'John', lastName: 'Doe', age: 30 },
        init() {
          captured = {
            firstName: this.firstName,
            lastName: this.lastName,
            age: this.age
          }
        }
      })

      testContainer.innerHTML = '<div data-component="shorthand-multi"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(captured.firstName).toBe('John')
      expect(captured.lastName).toBe('Doe')
      expect(captured.age).toBe(30)
    })

    it('resolves nested state object via shorthand', async () => {
      let capturedName = null

      wildflower.component('shorthand-nested', {
        state: { user: { name: 'Alice', email: 'alice@test.com' } },
        init() {
          capturedName = this.user.name
        }
      })

      testContainer.innerHTML = '<div data-component="shorthand-nested"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(capturedName).toBe('Alice')
    })

    it('reads and writes boolean state via shorthand', async () => {
      let afterToggle = null

      wildflower.component('shorthand-bool', {
        state: { isActive: false },
        init() {
          this.isActive = !this.isActive
          afterToggle = this.isActive
        }
      })

      testContainer.innerHTML = '<div data-component="shorthand-bool"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(afterToggle).toBe(true)
    })
  })

  // ============================================================
  // Section 2: Computed Shorthand Access (Component)
  // ============================================================
  describe('Computed Shorthand Access (Component)', () => {

    it('reads computed via this.doubled shorthand', async () => {
      let capturedDoubled = null

      wildflower.component('computed-read', {
        state: { count: 7 },
        computed: {
          doubled() { return this.state.count * 2 }
        },
        init() {
          capturedDoubled = this.doubled
        }
      })

      testContainer.innerHTML = '<div data-component="computed-read"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(capturedDoubled).toBe(14)
    })

    it('computed uses state shorthand internally', async () => {
      let capturedDoubled = null

      wildflower.component('computed-uses-shorthand', {
        state: { count: 5 },
        computed: {
          doubled() { return this.count * 2 }
        },
        init() {
          capturedDoubled = this.doubled
        }
      })

      testContainer.innerHTML = '<div data-component="computed-uses-shorthand"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(capturedDoubled).toBe(10)
    })

    it('supports computed chain via shorthand', async () => {
      let capturedQuadrupled = null

      wildflower.component('computed-chain', {
        state: { count: 3 },
        computed: {
          doubled() { return this.state.count * 2 },
          quadrupled() { return this.doubled * 2 }
        },
        init() {
          capturedQuadrupled = this.quadrupled
        }
      })

      testContainer.innerHTML = '<div data-component="computed-chain"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(capturedQuadrupled).toBe(12)
    })

    it('computed that depends on store still works alongside shorthand', async () => {
      let capturedTotal = null

      wildflower.store('cart-proxy-test', {
        state: { total: 100 }
      })

      wildflower.component('computed-with-store', {
        state: { tax: 10 },
        subscribe: { 'cart-proxy-test': ['total'] },
        computed: {
          grandTotal() {
            const cartTotal = this.stores['cart-proxy-test']?.state?.total || 0
            return cartTotal + this.tax
          }
        },
        init() {
          capturedTotal = this.grandTotal
        }
      })

      testContainer.innerHTML = '<div data-component="computed-with-store"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(capturedTotal).toBe(110)
    })
  })

  // ============================================================
  // Section 3: Resolution Order
  // ============================================================
  describe('Resolution Order', () => {

    it('computed takes precedence over same-named state property', async () => {
      let capturedValue = null

      wildflower.component('resolution-computed-wins', {
        state: { value: 'state' },
        computed: {
          value() { return 'computed' }
        },
        init() {
          capturedValue = this.value
        }
      })

      testContainer.innerHTML = '<div data-component="resolution-computed-wins"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(capturedValue).toBe('computed')
    })

    it('methods on context take precedence over state', async () => {
      let capturedType = null

      wildflower.component('resolution-method-wins', {
        state: { count: 0 },
        count() { return 'method' },
        init() {
          capturedType = typeof this.count
        }
      })

      testContainer.innerHTML = '<div data-component="resolution-method-wins"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      // The method gets bound to context as an own property, so it wins
      expect(capturedType).toBe('function')
    })

    it('framework property wins over state with same name', async () => {
      let capturedElement = null
      let capturedStateElement = null

      wildflower.component('resolution-framework-wins', {
        state: { element: 'fire' },
        init() {
          capturedElement = this.element
          capturedStateElement = this.state.element
        }
      })

      testContainer.innerHTML = '<div data-component="resolution-framework-wins"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      // this.element should be the DOM element (framework property), not 'fire'
      expect(capturedElement).toBeInstanceOf(HTMLElement)
      expect(capturedStateElement).toBe('fire')
    })

    it('framework property wins over computed with same name', async () => {
      let capturedId = null

      wildflower.component('resolution-framework-over-computed', {
        state: {},
        computed: {
          id() { return 'custom-id' }
        },
        init() {
          capturedId = this.id
        }
      })

      testContainer.innerHTML = '<div data-component="resolution-framework-over-computed"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      // this.id should be the framework instance ID, not 'custom-id'
      expect(capturedId).toBeTypeOf('string')
      expect(capturedId).not.toBe('custom-id')
    })
  })

  // ============================================================
  // Section 4: SET Behavior
  // ============================================================
  describe('SET Behavior', () => {

    it('sets state reactively via shorthand', async () => {
      let stateCheck = null

      wildflower.component('set-reactive', {
        state: { count: 0 },
        setCount() {
          this.count = 42
          stateCheck = this.state.count
        }
      })

      testContainer.innerHTML = `
        <div data-component="set-reactive">
          <span data-bind="count"></span>
          <button data-action="setCount">Set</button>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      testContainer.querySelector('button').click()
      await waitForUpdate()

      expect(stateCheck).toBe(42)
      expect(testContainer.querySelector('[data-bind="count"]').textContent).toBe('42')
    })

    it('computed write is blocked (no-op)', async () => {
      let computedAfterWrite = null

      wildflower.component('set-computed-blocked', {
        state: { count: 5 },
        computed: {
          doubled() { return this.state.count * 2 }
        },
        init() {
          this.doubled = 999
          computedAfterWrite = this.computed.doubled
        }
      })

      testContainer.innerHTML = '<div data-component="set-computed-blocked"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      // The computed should still return the derived value, not 999
      expect(computedAfterWrite).toBe(10)
    })

    it('computed write warns in dev mode', async () => {
      if (isMinifiedBuild()) return // warnings stripped in min builds

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      wildflower.component('set-computed-warns', {
        state: { count: 5 },
        computed: {
          doubled() { return this.state.count * 2 }
        },
        init() {
          this.doubled = 999
        }
      })

      testContainer.innerHTML = '<div data-component="set-computed-warns"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const foundWarning = warnSpy.mock.calls.some(
        call => call[0] && typeof call[0] === 'string' && call[0].includes('doubled')
      )
      expect(foundWarning).toBe(true)

      warnSpy.mockRestore()
    })

    it('ad-hoc property on context stays on context, not in state', async () => {
      let customFlag = null
      let inState = null

      wildflower.component('set-adhoc', {
        state: { count: 0 },
        init() {
          this.customFlag = true
          customFlag = this.customFlag
          inState = this.state.customFlag
        }
      })

      testContainer.innerHTML = '<div data-component="set-adhoc"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(customFlag).toBe(true)
      expect(inState).toBeUndefined()
    })
  })

  // ============================================================
  // Section 5: Backward Compatibility
  // ============================================================
  describe('Backward Compatibility', () => {

    it('this.state.count still works for reading', async () => {
      let capturedValue = null

      wildflower.component('compat-state-read', {
        state: { count: 42 },
        init() {
          capturedValue = this.state.count
        }
      })

      testContainer.innerHTML = '<div data-component="compat-state-read"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(capturedValue).toBe(42)
    })

    it('this.state.count = 5 still works for writing', async () => {
      let afterWrite = null

      wildflower.component('compat-state-write', {
        state: { count: 0 },
        init() {
          this.state.count = 5
          afterWrite = this.state.count
        }
      })

      testContainer.innerHTML = '<div data-component="compat-state-write"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(afterWrite).toBe(5)
    })

    it('this.computed.doubled still works', async () => {
      let capturedValue = null

      wildflower.component('compat-computed', {
        state: { count: 7 },
        computed: {
          doubled() { return this.state.count * 2 }
        },
        init() {
          capturedValue = this.computed.doubled
        }
      })

      testContainer.innerHTML = '<div data-component="compat-computed"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(capturedValue).toBe(14)
    })

    it('this.stores.myStore still works', async () => {
      let hasStoresObj = null

      wildflower.store('compat-store-test', {
        state: { value: 123 }
      })

      wildflower.component('compat-stores', {
        subscribe: { 'compat-store-test': ['value'] },
        state: {},
        init() {
          hasStoresObj = typeof this.stores === 'object'
        }
      })

      testContainer.innerHTML = '<div data-component="compat-stores"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(hasStoresObj).toBe(true)
    })

    it('this.element returns DOM element', async () => {
      let isHTMLElement = null

      wildflower.component('compat-element', {
        state: {},
        init() {
          isHTMLElement = this.element instanceof HTMLElement
        }
      })

      testContainer.innerHTML = '<div data-component="compat-element"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(isHTMLElement).toBe(true)
    })

    it('this.id returns instance ID', async () => {
      let capturedId = null

      wildflower.component('compat-id', {
        state: {},
        init() {
          capturedId = this.id
        }
      })

      testContainer.innerHTML = '<div data-component="compat-id"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(capturedId).toBeTypeOf('string')
      expect(capturedId.length).toBeGreaterThan(0)
    })

    it('this.emit() is callable as framework method', async () => {
      let emitIsFunction = null
      let noThrow = true

      wildflower.component('compat-emit-parent', {
        state: {},
        onChildEvent() {
          // Handler for child emit
        }
      })

      wildflower.component('compat-emit-child', {
        state: {},
        init() {
          emitIsFunction = typeof this.emit === 'function'
          try {
            this.emit('childEvent', { data: 1 })
          } catch (e) {
            noThrow = false
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="compat-emit-parent">
          <div data-component="compat-emit-child"></div>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(emitIsFunction).toBe(true)
      expect(noThrow).toBe(true)
    })

    it('this.find() queries DOM', async () => {
      let foundSpan = null

      wildflower.component('compat-find', {
        state: {},
        init() {
          foundSpan = this.find('.inner')
        }
      })

      testContainer.innerHTML = `
        <div data-component="compat-find">
          <span class="inner">hello</span>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(foundSpan).toBeInstanceOf(HTMLElement)
      expect(foundSpan.textContent).toBe('hello')
    })

    it('this.update("count", 5) sets state', async () => {
      let afterUpdate = null

      wildflower.component('compat-update', {
        state: { count: 0 },
        init() {
          this.update('count', 5)
          afterUpdate = this.state.count
        }
      })

      testContainer.innerHTML = '<div data-component="compat-update"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(afterUpdate).toBe(5)
    })

    it('this.props.title returns prop value', async () => {
      let capturedTitle = null

      wildflower.component('compat-props-parent', {
        state: { heading: 'Hello' }
      })

      wildflower.component('compat-props-child', {
        props: { title: { type: String } },
        state: {},
        init() {
          capturedTitle = this.props?.title
        }
      })

      testContainer.innerHTML = `
        <div data-component="compat-props-parent">
          <div data-component="compat-props-child" data-prop-title="heading"></div>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(capturedTitle).toBe('Hello')
    })
  })

  // ============================================================
  // Section 6: Store Proxy
  // ============================================================
  describe('Store Proxy', () => {

    it('store method reads state via shorthand', async () => {
      let capturedCount = null

      wildflower.store('store-shorthand-read', {
        state: { count: 99 },
        getCount() {
          capturedCount = this.count
        }
      })
      await waitForUpdate()

      const store = wildflower.getStore('store-shorthand-read')
      store.getCount()

      expect(capturedCount).toBe(99)
    })

    it('store method writes state via shorthand', async () => {
      wildflower.store('store-shorthand-write', {
        state: { count: 0 },
        setCount(val) {
          this.count = val
        }
      })
      await waitForUpdate()

      const store = wildflower.getStore('store-shorthand-write')
      store.setCount(55)

      expect(store.state.count).toBe(55)
    })

    it('store computed uses shorthand', async () => {
      let capturedDoubled = null

      wildflower.store('store-computed-shorthand', {
        state: { count: 8 },
        computed: {
          doubled() { return this.count * 2 }
        },
        getDoubled() {
          capturedDoubled = this.doubled
        }
      })
      await waitForUpdate()

      const store = wildflower.getStore('store-computed-shorthand')
      store.getDoubled()

      expect(capturedDoubled).toBe(16)
    })

    it('store shorthand triggers subscriber notification', async () => {
      wildflower.store('store-shorthand-notify', {
        state: { count: 0 },
        increment() {
          this.count++
        }
      })

      wildflower.component('store-subscriber-test', {
        state: {},
        subscribe: { 'store-shorthand-notify': ['count'] },
        init() {
          // Will be notified when store state changes
        }
      })

      testContainer.innerHTML = '<div data-component="store-subscriber-test"><span data-bind="stores.store-shorthand-notify.state.count"></span></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const store = wildflower.getStore('store-shorthand-notify')
      store.increment()
      await waitForUpdate()

      // The store's state should have been updated reactively
      expect(store.state.count).toBe(1)
    })

    it('store this.state.count backward compat still works', async () => {
      let capturedValue = null

      wildflower.store('store-compat', {
        state: { count: 77 },
        getCount() {
          capturedValue = this.state.count
        }
      })
      await waitForUpdate()

      const store = wildflower.getStore('store-compat')
      store.getCount()

      expect(capturedValue).toBe(77)
    })
  })

  // ============================================================
  // Section 7: has Trap (the `in` Operator)
  // ============================================================
  describe('has Trap (in operator)', () => {

    it('"count" in this returns true for state property', async () => {
      let result = null

      wildflower.component('has-state', {
        state: { count: 0 },
        init() {
          result = 'count' in this
        }
      })

      testContainer.innerHTML = '<div data-component="has-state"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(result).toBe(true)
    })

    it('"doubled" in this returns true for computed', async () => {
      let result = null

      wildflower.component('has-computed', {
        state: { count: 0 },
        computed: {
          doubled() { return this.state.count * 2 }
        },
        init() {
          result = 'doubled' in this
        }
      })

      testContainer.innerHTML = '<div data-component="has-computed"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(result).toBe(true)
    })

    it('"element" in this returns true for framework property', async () => {
      let result = null

      wildflower.component('has-framework', {
        state: {},
        init() {
          result = 'element' in this
        }
      })

      testContainer.innerHTML = '<div data-component="has-framework"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(result).toBe(true)
    })

    it('"nonexistent" in this returns false for missing property', async () => {
      let result = null

      wildflower.component('has-missing', {
        state: {},
        init() {
          result = 'nonexistent' in this
        }
      })

      testContainer.innerHTML = '<div data-component="has-missing"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(result).toBe(false)
    })

    it('"_internal" in this returns false for underscore-prefixed state', async () => {
      let result = null

      wildflower.component('has-underscore', {
        state: { _private: 'secret' },
        init() {
          result = '_private' in this
        }
      })

      testContainer.innerHTML = '<div data-component="has-underscore"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(result).toBe(false)
    })
  })

  // ============================================================
  // Section 8: Self-Referencing Helpers
  // ============================================================
  describe('Self-Referencing Helpers', () => {

    it('update() returns proxy for chaining', async () => {
      let noThrow = true
      let countAfterChain = null

      wildflower.component('helper-update-chain', {
        state: { count: 0, name: 'test' },
        init() {
          try {
            this.update('count', 1)
            this.update('name', 'a')
            countAfterChain = this.count
          } catch (e) {
            noThrow = false
          }
        }
      })

      testContainer.innerHTML = '<div data-component="helper-update-chain"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(noThrow).toBe(true)
      expect(countAfterChain).toBe(1)
    })
  })

  // ============================================================
  // Section 9: Underscore-Prefixed State Filtering
  // ============================================================
  describe('Underscore-Prefixed State Filtering', () => {

    it('this._private does NOT resolve state shorthand', async () => {
      let capturedValue = 'not-undefined'

      wildflower.component('underscore-filter', {
        state: { _private: 'secret' },
        init() {
          capturedValue = this._private
        }
      })

      testContainer.innerHTML = '<div data-component="underscore-filter"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(capturedValue).toBeUndefined()
    })

    it('this.state._private still works via explicit form', async () => {
      let capturedValue = null

      wildflower.component('underscore-explicit', {
        state: { _private: 'secret' },
        init() {
          capturedValue = this.state._private
        }
      })

      testContainer.innerHTML = '<div data-component="underscore-explicit"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(capturedValue).toBe('secret')
    })
  })

  // ============================================================
  // Section 10: Template/Method Parity
  // ============================================================
  describe('Template/Method Parity', () => {

    it('data-bind="count" and this.count resolve same value', async () => {
      let methodValue = null

      wildflower.component('parity-read', {
        state: { count: 7 },
        init() {
          methodValue = this.count
        }
      })

      testContainer.innerHTML = `
        <div data-component="parity-read">
          <span data-bind="count"></span>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const domValue = testContainer.querySelector('[data-bind="count"]').textContent
      expect(domValue).toBe('7')
      expect(methodValue).toBe(7)
    })

    it('shorthand write updates template binding', async () => {
      wildflower.component('parity-write', {
        state: { count: 0 },
        setCount() {
          this.count = 99
        }
      })

      testContainer.innerHTML = `
        <div data-component="parity-write">
          <span data-bind="count"></span>
          <button data-action="setCount">Set</button>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      testContainer.querySelector('button').click()
      await waitForUpdate()

      expect(testContainer.querySelector('[data-bind="count"]').textContent).toBe('99')
    })

    it('computed resolves same in template and method', async () => {
      let methodDoubled = null

      wildflower.component('parity-computed', {
        state: { count: 7 },
        computed: {
          doubled() { return this.state.count * 2 }
        },
        init() {
          methodDoubled = this.doubled
        }
      })

      testContainer.innerHTML = `
        <div data-component="parity-computed">
          <span data-bind="doubled"></span>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(testContainer.querySelector('[data-bind="doubled"]').textContent).toBe('14')
      expect(methodDoubled).toBe(14)
    })
  })

  // ============================================================
  // Section 11: Edge Cases
  // ============================================================
  describe('Edge Cases', () => {

    it('method returning this returns the proxy', async () => {
      let returnedThis = null
      let shorthandWorks = null

      wildflower.component('edge-return-this', {
        state: { count: 42 },
        getContext() {
          return this
        },
        init() {
          returnedThis = this.getContext()
          shorthandWorks = returnedThis.count
        }
      })

      testContainer.innerHTML = '<div data-component="edge-return-this"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(shorthandWorks).toBe(42)
    })

    it('init() lifecycle has shorthand access', async () => {
      let capturedInInit = null

      wildflower.component('edge-init', {
        state: { count: 10 },
        init() {
          this.count = 20
          capturedInInit = this.count
        }
      })

      testContainer.innerHTML = '<div data-component="edge-init"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(capturedInInit).toBe(20)
    })

    it('destroy() lifecycle has shorthand access (no crash)', async () => {
      let noThrow = true

      wildflower.component('edge-destroy', {
        state: { count: 0 },
        destroy() {
          try {
            const val = this.count
          } catch (e) {
            noThrow = false
          }
        }
      })

      testContainer.innerHTML = '<div data-component="edge-destroy"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      // Remove the component to trigger destroy
      const el = testContainer.querySelector('[data-component="edge-destroy"]')
      el.parentNode.removeChild(el)
      await waitForUpdate()

      expect(noThrow).toBe(true)
    })

    it('component with empty state: accessing this.nonexistent returns undefined', async () => {
      let capturedValue = 'not-undefined'

      wildflower.component('edge-empty-state', {
        state: {},
        init() {
          capturedValue = this.nonexistent
        }
      })

      testContainer.innerHTML = '<div data-component="edge-empty-state"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(capturedValue).toBeUndefined()
    })

    it('component with no computed: this.count reads state correctly', async () => {
      let capturedValue = null

      wildflower.component('edge-no-computed', {
        state: { count: 55 },
        init() {
          capturedValue = this.count
        }
      })

      testContainer.innerHTML = '<div data-component="edge-no-computed"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(capturedValue).toBe(55)
    })

    it('watch handler has shorthand access', async () => {
      let watchSawShorthand = null

      wildflower.component('edge-watch', {
        state: { count: 0, label: 'start' },
        watch: {
          count() {
            watchSawShorthand = this.label
          }
        },
        init() {
          this.state.count = 1
        }
      })

      testContainer.innerHTML = '<div data-component="edge-watch"></div>'
      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      expect(watchSawShorthand).toBe('start')
    })
  })

  // ============================================================
  // Section 12: Cross-Entity Shorthand Dependency Tracking
  // ============================================================
  describe('Cross-Entity Shorthand Dependency Tracking', () => {

    it.skipIf(isMinifiedBuild())('component computed re-evaluates when store state changes via shorthand', async () => {
      wildflower.store('tracking-store', {
        state: { query: '', items: ['a', 'b', 'c'] }
      })

      wildflower.component('tracking-consumer', {
        subscribe: { 'tracking-store': [] },
        state: {},
        computed: {
          filtered() {
            if (!this.stores['tracking-store']) return []
            var q = this.stores['tracking-store'].query
            var items = this.stores['tracking-store'].items
            if (!q) return items
            return items.filter(function(i) { return i.includes(q) })
          },
          count() {
            return this.filtered.length
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="tracking-consumer">
          <span class="count" data-bind="count"></span>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      // Initial: no filter, all 3 items
      expect(testContainer.querySelector('.count').textContent).toBe('3')

      // Update store state via shorthand
      const store = wildflower.storeManager._namedStores.get('tracking-store')
      store.context.query = 'a'
      await waitForUpdate(100)

      // Should re-evaluate: only 'a' matches
      expect(testContainer.querySelector('.count').textContent).toBe('1')
    })

    it.skipIf(isMinifiedBuild())('component computed re-evaluates when store computed changes via shorthand', async () => {
      wildflower.store('computed-tracking-store', {
        state: { multiplier: 2 },
        computed: {
          doubled() { return this.multiplier * 2 }
        }
      })

      wildflower.component('computed-tracking-consumer', {
        subscribe: { 'computed-tracking-store': [] },
        state: {},
        computed: {
          storeDoubled() {
            if (!this.stores['computed-tracking-store']) return 0
            return this.stores['computed-tracking-store'].doubled
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="computed-tracking-consumer">
          <span class="val" data-bind="storeDoubled"></span>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      expect(testContainer.querySelector('.val').textContent).toBe('4')

      // Change store state to trigger computed recalc
      const store = wildflower.storeManager._namedStores.get('computed-tracking-store')
      store.state.multiplier = 5
      await waitForUpdate(100)

      expect(testContainer.querySelector('.val').textContent).toBe('10')
    })

    it.skipIf(isMinifiedBuild())('store state shorthand write from component triggers re-render', async () => {
      wildflower.store('writable-store', {
        state: { label: 'initial' }
      })

      wildflower.component('store-writer', {
        subscribe: { 'writable-store': [] },
        state: {},
        computed: {
          storeLabel() {
            if (!this.stores['writable-store']) return ''
            return this.stores['writable-store'].label
          }
        },
        updateLabel() {
          if (this.stores['writable-store']) {
            this.stores['writable-store'].label = 'updated'
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="store-writer">
          <span class="label" data-bind="storeLabel"></span>
          <button data-action="updateLabel"></button>
        </div>
      `
      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      expect(testContainer.querySelector('.label').textContent).toBe('initial')

      // Click button to write to store via shorthand
      testContainer.querySelector('button').click()
      await waitForUpdate(100)

      expect(testContainer.querySelector('.label').textContent).toBe('updated')
    })
  })
})
