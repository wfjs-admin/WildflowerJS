/**
 * wildflower.flushPools(): flush every drawn pool now, synchronously, without
 * waiting for the frame loop and without running tick(). Code that moves time
 * itself (a video renderer seeking frame by frame, where no animation frame
 * comes) changes entities and then calls it to get them into the DOM.
 * Pool tiers only; on nano and mini the method is absent.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, waitForCompleteRender } from './helpers/load-framework.js'

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(hasFeature('pools'))('flushPools on a tier without pools', () => {
  beforeAll(async () => { await loadFramework() })
  it('is absent', () => {
    expect(wildflower.flushPools).toBeUndefined()
  })
})

describe.skipIf(!hasFeature('pools'))('wildflower.flushPools()', () => {
  let host, origError

  beforeAll(async () => { await loadFramework() })

  beforeEach(() => {
    resetFramework()
    host = document.createElement('div')
    document.body.appendChild(host)
    origError = console.error
  })

  afterEach(() => {
    console.error = origError
    host.remove()
  })

  async function mount(name, poolAttrs, def = {}) {
    let inst = null
    wildflower.component(name, { state: {}, pools: { items: def.pool || {} }, init() { inst = this }, ...(def.extra || {}) })
    host.innerHTML =
      '<div data-component="' + name + '"><div data-pool="items"' + poolAttrs + '><template><b class="n" data-bind="n"></b></template></div></div>'
    if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection()
    await waitForCompleteRender()
    await wait(60)
    return inst
  }

  const text = () => host.querySelector('.n').textContent

  it('an animation pool: a changed entity reaches the DOM with no frame', async () => {
    const c = await mount('fp-anim', '')
    c.pools.items.add({ id: 1, n: 1 })
    await wait(60)
    expect(text()).toBe('1')
    c.pools.items.get(1).n = 2
    expect(text()).toBe('1')
    expect(wildflower.flushPools()).toBeUndefined()
    expect(text()).toBe('2')
  })

  it('a targeted pool: update() then flushPools() applies the dirty entity', async () => {
    const c = await mount('fp-target', '')
    c.pools.items.add({ id: 1, n: 1 })
    c.pools.items.add({ id: 2, n: 1 })
    c.pools.items.markDirty(2)
    await wait(60)
    c.pools.items.update(1, { n: 5 })
    expect(text()).toBe('1')
    wildflower.flushPools()
    expect(text()).toBe('5')
  })

  it('a throttled pool (data-pool-fps) flushes despite the throttle', async () => {
    const c = await mount('fp-fps', ' data-pool-fps="1"')
    c.pools.items.add({ id: 1, n: 1 })
    await wait(60)
    wildflower.flushPools()
    expect(text()).toBe('1')
    c.pools.items.get(1).n = 3
    expect(text()).toBe('1')
    wildflower.flushPools()
    expect(text()).toBe('3')
  })

  it('a passive pool (data-pool-static) is left alone', async () => {
    const c = await mount('fp-static', ' data-pool-static')
    c.pools.items.add({ id: 1, n: 1 })
    await wait(30)
    expect(text()).toBe('1')
    c.pools.items.get(1).n = 4
    wildflower.flushPools()
    expect(text()).toBe('1')
  })

  it('does not run tick()', async () => {
    let ticks = 0
    const c = await mount('fp-tick', '', { extra: { tick() { ticks++ } } })
    c.pools.items.add({ id: 1, n: 1 })
    await wait(60)
    const before = ticks
    wildflower.flushPools()
    expect(ticks).toBe(before)
  })

  it('a throwing binding goes to onError, and is counted toward stopping the pool', async () => {
    const seen = []
    const c = await mount('fp-throw', '', {
      pool: { entity: { computed: { n() { if (this.boom) throw new Error('fp-boom'); return this.v } } } },
      extra: { onError(error, info) { seen.push([error.message, info && info.lifecycle]); return true } },
    })
    c.pools.items.add({ id: 1, v: 1, boom: false })
    await wait(60)
    c.pools.items.get(1).boom = true
    for (let i = 0; i < 5; i++) wildflower.flushPools()
    expect(seen.some(([m]) => m === 'fp-boom')).toBe(true)
    expect(seen.some(([m]) => /5 consecutive frames/.test(m))).toBe(true)
    expect(seen.every(([, l]) => l === 'pool-flush')).toBe(true)
  })

  it('with no pools on the page, returns undefined and does nothing', () => {
    expect(wildflower.flushPools()).toBeUndefined()
  })
})
