/**
 * Regression: does `navigate(path, { query: { … } })` put `undefined` and
 * `null` values into the URL as literal strings?
 *
 * Reported from ecommerce-wf (2026-09-15). That demo syncs its filters to the
 * URL with the conventional "omit when empty" idiom:
 *
 *     query: { category: …, search: this.searchQuery || undefined }
 *
 * With no search term that passes `undefined`, and the URL came back as
 * `?category=apparel&search=undefined`. Reloading the URL the demo had just
 * produced then showed "No products found", because the filter read the string
 * "undefined" and matched nothing.
 *
 * Cause: both query serialisers map every entry through
 * `encodeURIComponent(value)` with no filter for undefined/null
 * (RouteManager.js, the buildPath site and the URL-building site). Every other
 * router omits such keys, and the "|| undefined" idiom depends on it.
 *
 * A key whose value is the empty string is NOT the same case and must survive:
 * `?q=` is a meaningful URL that says "this filter exists and is blank".
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, hasFeature } from './helpers/load-framework.js'

async function wait(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

const describeIfRouter = hasFeature('router') ? describe : describe.skip

describeIfRouter('Router query serialisation: undefined and null', () => {
  let testRouter
  let testContainer

  beforeAll(async () => {
    await loadFramework()
    if (typeof RouteManager === 'undefined') {
      throw new Error('RouteManager class not found after loading framework')
    }
  })

  beforeEach(() => {
    if (testRouter && typeof testRouter.destroy === 'function') testRouter.destroy()
    testRouter = null
    testContainer = document.createElement('div')
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testRouter && typeof testRouter.destroy === 'function') testRouter.destroy()
    testRouter = null
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  function makeRouter() {
    return new RouteManager({
      mode: 'hash',
      routes: [{ path: '/search', content: 'Search' }],
      outlet: testContainer
    })
  }

  it('drops a key whose value is undefined', async () => {
    testRouter = makeRouter()
    await testRouter.navigate('/search', { query: { category: 'apparel', search: undefined } })
    await wait()

    expect(window.location.hash).not.toContain('search=undefined')
    expect(window.location.hash).toContain('category=apparel')
    expect(testRouter.getCurrentRoute().query.search).toBeUndefined()
  })

  it('drops a key whose value is null', async () => {
    testRouter = makeRouter()
    await testRouter.navigate('/search', { query: { category: 'apparel', search: null } })
    await wait()

    expect(window.location.hash).not.toContain('search=null')
    expect(window.location.hash).toContain('category=apparel')
  })

  it('keeps a key whose value is the empty string', async () => {
    // `?q=` is a real, different statement from "no q at all", so the fix must
    // not widen into a general falsy filter.
    testRouter = makeRouter()
    await testRouter.navigate('/search', { query: { q: '' } })
    await wait()

    expect(window.location.hash).toContain('q=')
  })

  it('keeps values that are falsy but meaningful: 0 and false', async () => {
    testRouter = makeRouter()
    await testRouter.navigate('/search', { query: { page: 0, exact: false } })
    await wait()

    expect(window.location.hash).toContain('page=0')
    expect(window.location.hash).toContain('exact=false')
  })

  it('omits the "?" entirely when every value is undefined', async () => {
    testRouter = makeRouter()
    await testRouter.navigate('/search', { query: { a: undefined, b: undefined } })
    await wait()

    expect(window.location.hash).not.toContain('?')
  })

  it('the demo\'s own idiom leaves a URL that parses back clean', async () => {
    // Exactly ecommerce-wf's shape: one filter set, one empty. The assertion is
    // on the URL and on a fresh parse of it, not on getCurrentRoute().query —
    // that returns the object passed to navigate(), which still holds a real
    // undefined and so looked correct even while the URL was wrong.
    testRouter = makeRouter()
    const searchQuery = ''
    await testRouter.navigate('/search', {
      query: {
        category: 'apparel',
        search: searchQuery || undefined
      }
    })
    await wait()

    const hash = window.location.hash
    expect(hash).toContain('category=apparel')

    const parsed = new URLSearchParams(hash.slice(hash.indexOf('?') + 1))
    expect(parsed.get('category')).toBe('apparel')
    // The whole point: a later page load must not read the string "undefined"
    // as a search term, which is what filtered every product out of the demo.
    expect(parsed.get('search')).toBeNull()
  })
})
