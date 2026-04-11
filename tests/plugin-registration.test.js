/**
 * Plugin Registration Tests - Vitest Browser Mode
 *
 * Tests for the WildflowerJS plugin system registration and metadata.
 * Phase 1 of the plugin system implementation.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, hasConsoleWarnings, isMinifiedBuild, hasFeature} from './helpers/load-framework.js'

// Skip warning tests in minified builds (console.warn is stripped)
const itIfWarnings = hasConsoleWarnings() ? it : it.skip

// Helper to wait for framework processing
async function waitForUpdate(ms = 10) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

const describeIfPlugins = hasFeature('plugins') ? describe : describe.skip

describeIfPlugins('Plugin Registration', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    // Reset plugin system state
    if (wildflower._plugins) wildflower._plugins = []
    if (wildflower._pluginsByName) wildflower._pluginsByName.clear()
    if (wildflower._customDirectives) wildflower._customDirectives.clear()
    if (wildflower._globalMixins) wildflower._globalMixins = {}
    if (wildflower._hooks) wildflower._hooks.clear()

    // Create a fresh test container
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

  describe('wildflower.plugin()', () => {
    it('should accept a function plugin', () => {
      const pluginFn = vi.fn()

      wildflower.plugin(pluginFn)

      expect(pluginFn).toHaveBeenCalledWith(wildflower, {})
    })

    it('should pass options to function plugin', () => {
      const pluginFn = vi.fn()
      const options = { theme: 'dark', debug: true }

      wildflower.plugin(pluginFn, options)

      expect(pluginFn).toHaveBeenCalledWith(wildflower, options)
    })

    it('should accept an object plugin with install method', () => {
      const installFn = vi.fn()
      const plugin = {
        name: 'testPlugin',
        version: '1.0.0',
        install: installFn
      }

      wildflower.plugin(plugin)

      expect(installFn).toHaveBeenCalledWith(wildflower, {})
    })

    it('should pass options to object plugin install method', () => {
      const installFn = vi.fn()
      const plugin = {
        name: 'testPlugin',
        version: '1.0.0',
        install: installFn
      }
      const options = { apiKey: '12345' }

      wildflower.plugin(plugin, options)

      expect(installFn).toHaveBeenCalledWith(wildflower, options)
    })

    it('should track registered plugins', () => {
      const plugin1 = vi.fn()
      const plugin2 = { name: 'plugin2', version: '1.0.0', install: vi.fn() }

      wildflower.plugin(plugin1)
      wildflower.plugin(plugin2)

      expect(wildflower._plugins.length).toBe(2)
    })

    it('should return wildflower instance for chaining', () => {
      const result = wildflower.plugin(vi.fn())

      expect(result).toBe(wildflower)
    })

    it('should throw if plugin is not a function or object', () => {
      expect(() => wildflower.plugin('invalid')).toThrow()
      expect(() => wildflower.plugin(123)).toThrow()
      expect(() => wildflower.plugin(null)).toThrow()
    })

    it('should throw if object plugin has no install method', () => {
      const plugin = { name: 'broken', version: '1.0.0' }

      expect(() => wildflower.plugin(plugin)).toThrow(/install/)
    })

    it.skipIf(isMinifiedBuild())('should catch and report plugin errors without crashing', () => {
      const errorPlugin = () => {
        throw new Error('Plugin initialization failed')
      }
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Should not throw
      expect(() => wildflower.plugin(errorPlugin)).not.toThrow()

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  describe('Plugin Metadata', () => {
    it('should store plugin name and version', () => {
      const plugin = {
        name: 'analytics',
        version: '2.1.0',
        install: vi.fn()
      }

      wildflower.plugin(plugin)

      const registered = wildflower.getPlugin('analytics')
      expect(registered).toBeDefined()
      expect(registered.version).toBe('2.1.0')
    })

    it('should allow checking if plugin is registered', () => {
      wildflower.plugin({
        name: 'myPlugin',
        version: '1.0.0',
        install: vi.fn()
      })

      expect(wildflower.hasPlugin('myPlugin')).toBe(true)
      expect(wildflower.hasPlugin('unknownPlugin')).toBe(false)
    })

    it('should list all registered plugins', () => {
      wildflower.plugin({ name: 'plugin1', version: '1.0.0', install: vi.fn() })
      wildflower.plugin({ name: 'plugin2', version: '2.0.0', install: vi.fn() })

      const plugins = wildflower.listPlugins()

      expect(plugins).toHaveLength(2)
      expect(plugins).toContainEqual({ name: 'plugin1', version: '1.0.0' })
      expect(plugins).toContainEqual({ name: 'plugin2', version: '2.0.0' })
    })
  })

  // ============================================================
  // EDGE CASE TESTS
  // ============================================================

  describe('Edge Cases: Duplicate Plugin Registration', () => {
    itIfWarnings('should warn when registering plugin with same name', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      wildflower.plugin({ name: 'duplicate', version: '1.0.0', install: vi.fn() })
      wildflower.plugin({ name: 'duplicate', version: '2.0.0', install: vi.fn() })

      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('should keep most recent plugin when duplicates registered', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      wildflower.plugin({ name: 'dup', version: '1.0.0', install: vi.fn() })
      wildflower.plugin({ name: 'dup', version: '2.0.0', install: vi.fn() })

      const plugin = wildflower.getPlugin('dup')
      expect(plugin.version).toBe('2.0.0')

      vi.restoreAllMocks()
    })

    it('should still run install for duplicate plugins', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const firstInstall = vi.fn()
      const secondInstall = vi.fn()

      wildflower.plugin({ name: 'dup', version: '1.0.0', install: firstInstall })
      wildflower.plugin({ name: 'dup', version: '2.0.0', install: secondInstall })

      expect(firstInstall).toHaveBeenCalled()
      expect(secondInstall).toHaveBeenCalled()

      vi.restoreAllMocks()
    })
  })

  describe('Edge Cases: Async Plugin Installation', () => {
    it('should handle async install function', async () => {
      const asyncResult = { loaded: true }

      const asyncPlugin = async (wf, options) => {
        await new Promise(resolve => setTimeout(resolve, 10))
        wf._testAsyncResult = asyncResult
      }

      wildflower.plugin(asyncPlugin)

      // Immediate check - may not be set yet
      await new Promise(resolve => setTimeout(resolve, 20))

      expect(wildflower._testAsyncResult).toBe(asyncResult)
    })

    it('should not block synchronous plugins when async plugin is slow', async () => {
      const executionOrder = []

      const slowAsync = async (wf) => {
        await new Promise(resolve => setTimeout(resolve, 50))
        executionOrder.push('async')
      }

      const syncPlugin = (wf) => {
        executionOrder.push('sync')
      }

      wildflower.plugin(slowAsync)
      wildflower.plugin(syncPlugin)

      // Sync should run immediately
      expect(executionOrder).toContain('sync')

      // Wait for async
      await new Promise(resolve => setTimeout(resolve, 60))
      expect(executionOrder).toContain('async')
    })
  })

  describe('Edge Cases: Plugin Installation Order', () => {
    it('should maintain registration order', () => {
      wildflower.plugin({ name: 'first', version: '1.0.0', install: vi.fn() })
      wildflower.plugin({ name: 'second', version: '1.0.0', install: vi.fn() })
      wildflower.plugin({ name: 'third', version: '1.0.0', install: vi.fn() })

      expect(wildflower._plugins[0].name).toBe('first')
      expect(wildflower._plugins[1].name).toBe('second')
      expect(wildflower._plugins[2].name).toBe('third')
    })

    it('should allow plugin to depend on previously registered plugin', () => {
      wildflower.plugin({
        name: 'base',
        version: '1.0.0',
        install(wf) {
          wf.baseFeature = () => 'base'
        }
      })

      wildflower.plugin({
        name: 'extension',
        version: '1.0.0',
        install(wf) {
          // Depends on base plugin
          if (!wf.baseFeature) {
            throw new Error('Missing base plugin')
          }
          wf.extendedFeature = () => wf.baseFeature() + '-extended'
        }
      })

      expect(wildflower.extendedFeature()).toBe('base-extended')
    })
  })

  describe('Edge Cases: Plugin Options', () => {
    it('should handle undefined options', () => {
      const installFn = vi.fn()

      wildflower.plugin({ name: 'test', version: '1.0.0', install: installFn }, undefined)

      expect(installFn).toHaveBeenCalledWith(wildflower, {})
    })

    it('should handle empty options object', () => {
      const installFn = vi.fn()

      wildflower.plugin({ name: 'test', version: '1.0.0', install: installFn }, {})

      expect(installFn).toHaveBeenCalledWith(wildflower, {})
    })

    it('should handle complex nested options', () => {
      const installFn = vi.fn()
      const complexOptions = {
        api: {
          baseUrl: 'https://api.example.com',
          timeout: 5000,
          headers: {
            'X-Custom': 'value'
          }
        },
        features: ['feature1', 'feature2'],
        callbacks: {
          onSuccess: () => {},
          onError: () => {}
        }
      }

      wildflower.plugin({ name: 'test', version: '1.0.0', install: installFn }, complexOptions)

      expect(installFn).toHaveBeenCalledWith(wildflower, complexOptions)
    })
  })

  describe('Edge Cases: Error Scenarios', () => {
    it.skipIf(isMinifiedBuild())('should handle plugin that throws synchronously', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const throwingPlugin = () => {
        throw new Error('Sync error')
      }

      expect(() => wildflower.plugin(throwingPlugin)).not.toThrow()
      expect(errorSpy).toHaveBeenCalled()

      errorSpy.mockRestore()
    })

    it('should continue with other plugins after one fails', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const successFn = vi.fn()

      const failingPlugin = () => {
        throw new Error('Plugin failed')
      }

      const successPlugin = (wf) => {
        successFn()
      }

      wildflower.plugin(failingPlugin)
      wildflower.plugin(successPlugin)

      expect(successFn).toHaveBeenCalled()

      errorSpy.mockRestore()
    })

    it.skipIf(isMinifiedBuild())('should handle plugin that tries to access undefined properties', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const badPlugin = (wf) => {
        // Try to access deeply nested undefined property
        const value = wf.nonexistent.deeply.nested.property
      }

      expect(() => wildflower.plugin(badPlugin)).not.toThrow()
      expect(errorSpy).toHaveBeenCalled()

      errorSpy.mockRestore()
    })
  })

  describe('Edge Cases: Special Values', () => {
    it('should handle plugin with empty name string', () => {
      // Empty string names should still work but not be queryable
      wildflower.plugin({
        name: '',
        version: '1.0.0',
        install: vi.fn()
      })

      expect(wildflower.hasPlugin('')).toBe(true)
    })

    it('should handle plugin with very long name', () => {
      const longName = 'a'.repeat(1000)

      wildflower.plugin({
        name: longName,
        version: '1.0.0',
        install: vi.fn()
      })

      expect(wildflower.hasPlugin(longName)).toBe(true)
    })

    it('should handle plugin with unicode name', () => {
      wildflower.plugin({
        name: '日本語プラグイン',
        version: '1.0.0',
        install: vi.fn()
      })

      expect(wildflower.hasPlugin('日本語プラグイン')).toBe(true)
    })

    it('should handle plugin with special characters in name', () => {
      wildflower.plugin({
        name: '@scope/my-plugin.v2',
        version: '1.0.0',
        install: vi.fn()
      })

      expect(wildflower.hasPlugin('@scope/my-plugin.v2')).toBe(true)
    })
  })

  describe('Edge Cases: Framework State', () => {
    it('should allow plugin registration before any components exist', () => {
      // Clear all components
      wildflower.componentDefinitions.clear()
      wildflower.componentInstances.clear()

      expect(() => wildflower.plugin(vi.fn())).not.toThrow()
    })

    it('should allow plugin registration after components exist', async () => {
      wildflower.component('test', { state: { value: 1 } })

      testContainer.innerHTML = '<div data-component="test"></div>'
      await waitForUpdate(50)

      // Register plugin after component exists
      const installFn = vi.fn()
      wildflower.plugin(installFn)

      expect(installFn).toHaveBeenCalled()
    })

    it('should preserve plugins across component lifecycle', async () => {
      wildflower.plugin({
        name: 'persistent',
        version: '1.0.0',
        install: vi.fn()
      })

      wildflower.component('temp', { state: {} })

      testContainer.innerHTML = '<div data-component="temp"></div>'
      await waitForUpdate(50)

      const element = testContainer.querySelector('[data-component="temp"]')
      const componentId = element.dataset.componentId

      // Destroy component
      wildflower.destroyComponent(componentId)

      // Plugin should still exist
      expect(wildflower.hasPlugin('persistent')).toBe(true)
    })
  })
})
