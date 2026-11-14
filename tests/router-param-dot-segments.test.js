/**
 * getRouteUrl() and navigate({ name, params }) put encodeURIComponent(value)
 * into the path. encodeURIComponent leaves dots alone, so a param of '.' or
 * '..' builds '/users/.' or '/users/..', which the browser's URL parser
 * rewrites to '/users/' or '/'. The router then believes it is on the user
 * route with id '..' while the address bar says '/', and a reload lands on a
 * different route. '%2e' does not help: the URL parser treats '%2e' and
 * '%2e%2e' as dot segments too.
 *
 * These tests do not pick the fix. They ask only that the URL the router
 * builds means what it says: it survives the browser's URL parser unchanged,
 * and after a history-mode navigate the router's path matches the address bar.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework, hasFeature } from './helpers/load-framework.js'

const wait = (ms = 40) => new Promise(r => setTimeout(r, ms))
const describeIfRouter = hasFeature('router') ? describe : describe.skip

// Path as the browser would read it, or null when the router built nothing.
const asBrowserReadsIt = (url) => (url == null ? null : new URL(url, 'http://h.test').pathname)
const pathOnly = (url) => url.split('?')[0].split('#')[0]

describeIfRouter('Router: dot segments in route params', () => {
  let startHref, router
  beforeAll(async () => { await loadFramework(); startHref = location.href })
  afterEach(() => {
    try { router && router.destroy() } catch (e) { /* ignore */ }
    router = null
    history.replaceState(null, '', startHref)
  })

  function make(mode) {
    const r = new RouteManager({ mode, defaultRoute: null })
    r.onRoute('/', { name: 'home', handler: () => {} })
    r.onRoute('/users', { name: 'users', handler: () => {} })
    r.onRoute('/users/:id', { name: 'user', handler: () => {} })
    r.onRoute('/docs/:section?', { name: 'docs', handler: () => {} })
    return r
  }

  for (const id of ['abc', 'a.b', '...', '.x', 'x.', 'a b', 'a/b']) {
    it(`control: getRouteUrl with id ${JSON.stringify(id)} survives the URL parser`, () => {
      router = make('hash')
      const url = router.getRouteUrl('user', { id })
      expect(asBrowserReadsIt(url)).toBe(pathOnly(url))
    })
  }

  for (const id of ['.', '..']) {
    it(`getRouteUrl with id ${JSON.stringify(id)} does not build a path the browser rewrites`, () => {
      router = make('hash')
      const url = router.getRouteUrl('user', { id })
      if (url != null) expect(asBrowserReadsIt(url)).toBe(pathOnly(url))
    })

    it(`getRouteUrl with an optional section ${JSON.stringify(id)} does not build a path the browser rewrites`, () => {
      router = make('hash')
      const url = router.getRouteUrl('docs', { section: id })
      if (url != null) expect(asBrowserReadsIt(url)).toBe(pathOnly(url))
    })

    it(`history navigate with id ${JSON.stringify(id)} leaves the router and the address bar agreeing`, async () => {
      history.replaceState(null, '', '/')
      router = make('history')
      router.init()
      await wait()
      try { await router.navigate({ name: 'user', params: { id } }) } catch (e) { /* a refusal may throw */ }
      await wait()
      expect(router.currentRoute.path).toBe(location.pathname)
    })
  }

  it('control: history navigate with an ordinary id agrees with the address bar', async () => {
    history.replaceState(null, '', '/')
    router = make('history')
    router.init()
    await wait()
    await router.navigate({ name: 'user', params: { id: '42' } })
    await wait()
    expect(router.currentRoute.path).toBe(location.pathname)
    expect(router.currentRoute.params.id).toBe('42')
  })
})
