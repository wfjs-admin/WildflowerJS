/**
 * One throwing tick() must not stop the frame loop for everything else.
 *
 * Each tick is isolated: its error goes through the framework's error sink
 * (wildflower.onError handlers, else the console in every build, since it is
 * the author's exception). A tick that throws on one frame keeps ticking; one
 * that throws on 5 consecutive frames is stopped, with a message saying so,
 * and every other tick keeps running. The same rule as the threads
 * extension's worker loop.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework, hasFeature } from './helpers/load-framework.js'

// The shared frame loop that runs tick() lives with pools.
const describeIfPools = hasFeature('pools') ? describe : describe.skip

let wf
let n = 0
const live = []
const handlers = []
const frames = (k) => new Promise((resolve) => {
  let left = k
  const step = () => { if (--left <= 0) resolve(); else requestAnimationFrame(step) }
  requestAnimationFrame(step)
})

describeIfPools('tick errors are isolated', () => {
  beforeAll(async () => { await loadFramework(); wf = window.wildflower })
  afterEach(() => {
    while (live.length) wf.unregister(live.pop())
    while (handlers.length) wf.offError(handlers.pop())
  })

  function capture() {
    const seen = []
    const h = (error) => { seen.push(error && error.message) }
    wf.onError(h)
    handlers.push(h)
    return seen
  }

  it('a throwing tick does not stop the others, and its error reaches onError', async () => {
    const seen = capture()
    let good = 0
    const bad = 'tickBad' + (++n), ok = 'tickOk' + n
    live.push(bad, ok)
    wf.store(bad, { tick() { throw new Error('boom ' + bad) } })
    wf.store(ok, { tick() { good++ } })
    await frames(8)
    expect(good).toBeGreaterThan(3)
    expect(seen.some((m) => m && m.includes('boom ' + bad))).toBe(true)
  })

  it('a tick that throws on 5 consecutive frames is stopped, and says so; the others keep running', async () => {
    const seen = capture()
    let calls = 0, good = 0
    const bad = 'tickBroken' + (++n), ok = 'tickFine' + n
    live.push(bad, ok)
    wf.store(bad, { tick() { calls++; throw new Error('always') } })
    wf.store(ok, { tick() { good++ } })
    await frames(15)
    expect(calls).toBe(5)
    const goodAt = good
    await frames(4)
    expect(good).toBeGreaterThan(goodAt)
    // The first three throws are reported, then one error saying it stopped.
    expect(seen.filter((m) => m === 'always').length).toBe(3)
    expect(seen.filter((m) => m && m.includes('stopped')).length).toBe(1)
  })

  it('a tick that throws once and recovers keeps ticking', async () => {
    capture()
    let calls = 0
    const name = 'tickOnce' + (++n)
    live.push(name)
    wf.store(name, { tick() { calls++; if (calls === 2) throw new Error('once') } })
    await frames(12)
    expect(calls).toBeGreaterThan(6)
  })
})
