/**
 * WildflowerJS Dynamic Components Test Suite - Vitest Browser Mode
 *
 * Adapted from legacy dynamicComponentsTestSuite.html/js which tested a proposed
 * (unimplemented) data-component-is feature. These tests cover the equivalent
 * patterns using WildflowerJS's actual mechanisms:
 *
 *   - data-render for conditional component rendering (switching)
 *   - wildflower.scan() for dynamic DOM injection
 *   - Lifecycle hooks (init/destroy) on dynamically shown/hidden components
 *   - Props passing to conditionally rendered components
 *   - State preservation vs reset across visibility toggles
 *
 * Categories:
 *   1. Component Switching via data-render
 *   2. Props Passing to Dynamic Components
 *   3. Lifecycle Hooks on Dynamic Components
 *   4. Dynamic Component Scanning (DOM injection + scan)
 *   5. Integration (data-render + lists, multiple toggles)
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 100) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}



describe('Dynamic Components', () => {
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

  // ==========================================================================
  // 1. Component Switching via data-render
  // ==========================================================================
  describe('Component Switching via data-render', () => {

    it('renders one component and hides the other based on state', async () => {
      wildflower.component('dc-switch-host', {
        state: { showHome: true },
        computed: {
          showSettings() { return !this.state.showHome }
        }
      })

      wildflower.component('dc-tab-home', {
        state: { label: 'Home Content' }
      })

      wildflower.component('dc-tab-settings', {
        state: { label: 'Settings Content' }
      })

      testContainer.innerHTML = `
        <div data-component="dc-switch-host">
          <div data-render="showHome">
            <div data-component="dc-tab-home">
              <span id="dc-home-label" data-bind="label"></span>
            </div>
          </div>
          <div data-render="computed:showSettings">
            <div data-component="dc-tab-settings">
              <span id="dc-settings-label" data-bind="label"></span>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // Home should be visible, settings should not
      expect(testContainer.querySelector('#dc-home-label')).not.toBeNull()
      expect(testContainer.querySelector('#dc-home-label').textContent).toBe('Home Content')
      expect(testContainer.querySelector('#dc-settings-label')).toBeNull()
    })

    it('switches components when state changes', async () => {
      wildflower.component('dc-view-switcher', {
        state: { activeView: 'a' },
        computed: {
          showA() { return this.state.activeView === 'a' },
          showB() { return this.state.activeView === 'b' }
        },
        switchToB() {
          this.state.activeView = 'b'
        }
      })

      wildflower.component('dc-view-a', {
        state: { text: 'View A' }
      })

      wildflower.component('dc-view-b', {
        state: { text: 'View B' }
      })

      testContainer.innerHTML = `
        <div data-component="dc-view-switcher">
          <button id="dc-switch-btn" data-action="switchToB">Switch</button>
          <div data-render="computed:showA">
            <div data-component="dc-view-a">
              <span id="dc-view-a-text" data-bind="text"></span>
            </div>
          </div>
          <div data-render="computed:showB">
            <div data-component="dc-view-b">
              <span id="dc-view-b-text" data-bind="text"></span>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // View A visible initially
      expect(testContainer.querySelector('#dc-view-a-text')).not.toBeNull()
      expect(testContainer.querySelector('#dc-view-b-text')).toBeNull()

      // Switch to B
      testContainer.querySelector('#dc-switch-btn').click()
      await waitForCompleteRender()

      // View B visible, A removed
      expect(testContainer.querySelector('#dc-view-a-text')).toBeNull()
      expect(testContainer.querySelector('#dc-view-b-text')).not.toBeNull()
      expect(testContainer.querySelector('#dc-view-b-text').textContent).toBe('View B')
    })

    it('handles switching between three or more components', async () => {
      wildflower.component('dc-multi-switch', {
        state: { tab: 'one' },
        computed: {
          showOne() { return this.state.tab === 'one' },
          showTwo() { return this.state.tab === 'two' },
          showThree() { return this.state.tab === 'three' }
        },
        goTwo() { this.state.tab = 'two' },
        goThree() { this.state.tab = 'three' }
      })

      wildflower.component('dc-panel-one', { state: { label: 'Panel One' } })
      wildflower.component('dc-panel-two', { state: { label: 'Panel Two' } })
      wildflower.component('dc-panel-three', { state: { label: 'Panel Three' } })

      testContainer.innerHTML = `
        <div data-component="dc-multi-switch">
          <button id="dc-go-two" data-action="goTwo">Two</button>
          <button id="dc-go-three" data-action="goThree">Three</button>
          <div data-render="computed:showOne">
            <div data-component="dc-panel-one">
              <span class="dc-panel-name" data-bind="label"></span>
            </div>
          </div>
          <div data-render="computed:showTwo">
            <div data-component="dc-panel-two">
              <span class="dc-panel-name" data-bind="label"></span>
            </div>
          </div>
          <div data-render="computed:showThree">
            <div data-component="dc-panel-three">
              <span class="dc-panel-name" data-bind="label"></span>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      let panels = testContainer.querySelectorAll('.dc-panel-name')
      expect(panels.length).toBe(1)
      expect(panels[0].textContent).toBe('Panel One')

      // Switch to two
      testContainer.querySelector('#dc-go-two').click()
      await waitForCompleteRender()

      panels = testContainer.querySelectorAll('.dc-panel-name')
      expect(panels.length).toBe(1)
      expect(panels[0].textContent).toBe('Panel Two')

      // Switch to three
      testContainer.querySelector('#dc-go-three').click()
      await waitForCompleteRender()

      panels = testContainer.querySelectorAll('.dc-panel-name')
      expect(panels.length).toBe(1)
      expect(panels[0].textContent).toBe('Panel Three')
    })

    it('renders nothing when no condition is true', async () => {
      wildflower.component('dc-none-active', {
        state: { active: 'none' },
        computed: {
          showAlpha() { return this.state.active === 'alpha' },
          showBeta() { return this.state.active === 'beta' }
        }
      })

      wildflower.component('dc-alpha', { state: { label: 'Alpha' } })
      wildflower.component('dc-beta', { state: { label: 'Beta' } })

      testContainer.innerHTML = `
        <div data-component="dc-none-active">
          <div data-render="computed:showAlpha">
            <div data-component="dc-alpha">
              <span class="dc-optional-label" data-bind="label"></span>
            </div>
          </div>
          <div data-render="computed:showBeta">
            <div data-component="dc-beta">
              <span class="dc-optional-label" data-bind="label"></span>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // Neither should be visible
      const labels = testContainer.querySelectorAll('.dc-optional-label')
      expect(labels.length).toBe(0)
    })
  })

  // ==========================================================================
  // 2. Props Passing to Dynamic Components
  // ==========================================================================
  describe('Props Passing to Dynamic Components', () => {

    it('passes props to a conditionally rendered child component', async () => {
      wildflower.component('dc-props-parent', {
        state: { showChild: true, childTitle: 'Hello Props' }
      })

      wildflower.component('dc-props-child', {
        props: {
          title: { type: String }
        }
      })

      testContainer.innerHTML = `
        <div data-component="dc-props-parent">
          <div data-render="showChild">
            <div data-component="dc-props-child" data-prop-title="childTitle">
              <span id="dc-props-title" data-bind="props.title"></span>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      const titleEl = testContainer.querySelector('#dc-props-title')
      expect(titleEl).not.toBeNull()
      expect(titleEl.textContent).toBe('Hello Props')
    })

    it('child component receives updated props after parent state change', async () => {
      wildflower.component('dc-prop-update-parent', {
        state: { showChild: true, message: 'initial' },
        updateMessage() {
          this.state.message = 'updated'
        }
      })

      wildflower.component('dc-prop-update-child', {
        props: {
          message: { type: String }
        }
      })

      testContainer.innerHTML = `
        <div data-component="dc-prop-update-parent">
          <button id="dc-update-msg" data-action="updateMessage">Update</button>
          <div data-render="showChild">
            <div data-component="dc-prop-update-child" data-prop-message="message">
              <span id="dc-child-msg" data-bind="props.message"></span>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelector('#dc-child-msg').textContent).toBe('initial')

      // Update parent state
      testContainer.querySelector('#dc-update-msg').click()
      await waitForUpdate()

      expect(testContainer.querySelector('#dc-child-msg').textContent).toBe('updated')
    })
  })

  // ==========================================================================
  // 3. Lifecycle Hooks on Dynamic Components
  // ==========================================================================
  describe('Lifecycle Hooks on Dynamic Components', () => {

    it('calls init when component appears via data-render', async () => {
      let initCalled = false

      wildflower.component('dc-lifecycle-host', {
        state: { showDynamic: false },
        reveal() {
          this.state.showDynamic = true
        }
      })

      wildflower.component('dc-lifecycle-target', {
        state: {},
        init() {
          initCalled = true
        }
      })

      testContainer.innerHTML = `
        <div data-component="dc-lifecycle-host">
          <button id="dc-reveal-btn" data-action="reveal">Reveal</button>
          <div data-render="showDynamic">
            <div data-component="dc-lifecycle-target">
              <span>Dynamic</span>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      expect(initCalled).toBe(false)

      // Reveal the component
      testContainer.querySelector('#dc-reveal-btn').click()
      await waitForCompleteRender()

      expect(initCalled).toBe(true)
    })

    it('calls destroy when component disappears via data-render', async () => {
      let destroyCalled = false

      wildflower.component('dc-destroy-host', {
        state: { showDynamic: true },
        hide() {
          this.state.showDynamic = false
        }
      })

      wildflower.component('dc-destroy-target', {
        state: {},
        destroy() {
          destroyCalled = true
        }
      })

      testContainer.innerHTML = `
        <div data-component="dc-destroy-host">
          <button id="dc-hide-btn" data-action="hide">Hide</button>
          <div data-render="showDynamic">
            <div data-component="dc-destroy-target" id="dc-destroy-el">
              <span>Will be destroyed</span>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      expect(destroyCalled).toBe(false)
      expect(testContainer.querySelector('#dc-destroy-el')).not.toBeNull()

      // Hide the component
      testContainer.querySelector('#dc-hide-btn').click()
      await waitForCompleteRender()
      await waitForUpdate()

      expect(destroyCalled).toBe(true)
      expect(testContainer.querySelector('#dc-destroy-el')).toBeNull()
    })

    it('calls init and destroy in correct order during switch', async () => {
      const lifecycleLog = []

      wildflower.component('dc-order-host', {
        state: { showFirst: true },
        computed: {
          showSecond() { return !this.state.showFirst }
        },
        toggle() {
          this.state.showFirst = !this.state.showFirst
        }
      })

      wildflower.component('dc-order-first', {
        state: {},
        init() { lifecycleLog.push('first-init') },
        destroy() { lifecycleLog.push('first-destroy') }
      })

      wildflower.component('dc-order-second', {
        state: {},
        init() { lifecycleLog.push('second-init') },
        destroy() { lifecycleLog.push('second-destroy') }
      })

      testContainer.innerHTML = `
        <div data-component="dc-order-host">
          <button id="dc-toggle-btn" data-action="toggle">Toggle</button>
          <div data-render="showFirst">
            <div data-component="dc-order-first">
              <span>First</span>
            </div>
          </div>
          <div data-render="computed:showSecond">
            <div data-component="dc-order-second">
              <span>Second</span>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      expect(lifecycleLog).toContain('first-init')
      expect(lifecycleLog).not.toContain('second-init')

      // Toggle: first hides, second shows
      lifecycleLog.length = 0
      testContainer.querySelector('#dc-toggle-btn').click()
      await waitForCompleteRender()
      await waitForUpdate()

      expect(lifecycleLog).toContain('first-destroy')
      expect(lifecycleLog).toContain('second-init')
    })
  })

  // ==========================================================================
  // 4. Dynamic Component Scanning (DOM injection + scan)
  // ==========================================================================
  describe('Dynamic Component Scanning', () => {

    it('initializes dynamically injected component after scan()', async () => {
      wildflower.component('dc-injected', {
        state: { greeting: 'Hello Dynamic' }
      })

      // Inject component HTML dynamically
      testContainer.innerHTML = `
        <div id="dc-inject-area">
          <div data-component="dc-injected">
            <span id="dc-injected-text" data-bind="greeting"></span>
          </div>
        </div>
      `

      // Manually scan the injected area
      wildflower.scan(testContainer.querySelector('#dc-inject-area'))
      await waitForUpdate()

      expect(testContainer.querySelector('#dc-injected-text').textContent).toBe('Hello Dynamic')
    })

    it('scoped scan does not affect components outside scope', async () => {
      // Define component first, then wait for any auto-scan to settle
      wildflower.component('dc-scoped-comp', {
        state: { value: 'scoped' }
      })
      await waitForUpdate(50)

      // Add HTML and immediately scan before mutation observer fires
      testContainer.innerHTML = `
        <div id="dc-area-inside">
          <div data-component="dc-scoped-comp" id="dc-inside-comp">
            <span data-bind="value"></span>
          </div>
        </div>
        <div id="dc-area-outside">
          <div data-component="dc-scoped-comp" id="dc-outside-comp">
            <span data-bind="value"></span>
          </div>
        </div>
      `

      // Immediately scan only inside area before mutation observer fires
      wildflower.scan(testContainer.querySelector('#dc-area-inside'))

      const insideInstances = wildflower.getComponents('dc-scoped-comp')
      expect(insideInstances.length).toBe(1)
      expect(insideInstances[0].element.id).toBe('dc-inside-comp')
    })

    it('multiple sequential scan() calls after incremental DOM additions', async () => {
      const initOrder = []

      wildflower.component('dc-incremental', {
        state: {},
        init() {
          initOrder.push(this.element.id)
        }
      })

      testContainer.innerHTML = '<div id="dc-dynamic-root"></div>'
      const root = testContainer.querySelector('#dc-dynamic-root')

      // First injection
      root.innerHTML = '<div data-component="dc-incremental" id="dc-inc-1"><span>One</span></div>'
      wildflower.scan(root)
      await waitForUpdate()

      expect(initOrder).toEqual(['dc-inc-1'])

      // Second injection (append, not replace)
      const second = document.createElement('div')
      second.setAttribute('data-component', 'dc-incremental')
      second.id = 'dc-inc-2'
      second.innerHTML = '<span>Two</span>'
      root.appendChild(second)

      wildflower.scan(root)
      await waitForUpdate()

      // First should not re-init, second should init
      expect(initOrder).toEqual(['dc-inc-1', 'dc-inc-2'])
    })
  })

  // ==========================================================================
  // 5. State Preservation and Reset
  // ==========================================================================
  describe('State Preservation and Reset', () => {

    it('component state resets when toggled off and back on via data-render', async () => {
      wildflower.component('dc-state-reset-host', {
        state: { showChild: true },
        hideChild() { this.state.showChild = false },
        showChild() { this.state.showChild = true }
      })

      wildflower.component('dc-state-reset-child', {
        state: { counter: 0 },
        increment() { this.state.counter++ }
      })

      testContainer.innerHTML = `
        <div data-component="dc-state-reset-host">
          <button id="dc-hide-child" data-action="hideChild">Hide</button>
          <button id="dc-show-child" data-action="showChild">Show</button>
          <div data-render="showChild">
            <div data-component="dc-state-reset-child">
              <span id="dc-counter" data-bind="counter"></span>
              <button id="dc-inc-btn" data-action="increment">+</button>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // Increment counter
      testContainer.querySelector('#dc-inc-btn').click()
      await waitForUpdate()
      testContainer.querySelector('#dc-inc-btn').click()
      await waitForUpdate()

      expect(testContainer.querySelector('#dc-counter').textContent).toBe('2')

      // Hide and show again
      testContainer.querySelector('#dc-hide-child').click()
      await waitForCompleteRender()
      await waitForUpdate()

      testContainer.querySelector('#dc-show-child').click()
      await waitForCompleteRender()
      await waitForUpdate()

      // State should be reset to initial value (new instance)
      expect(testContainer.querySelector('#dc-counter').textContent).toBe('0')
    })
  })

  // ==========================================================================
  // 6. Integration
  // ==========================================================================
  describe('Integration', () => {

    it('conditionally rendered component binds actions correctly', async () => {
      let actionFired = false

      wildflower.component('dc-action-host', {
        state: { showPanel: true }
      })

      wildflower.component('dc-action-panel', {
        state: { clicked: false },
        handleClick() {
          this.state.clicked = true
          actionFired = true
        }
      })

      testContainer.innerHTML = `
        <div data-component="dc-action-host">
          <div data-render="showPanel">
            <div data-component="dc-action-panel">
              <button id="dc-action-btn" data-action="handleClick">Click</button>
              <span id="dc-clicked" data-bind="clicked"></span>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      testContainer.querySelector('#dc-action-btn').click()
      await waitForUpdate()

      expect(actionFired).toBe(true)
      expect(testContainer.querySelector('#dc-clicked').textContent).toBe('true')
    })

    it('conditionally rendered component with computed properties', async () => {
      wildflower.component('dc-computed-host', {
        state: { showCalc: true }
      })

      wildflower.component('dc-computed-child', {
        state: { price: 100, taxRate: 0.1 },
        computed: {
          total() {
            return this.state.price + (this.state.price * this.state.taxRate)
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="dc-computed-host">
          <div data-render="showCalc">
            <div data-component="dc-computed-child">
              <span id="dc-total" data-bind="computed:total"></span>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelector('#dc-total').textContent).toBe('110')
    })

    it('component with store subscription works when rendered conditionally', async () => {
      wildflower.store('dc-shared-store', {
        state: { theme: 'dark' }
      })

      wildflower.component('dc-store-host', {
        state: { showSubscriber: true }
      })

      wildflower.component('dc-store-subscriber', {
        subscribe: { 'dc-shared-store': ['theme'] },
        state: {},
        computed: {
          currentTheme() {
            const store = wildflower.getStore('dc-shared-store')
            return store ? store.theme : ''
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="dc-store-host">
          <div data-render="showSubscriber">
            <div data-component="dc-store-subscriber">
              <span id="dc-theme" data-bind="computed:currentTheme"></span>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      expect(testContainer.querySelector('#dc-theme').textContent).toBe('dark')
    })

    it('nested data-render blocks with components at each level', async () => {
      wildflower.component('dc-nested-render-host', {
        state: { showOuter: true }
      })

      wildflower.component('dc-outer-child', {
        state: { outerLabel: 'Outer', showInner: true },
        hideInner() { this.state.showInner = false },
        showInner() { this.state.showInner = true }
      })

      wildflower.component('dc-inner-child', {
        state: { innerLabel: 'Inner' }
      })

      testContainer.innerHTML = `
        <div data-component="dc-nested-render-host">
          <div data-render="showOuter">
            <div data-component="dc-outer-child">
              <span id="dc-outer-label" data-bind="outerLabel"></span>
              <button id="dc-hide-inner" data-action="hideInner">Hide Inner</button>
              <button id="dc-show-inner" data-action="showInner">Show Inner</button>
              <div data-render="showInner">
                <div data-component="dc-inner-child">
                  <span id="dc-inner-label" data-bind="innerLabel"></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      `

      wildflower.scan()
      await waitForCompleteRender()

      // Both should be visible
      expect(testContainer.querySelector('#dc-outer-label').textContent).toBe('Outer')
      expect(testContainer.querySelector('#dc-inner-label').textContent).toBe('Inner')

      // Hide inner (action on dc-outer-child)
      testContainer.querySelector('#dc-hide-inner').click()
      await waitForCompleteRender()
      await waitForUpdate()

      // Outer still visible, inner gone
      expect(testContainer.querySelector('#dc-outer-label').textContent).toBe('Outer')
      expect(testContainer.querySelector('#dc-inner-label')).toBeNull()

      // Show inner again
      testContainer.querySelector('#dc-show-inner').click()
      await waitForCompleteRender()
      await waitForUpdate()

      expect(testContainer.querySelector('#dc-inner-label').textContent).toBe('Inner')
    })
  })
})
