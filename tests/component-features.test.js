/**
 * WildflowerJS Component Features Test Suite - Vitest Browser Mode
 *
 * Tests for emit, watch, and slot functionality.
 * Migrated from unitTestSuite.js EMIT, WATCH, and DATA-SLOT sections.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 100) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to wait for complete render cycle
async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

describe('Component Features', () => {
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

  // ============================================================================
  // EMIT (Child-to-Parent Events) Tests
  // ============================================================================
  describe('Emit (Child-to-Parent Events)', () => {
    it('emit() calls parent onEventName handler', async () => {
      let receivedData = null

      wildflower.component('emit-parent', {
        state: { message: '' },
        onChildEvent(data) {
          receivedData = data
          this.state.message = data.message
        }
      })

      wildflower.component('emit-child', {
        state: {},
        sendEvent() {
          this.emit('childEvent', { message: 'Hello from child' })
        }
      })

      testContainer.innerHTML = `
        <div data-component="emit-parent">
          <span id="emit-message" data-bind="message"></span>
          <div data-component="emit-child">
            <button id="emit-trigger" data-action="sendEvent">Send</button>
          </div>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      testContainer.querySelector('#emit-trigger').click()
      await waitForUpdate()

      expect(receivedData).not.toBeNull()
      expect(receivedData.message).toBe('Hello from child')
      expect(testContainer.querySelector('#emit-message').textContent).toBe('Hello from child')

      // Verify parent-child relationship is tracked
      const parentEl = testContainer.querySelector('[data-component="emit-parent"]')
      const childEl = testContainer.querySelector('[data-component="emit-child"]')
      const parentId = parentEl.dataset.componentId
      const childId = childEl.dataset.componentId

      expect(wildflower.componentParents.has(childId)).toBe(true)
      expect(wildflower.componentParents.get(childId)).toBe(parentId)
    })

    it('emit() with no parent handler does not error', async () => {
      let errorThrown = false

      wildflower.component('emit-orphan-parent', {
        state: {}
        // No onChildEvent handler
      })

      wildflower.component('emit-orphan-child', {
        state: {},
        sendEvent() {
          try {
            this.emit('childEvent', { message: 'test' })
          } catch (e) {
            errorThrown = true
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="emit-orphan-parent">
          <div data-component="emit-orphan-child">
            <button id="emit-orphan-trigger" data-action="sendEvent">Send</button>
          </div>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      testContainer.querySelector('#emit-orphan-trigger').click()
      await waitForUpdate()

      expect(errorThrown).toBe(false)
    })

    it('emit() bubbles through multiple ancestor levels', async () => {
      let grandparentReceived = false

      wildflower.component('emit-grandparent', {
        state: {},
        onDeepEvent(data) {
          grandparentReceived = true
        }
      })

      wildflower.component('emit-middle', {
        state: {}
        // No handler - should bubble through
      })

      wildflower.component('emit-deep-child', {
        state: {},
        sendDeepEvent() {
          this.emit('deepEvent', { level: 'deep' })
        }
      })

      testContainer.innerHTML = `
        <div data-component="emit-grandparent">
          <div data-component="emit-middle">
            <div data-component="emit-deep-child">
              <button id="emit-deep-trigger" data-action="sendDeepEvent">Send</button>
            </div>
          </div>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      testContainer.querySelector('#emit-deep-trigger').click()
      await waitForUpdate()

      expect(grandparentReceived).toBe(true)
    })

    it('emit() passes complex data objects', async () => {
      let receivedData = null

      wildflower.component('emit-data-parent', {
        state: {},
        onComplexEvent(data) {
          receivedData = data
        }
      })

      wildflower.component('emit-data-child', {
        state: {},
        sendComplexEvent() {
          this.emit('complexEvent', {
            user: { name: 'John', age: 30 },
            items: [1, 2, 3],
            nested: { deep: { value: 'test' } }
          })
        }
      })

      testContainer.innerHTML = `
        <div data-component="emit-data-parent">
          <div data-component="emit-data-child">
            <button id="emit-data-trigger" data-action="sendComplexEvent">Send</button>
          </div>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      testContainer.querySelector('#emit-data-trigger').click()
      await waitForUpdate()

      expect(receivedData).not.toBeNull()
      expect(receivedData.user.name).toBe('John')
      expect(receivedData.items.length).toBe(3)
      expect(receivedData.nested.deep.value).toBe('test')
    })

    it('emit() with empty data object', async () => {
      let handlerCalled = false
      let receivedData = null

      wildflower.component('emit-empty-parent', {
        state: {},
        onEmptyEvent(data) {
          handlerCalled = true
          receivedData = data
        }
      })

      wildflower.component('emit-empty-child', {
        state: {},
        sendEmptyEvent() {
          this.emit('emptyEvent')
        }
      })

      testContainer.innerHTML = `
        <div data-component="emit-empty-parent">
          <div data-component="emit-empty-child">
            <button id="emit-empty-trigger" data-action="sendEmptyEvent">Send</button>
          </div>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      testContainer.querySelector('#emit-empty-trigger').click()
      await waitForUpdate()

      expect(handlerCalled).toBe(true)
      expect(typeof receivedData).toBe('object')
    })
  })

  // ============================================================================
  // WATCH (State Watchers) Tests
  // ============================================================================
  describe('Watch (State Watchers)', () => {
    it('watch fires when watched property changes', async () => {
      let watcherCalled = false
      let watcherNewValue = null
      let watcherOldValue = null

      wildflower.component('watch-basic', {
        state: { count: 0 },
        watch: {
          'count': function(newVal, oldVal) {
            watcherCalled = true
            watcherNewValue = newVal
            watcherOldValue = oldVal
          }
        },
        increment() {
          this.state.count++
        }
      })

      testContainer.innerHTML = `
        <div data-component="watch-basic">
          <span id="watch-count" data-bind="count"></span>
          <button id="watch-increment" data-action="increment">+</button>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      testContainer.querySelector('#watch-increment').click()
      await waitForUpdate()

      expect(watcherCalled).toBe(true)
      expect(watcherNewValue).toBe(1)
      expect(watcherOldValue).toBe(0)
    })

    it('watch fires for nested property changes', async () => {
      let watcherCalled = false
      let receivedNewValue = null

      wildflower.component('watch-nested', {
        state: {
          user: { name: 'John', age: 30 }
        },
        watch: {
          'user.name': function(newVal, oldVal) {
            watcherCalled = true
            receivedNewValue = newVal
          }
        },
        changeName() {
          this.state.user.name = 'Jane'
        }
      })

      testContainer.innerHTML = `
        <div data-component="watch-nested">
          <span id="watch-name" data-bind="user.name"></span>
          <button id="watch-change-name" data-action="changeName">Change</button>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      testContainer.querySelector('#watch-change-name').click()
      await waitForUpdate()

      expect(watcherCalled).toBe(true)
      expect(receivedNewValue).toBe('Jane')
    })

    it('watch can trigger side effects', async () => {
      wildflower.component('watch-side-effect', {
        state: {
          input: '',
          derived: ''
        },
        watch: {
          'input': function(newVal) {
            this.state.derived = newVal.toUpperCase()
          }
        },
        setInput() {
          this.state.input = 'hello'
        }
      })

      testContainer.innerHTML = `
        <div data-component="watch-side-effect">
          <span id="watch-derived" data-bind="derived"></span>
          <button id="watch-set-input" data-action="setInput">Set</button>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      testContainer.querySelector('#watch-set-input').click()
      await waitForUpdate()

      expect(testContainer.querySelector('#watch-derived').textContent).toBe('HELLO')
    })

    it('multiple watchers on different properties', async () => {
      let firstCalled = false
      let secondCalled = false

      wildflower.component('watch-multiple', {
        state: { first: 0, second: 0 },
        watch: {
          'first': function(newVal) {
            firstCalled = true
          },
          'second': function(newVal) {
            secondCalled = true
          }
        },
        changeFirst() {
          this.state.first = 1
        },
        changeSecond() {
          this.state.second = 1
        }
      })

      testContainer.innerHTML = `
        <div data-component="watch-multiple">
          <button id="watch-change-first" data-action="changeFirst">First</button>
          <button id="watch-change-second" data-action="changeSecond">Second</button>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      testContainer.querySelector('#watch-change-first').click()
      await waitForUpdate()

      expect(firstCalled).toBe(true)
      expect(secondCalled).toBe(false)

      // Reset and test second
      firstCalled = false
      testContainer.querySelector('#watch-change-second').click()
      await waitForUpdate()

      expect(firstCalled).toBe(false)
      expect(secondCalled).toBe(true)
    })

    it('watch on array property fires on push', async () => {
      let watcherCalled = false

      wildflower.component('watch-array', {
        state: { watchItems: [] },
        watch: {
          'watchItems': function(newVal, oldVal, path) {
            watcherCalled = true
          }
        },
        addItem() {
          this.state.watchItems.push({ name: 'New Item' })
        }
      })

      testContainer.innerHTML = `
        <div data-component="watch-array">
          <button id="watch-add-item" data-action="addItem">Add</button>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      testContainer.querySelector('#watch-add-item').click()
      await waitForUpdate()

      expect(watcherCalled).toBe(true)
    })

    it('watch does not fire when unrelated property changes', async () => {
      let watcherCalled = false

      wildflower.component('watch-unrelated', {
        state: { watched: 0, unrelated: 0 },
        watch: {
          'watched': function(newVal) {
            watcherCalled = true
          }
        },
        changeUnrelated() {
          this.state.unrelated = 1
        }
      })

      testContainer.innerHTML = `
        <div data-component="watch-unrelated">
          <button id="watch-change-unrelated" data-action="changeUnrelated">Change</button>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      testContainer.querySelector('#watch-change-unrelated').click()
      await waitForUpdate()

      expect(watcherCalled).toBe(false)
    })

    it('watch has access to component context via this', async () => {
      let hasStateAccess = false
      let hasMethodAccess = false

      wildflower.component('watch-context', {
        state: { trigger: 0, result: '' },
        watch: {
          'trigger': function(newVal) {
            hasStateAccess = this.state !== undefined
            hasMethodAccess = typeof this.helperMethod === 'function'
            this.state.result = this.helperMethod(newVal)
          }
        },
        helperMethod(val) {
          return `Processed: ${val}`
        },
        triggerWatch() {
          this.state.trigger = 42
        }
      })

      testContainer.innerHTML = `
        <div data-component="watch-context">
          <span id="watch-result" data-bind="result"></span>
          <button id="watch-trigger" data-action="triggerWatch">Trigger</button>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      testContainer.querySelector('#watch-trigger').click()
      await waitForUpdate()

      expect(hasStateAccess).toBe(true)
      expect(hasMethodAccess).toBe(true)
      expect(testContainer.querySelector('#watch-result').textContent).toBe('Processed: 42')
    })
  })

  // ============================================================================
  // DATA-SLOT (Content Projection) Tests
  // ============================================================================
  describe('Slots (data-slot)', () => {
    it('data-slot content moves to data-slot-container', async () => {
      wildflower.component('slot-container', {
        state: {}
      })

      testContainer.innerHTML = `
        <div data-component="slot-container">
          <div data-slot-container="main" id="slot-target"></div>
          <div data-slot="main" id="slot-content">
            <p>Projected Content</p>
          </div>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      const container = testContainer.querySelector('#slot-target')
      const projectedContent = container.querySelector('p')

      expect(projectedContent).not.toBeNull()
      expect(projectedContent.textContent).toBe('Projected Content')
    })

    it('multiple named slots project to correct containers', async () => {
      wildflower.component('slot-multi', {
        state: {}
      })

      testContainer.innerHTML = `
        <div data-component="slot-multi">
          <header data-slot-container="header" id="header-container"></header>
          <main data-slot-container="body" id="body-container"></main>
          <footer data-slot-container="footer" id="footer-container"></footer>

          <div data-slot="header" id="header-content">Header Content</div>
          <div data-slot="body" id="body-content">Body Content</div>
          <div data-slot="footer" id="footer-content">Footer Content</div>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      const headerContainer = testContainer.querySelector('#header-container')
      const bodyContainer = testContainer.querySelector('#body-container')
      const footerContainer = testContainer.querySelector('#footer-container')

      expect(headerContainer.textContent).toContain('Header Content')
      expect(bodyContainer.textContent).toContain('Body Content')
      expect(footerContainer.textContent).toContain('Footer Content')
    })

    it('slot content with data bindings still works', async () => {
      wildflower.component('slot-binding', {
        state: { message: 'Dynamic Message' }
      })

      testContainer.innerHTML = `
        <div data-component="slot-binding">
          <div data-slot-container="content" id="binding-container"></div>
          <div data-slot="content">
            <span id="slot-bound-text" data-bind="message"></span>
          </div>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      const boundText = testContainer.querySelector('#slot-bound-text')
      expect(boundText.textContent).toBe('Dynamic Message')
    })

    it('slot content with actions still works', async () => {
      let actionCalled = false

      wildflower.component('slot-action', {
        state: {},
        slotButtonClick() {
          actionCalled = true
        }
      })

      testContainer.innerHTML = `
        <div data-component="slot-action">
          <div data-slot-container="buttons" id="action-container"></div>
          <div data-slot="buttons">
            <button id="slot-action-btn" data-action="slotButtonClick">Click Me</button>
          </div>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      testContainer.querySelector('#slot-action-btn').click()
      await waitForUpdate()

      expect(actionCalled).toBe(true)
    })

    it('empty slot container keeps default content when no matching slot', async () => {
      wildflower.component('slot-empty', {
        state: {}
      })

      testContainer.innerHTML = `
        <div data-component="slot-empty">
          <div data-slot-container="missing" id="empty-slot-container">
            <span id="default-content">Default Content</span>
          </div>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      const defaultContent = testContainer.querySelector('#default-content')
      expect(defaultContent).not.toBeNull()
      expect(defaultContent.textContent).toBe('Default Content')
    })
  })
})
