/**
 * The DevTools hook's getRoutes(): a snapshot of the router RouteManager.create()
 * made, on a tier with a router; null on a tier without one.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework, hasFeature } from './helpers/load-framework.js'

describe('DevTools hook: getRoutes()', () => {
  let router
  beforeAll(async () => { await loadFramework() })
  afterEach(() => {
    try { router && router.destroy() } catch (e) { /* ignore */ }
    router = null
    location.hash = ''
  })

  it('returns the snapshot shape on a router tier, null otherwise', async () => {
    const hook = window.__WF_DEVTOOLS_GLOBAL_HOOK__
    expect(hook && typeof hook.getRoutes).toBe('function')
    if (!hasFeature('router')) {
      expect(hook.getRoutes()).toBe(null)
      return
    }
    router = wildflower.RouteManager.create({
      mode: 'hash',
      defaultRoute: null,
      routes: [
        { path: '/', name: 'home', handler: () => {} },
        { path: '/users/:id', name: 'user', handler: () => {}, meta: { a: 1 }, beforeEnter: () => true }
      ]
    })
    router.beforeEach(() => true)
    await router.navigate('/users/7?tab=x')
    const snap = JSON.parse(JSON.stringify(hook.getRoutes()))
    expect(snap.mode).toBe('hash')
    expect(snap.base).toBe('/')
    expect(snap.defaultRoute).toBe(null)
    expect(snap.guardCount).toEqual({ beforeEach: 1, afterEach: 0 })
    expect(snap.isNavigating).toBe(false)
    expect(snap.current.name).toBe('user')
    expect(snap.current.params).toEqual({ id: '7' })
    expect(snap.current.query).toEqual({ tab: 'x' })
    const user = snap.routes.find(r => r.name === 'user')
    expect(user).toEqual({ path: '/users/:id', name: 'user', meta: { a: 1 }, hasGuard: true, hasChildren: false })
  })
})
