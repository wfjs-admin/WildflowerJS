/**
 * A plugin registered again under the same name replaces the old one.
 *
 * The old instance was torn down only when the new definition also took the
 * reactive path. Replaced by a lightweight (methods-only) plugin, the old
 * instance stayed registered: still ticking, its store: watchers still
 * firing. listPlugins() also listed the name once per registration.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework, hasFeature } from './helpers/load-framework.js'

const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms))
let n = 0
const uniq = (base) => base + (++n)
const stores = []

describe.skipIf(!hasFeature('plugins'))('plugin replacement', () => {
  beforeAll(async () => { await loadFramework() })
  afterEach(() => { while (stores.length) wildflower.unregister(stores.pop()) })

  it('a lightweight replacement stops the old store: watcher', () => {
    const store = uniq('prCart'), name = uniq('prWatch'); stores.push(store)
    wildflower.store(store, { state: { items: 0 } })
    const calls = []
    wildflower.plugin({ name, state: { a: 1 }, watch: { [`store:${store}.items`](v) { calls.push(v) } } })
    wildflower.plugin({ name, ping() { return 'pong' } })
    wildflower.getStore(store).items = 1
    expect(calls).toEqual([])
    expect(wildflower['$' + name].ping()).toBe('pong')
  })

  it.skipIf(!hasFeature('pools'))('a lightweight replacement stops the old tick', async () => {
    const name = uniq('prTick')
    let ticks = 0
    wildflower.plugin({ name, state: {}, tick() { ticks++ } })
    await wait()
    expect(ticks).toBeGreaterThan(0)
    wildflower.plugin({ name, ping() { return 'pong' } })
    const at = ticks
    await wait(100)
    expect(ticks).toBe(at)
  })

  it('listPlugins() lists a replaced plugin once, with the new version', () => {
    const name = uniq('prList')
    wildflower.plugin({ name, version: '1.0.0', state: { a: 1 } })
    wildflower.plugin({ name, version: '2.0.0', ping() {} })
    wildflower.plugin({ name, version: '3.0.0', state: { b: 1 } })
    const listed = wildflower.listPlugins().filter((p) => p.name === name)
    expect(listed).toEqual([{ name, version: '3.0.0' }])
  })
})
