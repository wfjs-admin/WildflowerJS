/**
 * WF-505 inside a portal.
 *
 * data-bind-class accepts an inline object literal, {'is-active': cond}; the
 * warning itself recommends that form. Inside a data-portal, class bindings
 * go through the context-record path, which warned on any object, so the
 * recommended form was reported as a computed returning the wrong shape. The
 * classes were applied correctly either way. A computed that returns an
 * object is still reported.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild, waitForCompleteRender } from './helpers/load-framework.js'

describe.skipIf(!hasFeature('portals') || isMinifiedBuild())('WF-505 in portal content', () => {
  let host, warnings, origWarn

  beforeAll(async () => { await loadFramework() })

  beforeEach(() => {
    resetFramework()
    host = document.createElement('div')
    document.body.appendChild(host)
    warnings = []
    origWarn = console.warn
    console.warn = (...a) => { warnings.push(a.map(String).join(' ')) }
  })

  afterEach(() => {
    console.warn = origWarn
    host.remove()
    document.querySelectorAll('[data-test-portal]').forEach((el) => el.remove())
  })

  async function mount(name, def, inner) {
    let ctx = null
    window.wildflower.component(name, { ...def, init() { ctx = this } })
    host.innerHTML = `<div data-component="${name}"><div data-show="open" data-portal="body" data-test-portal>${inner}</div></div>`
    if (window.wildflower._setupDynamicComponentDetection) window.wildflower._setupDynamicComponentDetection()
    await waitForCompleteRender()
    await new Promise((r) => setTimeout(r, 30))
    return ctx
  }

  const wf505 = () => warnings.filter((w) => w.includes('WF-505'))

  it('an inline object literal applies its classes and says nothing', async () => {
    const ctx = await mount('pc-inline', { state: { open: false, pick: 'a' } },
      '<div id="pc-opt" class="opt" data-bind-class="{ selected: pick === \'a\' }"></div>')
    ctx.open = true
    await waitForCompleteRender()
    await new Promise((r) => setTimeout(r, 30))
    const el = document.getElementById('pc-opt')
    expect(el.classList.contains('selected')).toBe(true)
    expect(el.classList.contains('opt')).toBe(true)
    expect(wf505()).toEqual([])
  })

  it('a computed that returns an object is still reported', async () => {
    const ctx = await mount('pc-computed', {
      state: { open: false },
      computed: { optClass() { return { selected: true } } },
    }, '<div id="pc-opt2" data-bind-class="optClass"></div>')
    ctx.open = true
    await waitForCompleteRender()
    await new Promise((r) => setTimeout(r, 30))
    expect(document.getElementById('pc-opt2').classList.contains('selected')).toBe(true)
    expect(wf505().length).toBeGreaterThan(0)
  })
})
