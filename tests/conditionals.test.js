/**
 * WildflowerJS Conditionals Test Suite - Vitest Browser Mode
 *
 * Tests for data-show conditional rendering.
 * Migrated from unitTestSuite.js CONDITIONAL CONTEXT section.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, getListItems, isMinifiedBuild} from './helpers/load-framework.js'

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

describe('Conditional Context', () => {
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

  it.skipIf(isMinifiedBuild())('Basic conditional visibility - simple boolean state', async () => {
    testContainer.innerHTML = `
      <div data-component="conditional-test">
        <div id="conditional-element" data-show="isVisible">
          This should be visible
        </div>
      </div>
    `

    wildflower.component('conditional-test', {
      state: {
        isVisible: true
      }
    })

    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="conditional-test"]')
    const componentId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(componentId)
    const conditionalElement = component.querySelector('#conditional-element')

    // data-show is applied directly (no registry-tracked conditional context).
    // Test initial visibility
    expect(conditionalElement.style.display).not.toBe('none')

    // Toggle visibility state
    instance.state.isVisible = false
    await waitForUpdate()

    // Test updated visibility
    expect(conditionalElement.style.display).toBe('none')

    // Toggle back
    instance.state.isVisible = true
    await waitForUpdate()

    // Test toggled visibility
    expect(conditionalElement.style.display).not.toBe('none')
  })

  it.skipIf(isMinifiedBuild())('Negated conditions - elements shown when condition is false', async () => {
    testContainer.innerHTML = `
      <div data-component="negation-test">
        <div id="loading-indicator" data-show="isLoading">Loading...</div>
        <div id="content-area" data-show="!isLoading">Content is ready!</div>
      </div>
    `

    wildflower.component('negation-test', {
      state: {
        isLoading: true
      }
    })

    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="negation-test"]')
    const componentId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(componentId)

    const loadingElement = component.querySelector('#loading-indicator')
    const contentElement = component.querySelector('#content-area')

    // data-show (incl. negation) is applied directly to the elements.
    // Test initial state
    expect(loadingElement.style.display).not.toBe('none')
    expect(contentElement.style.display).toBe('none')

    // Change state
    instance.state.isLoading = false
    await waitForUpdate()

    // Test state after change
    expect(loadingElement.style.display).toBe('none')
    expect(contentElement.style.display).not.toBe('none')
  })

  it.skipIf(isMinifiedBuild())('Conditional with computed property', async () => {
    testContainer.innerHTML = `
      <div data-component="computed-conditional-test">
        <div id="positive-message" data-show="computed:isPositive">
          Count is positive
        </div>
        <div id="non-positive-message" data-show="!computed:isPositive">
          Count is zero or negative
        </div>
      </div>
    `

    wildflower.component('computed-conditional-test', {
      state: {
        count: 5
      },
      computed: {
        isPositive() {
          return this.state.count > 0
        }
      }
    })

    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="computed-conditional-test"]')
    const componentId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(componentId)

    const positiveElement = component.querySelector('#positive-message')
    const nonPositiveElement = component.querySelector('#non-positive-message')

    // data-show with computed (incl. negation) is applied directly.
    // Test initial state (count is positive)
    expect(positiveElement.style.display).not.toBe('none')
    expect(nonPositiveElement.style.display).toBe('none')

    // Change state to negative
    instance.state.count = -2
    await waitForUpdate()

    // Test updated state
    expect(positiveElement.style.display).toBe('none')
    expect(nonPositiveElement.style.display).not.toBe('none')
  })

  it.skipIf(isMinifiedBuild())('Conditionals in list items', async () => {
    testContainer.innerHTML = `
      <div data-component="list-conditional-test">
        <ul data-list="tasks">
          <template>
            <li>
              <span class="task-name" data-bind="name"></span>
              <span class="completed-indicator" data-show="completed">✓</span>
              <button class="complete-button" data-show="!completed">Complete</button>
            </li>
          </template>
        </ul>
      </div>
    `

    wildflower.component('list-conditional-test', {
      state: {
        tasks: [
          { id: 1, name: 'Task 1', completed: true },
          { id: 2, name: 'Task 2', completed: false },
          { id: 3, name: 'Task 3', completed: true }
        ]
      }
    })

    // Lists need more time for rendering
    await waitForCompleteRender()
    await waitForUpdate(100)

    const component = testContainer.querySelector('[data-component="list-conditional-test"]')
    const componentId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(componentId)

    // Verify list items have rendered
    const listItems = getListItems(component.querySelector('[data-list="tasks"]'))
    expect(listItems.length).toBe(3)

    // Check first item (completed)
    const completedIndicator1 = listItems[0].querySelector('.completed-indicator')
    const completeButton1 = listItems[0].querySelector('.complete-button')
    expect(completedIndicator1.style.display).not.toBe('none')
    expect(completeButton1.style.display).toBe('none')

    // Check second item (not completed)
    const completedIndicator2 = listItems[1].querySelector('.completed-indicator')
    const completeButton2 = listItems[1].querySelector('.complete-button')
    expect(completedIndicator2.style.display).toBe('none')
    expect(completeButton2.style.display).not.toBe('none')

    // Toggle a task's completion state
    const updatedTasks = [...instance.state.tasks]
    updatedTasks[1].completed = true
    instance.state.tasks = updatedTasks

    await waitForCompleteRender()
    await waitForUpdate(100)

    // Check updated visibility
    const updatedIndicator = listItems[1].querySelector('.completed-indicator')
    const updatedButton = listItems[1].querySelector('.complete-button')
    expect(updatedIndicator.style.display).not.toBe('none')
    expect(updatedButton.style.display).toBe('none')
  })

  it.skipIf(isMinifiedBuild())('Conditionals in dynamically scanned components (regression for batch mode blocking)', async () => {
    // This test covers a regression where batch mode from list rendering
    // could block conditional context registration in dynamically scanned components
    // See: commitBatch() calls added in _initializeComponentSafely, _handleEmptyList, _setupListTemplate

    // Create a component that will trigger dynamic component scanning
    wildflower.component('parent-container', {
      state: {
        items: []
      }
    })

    // Component with data-show that will be scanned dynamically
    wildflower.component('inner-conditional', {
      state: {
        showContent: true
      }
    })

    testContainer.innerHTML = `
      <div data-component="parent-container">
        <div data-list="items">
          <template>
            <div data-bind="name"></div>
          </template>
        </div>
        <div data-component="inner-conditional">
          <div id="dynamic-show" data-show="showContent">Dynamic Content</div>
        </div>
      </div>
    `

    await waitForUpdate(100)

    const innerComponent = testContainer.querySelector('[data-component="inner-conditional"]')
    expect(innerComponent).toBeDefined()

    const showElement = innerComponent.querySelector('#dynamic-show')

    // data-show on a dynamically scanned component is applied directly despite
    // the list rendering above (regression guard for batch-mode blocking).
    // Verify initial visibility
    expect(showElement.style.display).not.toBe('none')

    // Get component instance and toggle state
    const componentId = innerComponent.dataset.componentId
    const instance = wildflower.componentInstances.get(componentId)

    instance.state.showContent = false
    await waitForUpdate()

    // Verify the conditional responded to state changes
    expect(showElement.style.display).toBe('none')
  })

  it('Multiple dependent conditionals', async () => {
    testContainer.innerHTML = `
      <div data-component="multi-conditional-test">
        <div id="login-prompt" data-show="!isLoggedIn">
          Please log in to continue
        </div>
        <div id="user-dashboard" data-show="isLoggedIn">
          <div id="welcome-message">Welcome back!</div>
          <div id="admin-panel" data-show="computed:showAdminControls">
            Admin Controls
          </div>
          <div id="notification-badge" data-show="hasUnreadMessages">
            You have unread messages
          </div>
        </div>
      </div>
    `

    wildflower.component('multi-conditional-test', {
      state: {
        isLoggedIn: false,
        isAdmin: false,
        hasUnreadMessages: true
      },
      computed: {
        showAdminControls() {
          return this.state.isLoggedIn && this.state.isAdmin
        }
      }
    })

    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="multi-conditional-test"]')
    const componentId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(componentId)

    const loginPrompt = component.querySelector('#login-prompt')
    const userDashboard = component.querySelector('#user-dashboard')
    const adminPanel = component.querySelector('#admin-panel')
    const notificationBadge = component.querySelector('#notification-badge')

    // Test initial state (not logged in)
    expect(loginPrompt.style.display).not.toBe('none')
    expect(userDashboard.style.display).toBe('none')

    // Log user in
    instance.state.isLoggedIn = true
    await waitForUpdate()

    // Test logged in state
    expect(loginPrompt.style.display).toBe('none')
    expect(userDashboard.style.display).not.toBe('none')
    expect(adminPanel.style.display).toBe('none')
    expect(notificationBadge.style.display).not.toBe('none')

    // Make user an admin
    instance.state.isAdmin = true
    await waitForUpdate()

    // Test admin panel visibility
    expect(adminPanel.style.display).not.toBe('none')

    // Mark messages as read
    instance.state.hasUnreadMessages = false
    await waitForUpdate()

    // Test notification badge visibility
    expect(notificationBadge.style.display).toBe('none')
  })
})
