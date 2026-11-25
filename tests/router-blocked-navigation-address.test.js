/**
 * A blocked navigation and the address bar.
 *
 * router.navigate() writes the address after the guards pass, so a blocked
 * call never moves it. Back, Forward, and a plain hash link are different:
 * the browser moves the address first and the router hears about it
 * afterwards. When a guard then blocks, the router steps the history back to
 * the entry the view belongs to, so the address, the view, and the history
 * list still agree and a reload lands on the route that is on screen.
 *
 * Each case runs for the four ways to block: beforeLeave, beforeEach and
 * beforeEnter returning false, and preventDefault() on route:beforeChange.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework, hasFeature } from './helpers/load-framework.js'

const wait = (ms = 120) => new Promise(r => setTimeout(r, ms))
const describeIfRouter = hasFeature('router') ? describe : describe.skip
const WAYS = ['beforeLeave', 'beforeEach', 'beforeEnter', 'route:beforeChange']

describeIfRouter('Router: a blocked navigation keeps the address on the current route', () => {
  let startHref, router, host, block, view, onBeforeChange, goCalls, realGo

  beforeAll(async () => { await loadFramework(); startHref = location.href })
  afterEach(() => {
    if (realGo) { history.go = realGo; realGo = null }
    if (onBeforeChange) document.removeEventListener('route:beforeChange', onBeforeChange)
    onBeforeChange = null
    try { router && router.destroy() } catch (e) { /* ignore */ }
    router = null
    if (host) host.remove()
    host = null
    history.replaceState(null, '', startHref)
  })

  const guard = () => (block ? false : undefined)
  const address = (mode) => (mode === 'hash' ? location.hash.slice(1) : location.pathname)
  const where = (mode) => ({ route: router.currentRoute && router.currentRoute.path, address: address(mode), view })

  // Builds a router with the chosen way to block wired in. Nothing is blocked
  // until a case sets `block`.
  function build(mode, way) {
    block = false
    view = ''
    router = new RouteManager({ mode, defaultRoute: null })
    for (const path of ['/', '/a', '/b']) {
      router.onRoute(path, {
        handler: () => { view = path },
        ...(way === 'beforeLeave' && { beforeLeave: guard }),
        ...(way === 'beforeEnter' && { beforeEnter: guard })
      })
    }
    if (way === 'beforeEach') router.beforeEach(guard)
    if (way === 'route:beforeChange') {
      onBeforeChange = (e) => { if (block) e.preventDefault() }
      document.addEventListener('route:beforeChange', onBeforeChange)
    }
  }

  // History list after this: '/', '/a', '/b', with the view on '/b'.
  async function setup(mode, way) {
    history.replaceState(null, '', mode === 'hash' ? '#/' : '/')
    build(mode, way)
    router.init()
    await wait()
    await router.navigate('/a')
    await wait()
    await router.navigate('/b')
    await wait()
    expect(where(mode)).toEqual({ route: '/b', address: '/b', view: '/b' })
  }

  for (const mode of ['history', 'hash']) {
    for (const way of WAYS) {
      describe(`${mode} mode, blocked by ${way}`, () => {
        it('Back: the address returns to the current route and the entry behind it is kept', async () => {
          await setup(mode, way)
          block = true
          history.back()
          await wait()
          expect(where(mode)).toEqual({ route: '/b', address: '/b', view: '/b' })

          block = false
          history.back()
          await wait()
          expect(where(mode)).toEqual({ route: '/a', address: '/a', view: '/a' })
        })

        it('Forward: the address returns to the current route and the entry ahead is kept', async () => {
          await setup(mode, way)
          history.back()
          await wait()
          expect(where(mode)).toEqual({ route: '/a', address: '/a', view: '/a' })

          block = true
          history.forward()
          await wait()
          expect(where(mode)).toEqual({ route: '/a', address: '/a', view: '/a' })

          block = false
          history.forward()
          await wait()
          expect(where(mode)).toEqual({ route: '/b', address: '/b', view: '/b' })
        })

        it('a jump of two entries: the address returns to the current route', async () => {
          await setup(mode, way)
          block = true
          history.go(-2)
          await wait()
          expect(where(mode)).toEqual({ route: '/b', address: '/b', view: '/b' })

          block = false
          history.go(-2)
          await wait()
          expect(where(mode)).toEqual({ route: '/', address: '/', view: '/' })
        })

        it('router.navigate(): the address never moves and the history is not stepped', async () => {
          await setup(mode, way)
          goCalls = []
          realGo = history.go
          history.go = (...args) => { goCalls.push(args) }
          block = true
          await router.navigate('/a')
          await wait()
          expect(where(mode)).toEqual({ route: '/b', address: '/b', view: '/b' })
          expect(goCalls).toEqual([])
        })
      })
    }
  }

  describe('hash mode, a plain link the browser follows itself', () => {
    for (const way of WAYS) {
      it(`blocked by ${way}: the address returns, and the entries on both sides are kept`, async () => {
        await setup('hash', way)
        host = document.createElement('div')
        host.innerHTML = '<a href="#/">home</a>'
        document.body.prepend(host)

        block = true
        host.querySelector('a').click()
        await wait()
        expect(where('hash')).toEqual({ route: '/b', address: '/b', view: '/b' })

        // The link's own entry is still ahead; going to it is blocked the same way.
        history.forward()
        await wait()
        expect(where('hash')).toEqual({ route: '/b', address: '/b', view: '/b' })

        block = false
        history.back()
        await wait()
        expect(where('hash')).toEqual({ route: '/a', address: '/a', view: '/a' })
      })
    }

    it('a link that is allowed: Back afterwards is blocked and returns to the link\'s route', async () => {
      await setup('hash', 'beforeEach')
      host = document.createElement('div')
      host.innerHTML = '<a href="#/">home</a>'
      document.body.prepend(host)
      host.querySelector('a').click()
      await wait()
      expect(where('hash')).toEqual({ route: '/', address: '/', view: '/' })

      block = true
      history.back()
      await wait()
      expect(where('hash')).toEqual({ route: '/', address: '/', view: '/' })

      block = false
      history.back()
      await wait()
      expect(where('hash')).toEqual({ route: '/b', address: '/b', view: '/b' })
    })
  })

  describe('nothing to return to', () => {
    for (const mode of ['history', 'hash']) {
      it(`${mode} mode: a blocked first load does not step the history`, async () => {
        history.replaceState(null, '', mode === 'hash' ? '#/a' : '/a')
        build(mode, 'beforeEach')
        goCalls = []
        realGo = history.go
        history.go = (...args) => { goCalls.push(args) }
        block = true
        router.init()
        await wait()
        expect(address(mode)).toBe('/a')
        expect(router.currentRoute).toBe(null)
        expect(goCalls).toEqual([])
      })
    }
  })

  describe('navigate() with replace', () => {
    for (const mode of ['history', 'hash']) {
      it(`${mode} mode: writes over the current entry and adds none`, async () => {
        await setup(mode, 'beforeEach')
        await router.navigate('/', { replace: true })
        await wait()
        expect(where(mode)).toEqual({ route: '/', address: '/', view: '/' })

        // '/b' is gone from the list: the entry behind is '/a'.
        history.back()
        await wait()
        expect(where(mode)).toEqual({ route: '/a', address: '/a', view: '/a' })
      })

      it(`${mode} mode: a blocked Back from the replaced entry returns to it`, async () => {
        await setup(mode, 'beforeEach')
        await router.navigate('/', { replace: true })
        await wait()
        block = true
        history.back()
        await wait()
        expect(where(mode)).toEqual({ route: '/', address: '/', view: '/' })
      })
    }
  })

  // An address that sends the visitor on (a route's redirect, a guard that
  // returns a path, the default route for an address with no route) is not a
  // place to come back to. When the browser is already on it, the target is
  // written over it, so Back from the target leaves instead of bouncing.
  describe('an address that redirects, reached by the browser', () => {
    const KINDS = ['route redirect', 'guard returning a path', 'default route']
    // '/r' sends the visitor to '/a' by the chosen kind.
    function buildRedirecting(mode, kind) {
      block = false
      view = ''
      router = new RouteManager({ mode, defaultRoute: kind === 'default route' ? '/a' : null })
      for (const path of ['/', '/a', '/b']) router.onRoute(path, { handler: () => { view = path } })
      if (kind === 'route redirect') router.onRoute('/r', { redirect: '/a' })
      if (kind === 'guard returning a path') {
        router.onRoute('/r', { handler: () => { view = '/r' } })
        router.beforeEach(({ to }) => (to.path === '/r' ? '/a' : undefined))
      }
      router.beforeEach(({ to }) => (block && to.path === '/a' ? false : undefined))
    }

    for (const mode of ['history', 'hash']) {
      for (const kind of KINDS) {
        it(`${mode} mode, ${kind}: a first load on it leaves one entry, and Back leaves`, async () => {
          history.replaceState(null, '', mode === 'hash' ? '#/' : '/')
          history.pushState(null, '', mode === 'hash' ? '#/r' : '/r')
          buildRedirecting(mode, kind)
          router.init()
          await wait(200)
          expect(where(mode)).toEqual({ route: '/a', address: '/a', view: '/a' })

          history.back()
          await wait()
          expect(where(mode)).toEqual({ route: '/', address: '/', view: '/' })
        })
      }
    }

    for (const kind of KINDS) {
      it(`hash mode, ${kind}: a plain link to it leaves one entry, and Back returns to where the link was`, async () => {
        history.replaceState(null, '', '#/')
        buildRedirecting('hash', kind)
        router.init()
        await wait()
        await router.navigate('/b')
        await wait()
        host = document.createElement('div')
        host.innerHTML = '<a href="#/r">r</a>'
        document.body.prepend(host)
        host.querySelector('a').click()
        await wait(200)
        expect(where('hash')).toEqual({ route: '/a', address: '/a', view: '/a' })

        history.back()
        await wait()
        expect(where('hash')).toEqual({ route: '/b', address: '/b', view: '/b' })
      })

      it(`hash mode, ${kind}: when its target is blocked, the address returns to the current route`, async () => {
        history.replaceState(null, '', '#/')
        buildRedirecting('hash', kind)
        router.init()
        await wait()
        await router.navigate('/b')
        await wait()
        host = document.createElement('div')
        host.innerHTML = '<a href="#/r">r</a>'
        document.body.prepend(host)
        block = true
        host.querySelector('a').click()
        await wait(200)
        expect(where('hash')).toEqual({ route: '/b', address: '/b', view: '/b' })
      })
    }

    for (const kind of KINDS) {
      it(`hash mode, ${kind}: when its target is the route on screen, the address returns to it`, async () => {
        history.replaceState(null, '', '#/')
        buildRedirecting('hash', kind)
        router.init()
        await wait()
        await router.navigate('/b')
        await wait()
        await router.navigate('/a')
        await wait()
        host = document.createElement('div')
        host.innerHTML = '<a href="#/r">r</a>'
        document.body.prepend(host)
        host.querySelector('a').click()
        await wait(200)
        expect(where('hash')).toEqual({ route: '/a', address: '/a', view: '/a' })

        history.back()
        await wait()
        expect(where('hash')).toEqual({ route: '/b', address: '/b', view: '/b' })
      })
    }

    it('router.navigate() to it still adds one entry, for the target', async () => {
      history.replaceState(null, '', '/')
      buildRedirecting('history', 'route redirect')
      router.init()
      await wait()
      await router.navigate('/b')
      await wait()
      await router.navigate('/r')
      await wait(200)
      expect(where('history')).toEqual({ route: '/a', address: '/a', view: '/a' })

      // '/b' was not written over.
      history.back()
      await wait()
      expect(where('history')).toEqual({ route: '/b', address: '/b', view: '/b' })
    })
  })

  it('state passed to navigate() is still on the history entry', async () => {
    history.replaceState(null, '', '/')
    build('history', 'beforeEach')
    router.init()
    await wait()
    await router.navigate('/a', { state: { from: 'test' } })
    await wait()
    expect(history.state.from).toBe('test')
    expect(history.state.path).toBe('/a')
  })
})
