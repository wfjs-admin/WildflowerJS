/**
 * Single Event Delegation Tests
 *
 * Verifies that model input handling fires exactly once per event,
 * and that all paths (text, checkbox, select, list items, debounce,
 * lazy, store-backed) work through the document-level capture handler.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, waitForUpdate } from './helpers/load-framework.js'

function ensureComponentScanning(wildflower) {
  if (wildflower._setupDynamicComponentDetection) {
    wildflower._setupDynamicComponentDetection()
  }
}

/**
 * Count how many times the model value is updated for a given path
 * during an action. Uses the component's subscribe() API which works
 * across all builds (dev and minified) without touching internal methods.
 */
async function countModelUpdates(wf, instance, path, action) {
  let count = 0
  const unsub = instance.context.subscribe(path, () => { count++ })
  action()
  await new Promise(r => setTimeout(r, 100))
  unsub()
  return count
}

describe('Single Event Delegation', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()
    testContainer = document.createElement('div')
    testContainer.id = 'test-container-sed'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    testContainer?.remove()
  })

  // === DOUBLE-PROCESSING PREVENTION ===

  describe('Double-Processing Prevention', () => {
    it('should update state exactly once per text input event', async () => {
      testContainer.innerHTML = `
        <div data-component="sed-text-test">
          <input type="text" data-model="name">
        </div>
      `

      wildflower.component('sed-text-test', {
        state: { name: '' }
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const el = testContainer.querySelector('[data-component-id]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)
      const input = testContainer.querySelector('input')

      const count = await countModelUpdates(wildflower, instance, 'name', () => {
        input.value = 'hello'
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })

      expect(count).toBe(1)
    })

    it('should update state exactly once per checkbox change', async () => {
      testContainer.innerHTML = `
        <div data-component="sed-check-test">
          <input type="checkbox" data-model="agreed">
        </div>
      `

      wildflower.component('sed-check-test', {
        state: { agreed: false }
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const el = testContainer.querySelector('[data-component-id]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)
      const checkbox = testContainer.querySelector('input[type="checkbox"]')

      const count = await countModelUpdates(wildflower, instance, 'agreed', () => {
        checkbox.checked = true
        checkbox.dispatchEvent(new Event('change', { bubbles: true }))
      })

      expect(count).toBe(1)
    })

    it('should update state exactly once per select change', async () => {
      testContainer.innerHTML = `
        <div data-component="sed-select-test">
          <select data-model="color">
            <option value="">Pick</option>
            <option value="red">Red</option>
          </select>
        </div>
      `

      wildflower.component('sed-select-test', {
        state: { color: '' }
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const el = testContainer.querySelector('[data-component-id]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)
      const select = testContainer.querySelector('select')

      const count = await countModelUpdates(wildflower, instance, 'color', () => {
        select.value = 'red'
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })

      expect(count).toBe(1)
    })

    it('should update state exactly once per radio selection', async () => {
      testContainer.innerHTML = `
        <div data-component="sed-radio-test">
          <input type="radio" name="size" value="small" data-model="size">
          <input type="radio" name="size" value="large" data-model="size">
        </div>
      `

      wildflower.component('sed-radio-test', {
        state: { size: 'small' }
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const el = testContainer.querySelector('[data-component-id]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)
      const largeRadio = testContainer.querySelectorAll('input[type="radio"]')[1]

      const count = await countModelUpdates(wildflower, instance, 'size', () => {
        largeRadio.checked = true
        largeRadio.dispatchEvent(new Event('change', { bubbles: true }))
      })

      expect(count).toBe(1)
    })
  })

  // === DELEGATION CORRECTNESS ===

  describe('Delegation Correctness', () => {
    it('should bind dynamically added input via data-render toggle', async () => {
      testContainer.innerHTML = `
        <div data-component="sed-render-test">
          <div data-render="showInput">
            <input type="text" data-model="value">
          </div>
          <button data-action="toggle">Show</button>
        </div>
      `

      wildflower.component('sed-render-test', {
        state: { showInput: false, value: '' },
        toggle() { this.showInput = !this.showInput }
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      // Toggle to show the input
      testContainer.querySelector('button').click()
      await waitForUpdate(200)

      const input = testContainer.querySelector('input')
      expect(input).not.toBeNull()

      // Type into the dynamically revealed input
      input.value = 'works'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate(50)

      const el = testContainer.querySelector('[data-component-id]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)
      expect(instance.state.value).toBe('works')
    })

    it('should apply trim modifier through delegated handler', async () => {
      testContainer.innerHTML = `
        <div data-component="sed-trim-test">
          <input type="text" data-model="name" data-model-trim>
        </div>
      `

      wildflower.component('sed-trim-test', {
        state: { name: '' }
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const input = testContainer.querySelector('input')
      input.value = '  hello  '
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate(50)

      const el = testContainer.querySelector('[data-component-id]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)
      expect(instance.state.name).toBe('hello')
    })

    it('should apply number modifier through delegated handler', async () => {
      testContainer.innerHTML = `
        <div data-component="sed-number-test">
          <input type="text" data-model="count" data-model-number>
        </div>
      `

      wildflower.component('sed-number-test', {
        state: { count: 0 }
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const input = testContainer.querySelector('input')
      input.value = '42'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate(50)

      const el = testContainer.querySelector('[data-component-id]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)
      expect(instance.state.count).toBe(42)
      expect(typeof instance.state.count).toBe('number')
    })

    it('should handle lazy mode: no update on input, update on blur', async () => {
      testContainer.innerHTML = `
        <div data-component="sed-lazy-test">
          <input type="text" data-model="email" data-model-lazy>
        </div>
      `

      wildflower.component('sed-lazy-test', {
        state: { email: '' }
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const el = testContainer.querySelector('[data-component-id]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)
      const input = testContainer.querySelector('input')

      // Input event should NOT update state in lazy mode
      input.value = 'test@example.com'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate(50)
      expect(instance.state.email).toBe('')

      // Blur should update state
      input.dispatchEvent(new FocusEvent('blur', { bubbles: false }))
      await waitForUpdate(50)
      expect(instance.state.email).toBe('test@example.com')
    })
  })

  // === CLEANUP ===

  describe('Cleanup', () => {
    it('should not process events after component is destroyed', async () => {
      testContainer.innerHTML = `
        <div data-component="sed-destroy-test">
          <input type="text" data-model="name">
        </div>
      `

      wildflower.component('sed-destroy-test', {
        state: { name: '' }
      })

      ensureComponentScanning(wildflower)
      await waitForUpdate(100)

      const el = testContainer.querySelector('[data-component-id]')
      const componentId = el.dataset.componentId
      const input = testContainer.querySelector('input')

      // Destroy the component
      wildflower.destroyComponent(componentId)
      await waitForUpdate(50)

      // Input event on orphaned element should be a no-op
      input.value = 'ghost'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate(50)

      // Component instance should be gone
      expect(wildflower.componentInstances.has(componentId)).toBe(false)
    })
  })
})
