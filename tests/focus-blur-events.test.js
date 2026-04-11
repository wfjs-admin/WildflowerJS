/**
 * WildflowerJS Focus/Blur Events Test Suite - Vitest Browser Mode
 *
 * Tests for focus and blur event handling in form contexts.
 * Part of the test suite gap analysis coverage expansion.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Focus and Blur Events', () => {
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

    // Clear template cache
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

  describe('Basic focus event handling', () => {
    it('should handle focus events on input elements', async () => {
      testContainer.innerHTML = `
        <div data-component="focus-test">
          <input id="test-input" data-action="focus:handleFocus" />
          <div id="focus-status" data-bind="focusStatus"></div>
        </div>
      `

      wildflower.component('focus-test', {
        state: {
          focusStatus: 'not focused'
        },
        handleFocus() {
          this.state.focusStatus = 'focused'
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#focus-status')

      expect(display.textContent).toBe('not focused')

      // Trigger focus event
      input.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
      await waitForUpdate()

      expect(display.textContent).toBe('focused')
    })

    it('should handle focusin events (bubbles)', async () => {
      testContainer.innerHTML = `
        <div data-component="focusin-test">
          <div id="container" data-action="focusin:handleFocusIn">
            <input id="test-input" />
          </div>
          <div id="focus-status" data-bind="focusStatus"></div>
        </div>
      `

      wildflower.component('focusin-test', {
        state: {
          focusStatus: 'not focused'
        },
        handleFocusIn() {
          this.state.focusStatus = 'child focused'
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#focus-status')

      expect(display.textContent).toBe('not focused')

      // Trigger focusin event on input (should bubble to container)
      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      await waitForUpdate()

      expect(display.textContent).toBe('child focused')
    })
  })

  describe('Basic blur event handling', () => {
    it('should handle blur events on input elements', async () => {
      testContainer.innerHTML = `
        <div data-component="blur-test">
          <input id="test-input" data-action="blur:handleBlur" />
          <div id="blur-status" data-bind="blurStatus"></div>
        </div>
      `

      wildflower.component('blur-test', {
        state: {
          blurStatus: 'not blurred'
        },
        handleBlur() {
          this.state.blurStatus = 'blurred'
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#blur-status')

      expect(display.textContent).toBe('not blurred')

      // Trigger blur event
      input.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
      await waitForUpdate()

      expect(display.textContent).toBe('blurred')
    })

    it('should handle focusout events (bubbles)', async () => {
      testContainer.innerHTML = `
        <div data-component="focusout-test">
          <div id="container" data-action="focusout:handleFocusOut">
            <input id="test-input" />
          </div>
          <div id="blur-status" data-bind="blurStatus"></div>
        </div>
      `

      wildflower.component('focusout-test', {
        state: {
          blurStatus: 'not blurred'
        },
        handleFocusOut() {
          this.state.blurStatus = 'child blurred'
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#blur-status')

      expect(display.textContent).toBe('not blurred')

      // Trigger focusout event on input (should bubble to container)
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      await waitForUpdate()

      expect(display.textContent).toBe('child blurred')
    })
  })

  describe('Focus tracking patterns', () => {
    it('should track which field is currently focused', async () => {
      testContainer.innerHTML = `
        <div data-component="focus-tracking-test">
          <input id="name-input" data-action="focus:handleFocus" data-field="name" />
          <input id="email-input" data-action="focus:handleFocus" data-field="email" />
          <input id="phone-input" data-action="focus:handleFocus" data-field="phone" />
          <div id="current-field" data-bind="currentField"></div>
        </div>
      `

      wildflower.component('focus-tracking-test', {
        state: {
          currentField: 'none'
        },
        handleFocus(event, element) {
          this.state.currentField = element.dataset.field
        }
      })

      await waitForUpdate()

      const nameInput = testContainer.querySelector('#name-input')
      const emailInput = testContainer.querySelector('#email-input')
      const phoneInput = testContainer.querySelector('#phone-input')
      const display = testContainer.querySelector('#current-field')

      expect(display.textContent).toBe('none')

      // Focus name input
      nameInput.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('name')

      // Focus email input
      emailInput.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('email')

      // Focus phone input
      phoneInput.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('phone')
    })

    it('should clear focus state on blur', async () => {
      testContainer.innerHTML = `
        <div data-component="focus-clear-test">
          <input id="test-input"
                 data-action="focus:handleFocus blur:handleBlur" />
          <div id="focus-state" data-bind="isFocused ? 'focused' : 'not focused'"></div>
        </div>
      `

      wildflower.component('focus-clear-test', {
        state: {
          isFocused: false
        },
        handleFocus() {
          this.state.isFocused = true
        },
        handleBlur() {
          this.state.isFocused = false
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#focus-state')

      expect(display.textContent).toBe('not focused')

      // Focus input
      input.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('focused')

      // Blur input
      input.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('not focused')
    })
  })

  describe('Form validation on blur', () => {
    it('should validate field on blur', async () => {
      testContainer.innerHTML = `
        <div data-component="blur-validation-test">
          <input id="email-input"
                 data-model="email"
                 data-action="blur:validateEmail" />
          <div id="error-message" data-bind="errorMessage"></div>
        </div>
      `

      wildflower.component('blur-validation-test', {
        state: {
          email: '',
          errorMessage: ''
        },
        validateEmail() {
          const email = this.state.email
          if (!email) {
            this.state.errorMessage = 'Email is required'
          } else if (!email.includes('@')) {
            this.state.errorMessage = 'Invalid email format'
          } else {
            this.state.errorMessage = ''
          }
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#email-input')
      const display = testContainer.querySelector('#error-message')

      // Initially no error
      expect(display.textContent).toBe('')

      // Blur without entering anything
      input.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('Email is required')

      // Enter invalid email
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await waitForUpdate()
      input.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('Invalid email format')

      // Enter valid email
      input.value = 'test@example.com'
      input.dispatchEvent(new Event('input'))
      await waitForUpdate()
      input.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('')
    })

    it('should mark field as touched on blur', async () => {
      testContainer.innerHTML = `
        <div data-component="touched-test">
          <input id="name-input" data-action="blur:markTouched" data-field="name" />
          <input id="email-input" data-action="blur:markTouched" data-field="email" />
          <div id="touched-count" data-bind="touchedCount"></div>
        </div>
      `

      wildflower.component('touched-test', {
        state: {
          touched: {},
          touchedCount: 0
        },
        markTouched(event, element) {
          const field = element.dataset.field
          if (!this.state.touched[field]) {
            this.state.touched[field] = true
            this.state.touchedCount++
          }
        }
      })

      await waitForUpdate()

      const nameInput = testContainer.querySelector('#name-input')
      const emailInput = testContainer.querySelector('#email-input')
      const display = testContainer.querySelector('#touched-count')

      expect(display.textContent).toBe('0')

      // Blur name input
      nameInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('1')

      // Blur name again (should not increment)
      nameInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('1')

      // Blur email input
      emailInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('2')
    })
  })

  describe('Focus management in lists', () => {
    it('should handle focus events in list items using element context', async () => {
      testContainer.innerHTML = `
        <div data-component="list-focus-test">
          <ul data-list="items">
            <template>
              <li>
                <input class="item-input"
                       data-action="focus:handleItemFocus"
                       data-bind-value="name" />
              </li>
            </template>
          </ul>
          <div id="focused-item" data-bind="focusedItem"></div>
        </div>
      `

      wildflower.component('list-focus-test', {
        state: {
          items: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' },
            { id: 3, name: 'Item 3' }
          ],
          focusedItem: 'none'
        },
        handleItemFocus(event, element, detail) {
          // Use the detail object to get item data (more reliable than element.value)
          this.state.focusedItem = detail?.item?.name || element?.value || 'unknown'
        }
      })

      await waitForUpdate()
      await waitForUpdate(100) // Extra time for list rendering

      const inputs = testContainer.querySelectorAll('.item-input')
      const display = testContainer.querySelector('#focused-item')

      expect(inputs.length).toBe(3)
      expect(display.textContent).toBe('none')

      // Focus first item - use focusin which bubbles (focus doesn't bubble natively)
      // The framework listens for focusin and maps it to focus handlers
      inputs[0].dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('Item 1')

      // Focus third item
      inputs[2].dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('Item 3')
    })
  })

  describe('Focus and model interaction', () => {
    it('should update state on focus and use it in computed', async () => {
      testContainer.innerHTML = `
        <div data-component="focus-model-test">
          <input id="price-input"
                 data-model="price"
                 data-action="focus:handleFocus blur:handleBlur" />
          <div id="formatted-price" data-bind="computed:formattedPrice"></div>
        </div>
      `

      wildflower.component('focus-model-test', {
        state: {
          price: 100,
          isEditing: false
        },
        computed: {
          formattedPrice() {
            if (this.state.isEditing) {
              return this.state.price
            }
            return '$' + this.state.price.toFixed(2)
          }
        },
        handleFocus() {
          this.state.isEditing = true
        },
        handleBlur() {
          this.state.isEditing = false
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#price-input')
      const display = testContainer.querySelector('#formatted-price')

      // Initially formatted
      expect(display.textContent).toBe('$100.00')

      // Focus - show raw value
      input.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('100')

      // Blur - show formatted value
      input.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('$100.00')
    })
  })

  describe('Multiple focus/blur handlers', () => {
    it('should support focus and blur on same element', async () => {
      testContainer.innerHTML = `
        <div data-component="multi-handler-test">
          <input id="test-input"
                 data-action="focus:logFocus blur:logBlur" />
          <div id="event-log" data-bind="eventLog"></div>
        </div>
      `

      wildflower.component('multi-handler-test', {
        state: {
          eventLog: ''
        },
        logFocus() {
          this.state.eventLog += 'focus,'
        },
        logBlur() {
          this.state.eventLog += 'blur,'
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#event-log')

      expect(display.textContent).toBe('')

      // Focus
      input.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('focus,')

      // Blur
      input.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('focus,blur,')

      // Focus again
      input.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('focus,blur,focus,')
    })
  })

  describe('Focus with event modifiers', () => {
    it('should work with data-event-once on focus', async () => {
      testContainer.innerHTML = `
        <div data-component="focus-once-test">
          <input id="test-input"
                 data-action="focus:handleFirstFocus"
                 data-event-once />
          <div id="focus-count" data-bind="focusCount"></div>
        </div>
      `

      wildflower.component('focus-once-test', {
        state: {
          focusCount: 0
        },
        handleFirstFocus() {
          this.state.focusCount++
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#focus-count')

      expect(display.textContent).toBe('0')

      // First focus - should trigger
      input.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('1')

      // Second focus - should not trigger (once modifier)
      input.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('1')
    })
  })
})
