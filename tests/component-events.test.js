/**
 * WildflowerJS Component Events (emit) Test Suite - Vitest Browser Mode
 *
 * Tests for the emit() method for child-to-parent communication.
 * Migrated from unitTestSuite.js Component Events section.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Component Events (emit)', () => {
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
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  it('emit() calls parent onEventName handler', async () => {
    let receivedData = null

    wildflower.component('emit-parent-1', {
      state: { message: '' },
      onChildEvent(data) {
        receivedData = data
        this.state.message = data.message
      }
    })

    wildflower.component('emit-child-1', {
      state: {},
      sendEvent() {
        this.emit('childEvent', { message: 'Hello from child' })
      }
    })

    testContainer.innerHTML = `
      <div data-component="emit-parent-1">
        <span id="emit-message" data-bind="message"></span>
        <div data-component="emit-child-1">
          <button id="emit-trigger" data-action="sendEvent">Send</button>
        </div>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(100)

    // Trigger the child event
    testContainer.querySelector('#emit-trigger').click()
    await waitForUpdate(100)

    expect(receivedData).not.toBeNull()
    expect(receivedData.message).toBe('Hello from child')
    expect(testContainer.querySelector('#emit-message').textContent).toBe('Hello from child')
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
    await waitForUpdate(100)

    testContainer.querySelector('#emit-orphan-trigger').click()
    await waitForUpdate(100)

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
    await waitForUpdate(100)

    testContainer.querySelector('#emit-deep-trigger').click()
    await waitForUpdate(100)

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
    await waitForUpdate(100)

    testContainer.querySelector('#emit-data-trigger').click()
    await waitForUpdate(100)

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
    await waitForUpdate(100)

    testContainer.querySelector('#emit-empty-trigger').click()
    await waitForUpdate(100)

    expect(handlerCalled).toBe(true)
    expect(typeof receivedData).toBe('object')
  })

  it('emit() event name is case-sensitive for handler', async () => {
    let lowerReceived = false
    let upperReceived = false

    wildflower.component('emit-case-parent', {
      state: {},
      onMyevent(data) {
        lowerReceived = true
      },
      onMyEvent(data) {
        upperReceived = true
      }
    })

    wildflower.component('emit-case-child', {
      state: {},
      sendLowerEvent() {
        this.emit('myevent', {})
      },
      sendUpperEvent() {
        this.emit('myEvent', {})
      }
    })

    testContainer.innerHTML = `
      <div data-component="emit-case-parent">
        <div data-component="emit-case-child">
          <button id="emit-lower-trigger" data-action="sendLowerEvent">Lower</button>
          <button id="emit-upper-trigger" data-action="sendUpperEvent">Upper</button>
        </div>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(100)

    testContainer.querySelector('#emit-lower-trigger').click()
    await waitForUpdate(100)

    expect(lowerReceived).toBe(true)
    expect(upperReceived).toBe(false)

    // Reset and test upper case
    lowerReceived = false
    upperReceived = false

    testContainer.querySelector('#emit-upper-trigger').click()
    await waitForUpdate(100)

    expect(lowerReceived).toBe(false)
    expect(upperReceived).toBe(true)
  })
})
