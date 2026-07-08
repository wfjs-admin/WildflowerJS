/**
 * @wildflowerjs/test-utils/vitest
 *
 * Vitest-specific integration for testing WildflowerJS applications.
 * Provides automatic setup/teardown and convenient test helpers.
 *
 * @example
 * import { describe, it, expect } from 'vitest'
 * import { setupWildflowerTests, waitForUpdate } from '@wildflowerjs/test-utils/vitest'
 *
 * describe('My Component', () => {
 *   const { getContainer, getWildflower } = setupWildflowerTests()
 *
 *   it('should render', async () => {
 *     const wildflower = getWildflower()
 *     const container = getContainer()
 *
 *     wildflower.component('my-comp', {
 *       state: { message: 'Hello' }
 *     })
 *
 *     container.innerHTML = `
 *       <div data-component="my-comp">
 *         <span data-bind="message"></span>
 *       </div>
 *     `
 *
 *     wildflower._scanForDynamicComponents()
 *     await waitForUpdate()
 *
 *     expect(container.querySelector('span').textContent).toBe('Hello')
 *   })
 * })
 */

// Re-export all utilities from main package
export {
  getDistMode,
  getFrameworkScripts,
  hasFeature,
  isMinifiedBuild,
  hasConsoleWarnings,
  loadFramework,
  resetFramework,
  waitForUpdate,
  waitForCompleteRender,
  createTestContainer,
  getComponent,
  triggerAction,
  waitForState,
  skipIfNoFeature,
  initContextSystem
} from './index.js'

// Import for internal use
import {
  loadFramework,
  resetFramework,
  initContextSystem
} from './index.js'

// Import Vitest hooks - these are available when running under Vitest
import { beforeAll, beforeEach, afterEach } from 'vitest'

/**
 * Setup WildflowerJS test environment for Vitest
 *
 * Automatically handles:
 * - Loading the framework (beforeAll)
 * - Resetting state between tests (beforeEach)
 * - Creating and cleaning up test containers
 * - Re-initializing the context system
 *
 * @param {Object} [options] - Configuration options
 * @param {boolean} [options.visible=false] - Make test container visible for debugging
 * @param {string} [options.mode] - Distribution mode to load
 * @param {string} [options.containerId='test-container'] - Test container ID
 * @returns {{ getContainer: () => HTMLElement, getWildflower: () => Object }}
 *
 * @example
 * describe('Counter', () => {
 *   const { getContainer, getWildflower } = setupWildflowerTests()
 *
 *   it('increments', async () => {
 *     const wildflower = getWildflower()
 *     const container = getContainer()
 *     // ... test code
 *   })
 * })
 *
 * @example
 * // With visible container for debugging
 * const { getContainer } = setupWildflowerTests({ visible: true })
 *
 * @example
 * // Testing minified build
 * const { getWildflower } = setupWildflowerTests({ mode: 'core' })
 */
export function setupWildflowerTests(options = {}) {
  let testContainer = null
  let wildflower = null

  // Setup framework loading
  beforeAll(async () => {
    wildflower = await loadFramework({ mode: options.mode })
  })

  // Setup test isolation
  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()
    initContextSystem()

    // Create test container
    testContainer = document.createElement('div')
    testContainer.id = options.containerId || 'test-container'

    if (!options.visible) {
      testContainer.style.position = 'absolute'
      testContainer.style.left = '-9999px'
      testContainer.style.opacity = '0'
    }

    document.body.appendChild(testContainer)
  })

  // Cleanup after each test
  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
    testContainer = null
  })

  return {
    /**
     * Get the test container element
     * @returns {HTMLElement} The test container
     */
    getContainer: () => testContainer,

    /**
     * Get the WildflowerJS instance
     * @returns {Object} The wildflower instance (window.wildflower)
     */
    getWildflower: () => wildflower
  }
}

/**
 * Mount a component for testing
 *
 * Creates a component, renders it into a container, and returns
 * helpers for interacting with it.
 *
 * @param {string} name - Component name
 * @param {Object} definition - Component definition
 * @param {string} template - HTML template string
 * @param {Object} [options] - Mount options
 * @param {HTMLElement} [options.container] - Container to mount into
 * @returns {Promise<{ instance: Object, element: HTMLElement, container: HTMLElement }>}
 *
 * @example
 * const { instance, element } = await mountComponent(
 *   'counter',
 *   {
 *     state: { count: 0 },
 *     increment() { this.state.count++ }
 *   },
 *   `<div data-component="counter">
 *     <span data-bind="count"></span>
 *     <button data-action="increment">+</button>
 *   </div>`
 * )
 *
 * expect(element.querySelector('span').textContent).toBe('0')
 */
export async function mountComponent(name, definition, template, options = {}) {
  const { waitForCompleteRender } = await import('./index.js')

  if (typeof window === 'undefined' || !window.wildflower) {
    throw new Error('mountComponent: Framework not loaded. Call loadFramework() first.')
  }

  const wildflower = window.wildflower

  // Register the component
  wildflower.component(name, definition)

  // Create or use container
  let container = options.container
  let createdContainer = false

  if (!container) {
    container = document.createElement('div')
    container.id = `mount-${name}-${Date.now()}`
    container.style.position = 'absolute'
    container.style.left = '-9999px'
    document.body.appendChild(container)
    createdContainer = true
  }

  // Set template
  container.innerHTML = template

  // Scan for components
  wildflower._scanForDynamicComponents()
  await waitForCompleteRender()

  // Find the component element
  const element = container.querySelector(`[data-component="${name}"]`)
  if (!element) {
    throw new Error(`mountComponent: Could not find element with data-component="${name}"`)
  }

  // Get instance
  const componentId = element.dataset.componentId || element.dataset.wfComponentId
  const instance = wildflower.componentInstances.get(componentId)

  return {
    instance,
    element,
    container,
    /**
     * Cleanup function to remove mounted component
     */
    cleanup: () => {
      if (createdContainer && container.parentNode) {
        container.parentNode.removeChild(container)
      }
    }
  }
}

/**
 * Create a test harness for component testing
 *
 * Provides a fluent API for setting up and testing components.
 *
 * @param {string} name - Component name
 * @returns {Object} Test harness with chainable methods
 *
 * @example
 * const harness = createTestHarness('counter')
 *   .withState({ count: 0 })
 *   .withMethods({
 *     increment() { this.state.count++ }
 *   })
 *   .withTemplate(`
 *     <div data-component="counter">
 *       <span data-bind="count"></span>
 *     </div>
 *   `)
 *
 * const { instance, element } = await harness.mount()
 */
export function createTestHarness(name) {
  const definition = {
    state: {}
  }
  let template = ''

  const harness = {
    /**
     * Set initial state
     */
    withState(state) {
      definition.state = state
      return this
    },

    /**
     * Add methods to the component
     */
    withMethods(methods) {
      Object.assign(definition, methods)
      return this
    },

    /**
     * Add computed properties
     */
    withComputed(computed) {
      definition.computed = computed
      return this
    },

    /**
     * Add lifecycle hooks
     */
    withLifecycle(hooks) {
      Object.assign(definition, hooks)
      return this
    },

    /**
     * Set the HTML template
     */
    withTemplate(html) {
      template = html
      return this
    },

    /**
     * Mount the component and return test helpers
     */
    async mount(options = {}) {
      return mountComponent(name, definition, template, options)
    }
  }

  return harness
}
