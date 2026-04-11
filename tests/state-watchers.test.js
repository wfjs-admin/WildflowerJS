/**
 * WildflowerJS State Watchers (watch) Test Suite - Vitest Browser Mode
 *
 * Tests for the watch feature to observe state changes.
 * Migrated from unitTestSuite.js State Watchers section.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('State Watchers (watch)', () => {
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

  it('watch fires when watched property changes', async () => {
    let watcherCalled = false
    let watcherNewValue = null
    let watcherOldValue = null

    wildflower.component('watch-basic', {
      state: {
        count: 0
      },
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
    await waitForUpdate(100)

    testContainer.querySelector('#watch-increment').click()
    await waitForUpdate(100)

    expect(watcherCalled).toBe(true)
    expect(watcherNewValue).toBe(1)
    expect(watcherOldValue).toBe(0)
  })

  it('watch fires for nested property changes', async () => {
    let watcherCalled = false
    let receivedNewValue = null

    wildflower.component('watch-nested', {
      state: {
        user: {
          name: 'John',
          age: 30
        }
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
    await waitForUpdate(100)

    testContainer.querySelector('#watch-change-name').click()
    await waitForUpdate(100)

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
          // Side effect: update derived state
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
    await waitForUpdate(100)

    testContainer.querySelector('#watch-set-input').click()
    await waitForUpdate(100)

    expect(testContainer.querySelector('#watch-derived').textContent).toBe('HELLO')
  })

  it('multiple watchers on different properties', async () => {
    let firstCalled = false
    let secondCalled = false

    wildflower.component('watch-multiple', {
      state: {
        first: 0,
        second: 0
      },
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
    await waitForUpdate(100)

    testContainer.querySelector('#watch-change-first').click()
    await waitForUpdate(100)

    expect(firstCalled).toBe(true)
    expect(secondCalled).toBe(false)

    // Reset and test second
    firstCalled = false
    testContainer.querySelector('#watch-change-second').click()
    await waitForUpdate(100)

    expect(firstCalled).toBe(false)
    expect(secondCalled).toBe(true)
  })

  it('watch on array property fires on push', async () => {
    let watcherCalled = false

    wildflower.component('watch-array', {
      state: {
        items: []
      },
      watch: {
        'items': function(newVal, oldVal, path) {
          watcherCalled = true
        }
      },
      addItem() {
        this.state.items.push({ name: 'New Item' })
      }
    })

    testContainer.innerHTML = `
      <div data-component="watch-array">
        <button id="watch-add-item" data-action="addItem">Add</button>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(100)

    testContainer.querySelector('#watch-add-item').click()
    await waitForUpdate(100)

    expect(watcherCalled).toBe(true)
  })

  it('watch does not fire when unrelated property changes', async () => {
    let watcherCalled = false

    wildflower.component('watch-unrelated', {
      state: {
        watched: 0,
        unrelated: 0
      },
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
    await waitForUpdate(100)

    testContainer.querySelector('#watch-change-unrelated').click()
    await waitForUpdate(100)

    expect(watcherCalled).toBe(false)
  })

  it('watch has access to component context via this', async () => {
    let hasStateAccess = false
    let hasMethodAccess = false

    wildflower.component('watch-context', {
      state: {
        trigger: 0,
        result: ''
      },
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
    await waitForUpdate(100)

    testContainer.querySelector('#watch-trigger').click()
    await waitForUpdate(100)

    expect(hasStateAccess).toBe(true)
    expect(hasMethodAccess).toBe(true)
    expect(testContainer.querySelector('#watch-result').textContent).toBe('Processed: 42')
  })

  it('watches a computed property reactively', async () => {
    let watchedValues = []

    wildflower.component('watch-computed', {
      state: { firstName: 'Alice', lastName: 'Smith' },
      computed: {
        fullName() { return this.state.firstName + ' ' + this.state.lastName }
      },
      watch: {
        fullName(newVal, oldVal) {
          watchedValues.push(newVal)
        }
      },
      changeName() { this.state.firstName = 'Bob' }
    })

    testContainer.innerHTML = `
      <div data-component="watch-computed">
        <span id="wc-name" data-bind="fullName"></span>
        <button id="wc-btn" data-action="changeName">Change</button>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(100)

    expect(testContainer.querySelector('#wc-name').textContent).toBe('Alice Smith')

    testContainer.querySelector('#wc-btn').click()
    await waitForUpdate(100)

    expect(testContainer.querySelector('#wc-name').textContent).toBe('Bob Smith')
    expect(watchedValues).toContain('Bob Smith')
  })

  it('watches a computed property with :immediate', async () => {
    let immediateValue = null

    wildflower.component('watch-computed-imm', {
      state: { count: 5 },
      computed: {
        doubled() { return this.state.count * 2 }
      },
      watch: {
        'doubled:immediate'(newVal) {
          immediateValue = newVal
        }
      }
    })

    testContainer.innerHTML = `
      <div data-component="watch-computed-imm">
        <span id="wci-val" data-bind="doubled"></span>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(100)

    // Immediate watcher should have fired with the computed value
    expect(immediateValue).toBe(10)
  })
})
