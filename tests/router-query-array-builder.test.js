/**
 * The router has two query builders. URLParser.buildUrl (used by navigate)
 * repeats the key for an array value ('tag=a&tag=b'), and _parseQuery reads
 * that back as an array. getRouteUrl stringifies the array instead
 * ('tag=a%2Cb'), which reads back as the single string 'a,b'.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework, hasFeature } from './helpers/load-framework.js'

const describeIfRouter = hasFeature('router') ? describe : describe.skip

describeIfRouter('Router: getRouteUrl writes array query values like navigate does', () => {
  let router
  beforeAll(async () => { await loadFramework() })
  afterEach(() => { try { router && router.destroy() } catch (e) { /* ignore */ } router = null })

  function make() {
    const r = new RouteManager({ mode: 'history', defaultRoute: null })
    r.onRoute('/list', { name: 'list', handler: () => {} })
    return r
  }

  it('control: navigate builds repeated keys for an array', () => {
    router = make()
    expect(router.urlParser.buildUrl({ pathname: '/list', query: { tag: ['a', 'b'] } })).toBe('/list?tag=a&tag=b')
  })

  it('control: special characters in keys and values are escaped', () => {
    router = make()
    expect(router.getRouteUrl('list', {}, { 'a&b': 'c=d#e' })).toBe('/list?a%26b=c%3Dd%23e')
  })

  it('getRouteUrl builds repeated keys for an array', () => {
    router = make()
    expect(router.getRouteUrl('list', {}, { tag: ['a', 'b'] })).toBe('/list?tag=a&tag=b')
  })
})
