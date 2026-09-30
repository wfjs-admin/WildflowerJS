/**
 * A pool handle kept after its owner is gone (a component destroyed, a store
 * unregistered) drops writes silently, in every build. The usual cause is
 * ordinary: a fetch or a socket message that arrives after the user navigated
 * away. Nothing is stored, no hook runs, and nothing throws. (React settled
 * the same case the same way in React 18.)
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, waitForCompleteRender } from './helpers/load-framework.js'

const describeIfPools = hasFeature('pools') ? describe : describe.skip

describeIfPools('a pool handle kept after its owner is gone', () => {
  let wf
  let n = 0
  beforeAll(async () => { await loadFramework(); wf = window.wildflower })
  beforeEach(() => resetFramework())

  function expectDroppedWrites(handle, added) {
    expect(() => {
      handle.add({ id: 101 })
      handle.push({ id: 102 }, { id: 103 })
      handle.push([{ id: 104 }, { id: 105 }])
    }).not.toThrow()
    expect(handle.length).toBe(0)
    expect(handle.get(101)).toBeUndefined()
    expect(added).toEqual([])
    expect(() => handle.remove(101)).not.toThrow()
    expect(handle.remove(101)).toBe(false)
    expect(handle.update(101, { x: 1 })).toBeNull()
    expect(() => handle.clear()).not.toThrow()
  }

  it('a destroyed component\'s pool drops writes, runs no hook, and does not throw', async () => {
    const name = 'pdh-comp-' + (++n)
    const added = []
    let handle = null
    wf.component(name, {
      pools: { dots: { onAdd(e) { added.push(e.id) } } },
      init() { handle = this.pools.dots; handle.add({ id: 1 }) },
    })
    const host = document.createElement('div')
    host.innerHTML = `<div data-component="${name}"><div data-pool="dots" data-key="id"><template><span></span></template></div></div>`
    document.body.appendChild(host)
    wf.scan(host)
    await waitForCompleteRender()
    expect(handle.length).toBe(1)

    const el = host.querySelector('[data-component]')
    const id = el.dataset.componentId
    el.remove()
    wf.destroyComponent(id)
    added.length = 0
    expectDroppedWrites(handle, added)
    host.remove()
  })

  it('an unregistered store\'s pool drops writes, runs no hook, and does not throw', () => {
    const name = 'pdhStore' + (++n)
    const added = []
    wf.store(name, { pools: { dots: { onAdd(e) { added.push(e.id) } } }, init() { this.pools.dots.push({ id: 1 }) } })
    const handle = wf.getStore(name).pools.dots
    expect(handle.length).toBe(1)

    wf.unregister(name)
    added.length = 0
    expectDroppedWrites(handle, added)
  })
})
