/**
 * WildflowerJS Expression Arithmetic Operator Test Suite - Vitest Browser Mode
 *
 * Tests for arithmetic operators (+, -, *, /, %) in data-bind, data-show,
 * and data-bind-class expressions. The expression-evaluation.test.js covers
 * comparison and logical operators; this file covers arithmetic.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, isMinifiedBuild } from './helpers/load-framework.js'

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

describe('Expression Arithmetic Operators', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

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

  // --- data-bind arithmetic ---

  describe('data-bind with arithmetic expressions', () => {
    it('addition: a + b', async () => {
      wildflower.component('arith-add-test', {
        state: { a: 3, b: 7 }
      })

      testContainer.innerHTML = `
        <div data-component="arith-add-test">
          <span id="result" data-bind="a + b"></span>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const result = testContainer.querySelector('#result')
      expect(result.textContent).toBe('10')
    })

    it('subtraction: a - b', async () => {
      wildflower.component('arith-sub-test', {
        state: { a: 20, b: 8 }
      })

      testContainer.innerHTML = `
        <div data-component="arith-sub-test">
          <span id="result" data-bind="a - b"></span>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const result = testContainer.querySelector('#result')
      expect(result.textContent).toBe('12')
    })

    it('multiplication: price * quantity', async () => {
      wildflower.component('arith-mul-test', {
        state: { price: 9, quantity: 4 }
      })

      testContainer.innerHTML = `
        <div data-component="arith-mul-test">
          <span id="result" data-bind="price * quantity"></span>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const result = testContainer.querySelector('#result')
      expect(result.textContent).toBe('36')
    })

    it('division: total / count', async () => {
      wildflower.component('arith-div-test', {
        state: { total: 100, count: 4 }
      })

      testContainer.innerHTML = `
        <div data-component="arith-div-test">
          <span id="result" data-bind="total / count"></span>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const result = testContainer.querySelector('#result')
      expect(result.textContent).toBe('25')
    })

    it('modulo: index % 2', async () => {
      wildflower.component('arith-mod-test', {
        state: { index: 7 }
      })

      testContainer.innerHTML = `
        <div data-component="arith-mod-test">
          <span id="result" data-bind="index % 2"></span>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const result = testContainer.querySelector('#result')
      expect(result.textContent).toBe('1')
    })

    it('string concatenation: firstName + " " + lastName', async () => {
      wildflower.component('arith-concat-test', {
        state: { firstName: 'Jane', lastName: 'Doe' }
      })

      testContainer.innerHTML = `
        <div data-component="arith-concat-test">
          <span id="result" data-bind="firstName + ' ' + lastName"></span>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const result = testContainer.querySelector('#result')
      expect(result.textContent).toBe('Jane Doe')
    })

    it('mixed arithmetic with parentheses: (price * quantity) * (1 + taxRate)', async () => {
      wildflower.component('arith-mixed-test', {
        state: { price: 10, quantity: 5, taxRate: 0.1 }
      })

      testContainer.innerHTML = `
        <div data-component="arith-mixed-test">
          <span id="result" data-bind="(price * quantity) * (1 + taxRate)"></span>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const result = testContainer.querySelector('#result')
      // 10 * 5 = 50, 50 * 1.1 = 55.00000000000001 (or 55)
      expect(Number(result.textContent)).toBeCloseTo(55, 5)
    })
  })

  // --- data-show with arithmetic ---

  describe('data-show with arithmetic expressions', () => {
    it('even check: count % 2 === 0', async () => {
      wildflower.component('arith-show-even-test', {
        state: { count: 4 }
      })

      testContainer.innerHTML = `
        <div data-component="arith-show-even-test">
          <div id="even-indicator" data-show="count % 2 === 0">Even</div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const el = testContainer.querySelector('[data-component="arith-show-even-test"]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)
      const indicator = testContainer.querySelector('#even-indicator')

      // 4 is even, should be visible
      expect(indicator.style.display).not.toBe('none')

      // Change to odd
      instance.state.count = 3
      await waitForCompleteRender()

      expect(indicator.style.display).toBe('none')

      // Change back to even
      instance.state.count = 6
      await waitForCompleteRender()

      expect(indicator.style.display).not.toBe('none')
    })

    it('subtraction comparison: total - discount > 0', async () => {
      wildflower.component('arith-show-sub-test', {
        state: { total: 50, discount: 30 }
      })

      testContainer.innerHTML = `
        <div data-component="arith-show-sub-test">
          <div id="positive-balance" data-show="total - discount > 0">Has balance</div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const el = testContainer.querySelector('[data-component="arith-show-sub-test"]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)
      const indicator = testContainer.querySelector('#positive-balance')

      // 50 - 30 = 20 > 0, should be visible
      expect(indicator.style.display).not.toBe('none')

      // Increase discount to exceed total
      instance.state.discount = 60
      await waitForCompleteRender()

      // 50 - 60 = -10 > 0 is false, should be hidden
      expect(indicator.style.display).toBe('none')
    })
  })

  // --- data-bind-class with arithmetic ---

  describe('data-bind-class with arithmetic expressions', () => {
    it('object syntax with modulo: { even: index % 2 === 0 }', async () => {
      wildflower.component('arith-class-mod-test', {
        state: { index: 4 }
      })

      testContainer.innerHTML = `
        <div data-component="arith-class-mod-test">
          <div id="class-target" data-bind-class="{ even: index % 2 === 0 }">Row</div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const el = testContainer.querySelector('[data-component="arith-class-mod-test"]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)
      const target = testContainer.querySelector('#class-target')

      // 4 is even, should have 'even' class
      expect(target.classList.contains('even')).toBe(true)

      // Change to odd
      instance.state.index = 5
      await waitForCompleteRender()

      expect(target.classList.contains('even')).toBe(false)

      // Change back to even
      instance.state.index = 10
      await waitForCompleteRender()

      expect(target.classList.contains('even')).toBe(true)
    })
  })

  // --- Reactivity ---

  describe('Reactivity of arithmetic expressions', () => {
    it('state change updates arithmetic result in DOM', async () => {
      wildflower.component('arith-reactive-test', {
        state: { price: 10, quantity: 2 }
      })

      testContainer.innerHTML = `
        <div data-component="arith-reactive-test">
          <span id="total" data-bind="price * quantity"></span>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const el = testContainer.querySelector('[data-component="arith-reactive-test"]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)
      const total = testContainer.querySelector('#total')

      expect(total.textContent).toBe('20')

      // Update price
      instance.state.price = 15
      await waitForCompleteRender()

      expect(total.textContent).toBe('30')

      // Update quantity
      instance.state.quantity = 3
      await waitForCompleteRender()

      expect(total.textContent).toBe('45')

      // Update both
      instance.state.price = 5
      instance.state.quantity = 10
      await waitForCompleteRender()

      expect(total.textContent).toBe('50')
    })
  })

  // --- Edge cases ---

  describe('Arithmetic edge cases', () => {
    it('division by zero produces Infinity', async () => {
      wildflower.component('arith-divzero-test', {
        state: { total: 10, count: 0 }
      })

      testContainer.innerHTML = `
        <div data-component="arith-divzero-test">
          <span id="result" data-bind="total / count"></span>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const result = testContainer.querySelector('#result')
      // JS division by zero yields Infinity
      expect(result.textContent).toBe('Infinity')
    })

    it('negative numbers in subtraction', async () => {
      wildflower.component('arith-neg-test', {
        state: { a: 5, b: 12 }
      })

      testContainer.innerHTML = `
        <div data-component="arith-neg-test">
          <span id="result" data-bind="a - b"></span>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const result = testContainer.querySelector('#result')
      expect(result.textContent).toBe('-7')
    })

    it('float precision (0.1 + 0.2)', async () => {
      wildflower.component('arith-float-test', {
        state: { a: 0.1, b: 0.2 }
      })

      testContainer.innerHTML = `
        <div data-component="arith-float-test">
          <span id="result" data-bind="a + b"></span>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const result = testContainer.querySelector('#result')
      // JS float: 0.1 + 0.2 = 0.30000000000000004
      expect(Number(result.textContent)).toBeCloseTo(0.3, 10)
    })

    it('string + number type coercion', async () => {
      wildflower.component('arith-coerce-test', {
        state: { label: 'Count: ', count: 5 }
      })

      testContainer.innerHTML = `
        <div data-component="arith-coerce-test">
          <span id="result" data-bind="label + count"></span>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const result = testContainer.querySelector('#result')
      // JS string + number = string concatenation
      expect(result.textContent).toBe('Count: 5')
    })

    it('modulo with zero produces NaN', async () => {
      wildflower.component('arith-modzero-test', {
        state: { index: 5, divisor: 0 }
      })

      testContainer.innerHTML = `
        <div data-component="arith-modzero-test">
          <span id="result" data-bind="index % divisor"></span>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const result = testContainer.querySelector('#result')
      // JS modulo by zero yields NaN
      expect(result.textContent).toBe('NaN')
    })
  })
})
