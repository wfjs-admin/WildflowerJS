/**
 * A `+` in a query string is a space. An HTML form submitted with GET writes
 * its fields that way (`?q=red+shoes`), and so does URLSearchParams, so the
 * router reads a plus as a space in a query key and in a query value. A
 * literal plus arrives as `%2B`, which is also how the router writes one.
 * A plus in the path is not touched: only the query uses this encoding.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework, hasFeature } from './helpers/load-framework.js'

const wait = (ms = 40) => new Promise(r => setTimeout(r, ms))
const describeIfRouter = hasFeature('router') ? describe : describe.skip

describeIfRouter('Router: a plus in the query string is a space', () => {
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
    r.onRoute('/q', { name: 'q', handler: ({ query }) => { seen.push({ ...query }) } })
    r.onRoute('/tag/:name', { handler: ({ params }) => { seen.push({ ...params }) } })
    return r
  }

  it('on load, in history mode', async () => {
    history.replaceState(null, '', '/q?q=red+shoes')
    router = make('history')
    router.init()
    await wait()
    expect(router.currentRoute.path).toBe('/q')
    expect(router.currentRoute.query.q).toBe('red shoes')
    expect(seen[seen.length - 1].q, 'the handler gets the same value').toBe('red shoes')
  })

  it('on navigate()', async () => {
    history.replaceState(null, '', '/')
    router = make('history')
    router.init()
    await wait()
    await router.navigate('/q?q=red+shoes&size=10+wide')
    expect(router.currentRoute.query.q).toBe('red shoes')
    expect(router.currentRoute.query.size).toBe('10 wide')
  })

  it('on load, in hash mode', async () => {
    location.hash = '#/q?q=red+shoes'
    await wait()
    router = make('hash')
    router.init()
    await wait()
    expect(router.currentRoute.path).toBe('/q')
    expect(router.currentRoute.query.q).toBe('red shoes')
  })

  it('in a key, such as a form field named "first name"', async () => {
    history.replaceState(null, '', '/q?first+name=Ada')
    router = make('history')
    router.init()
    await wait()
    expect(router.currentRoute.query['first name']).toBe('Ada')
  })

  it('in each value of a repeated key', async () => {
    history.replaceState(null, '', '/q?tag=a+b&tag=c+d')
    router = make('history')
    router.init()
    await wait()
    expect(router.currentRoute.query.tag).toEqual(['a b', 'c d'])
  })

  it('a literal plus written as %2B stays a plus', async () => {
    history.replaceState(null, '', '/q?q=1%2B1&lang=c%2B%2B')
    router = make('history')
    router.init()
    await wait()
    expect(router.currentRoute.query.q).toBe('1+1')
    expect(router.currentRoute.query.lang).toBe('c++')
  })

  it('a space and a plus both come back from a URL the router wrote', async () => {
    history.replaceState(null, '', '/')
    router = make('history')
    router.init()
    await wait()
    const url = router.getRouteUrl('q', {}, { q: 'red shoes', expr: '1+1' })
    expect(url).toBe('/q?q=red%20shoes&expr=1%2B1')
    await router.navigate(url)
    expect(router.currentRoute.query.q).toBe('red shoes')
    expect(router.currentRoute.query.expr).toBe('1+1')
  })

  it('a plus in the path stays a plus', async () => {
    history.replaceState(null, '', '/')
    router = make('history')
    router.init()
    await wait()
    await router.navigate('/tag/c++')
    expect(router.currentRoute.params.name).toBe('c++')
  })
})
