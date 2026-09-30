/**
 * Keys an entity kind consumes must not draw the "ignored key" warning.
 *
 * A component's uses: is read (its services are injected), but it was
 * missing from the component contract list, so development builds warned
 * WF-219 that it was ignored.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(isMinifiedBuild() || !hasFeature('plugins'))('definition contract keys', () => {
  let host, lines, origWarn

  beforeAll(async () => { await loadFramework() })

  beforeEach(() => {
    resetFramework()
    host = document.createElement('div')
    document.body.appendChild(host)
    lines = []
    origWarn = console.warn
    console.warn = (...a) => lines.push(a.map(String).join(' '))
  })

  afterEach(() => {
    console.warn = origWarn
    host.remove()
  })

  // warnCollisions ran before computeds were added, so its computed branch
  // never fired, for any entity kind.
  it('a computed named after a framework property warns, on a component and a store', async () => {
    wildflower.component('dck-collide', { state: {}, computed: { debug() { return 1 } } })
    host.innerHTML = '<div data-component="dck-collide"></div>'
    wildflower.scan(host)
    await settle()
    wildflower.store('dck-collide-store', { state: {}, computed: { find() { return 1 } } })
    expect(lines.some((l) => l.includes('computed property "debug" collides'))).toBe(true)
    expect(lines.some((l) => l.includes('computed property "find" collides'))).toBe(true)
  })

  it('a component\'s uses: draws no WF-219, and the service is injected', async () => {
    wildflower.provide('dck-svc', { hello: () => 'hi' })
    let ctx = null
    wildflower.component('dck-uses', { state: {}, uses: ['dck-svc'], init() { ctx = this } })
    host.innerHTML = '<div data-component="dck-uses"></div>'
    wildflower.scan(host)
    await settle()
    expect(ctx).not.toBe(null)
    expect(lines.filter((l) => l.includes('WF-219') && l.includes('uses')).length).toBe(0)
  })
})
