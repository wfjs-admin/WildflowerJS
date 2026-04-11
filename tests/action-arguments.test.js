/**
 * WildflowerJS Action Arguments Test Suite - Vitest Browser Mode
 *
 * Tests for literal argument passing in data-action attributes.
 * e.g. data-action="setPriority('high')"
 *
 * TDD: These tests are written BEFORE the feature implementation.
 * All should FAIL until the feature is implemented.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, getListItems } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to wait for complete render cycle (for lists)
async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

describe('Action Arguments', () => {
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

    // CRITICAL: Clear template cache to prevent cross-test contamination
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

  // ============================================================
  // A. Basic Argument Parsing
  // ============================================================

  describe('Basic Argument Parsing', () => {

    it('should pass a single string argument', async () => {
      let receivedArgs = null

      testContainer.innerHTML = `
        <div data-component="string-arg-test">
          <button id="btn" data-action="setMode('dark')">Dark</button>
          <div data-bind="mode"></div>
        </div>
      `

      wildflower.component('string-arg-test', {
        state: { mode: '' },
        setMode(event, element, detail) {
          receivedArgs = detail.args
          this.state.mode = detail.args[0]
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(receivedArgs).toEqual(['dark'])
      expect(testContainer.querySelector('[data-bind="mode"]').textContent).toBe('dark')
    })

    it('should pass a single number argument', async () => {
      let receivedArgs = null

      testContainer.innerHTML = `
        <div data-component="number-arg-test">
          <button id="btn" data-action="setCount(42)">Set</button>
          <div data-bind="count"></div>
        </div>
      `

      wildflower.component('number-arg-test', {
        state: { count: 0 },
        setCount(event, element, detail) {
          receivedArgs = detail.args
          this.state.count = detail.args[0]
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(receivedArgs).toEqual([42])
      expect(receivedArgs[0]).toBe(42)
      expect(typeof receivedArgs[0]).toBe('number')
    })

    it('should pass boolean true argument', async () => {
      let receivedArgs = null

      testContainer.innerHTML = `
        <div data-component="bool-true-test">
          <button id="btn" data-action="setEnabled(true)">Enable</button>
        </div>
      `

      wildflower.component('bool-true-test', {
        state: { enabled: false },
        setEnabled(event, element, detail) {
          receivedArgs = detail.args
          this.state.enabled = detail.args[0]
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(receivedArgs).toEqual([true])
      expect(receivedArgs[0]).toBe(true)
      expect(typeof receivedArgs[0]).toBe('boolean')
    })

    it('should pass boolean false argument', async () => {
      let receivedArgs = null

      testContainer.innerHTML = `
        <div data-component="bool-false-test">
          <button id="btn" data-action="setEnabled(false)">Disable</button>
        </div>
      `

      wildflower.component('bool-false-test', {
        state: { enabled: true },
        setEnabled(event, element, detail) {
          receivedArgs = detail.args
          this.state.enabled = detail.args[0]
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(receivedArgs).toEqual([false])
      expect(receivedArgs[0]).toBe(false)
      expect(typeof receivedArgs[0]).toBe('boolean')
    })

    it('should pass null argument', async () => {
      let receivedArgs = null

      testContainer.innerHTML = `
        <div data-component="null-arg-test">
          <button id="btn" data-action="reset(null)">Reset</button>
        </div>
      `

      wildflower.component('null-arg-test', {
        state: { value: 'something' },
        reset(event, element, detail) {
          receivedArgs = detail.args
          this.state.value = detail.args[0]
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(receivedArgs).toEqual([null])
      expect(receivedArgs[0]).toBe(null)
    })

    it('should pass negative number argument', async () => {
      let receivedArgs = null

      testContainer.innerHTML = `
        <div data-component="neg-num-test">
          <button id="btn" data-action="adjust(-5)">Adjust</button>
        </div>
      `

      wildflower.component('neg-num-test', {
        state: { value: 0 },
        adjust(event, element, detail) {
          receivedArgs = detail.args
          this.state.value = detail.args[0]
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(receivedArgs).toEqual([-5])
      expect(typeof receivedArgs[0]).toBe('number')
    })

    it('should pass decimal number argument', async () => {
      let receivedArgs = null

      testContainer.innerHTML = `
        <div data-component="decimal-test">
          <button id="btn" data-action="setOpacity(0.5)">Half</button>
        </div>
      `

      wildflower.component('decimal-test', {
        state: { opacity: 1 },
        setOpacity(event, element, detail) {
          receivedArgs = detail.args
          this.state.opacity = detail.args[0]
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(receivedArgs).toEqual([0.5])
      expect(typeof receivedArgs[0]).toBe('number')
    })

    it('should pass zero argument', async () => {
      let receivedArgs = null

      testContainer.innerHTML = `
        <div data-component="zero-test">
          <button id="btn" data-action="setCount(0)">Zero</button>
        </div>
      `

      wildflower.component('zero-test', {
        state: { count: 5 },
        setCount(event, element, detail) {
          receivedArgs = detail.args
          this.state.count = detail.args[0]
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(receivedArgs).toEqual([0])
      expect(receivedArgs[0]).toBe(0)
      expect(typeof receivedArgs[0]).toBe('number')
    })

    it('should pass double-quoted string argument', async () => {
      let receivedArgs = null

      testContainer.innerHTML = `
        <div data-component="dquote-test">
          <button id="btn" data-action='setMode("dark")'>Dark</button>
        </div>
      `

      wildflower.component('dquote-test', {
        state: { mode: '' },
        setMode(event, element, detail) {
          receivedArgs = detail.args
          this.state.mode = detail.args[0]
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(receivedArgs).toEqual(['dark'])
    })
  })

  // ============================================================
  // B. Multiple Arguments
  // ============================================================

  describe('Multiple Arguments', () => {

    it('should pass two string arguments', async () => {
      let receivedArgs = null

      testContainer.innerHTML = `
        <div data-component="two-strings-test">
          <button id="btn" data-action="setColor('red', 'blue')">Set Colors</button>
        </div>
      `

      wildflower.component('two-strings-test', {
        state: { primary: '', secondary: '' },
        setColor(event, element, detail) {
          receivedArgs = detail.args
          this.state.primary = detail.args[0]
          this.state.secondary = detail.args[1]
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(receivedArgs).toEqual(['red', 'blue'])
    })

    it('should pass mixed type arguments', async () => {
      let receivedArgs = null

      testContainer.innerHTML = `
        <div data-component="mixed-args-test">
          <button id="btn" data-action="configure('fast', 3, true)">Configure</button>
        </div>
      `

      wildflower.component('mixed-args-test', {
        state: { configured: false },
        configure(event, element, detail) {
          receivedArgs = detail.args
          this.state.configured = true
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(receivedArgs).toEqual(['fast', 3, true])
      expect(typeof receivedArgs[0]).toBe('string')
      expect(typeof receivedArgs[1]).toBe('number')
      expect(typeof receivedArgs[2]).toBe('boolean')
    })

    it('should pass string and null arguments', async () => {
      let receivedArgs = null

      testContainer.innerHTML = `
        <div data-component="string-null-test">
          <button id="btn" data-action="setItem('name', null)">Set</button>
        </div>
      `

      wildflower.component('string-null-test', {
        state: {},
        setItem(event, element, detail) {
          receivedArgs = detail.args
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(receivedArgs).toEqual(['name', null])
    })
  })

  // ============================================================
  // C. Empty Parentheses
  // ============================================================

  describe('Empty Parentheses', () => {

    it('should treat empty parens same as no parens', async () => {
      let called = false
      let receivedDetail = null

      testContainer.innerHTML = `
        <div data-component="empty-parens-test">
          <button id="btn" data-action="doSomething()">Do It</button>
        </div>
      `

      wildflower.component('empty-parens-test', {
        state: { done: false },
        doSomething(event, element, detail) {
          called = true
          receivedDetail = detail
          this.state.done = true
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(called).toBe(true)
      // Empty parens should result in empty args or no args property
      if (receivedDetail.args) {
        expect(receivedDetail.args).toEqual([])
      }
    })
  })

  // ============================================================
  // D. Event Type Prefix with Args
  // ============================================================

  describe('Event Type Prefix with Args', () => {

    it('should work with click prefix and args', async () => {
      let receivedArgs = null

      testContainer.innerHTML = `
        <div data-component="click-prefix-test">
          <button id="btn" data-action="click:setMode('dark')">Dark</button>
        </div>
      `

      wildflower.component('click-prefix-test', {
        state: { mode: '' },
        setMode(event, element, detail) {
          receivedArgs = detail.args
          this.state.mode = detail.args[0]
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(receivedArgs).toEqual(['dark'])
    })

    it('should work with input prefix and args', async () => {
      let receivedArgs = null

      testContainer.innerHTML = `
        <div data-component="input-prefix-test">
          <input id="inp" data-action="input:handleInput('search')" />
        </div>
      `

      wildflower.component('input-prefix-test', {
        state: { type: '' },
        handleInput(event, element, detail) {
          receivedArgs = detail.args
          this.state.type = detail.args[0]
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#inp')
      input.value = 'test'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()

      expect(receivedArgs).toEqual(['search'])
    })

    it('should handle multiple actions with args', async () => {
      let clickArgs = null
      let blurArgs = null

      testContainer.innerHTML = `
        <div data-component="multi-action-args-test">
          <input id="inp" data-action="click:handleClick('clicked') blur:handleBlur(true)" />
        </div>
      `

      wildflower.component('multi-action-args-test', {
        state: {},
        handleClick(event, element, detail) {
          clickArgs = detail.args
        },
        handleBlur(event, element, detail) {
          blurArgs = detail.args
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#inp')

      // Test click
      input.click()
      await waitForUpdate()
      expect(clickArgs).toEqual(['clicked'])

      // Test blur
      input.focus()
      input.blur()
      await waitForUpdate()
      expect(blurArgs).toEqual([true])
    })
  })

  // ============================================================
  // E. Args Delivery Mechanism
  // ============================================================

  describe('Args Delivery Mechanism', () => {

    it('should provide detail.args as an array', async () => {
      let receivedDetail = null

      testContainer.innerHTML = `
        <div data-component="detail-args-test">
          <button id="btn" data-action="handle('x', 42)">Go</button>
        </div>
      `

      wildflower.component('detail-args-test', {
        state: {},
        handle(event, element, detail) {
          receivedDetail = detail
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(receivedDetail).toBeDefined()
      expect(Array.isArray(receivedDetail.args)).toBe(true)
      expect(receivedDetail.args).toEqual(['x', 42])
    })

    it('should also append args after standard parameters', async () => {
      let extraParams = []

      testContainer.innerHTML = `
        <div data-component="appended-args-test">
          <button id="btn" data-action="handle('hello', 99)">Go</button>
        </div>
      `

      wildflower.component('appended-args-test', {
        state: {},
        handle(event, element, detail, ...rest) {
          extraParams = rest
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(extraParams).toEqual(['hello', 99])
    })

    it('should not have args property when no args specified', async () => {
      let receivedDetail = null

      testContainer.innerHTML = `
        <div data-component="no-args-test">
          <button id="btn" data-action="handle">Go</button>
        </div>
      `

      wildflower.component('no-args-test', {
        state: {},
        handle(event, element, detail) {
          receivedDetail = detail
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(receivedDetail).toBeDefined()
      // When no args, detail.args should be undefined (backward compat)
      expect(receivedDetail.args).toBeUndefined()
    })
  })

  // ============================================================
  // F. List Item Actions with Args
  // ============================================================

  describe('List Item Actions with Args', () => {

    it('should pass args alongside list item detail', async () => {
      let receivedDetail = null

      testContainer.innerHTML = `
        <div data-component="list-args-test">
          <div data-list="items">
            <template>
              <div class="item">
                <span data-bind="name"></span>
                <button class="priority-btn" data-action="setItemPriority('high')">High</button>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('list-args-test', {
        state: {
          items: [
            { name: 'Item A' },
            { name: 'Item B' },
            { name: 'Item C' }
          ]
        },
        setItemPriority(event, element, detail) {
          receivedDetail = { ...detail }
        }
      })

      await waitForCompleteRender()

      // Click the second item's button
      const buttons = testContainer.querySelectorAll('.priority-btn')
      expect(buttons.length).toBe(3)
      buttons[1].click()
      await waitForUpdate()

      expect(receivedDetail).toBeDefined()
      // Should have list item info
      expect(receivedDetail.index).toBe(1)
      expect(receivedDetail.item).toBeDefined()
      expect(receivedDetail.item.name).toBe('Item B')
      // Should also have args
      expect(receivedDetail.args).toEqual(['high'])
    })

    it('should provide both detail.item and detail.args in list context', async () => {
      let receivedDetail = null

      testContainer.innerHTML = `
        <div data-component="list-both-test">
          <div data-list="tasks">
            <template>
              <div class="task">
                <button class="status-btn" data-action="setStatus('done', 100)">Complete</button>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('list-both-test', {
        state: {
          tasks: [
            { id: 1, title: 'Task A' },
            { id: 2, title: 'Task B' }
          ]
        },
        setStatus(event, element, detail) {
          receivedDetail = { ...detail }
        }
      })

      await waitForCompleteRender()

      const buttons = testContainer.querySelectorAll('.status-btn')
      buttons[0].click()
      await waitForUpdate()

      expect(receivedDetail).toBeDefined()
      // List context
      expect(receivedDetail.index).toBe(0)
      expect(receivedDetail.item.id).toBe(1)
      expect(receivedDetail.list).toBeDefined()
      // Args
      expect(receivedDetail.args).toEqual(['done', 100])
    })
  })

  // ============================================================
  // G. Backward Compatibility
  // ============================================================

  describe('Backward Compatibility', () => {

    it('should still work with no-arg actions', async () => {
      let called = false

      testContainer.innerHTML = `
        <div data-component="compat-noarg-test">
          <button id="btn" data-action="doIt">Go</button>
        </div>
      `

      wildflower.component('compat-noarg-test', {
        state: {},
        doIt(event, element) {
          called = true
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(called).toBe(true)
    })

    it('should still work with event type without args', async () => {
      let called = false

      testContainer.innerHTML = `
        <div data-component="compat-event-test">
          <button id="btn" data-action="click:doIt">Go</button>
        </div>
      `

      wildflower.component('compat-event-test', {
        state: {},
        doIt(event, element) {
          called = true
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(called).toBe(true)
    })

    it('should still work with multiple no-arg actions', async () => {
      let clickCalled = false
      let blurCalled = false

      testContainer.innerHTML = `
        <div data-component="compat-multi-test">
          <input id="inp" data-action="click:handleClick blur:handleBlur" />
        </div>
      `

      wildflower.component('compat-multi-test', {
        state: {},
        handleClick() { clickCalled = true },
        handleBlur() { blurCalled = true }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#inp')
      input.click()
      await waitForUpdate()
      expect(clickCalled).toBe(true)

      input.focus()
      input.blur()
      await waitForUpdate()
      expect(blurCalled).toBe(true)
    })

    it('should work with event modifiers and args', async () => {
      let receivedArgs = null
      let defaultPrevented = false

      testContainer.innerHTML = `
        <div data-component="modifier-args-test">
          <form id="frm">
            <button id="btn" type="submit" data-action="submit('form1')" data-event-prevent>Submit</button>
          </form>
        </div>
      `

      wildflower.component('modifier-args-test', {
        state: {},
        submit(event, element, detail) {
          receivedArgs = detail.args
          defaultPrevented = event.defaultPrevented
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(receivedArgs).toEqual(['form1'])
    })
  })

  // ============================================================
  // H. Edge Cases
  // ============================================================

  describe('Edge Cases', () => {

    it('should handle string with comma inside quotes', async () => {
      let receivedArgs = null

      testContainer.innerHTML = `
        <div data-component="comma-string-test">
          <button id="btn" data-action="setLabel('hello, world')">Set</button>
        </div>
      `

      wildflower.component('comma-string-test', {
        state: {},
        setLabel(event, element, detail) {
          receivedArgs = detail.args
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(receivedArgs).toEqual(['hello, world'])
    })

    it('should handle empty string argument', async () => {
      let receivedArgs = null

      testContainer.innerHTML = `
        <div data-component="empty-string-test">
          <button id="btn" data-action="setName('')">Clear</button>
        </div>
      `

      wildflower.component('empty-string-test', {
        state: { name: 'existing' },
        setName(event, element, detail) {
          receivedArgs = detail.args
          this.state.name = detail.args[0]
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(receivedArgs).toEqual([''])
      expect(typeof receivedArgs[0]).toBe('string')
      expect(receivedArgs[0]).toBe('')
    })

    it('should handle large number argument', async () => {
      let receivedArgs = null

      testContainer.innerHTML = `
        <div data-component="large-num-test">
          <button id="btn" data-action="setId(999999)">Set</button>
        </div>
      `

      wildflower.component('large-num-test', {
        state: {},
        setId(event, element, detail) {
          receivedArgs = detail.args
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(receivedArgs).toEqual([999999])
    })

    it('should handle string with spaces', async () => {
      let receivedArgs = null

      testContainer.innerHTML = `
        <div data-component="space-string-test">
          <button id="btn" data-action="setLabel('hello world')">Set</button>
        </div>
      `

      wildflower.component('space-string-test', {
        state: {},
        setLabel(event, element, detail) {
          receivedArgs = detail.args
        }
      })

      await waitForUpdate()

      testContainer.querySelector('#btn').click()
      await waitForUpdate()

      expect(receivedArgs).toEqual(['hello world'])
    })
  })
})
