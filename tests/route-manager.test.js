/**
 * WildflowerJS RouteManager Test Suite - Vitest Browser Mode
 *
 * IMPORTANT: This is a smoke test suite for basic RouteManager functionality.
 * Router tests have special requirements since they modify browser history/hash,
 * which breaks the Vitest iframe-based test environment.
 *
 * For COMPLETE router testing (84 tests), use the browser-based test suite:
 *   tests/tests_to_convert/original/routerTestSuite.html
 *
 * This file tests:
 * - RouteManager class loading and instantiation
 * - Route registration
 * - URL building and parsing
 * - Route matching logic (without navigation)
 * - Configuration options
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, hasFeature } from './helpers/load-framework.js'

// Helper to wait for async operations
async function wait(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

const describeIfRouter = hasFeature('router') ? describe : describe.skip

describeIfRouter('RouteManager', () => {
  let testContainer
  let testRouter

  beforeAll(async () => {
    await loadFramework()

    if (typeof RouteManager === 'undefined') {
      throw new Error('RouteManager class not found after loading framework')
    }
  })

  beforeEach(() => {
    // Destroy previous router if exists
    if (testRouter) {
      if (typeof testRouter.destroy === 'function') {
        testRouter.destroy()
      }
      testRouter = null
    }

    // Create test container
    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testRouter) {
      if (typeof testRouter.destroy === 'function') {
        testRouter.destroy()
      }
      testRouter = null
    }

    window.location.hash = ''

    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  // ============================================================================
  // SMOKE TESTS: Basic Class Functionality
  // ============================================================================
  describe('Class Loading', () => {
    it('RouteManager class is available globally', () => {
      expect(typeof RouteManager).toBe('function')
    })

    it('can instantiate RouteManager with default options', () => {
      testRouter = new RouteManager()
      expect(testRouter).toBeDefined()
      expect(testRouter.options.mode).toBe('history')
    })

    it('can instantiate RouteManager with hash mode', () => {
      testRouter = new RouteManager({ mode: 'hash' })
      expect(testRouter.options.mode).toBe('hash')
    })

    it('has expected methods', () => {
      testRouter = new RouteManager({ mode: 'hash' })
      expect(typeof testRouter.onRoute).toBe('function')
      expect(typeof testRouter.navigate).toBe('function')
      expect(typeof testRouter.init).toBe('function')
      expect(typeof testRouter.destroy).toBe('function')
      expect(typeof testRouter.beforeEach).toBe('function')
      expect(typeof testRouter.afterEach).toBe('function')
      expect(typeof testRouter.getRouteUrl).toBe('function')
      expect(typeof testRouter.loadRoutes).toBe('function')
    })
  })

  // ============================================================================
  // Route Registration Tests (no navigation needed)
  // ============================================================================
  describe('Route Registration', () => {
    beforeEach(() => {
      testRouter = new RouteManager({ mode: 'hash' })
    })

    it('registers static routes', () => {
      testRouter.onRoute('/about', { handler: () => {} })
      // Routes without names are stored in routeTree, not routes Map
      expect(testRouter.routeTree.length).toBe(1)
    })

    it('registers parameterized routes', () => {
      testRouter.onRoute('/users/:id', { handler: () => {} })
      expect(testRouter.routeTree.length).toBe(1)
    })

    it('registers named routes', () => {
      testRouter.onRoute('/users/:id', { name: 'user-detail', handler: () => {} })
      expect(testRouter.routes.has('user-detail')).toBe(true)
    })

    it('supports chaining with onRoute', () => {
      const result = testRouter
        .onRoute('/route1', { handler: () => {} })
        .onRoute('/route2', { handler: () => {} })
        .onRoute('/route3', { handler: () => {} })

      expect(result).toBe(testRouter)
      expect(testRouter.routeTree.length).toBe(3)
    })

    it('loads routes from configuration array', () => {
      testRouter.loadRoutes([
        { path: '/home', name: 'home', handler: () => {} },
        { path: '/about', name: 'about', handler: () => {} },
        { path: '/contact', name: 'contact', handler: () => {} }
      ])

      expect(testRouter.routes.size).toBe(3)
      expect(testRouter.routes.has('home')).toBe(true)
      expect(testRouter.routes.has('about')).toBe(true)
      expect(testRouter.routes.has('contact')).toBe(true)
    })

    it('supports chaining with loadRoutes', () => {
      const result = testRouter.loadRoutes([
        { path: '/test', handler: () => {} }
      ])

      expect(result).toBe(testRouter)
    })
  })

  // ============================================================================
  // URL Building Tests (no navigation needed)
  // ============================================================================
  describe('URL Building', () => {
    beforeEach(() => {
      testRouter = new RouteManager({ mode: 'hash' })
    })

    it('generates URL for static named route', () => {
      testRouter.onRoute('/about', { name: 'about', handler: () => {} })
      const url = testRouter.getRouteUrl('about')
      expect(url).toBe('/about')
    })

    it('generates URL with parameters', () => {
      testRouter.onRoute('/users/:id', { name: 'user', handler: () => {} })
      const url = testRouter.getRouteUrl('user', { id: '123' })
      expect(url).toBe('/users/123')
    })

    it('generates URL with multiple parameters', () => {
      testRouter.onRoute('/users/:userId/posts/:postId', { name: 'user-post', handler: () => {} })
      const url = testRouter.getRouteUrl('user-post', { userId: '42', postId: '99' })
      expect(url).toBe('/users/42/posts/99')
    })

    it('generates URL with query parameters', () => {
      testRouter.onRoute('/search', { name: 'search', handler: () => {} })
      const url = testRouter.getRouteUrl('search', {}, { q: 'test', page: '1' })
      expect(url).toContain('q=test')
      expect(url).toContain('page=1')
    })

    it('returns default route for unknown route name', () => {
      const url = testRouter.getRouteUrl('nonexistent')
      expect(url).toBe('/')
    })
  })

  // ============================================================================
  // Configuration Tests
  // ============================================================================
  describe('Configuration', () => {
    it('accepts base path option', () => {
      testRouter = new RouteManager({ mode: 'hash', base: '/app' })
      expect(testRouter.options.base).toBe('/app')
    })

    it('accepts default route option', () => {
      testRouter = new RouteManager({ mode: 'hash', defaultRoute: '/home' })
      expect(testRouter.options.defaultRoute).toBe('/home')
    })

    it('accepts loading timeout option', () => {
      testRouter = new RouteManager({ mode: 'hash', loadingTimeout: 10000 })
      expect(testRouter.options.loadingTimeout).toBe(10000)
    })

    it('accepts scroll behavior function', () => {
      const scrollFn = () => ({ x: 0, y: 0 })
      testRouter = new RouteManager({ mode: 'hash', scrollBehavior: scrollFn })
      expect(testRouter.options.scrollBehavior).toBe(scrollFn)
    })

    it('accepts loading callbacks', () => {
      const onStart = () => {}
      const onEnd = () => {}
      const onError = () => {}
      const onTimeout = () => {}

      testRouter = new RouteManager({
        mode: 'hash',
        onLoadingStart: onStart,
        onLoadingEnd: onEnd,
        onLoadingError: onError,
        onLoadingTimeout: onTimeout
      })

      expect(testRouter.options.onLoadingStart).toBe(onStart)
      expect(testRouter.options.onLoadingEnd).toBe(onEnd)
      expect(testRouter.options.onLoadingError).toBe(onError)
      expect(testRouter.options.onLoadingTimeout).toBe(onTimeout)
    })
  })

  // ============================================================================
  // Guards Registration Tests (no navigation needed)
  // ============================================================================
  describe('Guards Registration', () => {
    beforeEach(() => {
      testRouter = new RouteManager({ mode: 'hash' })
    })

    it('registers beforeEach guard', () => {
      const guard = (to, from, next) => next()
      testRouter.beforeEach(guard)
      expect(testRouter.guards.beforeEach).toContain(guard)
    })

    it('registers multiple beforeEach guards', () => {
      const guard1 = (to, from, next) => next()
      const guard2 = (to, from, next) => next()
      testRouter.beforeEach(guard1)
      testRouter.beforeEach(guard2)
      expect(testRouter.guards.beforeEach.length).toBe(2)
    })

    it('registers afterEach hook', () => {
      const hook = (to, from) => {}
      testRouter.afterEach(hook)
      expect(testRouter.guards.afterEach).toContain(hook)
    })

    it('registers per-route beforeEnter guard', () => {
      const guard = (to, from, next) => next()
      testRouter.onRoute('/protected', {
        beforeEnter: guard,
        handler: () => {}
      })
      // Routes without names are stored in routeTree
      const route = testRouter.routeTree[0]
      expect(route.beforeEnter).toBe(guard)
    })
  })

  // ============================================================================
  // Route Metadata Tests
  // ============================================================================
  describe('Route Metadata', () => {
    beforeEach(() => {
      testRouter = new RouteManager({ mode: 'hash' })
    })

    it('stores route meta data', () => {
      testRouter.onRoute('/admin', {
        name: 'admin',
        meta: { requiresAuth: true, role: 'admin' },
        handler: () => {}
      })
      const route = testRouter.routes.get('admin')
      expect(route.meta.requiresAuth).toBe(true)
      expect(route.meta.role).toBe('admin')
    })

    it('stores redirect configuration', () => {
      testRouter.onRoute('/old', {
        redirect: '/new'
      })
      // Redirect routes are stored in routeTree
      const route = testRouter.routeTree[0]
      expect(route.redirect).toBe('/new')
    })

    it('stores alias configuration', () => {
      testRouter.onRoute('/main', {
        name: 'main',
        alias: '/alternate',
        handler: () => {}
      })
      const route = testRouter.routes.get('main')
      // Alias is stored as an array
      expect(route.alias).toContain('/alternate')
    })
  })

  // ============================================================================
  // Destroy Tests
  // ============================================================================
  describe('Destroy', () => {
    it('clears routes on destroy', () => {
      testRouter = new RouteManager({ mode: 'hash' })
      testRouter.onRoute('/test', { handler: () => {} })
      expect(testRouter.routeTree.length).toBe(1)

      testRouter.destroy()
      expect(testRouter.routeTree.length).toBe(0)
    })

    it('clears guards on destroy', () => {
      testRouter = new RouteManager({ mode: 'hash' })
      testRouter.beforeEach(() => {})
      testRouter.afterEach(() => {})
      expect(testRouter.guards.beforeEach.length).toBe(1)
      expect(testRouter.guards.afterEach.length).toBe(1)

      testRouter.destroy()
      expect(testRouter.guards.beforeEach.length).toBe(0)
      expect(testRouter.guards.afterEach.length).toBe(0)
    })

    it('sets isInitialized to false on destroy', () => {
      testRouter = new RouteManager({ mode: 'hash' })
      testRouter.isInitialized = true
      testRouter.destroy()
      expect(testRouter.isInitialized).toBe(false)
    })
  })
})
