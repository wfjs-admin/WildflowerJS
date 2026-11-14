/**
 * Route params are handed to the app exactly as the regex matched them; the
 * router never decodes them. The text it matches against depends on how the
 * navigation arrived, so one URL gives different params:
 *   - initial load or popstate on /users/a%20b: id 'a%20b' (the browser
 *     encodes location.pathname);
 *   - navigate('/users/a b'): id 'a b' (the router matches the raw string);
 *   - hash mode, navigate('/users/a b'): the handler runs twice, first with
 *     'a b', then again with 'a%20b' when hashchange reports the encoded hash.
 * getRouteUrl('user', { id: 'a b' }) writes '/users/a%20b', so the value an
 * app puts in does not come back out.
 *
 * NOTE: decoding is a behavior change for apps that already decode params
 * themselves (they would double-decode). The first two tests are
 * rule-agnostic (one URL, one value); the round-trip test assumes decoding.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework, hasFeature } from './helpers/load-framework.js'

const wait = (ms = 60) => new Promise(r => setTimeout(r, ms))
const describeIfRouter = hasFeature('router') ? describe : describe.skip

describeIfRouter('Router: param values do not depend on the arrival path', () => {
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
    r.onRoute('/', { name: 'home', handler: () => {} })
    r.onRoute('/users/:id', { name: 'user', handler: ({ params }) => { seen.push(params.id) } })
    return r
  }

  it('control: a plain ASCII id is the same on every path', async () => {
    history.replaceState(null, '', '/users/abc')
    router = make('history'); router.init(); await wait()
    const onLoad = router.currentRoute.params.id
    router.destroy()
    history.replaceState(null, '', '/')
    router = make('history'); router.init(); await wait()
    await router.navigate('/users/abc')
    expect(router.currentRoute.params.id).toBe(onLoad)
  })

  it('history: initial load and navigate() give the same id for /users/a b', async () => {
    history.replaceState(null, '', '/users/a b')
    router = make('history'); router.init(); await wait()
    const onLoad = router.currentRoute.params.id
    router.destroy()
    history.replaceState(null, '', '/')
    router = make('history'); router.init(); await wait()
    await router.navigate('/users/a b')
    expect(router.currentRoute.params.id).toBe(onLoad)
  })

  it('hash: navigate() runs the handler once, with one value', async () => {
    router = make('hash'); router.init(); await wait()
    seen.length = 0
    await router.navigate('/users/a b')
    await wait()
    expect(seen.length).toBe(1)
  })

  it('round trip: the id given to getRouteUrl is the id the handler gets', async () => {
    history.replaceState(null, '', '/')
    router = make('history'); router.init(); await wait()
    for (const id of ['a b', 'café', 'a/b', '%41']) {
      await router.navigate(router.getRouteUrl('user', { id }))
      expect(router.currentRoute.params.id).toBe(id)
    }
  })
})
