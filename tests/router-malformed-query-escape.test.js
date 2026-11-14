/**
 * A malformed percent escape in the query string (`?q=%`, `?q=100%`,
 * `?q=%E0%A4%A`) reaches decodeURIComponent in URLParser._parseQuery, which
 * throws URIError. On page load that throw leaves init() before the first
 * route runs, so one crafted or mistyped link leaves the whole app unrouted.
 * The same throw rejects navigate() and escapes the popstate listener.
 *
 * Expected: the router keeps the undecodable text as it was and routes.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework, hasFeature } from './helpers/load-framework.js'

const wait = (ms = 40) => new Promise(r => setTimeout(r, ms))
const describeIfRouter = hasFeature('router') ? describe : describe.skip

describeIfRouter('Router: malformed percent escapes in the query', () => {
  let startHref, router, seen
  beforeAll(async () => { await loadFramework(); startHref = location.href })
  afterEach(() => {
    try { router && router.destroy() } catch (e) { /* ignore */ }
    router = null
    history.replaceState(null, '', startHref)
  })

  function make(mode) {
    seen = []
    const r = new RouteManager({ mode, defaultRoute: null })
    r.onRoute('/', { handler: () => { seen.push('home') } })
    r.onRoute('/q', { handler: ({ query }) => { seen.push({ ...query }) } })
    return r
  }

  it('control: a well-formed escape decodes on init', async () => {
    history.replaceState(null, '', '/q?q=%25')
    router = make('history')
    router.init()
    await wait()
    expect(router.currentRoute.path).toBe('/q')
    expect(router.currentRoute.query.q).toBe('%')
  })

  for (const search of ['?q=%', '?q=100%', '?q=%E0%A4%A', '?%=1']) {
    it(`init routes the page when the address bar holds ${search} (history)`, async () => {
      history.replaceState(null, '', '/q' + search)
      router = make('history')
      expect(() => router.init()).not.toThrow()
      await wait()
      expect(router.isInitialized).toBe(true)
      expect(router.currentRoute && router.currentRoute.path).toBe('/q')
    })
  }

  it('init routes the page when the hash holds a malformed escape (hash)', async () => {
    location.hash = '#/q?x=%E0%A4%A'
    await wait()
    router = make('hash')
    expect(() => router.init()).not.toThrow()
    await wait()
    expect(router.currentRoute && router.currentRoute.path).toBe('/q')
  })

  it('navigate() to a path with a malformed escape resolves and routes', async () => {
    history.replaceState(null, '', '/')
    router = make('history')
    router.init()
    await wait()
    await expect(router.navigate('/q?x=%')).resolves.toBeUndefined()
    expect(router.currentRoute.path).toBe('/q')
  })

  it('control: navigate() with a well-formed query still decodes it', async () => {
    history.replaceState(null, '', '/')
    router = make('history')
    router.init()
    await wait()
    await router.navigate('/q?x=a%26b')
    expect(router.currentRoute.query.x).toBe('a&b')
  })
})
