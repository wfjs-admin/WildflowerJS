/**
 * One pool's flush throwing must not stop the frame loop.
 *
 * Every component pool is flushed from the one shared frame loop, which also
 * runs every tick(). A flush that threw (an entity computed, or a binding
 * reading one) escaped the loop before it re-armed, so every pool and every
 * tick on the page stopped for good, and the error was uncaught. tick() was
 * already isolated; the flush now follows the same rule: the error goes to
 * the owner's onError (else the console, in every build), the loop keeps
 * running, and a pool whose flush throws on 5 frames in a row stops
 * rendering while everything else carries on.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, waitForCompleteRender } from './helpers/load-framework.js'

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!hasFeature('pools'))('pool flush error isolation', () => {
  let host, errs, origError

  beforeAll(async () => { await loadFramework() })

  beforeEach(() => {
    resetFramework()
    host = document.createElement('div')
    document.body.appendChild(host)
    errs = []
    origError = console.error
    console.error = (...a) => errs.push(a.map(String).join(' '))
  })

  afterEach(() => {
    console.error = origError
    host.remove()
  })

  async function setup(onError) {
    let ticks = 0, bad = null, good = null
    wildflower.component('pf-ticker', { state: {}, tick() { ticks++ } })
    wildflower.component('pf-bad', {
      state: {},
      pools: { bad: { entity: { computed: { label() { if (this.boom) throw new Error('pf-boom'); return 'ok' } } } } },
      init() { bad = this },
      ...(onError ? { onError } : {}),
    })
    wildflower.component('pf-good', { state: {}, pools: { good: {} }, init() { good = this } })
    host.innerHTML =
      '<div data-component="pf-ticker"></div>' +
      '<div data-component="pf-bad"><div data-pool="bad"><template><i data-bind="label"></i></template></div></div>' +
      '<div data-component="pf-good"><div data-pool="good"><template><b class="g" data-bind="n"></b></template></div></div>'
    if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection()
    await waitForCompleteRender()
    await wait(60)
    return { get ticks() { return ticks }, bad, good }
  }

  it('the loop keeps running: other ticks and pools carry on, and the error is reported', async () => {
    const s = await setup()
    s.bad.pools.bad.add({ id: 1, boom: false })
    s.good.pools.good.add({ id: 1, n: 1 })
    await wait(60)
    s.bad.pools.bad.get(1).boom = true
    await wait(100)
    const before = s.ticks
    s.good.pools.good.get(1).n = 2
    await wait(150)
    expect(s.ticks).toBeGreaterThan(before)
    expect(host.querySelector('.g').textContent).toBe('2')
    expect(errs.some((e) => e.includes('pf-boom'))).toBe(true)
  })

  it('the owner\'s onError receives it, and a pool failing on every frame stops after five', async () => {
    const seen = []
    const s = await setup(function (error, info) { seen.push([error.message, info && info.lifecycle]); return true })
    s.bad.pools.bad.add({ id: 1, boom: false })
    await wait(60)
    s.bad.pools.bad.get(1).boom = true
    await wait(300)
    const reported = seen.filter(([m]) => m === 'pf-boom').length
    expect(reported).toBeGreaterThan(0)
    expect(reported).toBeLessThanOrEqual(3)
    expect(seen.some(([m]) => /5 consecutive frames/.test(m))).toBe(true)
    expect(seen.every(([, l]) => l === 'pool-flush')).toBe(true)
  })
})
