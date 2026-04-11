/**
 * WildflowerJS Data-Render Test Suite - Vitest Browser Mode
 *
 * Tests for data-render (conditional DOM rendering) functionality.
 * data-render removes/adds elements from the DOM entirely, unlike data-show which just hides them.
 * Migrated from unitTestSuite.js Conditional DOM (data-render) section.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, isMinifiedBuild} from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 100) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Conditional DOM (data-render)', () => {
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

  // --- Basic Functionality (6 tests) ---

  describe('Basic Functionality', () => {
    it('element removed from DOM when condition is false', async () => {
      wildflower.component('render-remove-test', {
        state: {
          showContent: false
        }
      })

      testContainer.innerHTML = `
        <div data-component="render-remove-test">
          <div id="render-target" data-render="showContent">
            <p>Conditional Content</p>
          </div>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      const target = document.getElementById('render-target')
      expect(target).toBeNull()
    })

    it.skipIf(isMinifiedBuild())('element present in DOM when condition is true', async () => {
      wildflower.component('render-present-test', {
        state: {
          showContent: true
        }
      })

      testContainer.innerHTML = `
        <div data-component="render-present-test">
          <div id="render-present-target" data-render="showContent">
            <p>Conditional Content</p>
          </div>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      const target = document.getElementById('render-present-target')
      expect(target).not.toBeNull()
      expect(target.textContent).toContain('Conditional Content')

      // Verify render context was created
      const registry = wildflower._contextRegistry
      const renderContext = registry.getContextForElement(target)
      expect(renderContext).toBeDefined()
      expect(renderContext.type).toBe('conditional')
      expect(renderContext.path).toBe('showContent')
    })

    it('comment placeholder left when element removed', async () => {
      wildflower.component('render-placeholder-test', {
        state: {
          showContent: false
        }
      })

      testContainer.innerHTML = `
        <div data-component="render-placeholder-test" id="placeholder-container">
          <span id="before-marker">Before</span>
          <div data-render="showContent">Conditional</div>
          <span id="after-marker">After</span>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      const beforeMarker = document.getElementById('before-marker')
      const afterMarker = document.getElementById('after-marker')

      // Find comment node between markers
      let foundComment = false
      let node = beforeMarker.nextSibling
      while (node && node !== afterMarker) {
        if (node.nodeType === Node.COMMENT_NODE) {
          foundComment = true
          break
        }
        node = node.nextSibling
      }

      expect(foundComment).toBe(true)
    })

    it('element re-inserted when condition changes to true', async () => {
      wildflower.component('render-reinsert-test', {
        state: {
          showContent: false
        },
        show() {
          this.state.showContent = true
        }
      })

      testContainer.innerHTML = `
        <div data-component="render-reinsert-test">
          <div id="render-reinsert-target" data-render="showContent">
            <p>Reinserted Content</p>
          </div>
          <button id="render-show-btn" data-action="show">Show</button>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      // Initially not in DOM
      let target = document.getElementById('render-reinsert-target')
      expect(target).toBeNull()

      // Trigger show
      document.getElementById('render-show-btn').click()
      await waitForUpdate()

      // Now should be in DOM
      target = document.getElementById('render-reinsert-target')
      expect(target).not.toBeNull()
      expect(target.textContent).toContain('Reinserted Content')
    })

    it('element removed when condition changes to false', async () => {
      wildflower.component('render-remove-change-test', {
        state: {
          showContent: true
        },
        hide() {
          this.state.showContent = false
        }
      })

      testContainer.innerHTML = `
        <div data-component="render-remove-change-test">
          <div id="render-remove-change-target" data-render="showContent">
            <p>Will Be Removed</p>
          </div>
          <button id="render-hide-btn" data-action="hide">Hide</button>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      // Initially in DOM
      let target = document.getElementById('render-remove-change-target')
      expect(target).not.toBeNull()

      // Trigger hide
      document.getElementById('render-hide-btn').click()
      await waitForUpdate()

      // Now should NOT be in DOM
      target = document.getElementById('render-remove-change-target')
      expect(target).toBeNull()
    })

    it('initial false - element never added to DOM (no flash)', async () => {
      wildflower.component('render-no-flash-test', {
        state: {
          showContent: false
        }
      })

      testContainer.innerHTML = `
        <div data-component="render-no-flash-test">
          <div id="never-flash-target" data-render="showContent">
            <p>Should Never Flash</p>
          </div>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      // The element should not be in DOM after initialization
      const target = document.getElementById('never-flash-target')
      expect(target).toBeNull()
    })
  })

  // --- Nested Components (3 tests) ---

  describe('Nested Components', () => {
    it('nested component destroyed when condition becomes false', async () => {
      let destroyCalled = false

      wildflower.component('render-destroy-parent', {
        state: {
          showChild: true
        },
        hideChild() {
          this.state.showChild = false
        }
      })

      wildflower.component('render-destroy-child', {
        state: { value: 0 },
        destroy() {
          destroyCalled = true
        }
      })

      testContainer.innerHTML = `
        <div data-component="render-destroy-parent">
          <div data-render="showChild">
            <div data-component="render-destroy-child" id="nested-child">
              <span data-bind="value"></span>
            </div>
          </div>
          <button id="hide-child-btn" data-action="hideChild">Hide</button>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      // Child should exist initially
      let child = document.getElementById('nested-child')
      expect(child).not.toBeNull()

      // Hide the parent container
      document.getElementById('hide-child-btn').click()
      await waitForUpdate()

      // Child should be destroyed
      expect(destroyCalled).toBe(true)
      child = document.getElementById('nested-child')
      expect(child).toBeNull()
    })

    it('nested component recreated when condition becomes true', async () => {
      let initCount = 0

      wildflower.component('render-recreate-parent', {
        state: {
          showChild: false
        },
        showChild() {
          this.state.showChild = true
        }
      })

      wildflower.component('render-recreate-child', {
        state: { value: 0 },
        init() {
          initCount++
        }
      })

      testContainer.innerHTML = `
        <div data-component="render-recreate-parent">
          <div data-render="showChild">
            <div data-component="render-recreate-child" id="recreate-child">
              <span data-bind="value"></span>
            </div>
          </div>
          <button id="show-child-btn" data-action="showChild">Show</button>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      // Child should not exist initially
      let child = document.getElementById('recreate-child')
      expect(child).toBeNull()
      expect(initCount).toBe(0)

      // Show the parent container
      document.getElementById('show-child-btn').click()
      await waitForUpdate()

      // Child should now exist and init called
      child = document.getElementById('recreate-child')
      expect(child).not.toBeNull()
      expect(initCount).toBe(1)
    })

    it('nested component state reset on recreate', async () => {
      wildflower.component('render-reset-parent', {
        state: {
          showChild: true
        },
        toggleChild() {
          this.state.showChild = !this.state.showChild
        }
      })

      wildflower.component('render-reset-child', {
        state: { counter: 0 },
        increment() {
          this.state.counter++
        }
      })

      testContainer.innerHTML = `
        <div data-component="render-reset-parent">
          <div data-render="showChild">
            <div data-component="render-reset-child" id="reset-child">
              <span id="reset-counter" data-bind="counter"></span>
              <button id="increment-btn" data-action="increment">+</button>
            </div>
          </div>
          <button id="toggle-child-btn" data-action="toggleChild">Toggle</button>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      // Increment counter
      document.getElementById('increment-btn').click()
      document.getElementById('increment-btn').click()
      await waitForUpdate()

      let counter = document.getElementById('reset-counter')
      expect(counter.textContent).toBe('2')

      // Hide (destroy) then show (recreate)
      document.getElementById('toggle-child-btn').click()
      await waitForUpdate()
      document.getElementById('toggle-child-btn').click()
      await waitForUpdate()

      // Counter should be reset to 0
      counter = document.getElementById('reset-counter')
      expect(counter.textContent).toBe('0')
    })
  })

  // --- Bindings & Contexts (3 tests) ---

  describe('Bindings & Contexts', () => {
    it('bindings inside work after insertion', async () => {
      wildflower.component('render-binding-test', {
        state: {
          showContent: false,
          message: 'Hello from binding'
        },
        show() {
          this.state.showContent = true
        },
        updateMessage() {
          this.state.message = 'Updated message'
        }
      })

      testContainer.innerHTML = `
        <div data-component="render-binding-test">
          <div data-render="showContent">
            <span id="render-bound-text" data-bind="message"></span>
          </div>
          <button id="show-binding-btn" data-action="show">Show</button>
          <button id="update-msg-btn" data-action="updateMessage">Update</button>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      // Show content
      document.getElementById('show-binding-btn').click()
      await waitForUpdate()

      let boundText = document.getElementById('render-bound-text')
      expect(boundText).not.toBeNull()
      expect(boundText.textContent).toBe('Hello from binding')

      // Update the bound value
      document.getElementById('update-msg-btn').click()
      await waitForUpdate()

      expect(boundText.textContent).toBe('Updated message')
    })

    it('actions inside work after insertion', async () => {
      let actionCalled = false

      wildflower.component('render-action-test', {
        state: {
          showContent: false
        },
        show() {
          this.state.showContent = true
        },
        innerAction() {
          actionCalled = true
        }
      })

      testContainer.innerHTML = `
        <div data-component="render-action-test">
          <div data-render="showContent">
            <button id="inner-action-btn" data-action="innerAction">Inner Action</button>
          </div>
          <button id="show-action-btn" data-action="show">Show</button>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      // Show content
      document.getElementById('show-action-btn').click()
      await waitForUpdate()

      // Click inner action button
      document.getElementById('inner-action-btn').click()
      await waitForUpdate()

      expect(actionCalled).toBe(true)
    })

    it('data-action on same element as data-render works after re-insertion', async () => {
      let clickCount = 0

      wildflower.component('render-self-action-test', {
        state: {
          showButton: false
        },
        show() {
          this.state.showButton = true
        },
        selfAction() {
          clickCount++
        }
      })

      testContainer.innerHTML = `
        <div data-component="render-self-action-test">
          <button id="trigger-show" data-action="show">Show</button>
          <button id="self-action-btn" data-render="showButton" data-action="selfAction">Click Me</button>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      // Button should not be in DOM initially
      expect(document.getElementById('self-action-btn')).toBeNull()

      // Show the button
      document.getElementById('trigger-show').click()
      await waitForUpdate()

      // Button should now be in DOM
      const btn = document.getElementById('self-action-btn')
      expect(btn).not.toBeNull()

      // Click should fire the action
      btn.click()
      await waitForUpdate()

      expect(clickCount).toBe(1)
    })

    it('data-action + data-render + data-bind-class on same element works after re-insertion', async () => {
      let toggleCount = 0

      wildflower.component('render-multi-binding-test', {
        state: {
          showToggle: false,
          isOpen: false
        },
        computed: {
          toggleClass() { return this.state.isOpen ? 'active' : '' }
        },
        enableToggle() {
          this.state.showToggle = true
        },
        doToggle() {
          toggleCount++
          this.state.isOpen = !this.state.isOpen
        }
      })

      testContainer.innerHTML = `
        <div data-component="render-multi-binding-test">
          <button id="enable-btn" data-action="enableToggle">Enable</button>
          <button id="multi-btn" data-render="showToggle" data-action="doToggle" data-bind-class="toggleClass">Toggle</button>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      // Button not in DOM
      expect(document.getElementById('multi-btn')).toBeNull()

      // Enable it
      document.getElementById('enable-btn').click()
      await waitForUpdate()

      const btn = document.getElementById('multi-btn')
      expect(btn).not.toBeNull()

      // Click should fire action AND update class
      btn.click()
      await waitForUpdate()

      expect(toggleCount).toBe(1)
      expect(btn.classList.contains('active')).toBe(true)

      // Click again
      btn.click()
      await waitForUpdate()

      expect(toggleCount).toBe(2)
      expect(btn.classList.contains('active')).toBe(false)
    })

    it('data-action on data-render element works when condition is store-backed computed (SPA nav pattern)', async () => {
      let actionCount = 0

      wildflower.store('nav-test-store', {
        state: { currentPage: 'home' },
        goToDocs() { this.state.currentPage = 'docs'; },
        goToHome() { this.state.currentPage = 'home'; }
      })

      wildflower.component('spa-nav-test', {
        subscribe: { 'nav-test-store': ['currentPage'] },
        computed: {
          isHomePage() {
            return (this.stores['nav-test-store']?.currentPage || 'home') === 'home'
          }
        },
        navigateToDocs() {
          wildflower.getStore('nav-test-store').goToDocs()
        },
        navigateToHome() {
          wildflower.getStore('nav-test-store').goToHome()
        },
        sidebarToggle() {
          actionCount++
        }
      })

      testContainer.innerHTML = `
        <div data-component="spa-nav-test" data-bind-class="isHomePage ? 'on-home' : 'on-docs'">
          <button id="go-docs" data-action="navigateToDocs">Go to Docs</button>
          <button id="go-home" data-action="navigateToHome">Go to Home</button>
          <button id="sidebar-btn" data-render="!isHomePage" data-action="sidebarToggle" data-bind-class="'toggle-btn'">Toggle Sidebar</button>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      // Starts on home — sidebar button should NOT be in DOM
      expect(document.getElementById('sidebar-btn')).toBeNull()

      // Navigate to docs — sidebar button should appear
      document.getElementById('go-docs').click()
      await waitForUpdate(200)

      const btn = document.getElementById('sidebar-btn')
      expect(btn).not.toBeNull()

      // Click sidebar toggle — action should fire
      btn.click()
      await waitForUpdate()

      expect(actionCount).toBe(1)

      // Navigate home — button removed
      document.getElementById('go-home').click()
      await waitForUpdate(200)
      expect(document.getElementById('sidebar-btn')).toBeNull()

      // Navigate back to docs — button reappears, action should still work
      document.getElementById('go-docs').click()
      await waitForUpdate(200)

      const btn2 = document.getElementById('sidebar-btn')
      expect(btn2).not.toBeNull()
      btn2.click()
      await waitForUpdate()

      expect(actionCount).toBe(2)
    })

    it.skipIf(isMinifiedBuild())('contexts cleaned up when element removed', async () => {
      wildflower.component('render-cleanup-test', {
        state: {
          showContent: true,
          value: 'test'
        },
        hide() {
          this.state.showContent = false
        }
      })

      testContainer.innerHTML = `
        <div data-component="render-cleanup-test" id="cleanup-component">
          <div data-render="showContent">
            <span id="cleanup-binding" data-bind="value"></span>
            <button id="cleanup-action" data-action="hide">Hide via inner</button>
          </div>
          <button id="hide-cleanup-btn" data-action="hide">Hide</button>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      // Get component instance
      const componentEl = document.getElementById('cleanup-component')
      const componentId = componentEl.dataset.componentId

      // Count contexts before hiding
      const bindingsBefore = wildflower._contextRegistry ?
        wildflower._contextRegistry.getContextsByType('binding')
          .filter(c => c.componentId === componentId).length : 0

      // Hide content
      document.getElementById('hide-cleanup-btn').click()
      await waitForUpdate()

      // Count contexts after hiding - should be fewer
      const bindingsAfter = wildflower._contextRegistry ?
        wildflower._contextRegistry.getContextsByType('binding')
          .filter(c => c.componentId === componentId).length : 0

      // The binding inside data-render should be cleaned up
      expect(bindingsAfter).toBeLessThan(bindingsBefore)
    })
  })

  // --- Edge Cases (3 tests) ---

  describe('Edge Cases', () => {
    it('with computed property condition', async () => {
      wildflower.component('render-computed-test', {
        state: {
          count: 0
        },
        computed: {
          isPositive() {
            return this.state.count > 0
          }
        },
        increment() {
          this.state.count++
        },
        decrement() {
          this.state.count--
        }
      })

      testContainer.innerHTML = `
        <div data-component="render-computed-test">
          <div id="computed-render-target" data-render="computed:isPositive">
            <p>Count is positive!</p>
          </div>
          <button id="increment-computed-btn" data-action="increment">+</button>
          <button id="decrement-computed-btn" data-action="decrement">-</button>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      // Initially count is 0, so isPositive is false
      let target = document.getElementById('computed-render-target')
      expect(target).toBeNull()

      // Increment to make positive
      document.getElementById('increment-computed-btn').click()
      await waitForUpdate()

      target = document.getElementById('computed-render-target')
      expect(target).not.toBeNull()

      // Decrement back to 0
      document.getElementById('decrement-computed-btn').click()
      await waitForUpdate()

      target = document.getElementById('computed-render-target')
      expect(target).toBeNull()
    })

    it('with negation (!condition)', async () => {
      wildflower.component('render-negation-test', {
        state: {
          isLoading: true
        },
        finishLoading() {
          this.state.isLoading = false
        }
      })

      testContainer.innerHTML = `
        <div data-component="render-negation-test">
          <div id="loading-indicator" data-render="isLoading">Loading...</div>
          <div id="content-area" data-render="!isLoading">Content loaded!</div>
          <button id="finish-loading-btn" data-action="finishLoading">Finish</button>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      // Initially loading
      let loading = document.getElementById('loading-indicator')
      let content = document.getElementById('content-area')
      expect(loading).not.toBeNull()
      expect(content).toBeNull()

      // Finish loading
      document.getElementById('finish-loading-btn').click()
      await waitForUpdate()

      loading = document.getElementById('loading-indicator')
      content = document.getElementById('content-area')
      expect(loading).toBeNull()
      expect(content).not.toBeNull()
    })

    it('multiple elements in same component', async () => {
      wildflower.component('render-multiple-test', {
        state: {
          showA: true,
          showB: false,
          showC: true
        },
        toggleA() { this.state.showA = !this.state.showA },
        toggleB() { this.state.showB = !this.state.showB },
        toggleC() { this.state.showC = !this.state.showC }
      })

      testContainer.innerHTML = `
        <div data-component="render-multiple-test">
          <div id="multi-a" data-render="showA">A</div>
          <div id="multi-b" data-render="showB">B</div>
          <div id="multi-c" data-render="showC">C</div>
          <button id="toggle-a-btn" data-action="toggleA">Toggle A</button>
          <button id="toggle-b-btn" data-action="toggleB">Toggle B</button>
          <button id="toggle-c-btn" data-action="toggleC">Toggle C</button>
        </div>
      `
      wildflower.scan()
      await waitForUpdate()

      // Check initial state: A=true, B=false, C=true
      expect(document.getElementById('multi-a')).not.toBeNull()
      expect(document.getElementById('multi-b')).toBeNull()
      expect(document.getElementById('multi-c')).not.toBeNull()

      // Toggle B on
      document.getElementById('toggle-b-btn').click()
      await waitForUpdate()

      expect(document.getElementById('multi-b')).not.toBeNull()

      // Toggle A off
      document.getElementById('toggle-a-btn').click()
      await waitForUpdate()

      expect(document.getElementById('multi-a')).toBeNull()

      // Verify others unchanged
      expect(document.getElementById('multi-b')).not.toBeNull()
      expect(document.getElementById('multi-c')).not.toBeNull()
    })
  })

  describe('Handler cleanup on toggle', () => {
    it('action handler fires exactly once after multiple data-render toggles', async () => {
      let clickCount = 0

      testContainer.innerHTML = `
        <div data-component="render-handler-test">
          <button id="toggle-btn" data-action="toggle">Toggle</button>
          <div data-render="visible">
            <button id="inner-btn" data-action="increment">Click me</button>
          </div>
        </div>
      `

      wildflower.component('render-handler-test', {
        state: { visible: true },
        toggle() { this.state.visible = !this.state.visible },
        increment() { clickCount++ }
      })

      wildflower.scan()
      await waitForUpdate()

      // Toggle off and on 5 times
      for (let i = 0; i < 5; i++) {
        document.getElementById('toggle-btn').click()
        await waitForUpdate()
        document.getElementById('toggle-btn').click()
        await waitForUpdate()
      }

      // Content should be visible
      const innerBtn = document.getElementById('inner-btn')
      expect(innerBtn).not.toBeNull()

      // Click the inner button once — handler should fire exactly once
      clickCount = 0
      innerBtn.click()
      await waitForUpdate()

      expect(clickCount).toBe(1)
    })
  })
})
