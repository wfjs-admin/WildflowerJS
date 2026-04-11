/**
 * WildflowerJS Framework Test - Vitest Browser Mode
 *
 * Tests core framework functionality in a real browser environment.
 * Patterns based on the canonical unitTestSuite.js browser tests.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode } from './helpers/load-framework.js'

// Helper to wait for framework processing (matching unitTestSuite pattern)
async function waitForUpdate(ms = 10) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to wait for a condition with timeout
async function waitFor(condition, timeout = 2000, interval = 10) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (condition()) return true
    await new Promise(resolve => setTimeout(resolve, interval))
  }
  return false
}

describe('WildflowerJS Framework', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower

    // Simple reset - just clear definitions and instances
    // This matches the pattern from working browser tests
    if (wildflower.componentDefinitions) {
      wildflower.componentDefinitions.clear()
    }
    if (wildflower.componentInstances) {
      wildflower.componentInstances.clear()
    }

    // Clear store manager if available
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

    // Create a fresh test container
    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    testContainer.style.opacity = '0'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    // Cleanup test container
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  describe('Framework Loading', () => {
    it('should have wildflower global available', () => {
      expect(window.wildflower).toBeDefined()
      expect(typeof window.wildflower.component).toBe('function')
    })

    it('should have WildflowerJS class available', () => {
      expect(window.WildflowerJS).toBeDefined()
      expect(typeof window.WildflowerJS).toBe('function')
    })
  })

  describe('Component Registration', () => {
    it('should register a component definition', () => {
      wildflower.component('test-component', {
        state: { count: 0 }
      })

      expect(wildflower.componentDefinitions.has('test-component')).toBe(true)
    })

    it('should initialize component with state', async () => {
      // Set up DOM first (following unitTestSuite pattern)
      testContainer.innerHTML = `
        <div data-component="counter">
          <span data-bind="count"></span>
        </div>
      `

      // Register component (triggers auto-scanning)
      wildflower.component('counter', {
        state: { count: 42 }
      })

      // Wait for component initialization
      await waitForUpdate(50)

      // Get component instance
      const componentEl = testContainer.querySelector('[data-component="counter"]')
      const componentId = componentEl.dataset.componentId
      expect(componentId).toBeDefined()

      // Verify binding rendered
      const span = testContainer.querySelector('[data-bind="count"]')
      expect(span.textContent).toBe('42')
    })
  })

  describe('Reactive State', () => {
    it('should update DOM when state changes', async () => {
      testContainer.innerHTML = `
        <div data-component="reactive-test">
          <span id="message" data-bind="message"></span>
        </div>
      `

      wildflower.component('reactive-test', {
        state: { message: 'Hello' }
      })

      await waitForUpdate(50)

      const element = testContainer.querySelector('[data-component="reactive-test"]')
      const componentId = element.dataset.componentId
      const instance = wildflower.componentInstances.get(componentId)

      expect(instance).toBeDefined()

      // Initial value
      const span = testContainer.querySelector('#message')
      expect(span.textContent).toBe('Hello')

      // Update state
      instance.state.message = 'Updated'

      // Wait for reactive update
      await waitForUpdate(50)

      expect(span.textContent).toBe('Updated')
    })

    it('should handle falsy values correctly', async () => {
      testContainer.innerHTML = `
        <div data-component="falsy-test">
          <span id="zero" data-bind="zero"></span>
          <span id="empty" data-bind="emptyString"></span>
          <span id="false" data-bind="falseValue"></span>
        </div>
      `

      wildflower.component('falsy-test', {
        state: {
          zero: 0,
          emptyString: '',
          falseValue: false
        }
      })

      await waitForUpdate(50)

      // These should render correctly in real browser
      expect(testContainer.querySelector('#zero').textContent).toBe('0')
      expect(testContainer.querySelector('#empty').textContent).toBe('')
      expect(testContainer.querySelector('#false').textContent).toBe('false')
    })
  })

  describe('Computed Properties', () => {
    it('should compute derived values', async () => {
      testContainer.innerHTML = `
        <div data-component="computed-test">
          <span id="fullname" data-bind="computed:fullName"></span>
        </div>
      `

      wildflower.component('computed-test', {
        state: {
          firstName: 'John',
          lastName: 'Doe'
        },
        computed: {
          fullName() {
            return `${this.state.firstName} ${this.state.lastName}`
          }
        }
      })

      await waitForUpdate(50)

      const span = testContainer.querySelector('#fullname')
      expect(span.textContent).toBe('John Doe')
    })

    it('should update computed when dependencies change', async () => {
      testContainer.innerHTML = `
        <div data-component="computed-reactive">
          <span id="result" data-bind="computed:doubled"></span>
        </div>
      `

      wildflower.component('computed-reactive', {
        state: { count: 5 },
        computed: {
          doubled() {
            return this.state.count * 2
          }
        }
      })

      await waitForUpdate(50)

      const element = testContainer.querySelector('[data-component="computed-reactive"]')
      const instance = wildflower.componentInstances.get(element.dataset.componentId)
      const span = testContainer.querySelector('#result')

      expect(span.textContent).toBe('10')

      // Update state
      instance.state.count = 7
      await waitForUpdate(50)

      expect(span.textContent).toBe('14')
    })
  })

  describe('Actions', () => {
    it('should handle click actions', async () => {
      testContainer.innerHTML = `
        <div data-component="action-test">
          <button id="btn" data-action="handleClick">Click me</button>
          <span id="status" data-bind="clicked"></span>
        </div>
      `

      wildflower.component('action-test', {
        state: { clicked: false },
        handleClick() {
          this.state.clicked = true
        }
      })

      await waitForUpdate(50)

      const button = testContainer.querySelector('#btn')
      const status = testContainer.querySelector('#status')

      expect(status.textContent).toBe('false')

      // Click the button (real browser event!)
      button.click()

      await waitForUpdate(50)

      expect(status.textContent).toBe('true')
    })

    it('should pass event to action handler', async () => {
      let receivedEvent = null

      testContainer.innerHTML = `
        <div data-component="event-test">
          <button id="btn" data-action="handleClick">Click</button>
        </div>
      `

      wildflower.component('event-test', {
        state: {},
        handleClick(e) {
          receivedEvent = e
        }
      })

      await waitForUpdate(50)

      const button = testContainer.querySelector('#btn')
      button.click()

      await waitForUpdate(10)

      expect(receivedEvent).toBeDefined()
      expect(receivedEvent.type).toBe('click')
    })
  })

  describe('Conditionals', () => {
    it('should show/hide elements based on state', async () => {
      testContainer.innerHTML = `
        <div data-component="conditional-test">
          <div id="conditional" data-show="visible">I am visible</div>
        </div>
      `

      wildflower.component('conditional-test', {
        state: { visible: true }
      })

      await waitForUpdate(50)

      const element = testContainer.querySelector('[data-component="conditional-test"]')
      const componentId = element.dataset.componentId
      const instance = wildflower.componentInstances.get(componentId)
      const conditional = testContainer.querySelector('#conditional')

      // Should be visible initially
      expect(conditional.style.display).not.toBe('none')

      // Hide it
      instance.state.visible = false
      await waitForUpdate(50)

      expect(conditional.style.display).toBe('none')

      // Show it again
      instance.state.visible = true
      await waitForUpdate(50)

      expect(conditional.style.display).not.toBe('none')
    })

    it('should handle negated conditions', async () => {
      testContainer.innerHTML = `
        <div data-component="negation-test">
          <div id="loading" data-show="isLoading">Loading...</div>
          <div id="content" data-show="!isLoading">Content ready</div>
        </div>
      `

      wildflower.component('negation-test', {
        state: { isLoading: true }
      })

      await waitForUpdate(50)

      const element = testContainer.querySelector('[data-component="negation-test"]')
      const instance = wildflower.componentInstances.get(element.dataset.componentId)

      const loading = testContainer.querySelector('#loading')
      const content = testContainer.querySelector('#content')

      // Initial state: loading visible, content hidden
      expect(loading.style.display).not.toBe('none')
      expect(content.style.display).toBe('none')

      // Change state
      instance.state.isLoading = false
      await waitForUpdate(50)

      // Loading hidden, content visible
      expect(loading.style.display).toBe('none')
      expect(content.style.display).not.toBe('none')
    })
  })

  describe('Lists', () => {
    it('should render list items', async () => {
      testContainer.innerHTML = `
        <div data-component="list-test">
          <ul data-list="items">
            <template>
              <li>
                <span data-bind="name"></span>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('list-test', {
        state: {
          items: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' },
            { id: 3, name: 'Item 3' }
          ]
        }
      })

      await waitForUpdate(100) // Lists may need slightly more time

      const listContainer = testContainer.querySelector('[data-list="items"]')
      const listItems = Array.from(listContainer.children).filter(c => c._listIndex !== undefined)
      expect(listItems.length).toBe(3)

      // Use DOM structure (span is the only child) - data-bind is stripped for performance
      const names = listItems.map(li => li.querySelector('span').textContent)
      expect(names).toEqual(['Item 1', 'Item 2', 'Item 3'])
    })

    it('should update list when items are added', async () => {
      testContainer.innerHTML = `
        <div data-component="list-update-test">
          <ul data-list="items">
            <template>
              <li>
                <span data-bind="name"></span>
              </li>
            </template>
          </ul>
        </div>
      `

      wildflower.component('list-update-test', {
        state: {
          items: [{ id: 1, name: 'Initial' }]
        }
      })

      await waitForUpdate(100)

      const element = testContainer.querySelector('[data-component="list-update-test"]')
      const instance = wildflower.componentInstances.get(element.dataset.componentId)

      // Add an item
      instance.state.items.push({ id: 2, name: 'Added' })
      await waitForUpdate(100)

      const listContainer = testContainer.querySelector('[data-list="items"]')
      const listItems = Array.from(listContainer.children).filter(c => c._listIndex !== undefined)
      expect(listItems.length).toBe(2)
    })
  })

  describe('Two-way Binding (data-model)', () => {
    it('should sync input value with state', async () => {
      testContainer.innerHTML = `
        <div data-component="model-test">
          <input id="input" type="text" data-model="name">
          <span id="display" data-bind="name"></span>
        </div>
      `

      wildflower.component('model-test', {
        state: { name: 'Initial' }
      })

      await waitForUpdate(50)

      const input = testContainer.querySelector('#input')
      const display = testContainer.querySelector('#display')

      // Initial sync
      expect(input.value).toBe('Initial')
      expect(display.textContent).toBe('Initial')

      // Simulate user input
      input.value = 'Changed'
      input.dispatchEvent(new Event('input', { bubbles: true }))

      await waitForUpdate(50)

      expect(display.textContent).toBe('Changed')
    })
  })
})
