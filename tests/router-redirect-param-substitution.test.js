/**
 * A route's redirect string has its ':name' placeholders filled with
 * String.replace(`:${key}`, value), first match only, in the order the
 * params were matched. When one param name is a prefix of another (':it'
 * and ':item') and the redirect names the longer one first, ':it' is
 * replaced inside ':item': '/old/A/B' with redirect '/new/:item/:it'
 * arrives at '/new/Aem/:it'.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework, hasFeature } from './helpers/load-framework.js'

const wait = (ms = 40) => new Promise(r => setTimeout(r, ms))
const describeIfRouter = hasFeature('router') ? describe : describe.skip

describeIfRouter('Router: redirect placeholders', () => {
  let router
  beforeAll(async () => { await loadFramework() })
  afterEach(() => {
    try { router && router.destroy() } catch (e) { /* ignore */ }
    router = null
    location.hash = ''
  })

  function make(from, to) {
    const r = new RouteManager({ mode: 'hash', defaultRoute: null })
    r.onRoute('/', { handler: () => {} })
    r.onRoute(from, { redirect: to })
    r.onRoute('/new/:a/:b', { handler: () => {} })
    r.init()
    return r
  }

  it('control: distinct names substitute in any order', async () => {
    router = make('/old/:x/:y', '/new/:y/:x')
    await wait()
    await router.navigate('/old/A/B')
    await wait()
    expect(router.currentRoute.path).toBe('/new/B/A')
  })

  it('a name that is a prefix of another does not replace inside it', async () => {
    router = make('/old/:it/:item', '/new/:item/:it')
    await wait()
    await router.navigate('/old/A/B')
    await wait()
    expect(router.currentRoute.path).toBe('/new/B/A')
  })
})
