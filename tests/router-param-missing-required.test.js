/**
 * A required param that is missing (undefined or null) or empty leaves the
 * builder with nothing sensible to write:
 *   - missing: the pattern text stays, so getRouteUrl('user', {}) returns
 *     '/users/:id', and navigate({ name: 'user' }) matches '/users/:id' and
 *     runs the handler with params.id === ':id';
 *   - null: written as the string 'null' ('/users/null');
 *   - '': '/users/', which matches a different route ('/users').
 * Expected: none of these reach a handler as a param value, and no URL the
 * router builds carries the pattern text.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework, hasFeature } from './helpers/load-framework.js'

const wait = (ms = 40) => new Promise(r => setTimeout(r, ms))
const describeIfRouter = hasFeature('router') ? describe : describe.skip

describeIfRouter('Router: missing or empty required params', () => {
  let router, seen
  beforeAll(async () => { await loadFramework() })
  afterEach(() => {
    try { router && router.destroy() } catch (e) { /* ignore */ }
    router = null
    location.hash = ''
  })

  function make() {
    seen = []
    const r = new RouteManager({ mode: 'hash', defaultRoute: null })
    r.onRoute('/', { name: 'home', handler: () => {} })
    r.onRoute('/users', { name: 'users', handler: () => { seen.push('users') } })
    r.onRoute('/users/:id', { name: 'user', handler: ({ params }) => { seen.push({ ...params }) } })
    r.onRoute('/docs/:section?', { name: 'docs', handler: () => {} })
    r.onRoute('/files/:a-:b', { name: 'pair', handler: () => {} })
    return r
  }

  it('control: a missing optional param drops its segment', () => {
    router = make()
    expect(router.getRouteUrl('docs', {})).toBe('/docs')
  })

  it('control: a numeric 0 is a real value', () => {
    router = make()
    expect(router.getRouteUrl('user', { id: 0 })).toBe('/users/0')
  })

  it('getRouteUrl never returns the pattern text for a missing required param', () => {
    router = make()
    const url = router.getRouteUrl('user', {})
    if (url != null) expect(url).not.toContain(':id')
    const pair = router.getRouteUrl('pair', { a: 'x' })
    if (pair != null) expect(pair).not.toContain(':b')
  })

  it('navigate with a missing required param does not run the handler with ":id"', async () => {
    router = make()
    router.init()
    await wait()
    try { await router.navigate({ name: 'user', params: {} }) } catch (e) { /* a refusal may throw */ }
    await wait()
    expect(seen).not.toContainEqual({ id: ':id' })
  })

  it('getRouteUrl does not write null as the string "null"', () => {
    router = make()
    const url = router.getRouteUrl('user', { id: null })
    if (url != null) expect(url).not.toBe('/users/null')
  })

  it('navigate with an empty required param does not land on a different route', async () => {
    router = make()
    router.init()
    await wait()
    seen.length = 0
    try { await router.navigate({ name: 'user', params: { id: '' } }) } catch (e) { /* a refusal may throw */ }
    await wait()
    expect(seen).not.toContain('users')
  })
})
