/**
 * WildflowerJS Plugin System Test Suite - Vitest Browser Mode
 *
 * Tests plugin registration, reactive state, computed properties,
 * ContextProxy parity (shorthand access), watch handlers, reset,
 * dependency injection, custom directives, and lifecycle hooks.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

function ensureComponentScanning() {
  const wf = window.wildflower
  if (wf._startScanning) wf._startScanning()
  if (wf.scan) wf.scan()
}

const describeIfPlugins = hasFeature('plugins') ? describe : describe.skip

describeIfPlugins('Plugin System', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower

    // Reset framework state
    if (wildflower.componentDefinitions) wildflower.componentDefinitions.clear()
    if (wildflower.componentInstances) wildflower.componentInstances.clear()
    if (wildflower.storeManager?._namedStores) wildflower.storeManager._namedStores.clear()
    if (wildflower._pluginStates) wildflower._pluginStates.clear()
    if (wildflower._pluginsByName) wildflower._pluginsByName.clear()
    if (wildflower._plugins) wildflower._plugins.length = 0
    if (wildflower._providers) wildflower._providers.clear()
    if (wildflower._hooks) wildflower._hooks.clear()
    if (wildflower._customDirectives) wildflower._customDirectives.clear()
    // _directiveContexts is a WeakMap — no clear() needed, GC handles it

    // Clear template cache
    if (wildflower._templateCache) {
      if (wildflower._templateCache.general) wildflower._templateCache.general.clear()
      if (wildflower._templateCache.lists) wildflower._templateCache.lists.clear()
      if (wildflower._templateCache.compiled) wildflower._templateCache.compiled.clear()
      if (wildflower._templateCache.extracted) wildflower._templateCache.extracted.clear()
      if (wildflower._templateCache.fragmentPools) wildflower._templateCache.fragmentPools.clear()
      if (wildflower._templateCache.stats) wildflower._templateCache.stats.clear()
    }

    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    testContainer.style.opacity = '0'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer?.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  // ═══════════════════════════════════════════════════════════════════
  // BASIC REGISTRATION
  // ═══════════════════════════════════════════════════════════════════

  describe('Registration', () => {
    it('registers a function-based plugin', () => {
      let installed = false
      wildflower.plugin(function(wf, opts) {
        installed = true
        expect(wf).toBe(wildflower)
      })
      expect(installed).toBe(true)
    })

    it('registers an object-based plugin with install()', () => {
      let installed = false
      wildflower.plugin({
        name: 'test-plugin',
        version: '1.0.0',
        install(wf, opts) {
          installed = true
        }
      })
      expect(installed).toBe(true)
      expect(wildflower.hasPlugin('test-plugin')).toBe(true)
    })

    it('throws for object plugin without install()', () => {
      expect(() => wildflower.plugin({ name: 'bad' })).toThrow('install()')
    })

    it('throws for non-function/non-object plugin', () => {
      expect(() => wildflower.plugin('not-a-plugin')).toThrow()
    })

    it('passes options to install', () => {
      let receivedOpts
      wildflower.plugin({
        name: 'opts-test',
        install(wf, opts) { receivedOpts = opts }
      }, { debug: true })
      expect(receivedOpts).toEqual({ debug: true })
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // PLUGIN QUERY API
  // ═══════════════════════════════════════════════════════════════════

  describe('Query API', () => {
    beforeEach(() => {
      wildflower.plugin({
        name: 'alpha',
        version: '1.0.0',
        install() {},
        state: { count: 0 }
      })
      wildflower.plugin({
        name: 'beta',
        version: '2.0.0',
        install() {},
        state: { active: true }
      })
    })

    it('getPlugin() returns plugin info', () => {
      const info = wildflower.getPlugin('alpha')
      expect(info).toBeDefined()
      expect(info.name).toBe('alpha')
      expect(info.version).toBe('1.0.0')
    })

    it('getPlugin() returns undefined for unknown', () => {
      expect(wildflower.getPlugin('nonexistent')).toBeUndefined()
    })

    it('hasPlugin() returns true/false', () => {
      expect(wildflower.hasPlugin('alpha')).toBe(true)
      expect(wildflower.hasPlugin('nonexistent')).toBe(false)
    })

    it('listPlugins() returns named plugins', () => {
      const list = wildflower.listPlugins()
      expect(list).toEqual([
        { name: 'alpha', version: '1.0.0' },
        { name: 'beta', version: '2.0.0' }
      ])
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // PLUGIN STATE — explicit `this.state.X` access (should always work)
  // ═══════════════════════════════════════════════════════════════════

  describe('Explicit State Access', () => {
    it('methods can read state via this.state.X', () => {
      let readValue
      wildflower.plugin({
        name: 'explicit-read',
        install() {},
        state: { count: 42 },
        getCount() { readValue = this.state.count }
      })
      wildflower.$explicit_read?.getCount?.() ?? wildflower._pluginStates.get('explicit-read').getCount()
      expect(readValue).toBe(42)
    })

    it('methods can write state via this.state.X = val', () => {
      wildflower.plugin({
        name: 'explicit-write',
        install() {},
        state: { count: 0 },
        setCount(val) { this.state.count = val }
      })
      const ctx = wildflower._pluginStates.get('explicit-write')
      ctx.setCount(99)
      expect(ctx.state.count).toBe(99)
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // CONTEXTPROXY PARITY — shorthand `this.X` access
  // ═══════════════════════════════════════════════════════════════════

  describe('ContextProxy Shorthand', () => {
    it('this.count reads state inside methods', () => {
      let readValue
      wildflower.plugin({
        name: 'shorthand-read',
        install() {},
        state: { count: 42 },
        getCount() { readValue = this.count }
      })
      const ctx = wildflower._pluginStates.get('shorthand-read')
      ctx.getCount()
      expect(readValue).toBe(42)
    })

    it('this.count = val writes to state', () => {
      wildflower.plugin({
        name: 'shorthand-write',
        install() {},
        state: { count: 0 },
        setCount(val) { this.count = val }
      })
      const ctx = wildflower._pluginStates.get('shorthand-write')
      ctx.setCount(77)
      expect(ctx.state.count).toBe(77)
    })

    it('this.doubled reads computed inside methods', () => {
      let readValue
      wildflower.plugin({
        name: 'shorthand-computed',
        install() {},
        state: { count: 5 },
        computed: {
          doubled() { return this.state.count * 2 }
        },
        getDoubled() { readValue = this.doubled }
      })
      const ctx = wildflower._pluginStates.get('shorthand-computed')
      ctx.getDoubled()
      expect(readValue).toBe(10)
    })

    it('external accessor resolves state shorthand: wildflower.$plugin.count', () => {
      wildflower.plugin({
        name: 'ext',
        install() {},
        state: { count: 33 }
      })
      expect(wildflower.$ext.count).toBe(33)
    })

    it('external accessor resolves computed shorthand: wildflower.$plugin.doubled', () => {
      wildflower.plugin({
        name: 'ext2',
        install() {},
        state: { count: 7 },
        computed: {
          doubled() { return this.state.count * 2 }
        }
      })
      expect(wildflower.$ext2.doubled).toBe(14)
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // COMPUTED PROPERTIES
  // ═══════════════════════════════════════════════════════════════════

  describe('Computed Properties', () => {
    it('computed properties are accessible via this.computed.X', () => {
      let readValue
      wildflower.plugin({
        name: 'comp-explicit',
        install() {},
        state: { firstName: 'Jane', lastName: 'Doe' },
        computed: {
          fullName() { return this.state.firstName + ' ' + this.state.lastName }
        },
        getFullName() { readValue = this.computed.fullName }
      })
      wildflower._pluginStates.get('comp-explicit').getFullName()
      expect(readValue).toBe('Jane Doe')
    })

    it('computed properties react to state changes', () => {
      wildflower.plugin({
        name: 'comp-react',
        install() {},
        state: { count: 3 },
        computed: {
          doubled() { return this.state.count * 2 }
        }
      })
      const ctx = wildflower._pluginStates.get('comp-react')
      expect(ctx.computed.doubled).toBe(6)
      ctx.state.count = 10
      expect(ctx.computed.doubled).toBe(20)
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // METHOD BINDING
  // ═══════════════════════════════════════════════════════════════════

  describe('Method Binding', () => {
    it('top-level methods are bound to the plugin context', () => {
      let context
      wildflower.plugin({
        name: 'method-bind',
        install() {},
        state: { count: 0 },
        whoAmI() { context = this }
      })
      const ctx = wildflower._pluginStates.get('method-bind')
      ctx.whoAmI()
      // `this` inside the method should be the proxy context
      expect(context.state).toBeDefined()
      expect(context.state.count).toBe(0)
    })

    it('methods block (legacy) is also supported', () => {
      let readValue
      wildflower.plugin({
        name: 'methods-block',
        install() {},
        state: { count: 5 },
        methods: {
          getCount() { readValue = this.state.count }
        }
      })
      wildflower._pluginStates.get('methods-block').getCount()
      expect(readValue).toBe(5)
    })

    it('reserved keys are not bound as methods', () => {
      wildflower.plugin({
        name: 'reserved-keys',
        install() {},
        state: { x: 1 }
      })
      const ctx = wildflower._pluginStates.get('reserved-keys')
      // 'install' should NOT be on the context as a method
      expect(typeof ctx.install).not.toBe('function')
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // RESET
  // ═══════════════════════════════════════════════════════════════════

  describe('Reset', () => {
    it('reset() restores state to initial values', () => {
      wildflower.plugin({
        name: 'resettable',
        install() {},
        state: { count: 0, label: 'start' },
        modify() {
          this.state.count = 999
          this.state.label = 'changed'
        }
      })
      const ctx = wildflower._pluginStates.get('resettable')
      ctx.modify()
      expect(ctx.state.count).toBe(999)
      ctx.reset()
      expect(ctx.state.count).toBe(0)
      expect(ctx.state.label).toBe('start')
    })

    it('reset() deep-clones object state', () => {
      wildflower.plugin({
        name: 'deep-reset',
        install() {},
        state: { items: [1, 2, 3] }
      })
      const ctx = wildflower._pluginStates.get('deep-reset')
      ctx.state.items.push(4)
      expect(ctx.state.items.length).toBe(4)
      ctx.reset()
      expect(ctx.state.items.length).toBe(3)
      expect(ctx.state.items[0]).toBe(1)
      expect(ctx.state.items[1]).toBe(2)
      expect(ctx.state.items[2]).toBe(3)
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // WATCH HANDLERS
  // ═══════════════════════════════════════════════════════════════════

  describe('Watch', () => {
    it('watch callback fires on state change', () => {
      const calls = []
      wildflower.plugin({
        name: 'watched',
        install() {},
        state: { count: 0 },
        watch: {
          count(newVal, oldVal) {
            calls.push({ newVal, oldVal })
          }
        }
      })
      const ctx = wildflower._pluginStates.get('watched')
      ctx.state.count = 5
      expect(calls.length).toBeGreaterThanOrEqual(1)
      expect(calls[calls.length - 1].newVal).toBe(5)
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // SUBSCRIBE
  // ═══════════════════════════════════════════════════════════════════

  describe('Subscribe', () => {
    it('subscribe() fires callback on state change', () => {
      const calls = []
      wildflower.plugin({
        name: 'subscribable',
        install() {},
        state: { count: 0 }
      })
      const ctx = wildflower._pluginStates.get('subscribable')
      const unsub = ctx.subscribe('count', (newVal) => {
        calls.push(newVal)
      })
      ctx.state.count = 10
      expect(calls.length).toBeGreaterThanOrEqual(1)
      unsub()
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // DEPENDENCY INJECTION
  // ═══════════════════════════════════════════════════════════════════

  describe('Dependency Injection', () => {
    it('provide() / getService() round-trip', () => {
      const api = { fetch: () => 'data' }
      wildflower.provide('api', api)
      expect(wildflower.getService('api')).toBe(api)
    })

    it('hasProvider() returns true/false', () => {
      wildflower.provide('logger', console)
      expect(wildflower.hasProvider('logger')).toBe(true)
      expect(wildflower.hasProvider('missing')).toBe(false)
    })

    it('provide() throws for invalid key', () => {
      expect(() => wildflower.provide('', {})).toThrow()
      expect(() => wildflower.provide(null, {})).toThrow()
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // CUSTOM DIRECTIVES
  // ═══════════════════════════════════════════════════════════════════

  describe('Custom Directives', () => {
    it('directive() registers and init fires on scan', async () => {
      const initCalls = []
      wildflower.directive('tooltip', {
        init(el, value, ctx) {
          initCalls.push({ el, value })
        }
      })

      testContainer.innerHTML = `
        <div data-component="dir-test">
          <span id="tip-el" data-tooltip="Hello">Hover me</span>
        </div>
      `
      wildflower.component('dir-test', {
        state: {}
      })
      ensureComponentScanning()
      await waitForUpdate(100)

      expect(initCalls.length).toBeGreaterThanOrEqual(1)
      expect(initCalls[0].value).toBe('Hello')
    })

    it('directive() throws for invalid name or handlers', () => {
      expect(() => wildflower.directive('', {})).toThrow()
      expect(() => wildflower.directive('test', null)).toThrow()
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // LIFECYCLE HOOKS
  // ═══════════════════════════════════════════════════════════════════

  describe('Lifecycle Hooks', () => {
    it('hook() registers a handler and returns unsubscribe', () => {
      const calls = []
      const unsub = wildflower.hook('component:afterInit', (instance) => {
        calls.push(instance)
      })
      expect(typeof unsub).toBe('function')

      // Trigger hook manually
      wildflower._triggerHook('component:afterInit', { id: 'test' })
      expect(calls.length).toBe(1)

      unsub()
      wildflower._triggerHook('component:afterInit', { id: 'test2' })
      expect(calls.length).toBe(1) // no new call after unsubscribe
    })

    it('hook() throws for invalid args', () => {
      expect(() => wildflower.hook('', () => {})).toThrow()
      expect(() => wildflower.hook('test', 'not-fn')).toThrow()
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // LIGHTWEIGHT (methods-only) PLUGIN
  // ═══════════════════════════════════════════════════════════════════

  describe('Lightweight Plugin (no state)', () => {
    it('methods-only plugin works without state', () => {
      let called = false
      wildflower.plugin({
        name: 'util',
        install() {},
        methods: {
          formatDate() { called = true; return '2026-01-01' }
        }
      })
      const ctx = wildflower._pluginStates.get('util')
      expect(ctx).toBeDefined()
      const result = ctx.formatDate()
      expect(called).toBe(true)
      expect(result).toBe('2026-01-01')
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  // PLUGIN + COMPONENT INTEGRATION
  // ═══════════════════════════════════════════════════════════════════

  describe('Component Integration', () => {
    it.skipIf(isMinifiedBuild())('component computed can read plugin state', async () => {
      wildflower.plugin({
        name: 'notifications',
        install() {},
        state: { unreadCount: 3 },
        markRead() { this.state.unreadCount = 0 }
      })

      testContainer.innerHTML = `
        <div data-component="notif-badge">
          <span id="badge-count" data-bind="badgeText"></span>
        </div>
      `

      wildflower.component('notif-badge', {
        state: {},
        computed: {
          badgeText() {
            const notif = wildflower.$notifications
            return notif ? String(notif.state.unreadCount) : '0'
          }
        }
      })

      ensureComponentScanning()
      await waitForUpdate(100)

      const badge = testContainer.querySelector('#badge-count')
      expect(badge.textContent).toBe('3')
    })
  })
})
