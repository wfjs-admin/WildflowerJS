/**
 * The router decides a link is its own by pattern-matching the raw href
 * attribute: no scheme, not '//'. The browser's URL parser disagrees for
 * several spellings: '/\evil.test', '\\evil.test', '\/evil.test', a leading
 * space, tab or newline before 'https://' or '//', a tab inside the path
 * ('/\t/evil.test'), and any relative href under a cross-origin <base>. All
 * of these resolve to another origin, yet the router calls preventDefault()
 * and navigates the app to the path part instead of following the link.
 *
 * The right test is the one the browser uses:
 * new URL(href, document.baseURI).origin === location.origin.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework, hasFeature } from './helpers/load-framework.js'

const wait = (ms = 40) => new Promise(r => setTimeout(r, ms))
const describeIfRouter = hasFeature('router') ? describe : describe.skip

describeIfRouter('Router: link interception follows the browser on origin', () => {
  let startHref, router, calls, lastPrevented
  // Runs after the router's document listener: records what the router did,
  // then stops the real navigation so the test page stays put.
  const after = (e) => { lastPrevented = e.defaultPrevented; e.preventDefault() }

  beforeAll(async () => { await loadFramework(); startHref = location.href })
  afterEach(() => {
    document.removeEventListener('click', after)
    try { router && router.destroy() } catch (e) { /* ignore */ }
    router = null
    document.querySelectorAll('base[data-probe]').forEach(b => b.remove())
    history.replaceState(null, '', startHref)
  })

  async function setup(mode = 'history') {
    router = new RouteManager({ mode, defaultRoute: null })
    router.onRoute('/', { handler: () => {} })
    router.onRoute('/users/:id', { handler: () => {} })
    router.init()
    await wait()
    calls = []
    router.navigate = (to) => { calls.push(to); return Promise.resolve() }
    document.addEventListener('click', after)
  }

  function click(href) {
    const a = document.createElement('a')
    a.setAttribute('href', href)
    document.body.appendChild(a)
    lastPrevented = null
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    a.remove()
    return { intercepted: lastPrevented, navigatedTo: calls.pop() ?? null }
  }

  for (const href of ['/users/1', 'users/1', '?x=1']) {
    it(`control: same-origin ${JSON.stringify(href)} is intercepted`, async () => {
      await setup()
      expect(new URL(href, document.baseURI).origin).toBe(location.origin)
      expect(click(href).intercepted).toBe(true)
    })
  }

  for (const href of ['//evil.test/a', 'https://evil.test/a', 'javascript:void(0)', 'mailto:a@b.test']) {
    it(`control: ${JSON.stringify(href)} is left to the browser`, async () => {
      await setup()
      expect(click(href)).toEqual({ intercepted: false, navigatedTo: null })
    })
  }

  const offOrigin = ['/\\evil.test/a', '\\\\evil.test/a', '\\/evil.test/a', ' https://evil.test/a',
    '\thttps://evil.test/a', '\nhttps://evil.test/a', ' //evil.test/a', '/\t/evil.test/a']
  for (const mode of ['history', 'hash']) {
    for (const href of offOrigin) {
      it(`${mode}: off-origin ${JSON.stringify(href)} is left to the browser`, async () => {
        await setup(mode)
        expect(new URL(href, document.baseURI).origin).not.toBe(location.origin)
        expect(click(href)).toEqual({ intercepted: false, navigatedTo: null })
      })
    }
  }

  it('a relative link under a cross-origin <base> is left to the browser', async () => {
    await setup()
    const base = document.createElement('base')
    base.setAttribute('data-probe', '')
    base.href = 'https://other.test/sub/'
    document.head.prepend(base)
    const abs = click('/users/5')
    const rel = click('users/5')
    base.remove()
    expect(abs).toEqual({ intercepted: false, navigatedTo: null })
    expect(rel).toEqual({ intercepted: false, navigatedTo: null })
  })
})
