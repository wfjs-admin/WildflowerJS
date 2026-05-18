/**
 * WildflowerJS RouteManager Gaps Test Suite - Vitest Browser Mode
 *
 * Tests for 14 identified gaps in RouteManager, organized by priority.
 * Uses hash mode to avoid breaking Vitest's iframe test environment.
 * Loads legacy scripts (like route-manager.test.js) since RouteManager is standalone.
 *
 * Each test is designed to fail initially (proving the gap exists),
 * then pass after the corresponding fix is implemented.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, hasFeature } from './helpers/load-framework.js'

// Helper to wait for async operations
async function wait(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

const describeIfRouter = hasFeature('router') ? describe : describe.skip

describeIfRouter('RouteManager Gaps', () => {
  let testRouter
  let testContainer

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

    // Clean hash
    window.location.hash = ''

    // Create test container
    testContainer = document.createElement('div')
    testContainer.id = 'router-gaps-test'
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

  // ==========================================================================
  // CRITICAL: Hash Fragment Support
  // ==========================================================================
  describe('Hash Fragment Support', () => {
    it('navigate should preserve hash in parsed location', async () => {
      testRouter = new RouteManager({ mode: 'hash' })
      let receivedRoute = null
      testRouter.onRoute('/page', {
        name: 'page',
        handler: ({ path, query }) => {
          receivedRoute = testRouter.currentRoute
        }
      })
      testRouter.init()
      await wait(100)

      await testRouter.navigate('/page#section')
      await wait(100)

      // The route object should have a hash property
      expect(receivedRoute).toBeTruthy()
      expect(receivedRoute.hash).toBe('#section')
    })

    it('navigate should strip hash from pathname for route matching', async () => {
      testRouter = new RouteManager({ mode: 'hash' })
      let matched = false
      testRouter.onRoute('/page', {
        handler: () => { matched = true }
      })
      testRouter.init()
      await wait(100)

      await testRouter.navigate('/page#section')
      await wait(100)

      // Route should match /page even when #section is appended
      expect(matched).toBe(true)
    })

    it('route object should include hash property', async () => {
      testRouter = new RouteManager({ mode: 'hash' })
      testRouter.onRoute('/docs', { handler: () => {} })
      testRouter.init()
      await wait(100)

      await testRouter.navigate('/docs#how-external-works')
      await wait(100)

      const route = testRouter.getCurrentRoute()
      expect(route).toBeTruthy()
      expect(route.hash).toBe('#how-external-works')
    })

    it('scrollBehavior should receive hash for fragment scrolling', async () => {
      let scrollArgs = null
      testRouter = new RouteManager({
        mode: 'hash',
        scrollBehavior: (to, from, savedPosition) => {
          scrollArgs = { to, from, savedPosition }
          return null // Don't actually scroll
        }
      })
      testRouter.onRoute('/page', { handler: () => {} })
      testRouter.init()
      await wait(100)

      await testRouter.navigate('/page#target')
      await wait(100)

      expect(scrollArgs).toBeTruthy()
      expect(scrollArgs.to.hash).toBe('#target')
    })
  })

  // ==========================================================================
  // HIGH: beforeLeave Guard
  // ==========================================================================
  describe('beforeLeave Guard', () => {
    it('should support beforeLeave guard on route config', async () => {
      testRouter = new RouteManager({ mode: 'hash' })
      let leaveCalled = false
      testRouter.onRoute('/start', {
        handler: () => {},
        beforeLeave: ({ to, from }) => {
          leaveCalled = true
        }
      })
      testRouter.onRoute('/end', { handler: () => {} })
      testRouter.init()
      await wait(100)

      await testRouter.navigate('/start')
      await wait(100)
      await testRouter.navigate('/end')
      await wait(100)

      expect(leaveCalled).toBe(true)
    })

    it('beforeLeave guard returning false should block navigation', async () => {
      testRouter = new RouteManager({ mode: 'hash' })
      testRouter.onRoute('/stay', {
        handler: () => {},
        beforeLeave: () => false
      })
      testRouter.onRoute('/away', { handler: () => {} })
      testRouter.init()
      await wait(100)

      await testRouter.navigate('/stay')
      await wait(100)
      await testRouter.navigate('/away')
      await wait(100)

      // Should still be on /stay because beforeLeave blocked navigation
      expect(testRouter.getCurrentRoute().path).toBe('/stay')
    })
  })

  // ==========================================================================
  // HIGH: Saved Scroll Position (back/forward)
  // ==========================================================================
  describe('Saved Scroll Position', () => {
    it('navigate should save scroll position in history state', async () => {
      testRouter = new RouteManager({ mode: 'hash' })
      testRouter.onRoute('/page1', { handler: () => {} })
      testRouter.onRoute('/page2', { handler: () => {} })
      testRouter.init()
      await wait(100)

      await testRouter.navigate('/page1')
      await wait(100)

      // Navigate away — history.state should have scroll position
      await testRouter.navigate('/page2')
      await wait(100)

      // Check that history state includes scroll position
      // In hash mode, we can check if the router stores scroll position
      // Since we can't easily inspect the previous state, check that
      // pushState is called with scroll info
      const state = window.history.state
      expect(state).toBeTruthy()
      expect(state.scrollX).toBeDefined()
      expect(state.scrollY).toBeDefined()
    })

    it('history state should include scroll position for scrollBehavior', async () => {
      // In hash mode, verify that after navigation, history.state contains scroll info
      // which would be passed to scrollBehavior as savedPosition on back navigation
      testRouter = new RouteManager({ mode: 'hash' })
      testRouter.onRoute('/first', { handler: () => {} })
      testRouter.onRoute('/second', { handler: () => {} })
      testRouter.init()
      await wait(100)

      await testRouter.navigate('/first')
      await wait(100)

      // After navigating to /second, the state for /first should have been stored
      await testRouter.navigate('/second')
      await wait(100)

      // Verify history.state has scroll info (from the /second navigation's pushState)
      const state = window.history.state
      expect(state).toBeTruthy()
      expect(typeof state.scrollX).toBe('number')
      expect(typeof state.scrollY).toBe('number')
    })
  })

  // ==========================================================================
  // HIGH: Query Parameter Arrays
  // ==========================================================================
  describe('Query Parameter Arrays', () => {
    it('URLParser should parse array params (tags[]=a&tags[]=b)', async () => {
      testRouter = new RouteManager({ mode: 'hash' })
      const parsed = testRouter.urlParser._parseQuery('?tags[]=a&tags[]=b')
      // Should produce an array, not overwrite
      expect(Array.isArray(parsed['tags[]'])).toBe(true)
      expect(parsed['tags[]']).toEqual(['a', 'b'])
    })

    it('URLParser should parse repeated params (tag=a&tag=b)', async () => {
      testRouter = new RouteManager({ mode: 'hash' })
      const parsed = testRouter.urlParser._parseQuery('?tag=a&tag=b')
      // Should produce an array for duplicate keys
      expect(Array.isArray(parsed.tag)).toBe(true)
      expect(parsed.tag).toEqual(['a', 'b'])
    })
  })

  // ==========================================================================
  // MEDIUM: Trailing Slash Normalization
  // ==========================================================================
  describe('Trailing Slash Normalization', () => {
    it('/about/ should match route registered as /about', async () => {
      testRouter = new RouteManager({ mode: 'hash' })
      let matched = false
      testRouter.onRoute('/about', {
        handler: () => { matched = true }
      })
      testRouter.init()
      await wait(100)

      await testRouter.navigate('/about/')
      await wait(100)

      expect(matched).toBe(true)
    })

    it('should strip trailing slash before matching', async () => {
      testRouter = new RouteManager({ mode: 'hash' })
      testRouter.onRoute('/users', { handler: () => {} })
      testRouter.init()
      await wait(100)

      await testRouter.navigate('/users/')
      await wait(100)

      const route = testRouter.getCurrentRoute()
      expect(route).toBeTruthy()
      expect(route.path).toBe('/users')
    })
  })

  // ==========================================================================
  // MEDIUM: 404 Event
  // ==========================================================================
  describe('404 Event (route:notFound)', () => {
    it('should dispatch route:notFound event when no route matches', async () => {
      testRouter = new RouteManager({ mode: 'hash', defaultRoute: null })
      testRouter.onRoute('/home', { handler: () => {} })
      testRouter.init()
      await wait(100)

      let notFoundFired = false
      let notFoundDetail = null
      document.addEventListener('route:notFound', (e) => {
        notFoundFired = true
        notFoundDetail = e.detail
      }, { once: true })

      await testRouter.navigate('/nonexistent')
      await wait(100)

      expect(notFoundFired).toBe(true)
    })

    it('should include attempted path in notFound event detail', async () => {
      testRouter = new RouteManager({ mode: 'hash', defaultRoute: null })
      testRouter.onRoute('/home', { handler: () => {} })
      testRouter.init()
      await wait(100)

      let notFoundDetail = null
      document.addEventListener('route:notFound', (e) => {
        notFoundDetail = e.detail
      }, { once: true })

      await testRouter.navigate('/missing-page')
      await wait(100)

      expect(notFoundDetail).toBeTruthy()
      expect(notFoundDetail.path).toBe('/missing-page')
    })
  })

  // ==========================================================================
  // MEDIUM: Hash in navigate() Options
  // ==========================================================================
  describe('Hash in navigate() Options', () => {
    it('navigate with hash option should append hash to URL', async () => {
      testRouter = new RouteManager({ mode: 'hash' })
      testRouter.onRoute('/page', { handler: () => {} })
      testRouter.init()
      await wait(100)

      await testRouter.navigate('/page', { hash: '#section' })
      await wait(100)

      const route = testRouter.getCurrentRoute()
      expect(route).toBeTruthy()
      expect(route.hash).toBe('#section')
    })

    it('getRouteUrl should support hash option', async () => {
      testRouter = new RouteManager({ mode: 'hash' })
      testRouter.onRoute('/docs', { name: 'docs', handler: () => {} })

      const url = testRouter.getRouteUrl('docs', {}, {}, '#api')
      expect(url).toContain('#api')
    })
  })

  // ==========================================================================
  // MEDIUM: History State Persistence
  // ==========================================================================
  describe('History State Persistence', () => {
    it('navigate should store custom state in history', async () => {
      testRouter = new RouteManager({ mode: 'hash' })
      testRouter.onRoute('/page', { handler: () => {} })
      testRouter.init()
      await wait(100)

      await testRouter.navigate('/page', { state: { customData: 'hello' } })
      await wait(100)

      const state = window.history.state
      expect(state).toBeTruthy()
      expect(state.customData).toBe('hello')
    })
  })

  // ==========================================================================
  // MEDIUM: Redirect Parameter Substitution
  // ==========================================================================
  describe('Redirect Parameter Substitution', () => {
    it('redirect from /old/:id to /new/:id should substitute :id', async () => {
      testRouter = new RouteManager({ mode: 'hash' })
      let receivedParams = null
      testRouter.onRoute('/old/:id', { redirect: '/new/:id' })
      testRouter.onRoute('/new/:id', {
        handler: ({ params }) => { receivedParams = params }
      })
      testRouter.init()
      await wait(100)

      await testRouter.navigate('/old/42')
      await wait(200)

      expect(receivedParams).toBeTruthy()
      expect(receivedParams.id).toBe('42')
    })
  })

  // ==========================================================================
  // LOW: Route Metadata Inheritance
  // ==========================================================================
  describe('Route Metadata Inheritance', () => {
    it('child route should inherit parent meta', async () => {
      testRouter = new RouteManager({ mode: 'hash' })
      let childMeta = null
      testRouter.loadRoutes([{
        path: '/admin',
        meta: { requiresAuth: true, layout: 'admin' },
        children: [{
          path: '/users',
          meta: { title: 'Users' },
          handler: () => {
            childMeta = testRouter.getCurrentRoute().meta
          }
        }]
      }])
      testRouter.init()
      await wait(100)

      await testRouter.navigate('/admin/users')
      await wait(100)

      expect(childMeta).toBeTruthy()
      // Child should inherit parent's requiresAuth
      expect(childMeta.requiresAuth).toBe(true)
      expect(childMeta.layout).toBe('admin')
      // Child's own meta should also be present
      expect(childMeta.title).toBe('Users')
    })
  })

  // ==========================================================================
  // LOW: Navigation Cancellation
  // ==========================================================================
  describe('Navigation Cancellation', () => {
    it('should provide abortNavigation method', () => {
      testRouter = new RouteManager({ mode: 'hash' })
      expect(typeof testRouter.abortNavigation).toBe('function')
    })

    it('abortNavigation should cancel queued navigation', async () => {
      testRouter = new RouteManager({ mode: 'hash' })
      testRouter.onRoute('/home', { handler: () => {} })
      testRouter.onRoute('/target', { handler: () => {} })
      testRouter.init()
      await wait(100)

      await testRouter.navigate('/home')
      await wait(100)

      // Simulate in-progress navigation by setting the flag, then abort
      testRouter.isNavigating = true
      testRouter.abortNavigation()
      expect(testRouter._navigationAborted).toBe(true)

      // Now when matchAndExecute runs, it should detect the abort
      testRouter.isNavigating = false
      const location = testRouter.urlParser.parse({ pathname: '/target', search: '' })
      location.hash = ''
      await testRouter._matchAndExecute(location, false)

      // Should still be on /home because _matchAndExecute was aborted
      expect(testRouter.getCurrentRoute().path).toBe('/home')
    })
  })

  // =========================================================================
  // C5: Guard object redirect support
  // =========================================================================
  describe('Guard object redirect', () => {
    it('beforeEach guard returning { path } triggers redirect', async () => {
      testRouter = new RouteManager({
        mode: 'hash',
        routes: [
          { path: '/home', content: 'Home' },
          { path: '/admin', content: 'Admin' },
          { path: '/login', content: 'Login' }
        ],
        outlet: testContainer
      })

      testRouter.beforeEach(({ to }) => {
        if (to.path === '/admin') {
          return { path: '/login' }
        }
      })

      await testRouter.navigate('/home')
      expect(testRouter.getCurrentRoute().path).toBe('/home')

      await testRouter.navigate('/admin')
      await wait(50)
      // Should have been redirected to /login, not stuck on /admin
      expect(testRouter.getCurrentRoute().path).toBe('/login')
    })

    it('beforeLeave guard returning { path } triggers redirect', async () => {
      testRouter = new RouteManager({
        mode: 'hash',
        routes: [
          {
            path: '/form',
            content: 'Form',
            beforeLeave: ({ to }) => {
              // Only redirect if not already going to /confirm
              if (to.path !== '/confirm') return { path: '/confirm' }
            }
          },
          { path: '/other', content: 'Other' },
          { path: '/confirm', content: 'Confirm' }
        ],
        outlet: testContainer
      })

      await testRouter.navigate('/form')
      expect(testRouter.getCurrentRoute().path).toBe('/form')

      await testRouter.navigate('/other')
      await wait(50)
      // Should have been redirected to /confirm
      expect(testRouter.getCurrentRoute().path).toBe('/confirm')
    })
  })

  // =========================================================================
  // C6: Popstate/hashchange with query-only changes
  // =========================================================================
  describe('Query-only navigation via popstate', () => {
    it('hashchange fires route update when only query changes', async () => {
      let routeChanges = 0

      testRouter = new RouteManager({
        mode: 'hash',
        routes: [
          { path: '/search', content: 'Search' }
        ],
        outlet: testContainer
      })

      testRouter.afterEach(() => { routeChanges++ })

      await testRouter.navigate('/search', { query: { q: 'foo' } })
      expect(testRouter.getCurrentRoute().path).toBe('/search')
      const changesAfterFirst = routeChanges

      // Navigate to same path, different query
      await testRouter.navigate('/search', { query: { q: 'bar' } })
      await wait(50)

      // Should have fired a second route change
      expect(routeChanges).toBeGreaterThan(changesAfterFirst)
      expect(testRouter.getCurrentRoute().query.q).toBe('bar')
    })
  })

  // =========================================================================
  // R1: _handlePopState missing isNavigating guard
  // =========================================================================
  describe('Popstate during active navigation', () => {
    it('popstate is ignored while navigation is in progress', async () => {
      let guardCallCount = 0

      testRouter = new RouteManager({
        mode: 'hash',
        routes: [
          { path: '/a', content: 'A' },
          { path: '/b', content: 'B' },
          { path: '/c', content: 'C' }
        ],
        outlet: testContainer
      })

      // Slow guard to keep isNavigating true
      testRouter.beforeEach(async () => {
        guardCallCount++
        await new Promise(r => setTimeout(r, 100))
      })

      await testRouter.navigate('/a')
      await wait(150)
      const countAfterA = guardCallCount

      // Start a slow navigation to /b (will hold isNavigating = true for 100ms)
      const navPromise = testRouter.navigate('/b')

      // While that's in flight, simulate a popstate by dispatching
      // the real event on window. Calling the private handler directly
      // doesn't work against minified builds where `_handlePopState`
      // gets mangled; the window listener is the public contract.
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }))

      await navPromise
      await wait(50)

      // Guard should have been called only once more (for /b), not twice
      // If the popstate guard is missing, it would fire a second _matchAndExecute
      expect(guardCallCount).toBe(countAfterA + 1)
    })
  })

  // =========================================================================
  // R3: Optional params corrupt URLs
  // =========================================================================
  describe('Optional parameter URL generation', () => {
    it('getRouteUrl with optional param value does not leave trailing ?', async () => {
      testRouter = new RouteManager({
        mode: 'hash',
        routes: [
          { path: '/docs/:section?', name: 'docs', content: 'Docs' }
        ],
        outlet: testContainer
      })

      const url = testRouter.getRouteUrl('docs', { section: 'intro' })
      expect(url).not.toContain('?')
      expect(url).toContain('/docs/intro')
    })

    it('getRouteUrl with absent optional param removes param segment', async () => {
      testRouter = new RouteManager({
        mode: 'hash',
        routes: [
          { path: '/docs/:section?', name: 'docs', content: 'Docs' }
        ],
        outlet: testContainer
      })

      const url = testRouter.getRouteUrl('docs', {})
      expect(url).not.toContain(':section')
      expect(url).not.toContain('?')
      // Should be /docs or /docs/
      expect(url).toMatch(/\/docs\/?$/)
    })
  })

  // ==========================================================================
  // navigate({ replace: true }) must update the address bar via replaceState
  // ==========================================================================
  describe('Replace navigation', () => {
    let originalUrl
    beforeEach(() => { originalUrl = window.location.href })
    afterEach(() => {
      // History-mode navigation here mutates the real window.location;
      // restore it so it doesn't leak into the runner or sibling tests.
      window.history.replaceState(null, '', originalUrl)
    })

    it('replace navigation updates the URL without adding a history entry', async () => {
      testRouter = new RouteManager({ mode: 'history' })
      testRouter.onRoute('/replace-a', { name: 'replace-a', handler: () => {} })
      testRouter.onRoute('/replace-b', { name: 'replace-b', handler: () => {} })
      testRouter.init()
      await wait(50)

      await testRouter.navigate('/replace-a')
      await wait(50)
      expect(window.location.pathname.endsWith('/replace-a')).toBe(true)
      const lenAfterPush = window.history.length

      await testRouter.navigate('/replace-b', { replace: true })
      await wait(50)
      // The address bar reflects the new route...
      expect(window.location.pathname.endsWith('/replace-b')).toBe(true)
      // ...but no history entry was added.
      expect(window.history.length).toBe(lenAfterPush)
    })

    it('replace navigation preserves the query string in the address bar', async () => {
      testRouter = new RouteManager({ mode: 'history' })
      testRouter.onRoute('/replace-q', { name: 'replace-q', handler: () => {} })
      testRouter.init()
      await wait(50)

      await testRouter.navigate('/replace-q?status=todo&sort=priority', { replace: true })
      await wait(50)
      expect(window.location.pathname.endsWith('/replace-q')).toBe(true)
      expect(window.location.search).toContain('status=todo')
      expect(window.location.search).toContain('sort=priority')
    })
  })
})
