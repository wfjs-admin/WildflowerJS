/**
 * What the router's diagnostics print, per build. A development build names
 * the route and suggests one ("Did you mean"); a production build prints the
 * code, the doc link and, where there is one, the author's own error, and no
 * route names or suggestion text.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { loadFramework, hasFeature, hasConsoleWarnings } from './helpers/load-framework.js'

const describeIfRouter = hasFeature('router') ? describe : describe.skip
const wait = (ms = 40) => new Promise(r => setTimeout(r, ms))

function capture() {
  const lines = []
  const rec = (...args) => { lines.push(args.map(a => a instanceof Error ? 'Error:' + a.message : String(a)).join(' ')) }
  const spies = [vi.spyOn(console, 'error').mockImplementation(rec), vi.spyOn(console, 'warn').mockImplementation(rec)]
  return { lines, restore: () => spies.forEach(s => s.mockRestore()) }
}

describeIfRouter('Router: diagnostic lines per build', () => {
  let router, cap
  const dev = hasConsoleWarnings()
  beforeAll(async () => { await loadFramework() })
  afterEach(() => {
    if (cap) cap.restore()
    cap = null
    try { router && router.destroy() } catch (e) { /* ignore */ }
    router = null
    location.hash = ''
  })

  function make() {
    const r = new RouteManager({ mode: 'hash', defaultRoute: null })
    r.onRoute('/', { name: 'home', handler: () => {} })
    r.onRoute('/users/:id', { name: 'userDetail', handler: () => {} })
    return r
  }

  it('an unknown route name: WF-705, with a suggestion in development only', async () => {
    router = make()
    router.init()
    await wait()
    cap = capture()
    try { await router.navigate({ name: 'userDetails', params: { id: 1 } }) } catch (e) { /* ignore */ }
    const text = cap.lines.join('\n')
    expect(text).toContain('WF-705')
    if (dev) expect(text).toContain('Did you mean: userDetail')
    else expect(text).not.toContain('userDetail')
  })

  it('getRouteUrl with an unknown name: WF-705 and "/"', () => {
    router = make()
    cap = capture()
    expect(router.getRouteUrl('nope')).toBe('/')
    const text = cap.lines.join('\n')
    expect(text).toContain('WF-705')
    if (!dev) expect(text).not.toContain('nope')
  })

  it('a refused param: WF-713 as a warning, the param named in development only', () => {
    router = make()
    cap = capture()
    expect(router.getRouteUrl('userDetail', { id: '..' })).toBe(null)
    const text = cap.lines.join('\n')
    expect(text).toContain('WF-713')
    if (dev) expect(text).toContain('param "id" is ".."')
    else expect(text).not.toContain('param "id"')
  })

  it('a throwing afterEach hook: WF-712 and the author\'s error in every build', async () => {
    router = make()
    router.afterEach(() => { throw new Error('hook boom') })
    router.init()
    await wait()
    cap = capture()
    await router.navigate('/users/7')
    await wait()
    const text = cap.lines.join('\n')
    expect(text).toContain('WF-712')
    expect(text).toContain('hook boom')
    if (!dev) expect(text).not.toContain('afterEach hook')
  })

  // The router's plain warnings. One prints in every build: no route matched
  // the address, which a visitor's link can cause. The others report a
  // mistake in the route table or in the calling code, and print in a
  // development build only.
  it('no route matched: a warning in every build', async () => {
    router = make()
    router.init()
    await wait()
    cap = capture()
    await router.navigate('/nowhere/at/all')
    await wait()
    expect(cap.lines.join('\n')).toContain('No route matched')
  })

  it('a second route of one name, and a second init(): warnings in development only', async () => {
    router = make()
    cap = capture()
    router.onRoute('/again', { name: 'home', handler: () => {} })
    router.init()
    await wait()
    router.init()
    await wait()
    const text = cap.lines.join('\n')
    expect(text.includes('Route name "home" is already registered')).toBe(dev)
    expect(text.includes('Router already initialized')).toBe(dev)
  })
})
