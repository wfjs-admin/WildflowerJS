/**
 * Pool hooks and entity actions report errors like the rest of the entity.
 *
 * onAdd / onRemove / onClear and an entity method run from a data-action
 * threw straight out (through add() or the click handler) and never reached
 * the owner's onError. A throwing onClear could stop clear() partway. They
 * now go to the owner's onError (else the console, in every build), and the
 * pool operation completes.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, waitForCompleteRender } from './helpers/load-framework.js'

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!hasFeature('pools'))('pool hook and entity action errors', () => {
  let host, errs, origError

  beforeAll(async () => { await loadFramework() })

  beforeEach(() => {
    resetFramework()
    host = document.createElement('div')
    document.body.appendChild(host)
    errs = []
    origError = console.error
    console.error = (...a) => errs.push(a.map((x) => (x && x.message) || String(x)).join(' '))
  })

  afterEach(() => {
    console.error = origError
    host.remove()
  })

  async function mount(name, def) {
    let inst = null
    wildflower.component(name, { state: {}, ...def, init() { inst = this } })
    host.innerHTML = `<div data-component="${name}"><div data-pool="items"><template><button class="hit" data-action="hit"></button></template></div></div>`
    if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection()
    await waitForCompleteRender()
    await settle()
    return inst
  }

  it('onAdd and onRemove errors go to onError, and the operation completes', async () => {
    const seen = []
    const c = await mount('phe-a', {
      pools: { items: { onAdd() { throw new Error('phe-add') }, onRemove() { throw new Error('phe-remove') } } },
      onError(error) { seen.push(error.message); return true },
    })
    c.pools.items.add({ id: 1 })
    expect(c.pools.items.size).toBe(1)
    c.pools.items.remove(1)
    expect(c.pools.items.size).toBe(0)
    expect(seen).toEqual(['phe-add', 'phe-remove'])
  })

  it('a throwing onClear is reported and clear() still empties the pool', async () => {
    const c = await mount('phe-b', { pools: { items: { onClear() { throw new Error('phe-clear') } } } })
    c.pools.items.add([{ id: 1 }, { id: 2 }])
    c.pools.items.clear()
    expect(c.pools.items.size).toBe(0)
    expect(errs.some((e) => e.includes('phe-clear'))).toBe(true)
  })

  it('an entity method run by data-action reports to onError', async () => {
    const seen = []
    const c = await mount('phe-c', {
      pools: { items: { entity: { hit() { throw new Error('phe-entity') } } } },
      onError(error) { seen.push(error.message); return true },
    })
    c.pools.items.add({ id: 1 })
    await settle(60)
    host.querySelector('.hit').click()
    expect(seen).toEqual(['phe-entity'])
  })
})
