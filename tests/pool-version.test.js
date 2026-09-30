/**
 * pool.version: a number on every pool handle that goes up whenever the pool
 * changes through its API (add/push, remove, clear, update, swap, markDirty).
 * It only ever increases; code compares it with a value it kept, and never
 * relies on the size of the step, so several changes may share one.
 *
 * It answers "did this pool change?" for code outside the framework, such as
 * an extension that draws a pool and wants to skip frames where nothing did.
 * A pool refilled with the same number of entities changes no length but
 * does change the version. A store pool has no DOM, so before this its
 * markDirty() did nothing at all; now it raises the version.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, waitForCompleteRender } from './helpers/load-framework.js'

const describeIfPools = hasFeature('pools') ? describe : describe.skip

describeIfPools('pool.version', () => {
  let wf
  let n = 0
  beforeAll(async () => { await loadFramework(); wf = window.wildflower })
  beforeEach(() => resetFramework())

  // Each call must raise the version; returns the value after the last one.
  function expectEachRaises(pool, steps) {
    let last = pool.version
    for (const [label, step] of steps) {
      step()
      expect(pool.version, label).toBeGreaterThan(last)
      last = pool.version
    }
    return last
  }

  it('a store pool starts at a number and goes up on every change', () => {
    const name = 'pv' + (++n)
    wf.store(name, { pools: { dots: {} } })
    const pool = wf.getStore(name).pools.dots
    expect(typeof pool.version).toBe('number')
    expectEachRaises(pool, [
      ['push', () => pool.push({ id: 1, x: 0 })],
      ['push several', () => pool.push({ id: 2, x: 0 }, { id: 3, x: 0 })],
      ['add an array', () => pool.add([{ id: 4, x: 0 }])],
      ['update', () => pool.update(1, { x: 5 })],
      ['markDirty', () => { pool.get(2).x = 7; pool.markDirty(2) }],
      ['remove', () => pool.remove(3)],
      ['clear', () => pool.clear()],
    ])
    wf.unregister(name)
  })

  it('reading does not change it', () => {
    const name = 'pv' + (++n)
    wf.store(name, { pools: { dots: {} } })
    const pool = wf.getStore(name).pools.dots
    pool.push({ id: 1 }, { id: 2 })
    const v = pool.version
    pool.get(1); pool.at(0); pool.find(() => true); pool.map((e) => e.id)
    void pool.length; void pool.items
    expect(pool.version).toBe(v)
    wf.unregister(name)
  })

  it('a refill with the same number of entities changes the version, not the length', () => {
    const name = 'pv' + (++n)
    wf.store(name, { pools: { dots: {} } })
    const pool = wf.getStore(name).pools.dots
    pool.push({ id: 1 }, { id: 2 })
    const v = pool.version
    pool.clear()
    pool.push({ id: 3 }, { id: 4 })
    expect(pool.length).toBe(2)
    expect(pool.version).toBeGreaterThan(v)
    wf.unregister(name)
  })

  // What the pool API page may say about binding it. The version is a plain
  // number, so a computed that reads only it has no reactive sources and gets
  // method semantics (entity-handle.js evaluateComputed: fresh on each read,
  // never pushed). The question is what markup bound to it does when only the
  // version changes (markDirty: no length change to wake anything else).
  it('is not a reactive source: markup bound to a computed over it alone does not update', async () => {
    const name = 'pvs' + (++n)
    wf.store(name, { pools: { dots: {} }, computed: { v() { return this.pools.dots.version } } })
    const pool = wf.getStore(name).pools.dots
    pool.push({ id: 1 })
    const view = 'pv-view-' + n
    wf.component(view, {})
    const host = document.createElement('div')
    host.innerHTML = `<div data-component="${view}"><span data-bind="$${name}.v"></span></div>`
    document.body.appendChild(host)
    wf.scan(host)
    await waitForCompleteRender()
    const span = host.querySelector('span')
    const shownBefore = span.textContent
    pool.markDirty(1)
    pool.markDirty(1)
    await waitForCompleteRender()
    await new Promise((r) => setTimeout(r, 100))
    expect(pool.version).toBeGreaterThan(Number(shownBefore))
    expect(span.textContent).toBe(shownBefore)
    host.remove()
    wf.unregister(name)
  })

  it('a component pool goes up on the same changes', async () => {
    const name = 'pv-comp-' + (++n)
    let pool = null
    wf.component(name, { pools: { dots: {} }, init() { pool = this.pools.dots } })
    const host = document.createElement('div')
    host.innerHTML = `<div data-component="${name}"><div data-pool="dots" data-key="id"><template><span data-bind="x"></span></template></div></div>`
    document.body.appendChild(host)
    wf.scan(host)
    await waitForCompleteRender()
    expect(typeof pool.version).toBe('number')
    expectEachRaises(pool, [
      ['push', () => pool.push({ id: 1, x: 0 })],
      ['push several', () => pool.push({ id: 2, x: 0 }, { id: 3, x: 0 })],
      ['update', () => pool.update(1, { x: 5 })],
      ['markDirty', () => { pool.get(2).x = 7; pool.markDirty(2) }],
      ['swap', () => pool.swap(1, 2)],
      ['remove', () => pool.remove(3)],
      ['clear', () => pool.clear()],
    ])
    host.remove()
  })
})
