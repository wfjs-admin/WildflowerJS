/**
 * WildflowerJS Plugin-Component Automatic Dependency Tracking Test Suite
 *
 * Tests for automatic dependency tracking when components access plugin state.
 * Similar to store auto-tracking, when a component's computed property accesses
 * plugin state via wildflower.getPlugin(), the framework should automatically:
 * 1. Detect the access during computed evaluation
 * 2. Register the component as dependent on the plugin
 * 3. Re-evaluate the computed when plugin state changes
 *
 * NOTE: These tests are expected to FAIL initially until the feature is implemented.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to get component instance from selector
function getComponentInstance(selector) {
  const el = document.querySelector(selector)
  if (el && el.dataset.componentId) {
    return window.wildflower.componentInstances.get(el.dataset.componentId)
  }
  return null
}

const describeIfPlugins = hasFeature('plugins') ? describe : describe.skip

describeIfPlugins('Plugin-Component Automatic Dependency Tracking', () => {
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

  describe('Automatic Dependency Registration', () => {
    it('automatically registers component as dependent when accessing plugin.state', async () => {
      // Register a plugin with reactive state
      wildflower.plugin({
        name: 'auth-plugin',
        version: '1.0.0',
        state: {
          isLoggedIn: false,
          username: 'Guest'
        },
        install(wf) {
          // Plugin installed
        }
      })

      wildflower.component('auth-status', {
        computed: {
          currentUser() {
            // This should automatically register the dependency
            // Currently uses $pluginName accessor - we want getPlugin() to also work
            const plugin = wildflower['$auth-plugin']
            return plugin ? plugin.state.username : 'not-found'
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="auth-status">
          <span class="username" data-bind="computed:currentUser"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Verify initial render
      const usernameDisplay = testContainer.querySelector('.username')
      expect(usernameDisplay.textContent).toBe('Guest')
    })
  })

  describe('Automatic Reactivity Without Manual Subscription', () => {
    it('component computed updates when plugin state changes (no manual subscribe)', async () => {
      // Register plugin
      const authPlugin = {
        name: 'reactive-auth',
        version: '1.0.0',
        state: {
          user: 'Anonymous'
        },
        install(wf) {}
      }
      wildflower.plugin(authPlugin)

      // Component WITHOUT manual subscription
      wildflower.component('reactive-auth-display', {
        computed: {
          displayUser() {
            const plugin = wildflower['$reactive-auth']
            return plugin ? plugin.state.user : 'not-found'
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="reactive-auth-display">
          <span class="user" data-bind="computed:displayUser"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Verify initial render
      const userDisplay = testContainer.querySelector('.user')
      expect(userDisplay.textContent).toBe('Anonymous')

      // Update plugin state
      const plugin = wildflower['$reactive-auth']
      plugin.state.user = 'John'
      await waitForUpdate(100)

      // Computed should automatically re-evaluate
      expect(userDisplay.textContent).toBe('John')
    })

    it('multiple components react to same plugin state changes', async () => {
      wildflower.plugin({
        name: 'theme-plugin',
        version: '1.0.0',
        state: {
          mode: 'light'
        },
        install(wf) {}
      })

      wildflower.component('theme-indicator-a', {
        computed: {
          themeClass() {
            const plugin = wildflower['$theme-plugin']
            return 'theme-' + (plugin ? plugin.state.mode : 'unknown')
          }
        }
      })

      wildflower.component('theme-indicator-b', {
        computed: {
          isDark() {
            const plugin = wildflower['$theme-plugin']
            return plugin ? plugin.state.mode === 'dark' : false
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="theme-indicator-a">
          <span class="theme-class" data-bind="computed:themeClass"></span>
        </div>
        <div data-component="theme-indicator-b">
          <span class="is-dark" data-bind="computed:isDark"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Verify initial render
      expect(testContainer.querySelector('.theme-class').textContent).toBe('theme-light')
      expect(testContainer.querySelector('.is-dark').textContent).toBe('false')

      // Update plugin state
      wildflower['$theme-plugin'].state.mode = 'dark'
      await waitForUpdate(100)

      // Both components should update
      expect(testContainer.querySelector('.theme-class').textContent).toBe('theme-dark')
      expect(testContainer.querySelector('.is-dark').textContent).toBe('true')
    })
  })

  describe('Real-world Plugin Scenarios', () => {
    it('auth plugin pattern: components react to login/logout', async () => {
      wildflower.plugin({
        name: 'auth',
        version: '1.0.0',
        state: {
          isAuthenticated: false,
          user: null
        },
        login(username) {
          this.state.isAuthenticated = true
          this.state.user = { name: username }
        },
        logout() {
          this.state.isAuthenticated = false
          this.state.user = null
        },
        install(wf) {}
      })

      wildflower.component('auth-guard', {
        computed: {
          showProtected() {
            const auth = wildflower['$auth']
            return auth ? auth.state.isAuthenticated : false
          },
          welcomeMessage() {
            const auth = wildflower['$auth']
            if (!auth) return 'No auth plugin'
            return auth.state.user ? `Welcome, ${auth.state.user.name}!` : 'Please log in'
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="auth-guard">
          <div class="protected" data-show="computed:showProtected">Protected Content</div>
          <span class="welcome" data-bind="computed:welcomeMessage"></span>
        </div>
      `

      wildflower.scan()
      await waitForUpdate()

      // Verify initial state (logged out)
      expect(testContainer.querySelector('.protected').style.display).toBe('none')
      expect(testContainer.querySelector('.welcome').textContent).toBe('Please log in')

      // Log in - call method on plugin context
      wildflower['$auth'].login('Alice')
      await waitForUpdate(100)

      // Should auto-update
      expect(testContainer.querySelector('.protected').style.display).not.toBe('none')
      expect(testContainer.querySelector('.welcome').textContent).toBe('Welcome, Alice!')

      // Log out
      wildflower['$auth'].logout()
      await waitForUpdate(100)

      // Should auto-update again
      expect(testContainer.querySelector('.protected').style.display).toBe('none')
      expect(testContainer.querySelector('.welcome').textContent).toBe('Please log in')
    })
  })
})
