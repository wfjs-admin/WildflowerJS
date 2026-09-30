/**
 * toRaw() copies the plain data behind a reactive value.
 *
 * It used to walk the reactive proxy itself, so every element and field read
 * went through a get trap: slow on a large array, a false WF-216 (hot-loop
 * facade reads) when repeated, and a dependency registered for every walked
 * path when called inside a computed. It now unwraps each level to its raw
 * target first, so the copy is made with plain reads and tracks nothing.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, waitForCompleteRender } from './helpers/load-framework.js'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const items = (n) => Array.from({ length: n }, (_, i) => ({ id: i, a: i, b: 'x' + i }))

describe('toRaw walks plain data', () => {
  let warnings, originalWarn, host

  beforeAll(async () => { await loadFramework() })

  beforeEach(() => {
    resetFramework()
    warnings = []
    originalWarn = console.warn
    console.warn = (...args) => { warnings.push(args.join(' ')) }
    host = document.createElement('div')
    document.body.appendChild(host)
  })

  afterEach(() => {
    console.warn = originalWarn
    host.remove()
  })

  it('still returns a plain deep copy of reactive state', () => {
    wildflower.store('trpw-copy', { state: { list: items(3) } })
    const s = wildflower.getStore('trpw-copy')
    const out = wildflower.toRaw(s.list)
    expect(out).toEqual(items(3))
    expect(() => structuredClone(out)).not.toThrow()
    out[0].a = 99
    expect(s.list[0].a).toBe(0)
  })

  it.skipIf(isMinifiedBuild())('repeated copies of a large reactive array raise no WF-216', async () => {
    wildflower.store('trpw-big', { state: { list: items(2000) } })
    const s = wildflower.getStore('trpw-big')
    for (let tick = 0; tick < 6; tick++) {
      wildflower.toRaw(s.list)
      await wait(30)
    }
    expect(warnings.filter((w) => w.includes('[WF WF-216]'))).toEqual([])
  })

  it('a computed that copies through toRaw does not track what it copied', async () => {
    let runs = 0
    wildflower.component('trpw-c', {
      state: { list: items(3) },
      computed: { firstA() { runs++; return wildflower.toRaw(this.state.list)[0].a } },
    })
    host.innerHTML = '<div data-component="trpw-c"><span class="v" data-bind="firstA"></span></div>'
    if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection()
    await waitForCompleteRender()
    await wait(30)
    const el = host.querySelector('[data-component="trpw-c"]')
    const inst = wildflower.componentInstances.get(el.dataset.componentId)
    expect(host.querySelector('.v').textContent).toBe('0')
    const before = runs
    inst.context.state.list[0].a = 7
    await wait(50)
    expect(runs).toBe(before)
    expect(host.querySelector('.v').textContent).toBe('0')
  })
})
