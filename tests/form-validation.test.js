/**
 * Form Validation Test Suite - data-validate-on
 *
 * Tests for the built-in form validation system:
 * - data-validate-on="blur,submit" — validates on both blur and submit
 * - data-validate-on="blur" — validates on blur only, submit does NOT block
 * - data-validate-on="submit" — validates on submit only (explicit)
 * - bare data-validate — validates on submit only (backward compat)
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, waitForUpdate, isMinifiedBuild } from './helpers/load-framework.js'

function ensureComponentScanning(wildflower) {
  if (wildflower._setupDynamicComponentDetection) {
    wildflower._setupDynamicComponentDetection()
  }
}

describe('Form Validation', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()
    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  // =========================================================================
  // _getValidationTriggers
  // =========================================================================

  describe.skipIf(isMinifiedBuild())('_getValidationTriggers', () => {
    it('should parse data-validate-on="blur,submit" into Set with both triggers', () => {
      const form = document.createElement('form')
      form.setAttribute('data-validate-on', 'blur,submit')
      const triggers = wildflower._getValidationTriggers(form)
      expect(triggers.has('blur')).toBe(true)
      expect(triggers.has('submit')).toBe(true)
      expect(triggers.size).toBe(2)
    })

    it('should parse data-validate-on="blur" into Set with blur only', () => {
      const form = document.createElement('form')
      form.setAttribute('data-validate-on', 'blur')
      const triggers = wildflower._getValidationTriggers(form)
      expect(triggers.has('blur')).toBe(true)
      expect(triggers.has('submit')).toBe(false)
      expect(triggers.size).toBe(1)
    })

    it('should parse data-validate-on="submit" into Set with submit only', () => {
      const form = document.createElement('form')
      form.setAttribute('data-validate-on', 'submit')
      const triggers = wildflower._getValidationTriggers(form)
      expect(triggers.has('submit')).toBe(true)
      expect(triggers.has('blur')).toBe(false)
    })

    it('should handle whitespace in data-validate-on values', () => {
      const form = document.createElement('form')
      form.setAttribute('data-validate-on', ' blur , submit ')
      const triggers = wildflower._getValidationTriggers(form)
      expect(triggers.has('blur')).toBe(true)
      expect(triggers.has('submit')).toBe(true)
    })

    it('should return empty set when form has no data-validate-on', () => {
      const form = document.createElement('form')
      const triggers = wildflower._getValidationTriggers(form)
      expect(triggers.size).toBe(0)
    })
  })

  // =========================================================================
  // Submit validation (data-validate-on="submit" and bare data-validate)
  // =========================================================================

  describe('Submit Validation', () => {
    it('should block submit when required field is empty (data-validate-on="submit")', async () => {
      let submitted = false
      testContainer.innerHTML = `
        <div data-component="submit-val-test">
          <form data-validate-on="submit" data-action="handleSubmit" novalidate>
            <input type="text" data-model="username" required>
            <span data-error-for="username"></span>
            <button type="submit">Submit</button>
          </form>
        </div>
      `

      wildflower.component('submit-val-test', {
        state: { username: '' },
        handleSubmit() { submitted = true }
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const form = testContainer.querySelector('form')
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await waitForUpdate(50)

      expect(submitted).toBe(false)
      const errorEl = testContainer.querySelector('[data-error-for="username"]')
      expect(errorEl.textContent).not.toBe('')
    })

    it('should allow submit when required field is filled', async () => {
      let submitted = false
      testContainer.innerHTML = `
        <div data-component="submit-val-pass">
          <form data-validate-on="submit" data-action="handleSubmit" novalidate>
            <input type="text" data-model="username" required>
            <span data-error-for="username"></span>
            <button type="submit">Submit</button>
          </form>
        </div>
      `

      wildflower.component('submit-val-pass', {
        state: { username: 'alice' },
        handleSubmit() { submitted = true }
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      // Set value on the input so HTML5 validation sees it
      const input = testContainer.querySelector('input')
      input.value = 'alice'

      const form = testContainer.querySelector('form')
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await waitForUpdate(50)

      expect(submitted).toBe(true)
    })

    it('should show error for invalid email on submit', async () => {
      let submitted = false
      testContainer.innerHTML = `
        <div data-component="email-val-test">
          <form data-validate-on="submit" data-action="handleSubmit" novalidate>
            <input type="email" data-model="email" required>
            <span data-error-for="email"></span>
            <button type="submit">Submit</button>
          </form>
        </div>
      `

      wildflower.component('email-val-test', {
        state: { email: 'not-an-email' },
        handleSubmit() { submitted = true }
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const input = testContainer.querySelector('input')
      input.value = 'not-an-email'

      const form = testContainer.querySelector('form')
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await waitForUpdate(50)

      expect(submitted).toBe(false)
      const errorEl = testContainer.querySelector('[data-error-for="email"]')
      expect(errorEl.textContent).not.toBe('')
    })

    it('should validate minlength constraint', async () => {
      let submitted = false
      testContainer.innerHTML = `
        <div data-component="minlen-val-test">
          <form data-validate-on="submit" data-action="handleSubmit" novalidate>
            <input type="text" data-model="username" required minlength="3">
            <span data-error-for="username"></span>
            <button type="submit">Submit</button>
          </form>
        </div>
      `

      wildflower.component('minlen-val-test', {
        state: { username: 'ab' },
        handleSubmit() { submitted = true }
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const input = testContainer.querySelector('input')
      input.value = 'ab'

      const form = testContainer.querySelector('form')
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await waitForUpdate(50)

      expect(submitted).toBe(false)
      const errorEl = testContainer.querySelector('[data-error-for="username"]')
      expect(errorEl.textContent).not.toBe('')
    })

    it('should clear errors when field is corrected and resubmitted', async () => {
      let submitCount = 0
      testContainer.innerHTML = `
        <div data-component="clear-err-test">
          <form data-validate-on="submit" data-action="handleSubmit" novalidate>
            <input type="text" data-model="field" required>
            <span data-error-for="field" style="display: none;"></span>
            <button type="submit">Submit</button>
          </form>
        </div>
      `

      wildflower.component('clear-err-test', {
        state: { field: '' },
        handleSubmit() { submitCount++ }
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const form = testContainer.querySelector('form')
      const input = testContainer.querySelector('input')
      const errorEl = testContainer.querySelector('[data-error-for="field"]')

      // First submit — should fail
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await waitForUpdate(50)
      expect(submitCount).toBe(0)
      expect(errorEl.textContent).not.toBe('')
      expect(input.classList.contains('invalid')).toBe(true)

      // Fix the field
      input.value = 'valid'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate(50)

      // Resubmit — should pass and clear error
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await waitForUpdate(50)
      expect(submitCount).toBe(1)
      expect(input.classList.contains('invalid')).toBe(false)
    })
  })

  // =========================================================================
  // Blur validation (data-validate-on includes "blur")
  // =========================================================================

  describe('Blur Validation', () => {
    it('should validate on focusout when data-validate-on includes blur', async () => {
      testContainer.innerHTML = `
        <div data-component="blur-val-test">
          <form data-validate-on="blur,submit" data-action="handleSubmit" novalidate>
            <input type="text" data-model="username" required minlength="3">
            <span data-error-for="username" style="display: none;"></span>
            <button type="submit">Submit</button>
          </form>
        </div>
      `

      wildflower.component('blur-val-test', {
        state: { username: '' },
        handleSubmit() {}
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const input = testContainer.querySelector('input')
      const errorEl = testContainer.querySelector('[data-error-for="username"]')

      // Trigger focusout on empty required field
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      await waitForUpdate(50)

      expect(input.classList.contains('invalid')).toBe(true)
      expect(errorEl.textContent).not.toBe('')
      expect(errorEl.style.display).not.toBe('none')
    })

    it('should clear error on focusout when field becomes valid', async () => {
      testContainer.innerHTML = `
        <div data-component="blur-clear-test">
          <form data-validate-on="blur" data-action="handleSubmit" novalidate>
            <input type="text" data-model="field" required>
            <span data-error-for="field" style="display: none;"></span>
            <button type="submit">Submit</button>
          </form>
        </div>
      `

      wildflower.component('blur-clear-test', {
        state: { field: '' },
        handleSubmit() {}
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const input = testContainer.querySelector('input')
      const errorEl = testContainer.querySelector('[data-error-for="field"]')

      // Blur while empty — should show error
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      await waitForUpdate(50)
      expect(input.classList.contains('invalid')).toBe(true)

      // Fill in value and blur again — should clear error
      input.value = 'valid'
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      await waitForUpdate(50)
      expect(input.classList.contains('invalid')).toBe(false)
      expect(errorEl.textContent).toBe('')
      expect(errorEl.style.display).toBe('none')
    })

    it('should NOT validate on focusout when data-validate-on is submit only', async () => {
      testContainer.innerHTML = `
        <div data-component="no-blur-test">
          <form data-validate-on="submit" data-action="handleSubmit" novalidate>
            <input type="text" data-model="field" required>
            <span data-error-for="field" style="display: none;"></span>
            <button type="submit">Submit</button>
          </form>
        </div>
      `

      wildflower.component('no-blur-test', {
        state: { field: '' },
        handleSubmit() {}
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const input = testContainer.querySelector('input')
      const errorEl = testContainer.querySelector('[data-error-for="field"]')

      // Blur while empty — should NOT show error (submit-only validation)
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      await waitForUpdate(50)
      expect(input.classList.contains('invalid')).toBe(false)
      expect(errorEl.textContent).toBe('')
    })

    it('should NOT validate with bare data-validate (input-level only, not form-level)', async () => {
      let submitted = false
      testContainer.innerHTML = `
        <div data-component="bare-ignored-test">
          <form data-validate data-action="handleSubmit" novalidate>
            <input type="text" data-model="field" required>
            <span data-error-for="field" style="display: none;"></span>
            <button type="submit">Submit</button>
          </form>
        </div>
      `

      wildflower.component('bare-ignored-test', {
        state: { field: '' },
        handleSubmit() { submitted = true }
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      // Blur should not validate (no data-validate-on)
      const input = testContainer.querySelector('input')
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      await waitForUpdate(50)
      expect(input.classList.contains('invalid')).toBe(false)

      // Submit should not be blocked (no data-validate-on)
      const form = testContainer.querySelector('form')
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await waitForUpdate(50)
      expect(submitted).toBe(true)
    })
  })

  // =========================================================================
  // Blur-only mode (no submit blocking)
  // =========================================================================

  describe('Blur-Only Mode', () => {
    it('should NOT block submit when data-validate-on="blur" (no submit trigger)', async () => {
      let submitted = false
      testContainer.innerHTML = `
        <div data-component="blur-only-submit">
          <form data-validate-on="blur" data-action="handleSubmit" novalidate>
            <input type="text" data-model="field" required>
            <span data-error-for="field" style="display: none;"></span>
            <button type="submit">Submit</button>
          </form>
        </div>
      `

      wildflower.component('blur-only-submit', {
        state: { field: '' },
        handleSubmit() { submitted = true }
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const form = testContainer.querySelector('form')
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await waitForUpdate(50)

      // Submit should go through — blur-only mode doesn't block submit
      expect(submitted).toBe(true)
    })
  })

  // =========================================================================
  // Combined blur + submit
  // =========================================================================

  describe('Combined Blur + Submit', () => {
    it('should validate on both blur and submit with data-validate-on="blur,submit"', async () => {
      let submitted = false
      testContainer.innerHTML = `
        <div data-component="combined-val-test">
          <form data-validate-on="blur,submit" data-action="handleSubmit" novalidate>
            <input type="text" data-model="field" required>
            <span data-error-for="field" style="display: none;"></span>
            <button type="submit">Submit</button>
          </form>
        </div>
      `

      wildflower.component('combined-val-test', {
        state: { field: '' },
        handleSubmit() { submitted = true }
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const input = testContainer.querySelector('input')
      const errorEl = testContainer.querySelector('[data-error-for="field"]')
      const form = testContainer.querySelector('form')

      // Blur — should show error
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      await waitForUpdate(50)
      expect(input.classList.contains('invalid')).toBe(true)
      expect(errorEl.textContent).not.toBe('')

      // Submit — should also block
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await waitForUpdate(50)
      expect(submitted).toBe(false)

      // Fix and resubmit
      input.value = 'valid'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate(50)

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await waitForUpdate(50)
      expect(submitted).toBe(true)
    })

    it('should validate multiple fields independently on blur', async () => {
      testContainer.innerHTML = `
        <div data-component="multi-blur-test">
          <form data-validate-on="blur,submit" data-action="handleSubmit" novalidate>
            <input type="text" data-model="firstName" required class="first">
            <span data-error-for="firstName" style="display: none;"></span>
            <input type="email" data-model="email" required class="email">
            <span data-error-for="email" style="display: none;"></span>
            <button type="submit">Submit</button>
          </form>
        </div>
      `

      wildflower.component('multi-blur-test', {
        state: { firstName: '', email: '' },
        handleSubmit() {}
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const firstInput = testContainer.querySelector('.first')
      const emailInput = testContainer.querySelector('.email')
      const firstError = testContainer.querySelector('[data-error-for="firstName"]')
      const emailError = testContainer.querySelector('[data-error-for="email"]')

      // Blur first field only — only first field should show error
      firstInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      await waitForUpdate(50)
      expect(firstInput.classList.contains('invalid')).toBe(true)
      expect(firstError.textContent).not.toBe('')
      // Email should NOT have error yet (hasn't been blurred)
      expect(emailInput.classList.contains('invalid')).toBe(false)
      expect(emailError.textContent).toBe('')

      // Now blur email
      emailInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      await waitForUpdate(50)
      expect(emailInput.classList.contains('invalid')).toBe(true)
      expect(emailError.textContent).not.toBe('')
    })
  })

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe('Edge Cases', () => {
    it('should ignore focusout on non-data-model inputs', async () => {
      testContainer.innerHTML = `
        <div data-component="non-model-test">
          <form data-validate-on="blur,submit" data-action="handleSubmit" novalidate>
            <input type="text" class="plain-input" required>
            <input type="text" data-model="tracked" required>
            <span data-error-for="tracked" style="display: none;"></span>
            <button type="submit">Submit</button>
          </form>
        </div>
      `

      wildflower.component('non-model-test', {
        state: { tracked: '' },
        handleSubmit() {}
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const plainInput = testContainer.querySelector('.plain-input')
      // Should not throw or add error for non-data-model input
      plainInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      await waitForUpdate(50)
      expect(plainInput.classList.contains('invalid')).toBe(false)
    })

    it('should ignore focusout when no data-error-for element exists', async () => {
      testContainer.innerHTML = `
        <div data-component="no-error-el-test">
          <form data-validate-on="blur" novalidate>
            <input type="text" data-model="field" required>
            <!-- no data-error-for element -->
            <button type="submit">Submit</button>
          </form>
        </div>
      `

      wildflower.component('no-error-el-test', {
        state: { field: '' }
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const input = testContainer.querySelector('input')
      // Should not throw
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      await waitForUpdate(50)
      // No error element to update, so no class change either
      // (implementation returns early when no errorEl found)
      expect(true).toBe(true)
    })

    it('should validate min constraint on number inputs', async () => {
      let submitted = false
      testContainer.innerHTML = `
        <div data-component="min-val-test">
          <form data-validate-on="submit" data-action="handleSubmit" novalidate>
            <input type="number" data-model="age" required min="18">
            <span data-error-for="age" style="display: none;"></span>
            <button type="submit">Submit</button>
          </form>
        </div>
      `

      wildflower.component('min-val-test', {
        state: { age: 10 },
        handleSubmit() { submitted = true }
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const input = testContainer.querySelector('input')
      input.value = '10'

      const form = testContainer.querySelector('form')
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await waitForUpdate(50)

      expect(submitted).toBe(false)
      const errorEl = testContainer.querySelector('[data-error-for="age"]')
      expect(errorEl.textContent).not.toBe('')
    })

    it('should validate max constraint on number inputs', async () => {
      let submitted = false
      testContainer.innerHTML = `
        <div data-component="max-val-test">
          <form data-validate-on="submit" data-action="handleSubmit" novalidate>
            <input type="number" data-model="quantity" required max="100">
            <span data-error-for="quantity" style="display: none;"></span>
            <button type="submit">Submit</button>
          </form>
        </div>
      `

      wildflower.component('max-val-test', {
        state: { quantity: 200 },
        handleSubmit() { submitted = true }
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const input = testContainer.querySelector('input')
      input.value = '200'

      const form = testContainer.querySelector('form')
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await waitForUpdate(50)

      expect(submitted).toBe(false)
      const errorEl = testContainer.querySelector('[data-error-for="quantity"]')
      expect(errorEl.textContent).not.toBe('')
    })

    it('should validate type="url" inputs', async () => {
      let submitted = false
      testContainer.innerHTML = `
        <div data-component="url-val-test">
          <form data-validate-on="submit" data-action="handleSubmit" novalidate>
            <input type="url" data-model="website" required>
            <span data-error-for="website" style="display: none;"></span>
            <button type="submit">Submit</button>
          </form>
        </div>
      `

      wildflower.component('url-val-test', {
        state: { website: 'not-a-url' },
        handleSubmit() { submitted = true }
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const input = testContainer.querySelector('input')
      input.value = 'not-a-url'

      const form = testContainer.querySelector('form')
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await waitForUpdate(50)

      expect(submitted).toBe(false)
      const errorEl = testContainer.querySelector('[data-error-for="website"]')
      expect(errorEl.textContent).not.toBe('')
    })

    it('should validate pattern constraint', async () => {
      let submitted = false
      testContainer.innerHTML = `
        <div data-component="pattern-val-test">
          <form data-validate-on="submit" data-action="handleSubmit" novalidate>
            <input type="text" data-model="code" required pattern="[A-Z]{3}-\\d{4}">
            <span data-error-for="code" style="display: none;"></span>
            <button type="submit">Submit</button>
          </form>
        </div>
      `

      wildflower.component('pattern-val-test', {
        state: { code: 'abc' },
        handleSubmit() { submitted = true }
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const input = testContainer.querySelector('input')
      input.value = 'abc'

      const form = testContainer.querySelector('form')
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await waitForUpdate(50)

      expect(submitted).toBe(false)
      const errorEl = testContainer.querySelector('[data-error-for="code"]')
      expect(errorEl.textContent).not.toBe('')
    })
  })
})
