/**
 * A click on an in-app link that something has already cancelled.
 *
 * The router takes over a click on a same-origin link from a listener on the
 * document. A handler that ran first and called preventDefault() has said the
 * link is not to be followed: a confirm step, a menu that only closes, a
 * data-action with data-event-prevent. The router leaves such a click alone.
 *
 * Only the main button matters here. A middle click arrives as `auxclick`
 * and a right click as `contextmenu` and `auxclick`; neither sends `click`,
 * so the router's listener does not run for them. The last case holds that
 * with a real middle click.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { userEvent } from 'vitest/browser'
import { loadFramework, hasFeature } from './helpers/load-framework.js'

const wait = (ms = 60) => new Promise(r => setTimeout(r, ms))
const describeIfRouter = hasFeature('router') ? describe : describe.skip

describeIfRouter('Router: a link click that was already cancelled', () => {
  let startHref, router, host, seen
  // After the router's listener: records each event that reached the
  // document, and keeps a middle click from opening a tab.
  const record = (e) => { seen.push(e.type + ':' + e.button); if (e.type !== 'click') e.preventDefault() }

  beforeAll(async () => { await loadFramework(); startHref = location.href })
  afterEach(() => {
    for (const t of ['click', 'auxclick']) document.removeEventListener(t, record)
    try { router && router.destroy() } catch (e) { /* ignore */ }
    router = null
    if (host) host.remove()
    host = null
    history.replaceState(null, '', startHref)
  })

  async function setup(html) {
    history.replaceState(null, '', '/')
    router = new RouteManager({ mode: 'history', defaultRoute: null })
    router.onRoute('/', { handler: () => {} })
    router.onRoute('/q', { handler: () => {} })
    router.init()
    await wait()
    seen = []
    for (const t of ['click', 'auxclick']) document.addEventListener(t, record)
    host = document.createElement('div')
    host.innerHTML = html
    document.body.prepend(host)
    return host.querySelector('a')
  }
  const LINK = '<a href="/q" style="display:inline-block;padding:20px">to q</a>'
  const where = () => ({ route: router.currentRoute.path, address: location.pathname })

  it('control: a click nothing cancelled goes to the route', async () => {
    const link = await setup(LINK)
    link.click()
    await wait()
    expect(where()).toEqual({ route: '/q', address: '/q' })
  })

  it('a listener on the link cancelled it: the router stays where it is', async () => {
    const link = await setup(LINK)
    link.addEventListener('click', (e) => e.preventDefault())
    link.click()
    await wait()
    expect(where()).toEqual({ route: '/', address: '/' })
  })

  it('a listener on an element around the link cancelled it', async () => {
    const link = await setup(`<nav>${LINK}</nav>`)
    host.querySelector('nav').addEventListener('click', (e) => e.preventDefault())
    link.click()
    await wait()
    expect(where()).toEqual({ route: '/', address: '/' })
  })

  it('a listener on the link cancelled a real click of the main button', async () => {
    const link = await setup(LINK)
    link.addEventListener('click', (e) => e.preventDefault())
    await userEvent.click(link)
    await wait()
    expect(seen).toEqual(['click:0'])
    expect(where()).toEqual({ route: '/', address: '/' })
  })

  it('data-event-prevent on a link with a data-action: the action runs and the router stays', async () => {
    const wf = window.wildflower
    const log = []
    const name = 'router-prevented-link'
    wf.component(name, { state: {}, ask(e) { log.push('ask') } })
    const link = await setup(`<div data-component="${name}"><a href="/q" data-action="ask" data-event-prevent>ask first</a></div>`)
    if (wf._setupDynamicComponentDetection) wf._setupDynamicComponentDetection()
    wf.scan(host)
    await wait(120)
    link.click()
    await wait()
    expect(log).toEqual(['ask'])
    expect(where()).toEqual({ route: '/', address: '/' })
  })

  it('a real middle click sends auxclick and no click, so the router does not see it', async () => {
    const link = await setup(LINK)
    await userEvent.click(link, { button: 'middle' })
    await wait()
    expect(seen).toEqual(['auxclick:1'])
    expect(where()).toEqual({ route: '/', address: '/' })
  })
})
