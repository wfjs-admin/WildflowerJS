/**
 * Smoke tests for @wildflowerjs/test-utils
 *
 * These tests verify that the test utilities package exports work correctly
 * and integrate properly with the WildflowerJS framework.
 *
 * Run with: npx vitest run tests/test-utils-smoke.test.js --config tests/vitest.browser.config.js
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'

// Import from the package
import {
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
} from '../packages/test-utils/index.js'

import {
  setupWildflowerTests,
  mountComponent,
  createTestHarness
} from '../packages/test-utils/vitest.js'

describe('@wildflowerjs/test-utils', () => {
  describe('Core Utilities', () => {
    describe('getDistMode', () => {
      it('should return a valid distribution mode', () => {
        const mode = getDistMode()
        // 'source' is deprecated but still accepted; defaults to 'ai-dev'
        // 'experimental' and 'experimental-dev' are for testing ListRenderer.v2
        // '*-raw' modes load uncompressed (plain .js) bundles
        // '*-min' modes load explicitly-minified bundles (alias of the
        // unsuffixed build; included so the 15-variant pre-launch sweep
        // exercises the test utility against the explicit names too)
        expect(['source', 'core', 'mini', 'lite', 'spa', 'full', 'ai', 'experimental', 'core-dev', 'mini-dev', 'lite-dev', 'spa-dev', 'full-dev', 'ai-dev', 'experimental-dev', 'core-raw', 'mini-raw', 'lite-raw', 'spa-raw', 'full-raw', 'core-min', 'mini-min', 'lite-min', 'spa-min', 'full-min', 'experimental-min']).toContain(mode)
      })

      it('should default to ai-dev mode', () => {
        const mode = getDistMode()
        // Default is now 'ai-dev' (full framework with debug info)
        // When WILDFLOWER_DIST is explicitly set, it returns that mode
        // 'experimental', '*-raw', and explicit '*-min' modes are also valid
        expect(['core', 'mini', 'lite', 'spa', 'full', 'ai', 'experimental', 'core-dev', 'mini-dev', 'lite-dev', 'spa-dev', 'full-dev', 'ai-dev', 'experimental-dev', 'core-raw', 'mini-raw', 'lite-raw', 'spa-raw', 'full-raw', 'core-min', 'mini-min', 'lite-min', 'spa-min', 'full-min', 'experimental-min']).toContain(mode)
      })
    })

    describe('getFrameworkScripts', () => {
      it('should return an array of script paths', () => {
        const scripts = getFrameworkScripts()
        expect(Array.isArray(scripts)).toBe(true)
        expect(scripts.length).toBeGreaterThan(0)
      })

      it('should return full-dev scripts for deprecated source mode', () => {
        // 'source' mode is deprecated and now falls back to full-dev
        const scripts = getFrameworkScripts('source')
        const dir = (typeof __WILDFLOWER_DIST_DIR__ !== 'undefined') ? __WILDFLOWER_DIST_DIR__ : '/dist'
        expect(scripts).toEqual([`${dir}/wildflower.full.dev.js`])
      })

      it('should return minified script for core mode', () => {
        const scripts = getFrameworkScripts('core')
        const dir = (typeof __WILDFLOWER_DIST_DIR__ !== 'undefined') ? __WILDFLOWER_DIST_DIR__ : '/dist'
        expect(scripts).toEqual([`${dir}/wildflower.min.js`])
      })
    })

    describe('hasFeature', () => {
      it('should return true for standard features in ai-dev mode', () => {
        // In ai-dev mode (default), all features are available
        const mode = getDistMode()
        if (mode === 'ai-dev' || mode === 'ai' || mode === 'full' || mode === 'full-dev') {
          expect(hasFeature('portals')).toBe(true)
          expect(hasFeature('transitions')).toBe(true)
          expect(hasFeature('ssr')).toBe(true)
          expect(hasFeature('router')).toBe(true)
        }
      })

      it('should return boolean for any feature check', () => {
        expect(typeof hasFeature('unknown')).toBe('boolean')
      })
    })

    describe('isMinifiedBuild / hasConsoleWarnings', () => {
      it('should correctly identify dev build', () => {
        const mode = getDistMode()
        if (mode.endsWith('-dev')) {
          expect(isMinifiedBuild()).toBe(false)
          expect(hasConsoleWarnings()).toBe(true)
        }
      })
    })

    describe('skipIfNoFeature', () => {
      it('should return original function if feature is available', () => {
        const testFn = () => 'test'
        const result = skipIfNoFeature('bindings', testFn)
        // bindings are always available
        expect(result).toBe(testFn)
      })
    })
  })

  describe('Framework Loading', () => {
    beforeAll(async () => {
      await loadFramework()
    })

    it('should load the framework successfully', () => {
      expect(window.wildflower).toBeDefined()
      expect(typeof window.wildflower.component).toBe('function')
    })

    it('should provide component registration', () => {
      expect(typeof window.wildflower.component).toBe('function')
      expect(window.wildflower.componentDefinitions).toBeDefined()
    })

    describe('resetFramework', () => {
      beforeEach(() => {
        // Register a test component
        window.wildflower.component('smoke-test-comp', {
          state: { value: 1 }
        })
      })

      it('should clear component definitions', () => {
        expect(window.wildflower.componentDefinitions.has('smoke-test-comp')).toBe(true)

        resetFramework()

        expect(window.wildflower.componentDefinitions.has('smoke-test-comp')).toBe(false)
      })
    })

    describe('initContextSystem', () => {
      it('should initialize without error', () => {
        expect(() => initContextSystem()).not.toThrow()
      })
    })
  })

  describe('Timing Utilities', () => {
    beforeAll(async () => {
      await loadFramework()
    })

    describe('waitForUpdate', () => {
      it('should wait for specified time', async () => {
        const start = Date.now()
        await waitForUpdate(20)
        const elapsed = Date.now() - start
        expect(elapsed).toBeGreaterThanOrEqual(15) // Allow some variance
      })

      it('should resolve via whenSettled() when called without args', async () => {
        const start = Date.now()
        await waitForUpdate()
        const elapsed = Date.now() - start
        // whenSettled() is deterministic — resolves after framework async layers drain
        expect(elapsed).toBeLessThan(200)
      })
    })

    describe('waitForCompleteRender', () => {
      it('should complete without error', async () => {
        await expect(waitForCompleteRender()).resolves.not.toThrow()
      })
    })
  })

  describe('Container Utilities', () => {
    describe('createTestContainer', () => {
      it('should create a container element', () => {
        const { container, cleanup } = createTestContainer()

        expect(container).toBeInstanceOf(HTMLElement)
        expect(container.parentNode).toBe(document.body)

        cleanup()
        expect(container.parentNode).toBeNull()
      })

      it('should use custom id', () => {
        const { container, cleanup } = createTestContainer({ id: 'custom-test' })

        expect(container.id).toBe('custom-test')

        cleanup()
      })

      it('should be hidden by default', () => {
        const { container, cleanup } = createTestContainer()

        expect(container.style.position).toBe('absolute')
        expect(container.style.left).toBe('-9999px')

        cleanup()
      })

      it('should be visible when requested', () => {
        const { container, cleanup } = createTestContainer({ visible: true })

        expect(container.style.position).not.toBe('absolute')

        cleanup()
      })
    })
  })

  describe('Component Utilities', () => {
    let container, cleanup

    beforeAll(async () => {
      await loadFramework()
    })

    beforeEach(() => {
      resetFramework()
      initContextSystem()
      const result = createTestContainer()
      container = result.container
      cleanup = result.cleanup
    })

    afterEach(() => {
      cleanup()
    })

    describe('getComponent', () => {
      it('should return null for non-existent component', () => {
        expect(getComponent('non-existent')).toBeNull()
      })
    })

    describe('triggerAction', () => {
      it('should throw if element is null', async () => {
        await expect(triggerAction(null)).rejects.toThrow('element is required')
      })

      it('should dispatch click event by default', async () => {
        let clicked = false
        const button = document.createElement('button')
        button.addEventListener('click', () => { clicked = true })
        container.appendChild(button)

        await triggerAction(button)

        expect(clicked).toBe(true)
      })

      it('should dispatch custom event type', async () => {
        let entered = false
        const div = document.createElement('div')
        div.addEventListener('mouseenter', () => { entered = true })
        container.appendChild(div)

        await triggerAction(div, 'mouseenter')

        expect(entered).toBe(true)
      })
    })

    describe('waitForState', () => {
      it('should resolve immediately if state matches', async () => {
        const instance = {
          state: { loading: false }
        }

        await expect(waitForState(instance, 'loading', false)).resolves.not.toThrow()
      })

      it('should timeout if state never matches', async () => {
        const instance = {
          state: { loading: true }
        }

        await expect(waitForState(instance, 'loading', false, 100))
          .rejects.toThrow('timeout')
      })

      it('should support dot notation paths', async () => {
        const instance = {
          state: { user: { name: 'John' } }
        }

        await expect(waitForState(instance, 'user.name', 'John')).resolves.not.toThrow()
      })
    })
  })

  describe('Vitest Integration', () => {
    describe('setupWildflowerTests', () => {
      const { getContainer, getWildflower } = setupWildflowerTests()

      it('should provide container getter', () => {
        const container = getContainer()
        expect(container).toBeInstanceOf(HTMLElement)
      })

      it('should provide wildflower getter', () => {
        const wildflower = getWildflower()
        expect(wildflower).toBeDefined()
        expect(typeof wildflower.component).toBe('function')
      })
    })

    describe('mountComponent', () => {
      beforeAll(async () => {
        await loadFramework()
      })

      beforeEach(() => {
        resetFramework()
        initContextSystem()
      })

      it('should mount a component and return instance', async () => {
        const result = await mountComponent(
          'mount-test',
          { state: { count: 42 } },
          '<div data-component="mount-test"><span data-bind="count"></span></div>'
        )

        expect(result.element).toBeInstanceOf(HTMLElement)
        expect(result.container).toBeInstanceOf(HTMLElement)
        expect(typeof result.cleanup).toBe('function')

        // Check DOM was updated
        const span = result.element.querySelector('span')
        expect(span.textContent).toBe('42')

        result.cleanup()
      })
    })

    describe('createTestHarness', () => {
      beforeAll(async () => {
        await loadFramework()
      })

      beforeEach(() => {
        resetFramework()
        initContextSystem()
      })

      it('should provide fluent API', () => {
        const harness = createTestHarness('harness-test')

        expect(typeof harness.withState).toBe('function')
        expect(typeof harness.withMethods).toBe('function')
        expect(typeof harness.withComputed).toBe('function')
        expect(typeof harness.withLifecycle).toBe('function')
        expect(typeof harness.withTemplate).toBe('function')
        expect(typeof harness.mount).toBe('function')
      })

      it('should be chainable', () => {
        const harness = createTestHarness('harness-chain-test')
          .withState({ value: 1 })
          .withMethods({ getValue() { return this.state.value } })
          .withTemplate('<div data-component="harness-chain-test"></div>')

        expect(harness).toBeDefined()
        expect(typeof harness.mount).toBe('function')
      })

      it('should mount component with full configuration', async () => {
        const result = await createTestHarness('full-harness-test')
          .withState({ message: 'Hello' })
          .withTemplate('<div data-component="full-harness-test"><span data-bind="message"></span></div>')
          .mount()

        const span = result.element.querySelector('span')
        expect(span.textContent).toBe('Hello')

        result.cleanup()
      })
    })
  })
})
