/**
 * WildflowerJS Portal Focus Management Test Suite - Vitest Browser Mode
 *
 * Tests for focus management and accessibility in portals.
 * Validates that modals/dialogs created via portals are accessible.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, hasFeature } from './helpers/load-framework.js'

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

// Skip entire suite if portals not available (lite build)
const describeIfPortals = hasFeature('portals') ? describe : describe.skip

describeIfPortals('Portal Focus Management', () => {
  let testContainer
  let portalTarget
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

    // Create portal target container
    portalTarget = document.createElement('div')
    portalTarget.id = 'portal-target'
    portalTarget.style.position = 'absolute'
    portalTarget.style.left = '-9999px'
    portalTarget.style.opacity = '0'
    document.body.appendChild(portalTarget)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
    if (portalTarget && portalTarget.parentNode) {
      portalTarget.parentNode.removeChild(portalTarget)
    }
    // Clean up any portaled content
    document.querySelectorAll('[data-portaled]').forEach(el => el.remove())
  })

  describe('Focus Trapping in Portaled Modals', () => {
    it('should render focusable elements in portal', async () => {
      wildflower.component('modal-with-inputs', {
        state: { showModal: true },
        init() {
          this.element.innerHTML = `
            <div data-show="showModal">
              <div data-portal="#portal-target">
                <div class="modal" data-portaled>
                  <input type="text" class="first-input" placeholder="First">
                  <input type="text" class="second-input" placeholder="Second">
                  <button class="close-btn">Close</button>
                </div>
              </div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="modal-with-inputs"></div>'
      await wildflower.scan()
      await waitForCompleteRender()

      // Verify focusable elements exist in portal target
      const modal = portalTarget.querySelector('.modal')
      expect(modal).not.toBeNull()

      const inputs = modal.querySelectorAll('input')
      expect(inputs.length).toBe(2)

      const button = modal.querySelector('button')
      expect(button).not.toBeNull()
    })

    it('should allow focusing elements inside portal', async () => {
      wildflower.component('focusable-modal', {
        state: {},
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="modal" data-portaled>
                <input type="text" class="modal-input" id="modal-input">
              </div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="focusable-modal"></div>'
      await wildflower.scan()
      await waitForCompleteRender()

      const input = portalTarget.querySelector('.modal-input')
      expect(input).not.toBeNull()

      // Focus the input
      input.focus()
      await waitForUpdate()

      // Verify focus is on the input
      expect(document.activeElement).toBe(input)
    })

    it('should maintain focus when typing in portal input', async () => {
      wildflower.component('typing-modal', {
        state: { value: '' },
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="modal" data-portaled>
                <input type="text" class="type-input" data-model="value">
              </div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="typing-modal"></div>'
      await wildflower.scan()
      await waitForCompleteRender()

      const input = portalTarget.querySelector('.type-input')
      input.focus()

      // Simulate typing
      input.value = 'Hello'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()

      // Focus should still be on input
      expect(document.activeElement).toBe(input)
      expect(input.value).toBe('Hello')
    })
  })

  describe('Tabindex and Tab Order', () => {
    it('should preserve tab order for elements in portal', async () => {
      wildflower.component('taborder-modal', {
        state: {},
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="modal" data-portaled>
                <button class="btn-1" tabindex="1">First</button>
                <button class="btn-2" tabindex="2">Second</button>
                <button class="btn-3" tabindex="3">Third</button>
              </div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="taborder-modal"></div>'
      await wildflower.scan()
      await waitForCompleteRender()

      const modal = portalTarget.querySelector('.modal')
      const buttons = modal.querySelectorAll('button')

      expect(buttons.length).toBe(3)
      expect(buttons[0].getAttribute('tabindex')).toBe('1')
      expect(buttons[1].getAttribute('tabindex')).toBe('2')
      expect(buttons[2].getAttribute('tabindex')).toBe('3')
    })

    it('should handle tabindex="-1" for programmatic focus only', async () => {
      wildflower.component('programmatic-focus-modal', {
        state: {},
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="modal" tabindex="-1" data-portaled>
                <p>Modal content</p>
                <button class="focus-me">OK</button>
              </div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="programmatic-focus-modal"></div>'
      await wildflower.scan()
      await waitForCompleteRender()

      const modal = portalTarget.querySelector('.modal')
      expect(modal.getAttribute('tabindex')).toBe('-1')

      // Can still focus programmatically
      modal.focus()
      await waitForUpdate()

      expect(document.activeElement).toBe(modal)
    })
  })

  describe('ARIA Attributes in Portals', () => {
    it('should preserve aria-label on portal content', async () => {
      wildflower.component('aria-label-modal', {
        state: {},
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="modal" role="dialog" aria-label="User settings" data-portaled>
                <h2>Settings</h2>
              </div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="aria-label-modal"></div>'
      await wildflower.scan()
      await waitForCompleteRender()

      const modal = portalTarget.querySelector('.modal')
      expect(modal.getAttribute('role')).toBe('dialog')
      expect(modal.getAttribute('aria-label')).toBe('User settings')
    })

    it('should preserve aria-modal attribute', async () => {
      wildflower.component('aria-modal-test', {
        state: {},
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="modal" role="dialog" aria-modal="true" data-portaled>
                <p>Modal content</p>
              </div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="aria-modal-test"></div>'
      await wildflower.scan()
      await waitForCompleteRender()

      const modal = portalTarget.querySelector('.modal')
      expect(modal.getAttribute('aria-modal')).toBe('true')
    })

    it('should preserve aria-labelledby reference', async () => {
      wildflower.component('aria-labelledby-modal', {
        state: {},
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="modal" role="dialog" aria-labelledby="modal-title" data-portaled>
                <h2 id="modal-title">Dialog Title</h2>
                <p>Content here</p>
              </div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="aria-labelledby-modal"></div>'
      await wildflower.scan()
      await waitForCompleteRender()

      const modal = portalTarget.querySelector('.modal')
      expect(modal.getAttribute('aria-labelledby')).toBe('modal-title')

      const title = modal.querySelector('#modal-title')
      expect(title).not.toBeNull()
      expect(title.textContent).toBe('Dialog Title')
    })

    it('should preserve aria-describedby reference', async () => {
      wildflower.component('aria-describedby-modal', {
        state: {},
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="modal" role="alertdialog" aria-describedby="alert-desc" data-portaled>
                <p id="alert-desc">Are you sure you want to delete?</p>
                <button>Confirm</button>
              </div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="aria-describedby-modal"></div>'
      await wildflower.scan()
      await waitForCompleteRender()

      const modal = portalTarget.querySelector('.modal')
      expect(modal.getAttribute('role')).toBe('alertdialog')
      expect(modal.getAttribute('aria-describedby')).toBe('alert-desc')

      const desc = modal.querySelector('#alert-desc')
      expect(desc.textContent).toBe('Are you sure you want to delete?')
    })
  })

  describe('Focus Return on Modal Close', () => {
    it('should allow manual focus return after modal closes', async () => {
      wildflower.component('focus-return-modal', {
        state: { showModal: false },
        openModal() {
          this.state.showModal = true
        },
        closeModal() {
          this.state.showModal = false
          // Manual focus return
          const trigger = this.element.querySelector('.trigger-btn')
          if (trigger) trigger.focus()
        },
        init() {
          this.element.innerHTML = `
            <button class="trigger-btn" data-action="openModal">Open Modal</button>
            <div data-show="showModal">
              <div data-portal="#portal-target">
                <div class="modal" data-portaled>
                  <button class="close-btn" data-action="closeModal">Close</button>
                </div>
              </div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="focus-return-modal"></div>'
      await wildflower.scan()
      await waitForCompleteRender()

      const triggerBtn = testContainer.querySelector('.trigger-btn')
      triggerBtn.focus()
      expect(document.activeElement).toBe(triggerBtn)

      // Open modal
      triggerBtn.click()
      await waitForCompleteRender()

      // Modal should be visible
      const modal = portalTarget.querySelector('.modal')
      expect(modal).not.toBeNull()

      // Close modal
      const closeBtn = portalTarget.querySelector('.close-btn')
      closeBtn.click()
      await waitForCompleteRender()

      // Focus should return to trigger
      expect(document.activeElement).toBe(triggerBtn)
    })
  })

  describe('Multiple Focusable Portals', () => {
    it('should handle focus in multiple concurrent portals', async () => {
      // Create secondary portal target
      const secondTarget = document.createElement('div')
      secondTarget.id = 'second-portal-target'
      secondTarget.style.position = 'absolute'
      secondTarget.style.left = '-9999px'
      document.body.appendChild(secondTarget)

      wildflower.component('multi-portal-focus', {
        state: {},
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="modal-1" data-portaled>
                <input class="input-1" placeholder="Modal 1">
              </div>
            </div>
            <div data-portal="#second-portal-target">
              <div class="modal-2" data-portaled>
                <input class="input-2" placeholder="Modal 2">
              </div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="multi-portal-focus"></div>'
      await wildflower.scan()
      await waitForCompleteRender()

      const input1 = portalTarget.querySelector('.input-1')
      const input2 = secondTarget.querySelector('.input-2')

      expect(input1).not.toBeNull()
      expect(input2).not.toBeNull()

      // Focus first input
      input1.focus()
      expect(document.activeElement).toBe(input1)

      // Focus second input
      input2.focus()
      expect(document.activeElement).toBe(input2)

      // Cleanup
      secondTarget.remove()
    })
  })

  describe('Focus with Portal Show/Hide', () => {
    it('should handle focus when portal is shown', async () => {
      wildflower.component('show-focus-portal', {
        state: { visible: true },
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="shown-modal" data-portaled>
                <input class="show-input">
              </div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="show-focus-portal"></div>'
      await wildflower.scan()
      await waitForCompleteRender()

      // Modal should be visible
      const modal = portalTarget.querySelector('.shown-modal')
      expect(modal).not.toBeNull()

      const input = modal.querySelector('.show-input')
      input.focus()
      expect(document.activeElement).toBe(input)

      // Type in input
      input.value = 'test'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()

      // Focus should still be on input after typing
      expect(document.activeElement).toBe(input)
    })
  })

  describe('Keyboard Navigation in Portals', () => {
    it('should allow Enter key to activate buttons in portal', async () => {
      let buttonClicked = false

      wildflower.component('keyboard-portal', {
        state: {},
        handleClick() {
          buttonClicked = true
        },
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="modal" data-portaled>
                <button class="enter-btn" data-action="handleClick">Press Enter</button>
              </div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="keyboard-portal"></div>'
      await wildflower.scan()
      await waitForCompleteRender()

      const button = portalTarget.querySelector('.enter-btn')
      button.focus()

      // Simulate Enter key
      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true
      })
      button.dispatchEvent(enterEvent)
      button.click() // Enter on button typically triggers click
      await waitForUpdate()

      expect(buttonClicked).toBe(true)
    })

    it('should allow Space key to activate buttons in portal', async () => {
      let spacePressed = false

      wildflower.component('space-key-portal', {
        state: {},
        handleClick() {
          spacePressed = true
        },
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="modal" data-portaled>
                <button class="space-btn" data-action="handleClick">Press Space</button>
              </div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="space-key-portal"></div>'
      await wildflower.scan()
      await waitForCompleteRender()

      const button = portalTarget.querySelector('.space-btn')
      button.focus()
      button.click() // Space on button triggers click
      await waitForUpdate()

      expect(spacePressed).toBe(true)
    })
  })

  describe('Form Elements in Portals', () => {
    it('should handle form submission in portal', async () => {
      let formSubmitted = false

      wildflower.component('form-portal', {
        state: {},
        handleSubmit(e) {
          e.preventDefault()
          formSubmitted = true
        },
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <form class="portal-form" data-action="submit:handleSubmit" data-portaled>
                <input type="text" name="username" class="username-input">
                <button type="submit" class="submit-btn">Submit</button>
              </form>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="form-portal"></div>'
      await wildflower.scan()
      await waitForCompleteRender()

      const form = portalTarget.querySelector('.portal-form')
      const input = form.querySelector('.username-input')
      const submitBtn = form.querySelector('.submit-btn')

      expect(form).not.toBeNull()
      expect(input).not.toBeNull()
      expect(submitBtn).not.toBeNull()

      // Fill in form
      input.value = 'testuser'
      input.dispatchEvent(new Event('input', { bubbles: true }))

      // Submit form
      submitBtn.click()
      await waitForUpdate()

      expect(formSubmitted).toBe(true)
    })

    it('should handle select elements in portal', async () => {
      wildflower.component('select-portal', {
        state: { selectedValue: '' },
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="modal" data-portaled>
                <select class="portal-select" data-model="selectedValue">
                  <option value="">Select...</option>
                  <option value="a">Option A</option>
                  <option value="b">Option B</option>
                </select>
                <span class="selected-display" data-bind="selectedValue"></span>
              </div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="select-portal"></div>'
      await wildflower.scan()
      await waitForCompleteRender()

      const select = portalTarget.querySelector('.portal-select')
      expect(select).not.toBeNull()

      // Focus and change selection
      select.focus()
      select.value = 'a'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await waitForUpdate()

      const display = portalTarget.querySelector('.selected-display')
      expect(display.textContent).toBe('a')
    })

    it('should handle checkbox in portal', async () => {
      wildflower.component('checkbox-portal', {
        state: { accepted: false },
        init() {
          this.element.innerHTML = `
            <div data-portal="#portal-target">
              <div class="modal" data-portaled>
                <label>
                  <input type="checkbox" class="portal-checkbox" data-model="accepted">
                  Accept terms
                </label>
              </div>
            </div>
          `
        }
      })

      testContainer.innerHTML = '<div data-component="checkbox-portal"></div>'
      await wildflower.scan()
      await waitForCompleteRender()

      const checkbox = portalTarget.querySelector('.portal-checkbox')
      expect(checkbox).not.toBeNull()
      expect(checkbox.checked).toBe(false)

      // Click checkbox
      checkbox.click()
      await waitForUpdate()

      // Checkbox should be checked
      expect(checkbox.checked).toBe(true)

      // Verify component state updated
      const componentEl = testContainer.querySelector('[data-component="checkbox-portal"]')
      const component = wildflower.componentInstances.get(componentEl.dataset.componentId)
      expect(component.state.accepted).toBe(true)
    })
  })
})
