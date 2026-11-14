/**
 * The pool call sites in shared modules, on a tier with pools and on one
 * without: a component or store that touches pools behaves the same way
 * whichever way the tier was built.
 *   - with pools: getPool() returns the handle, tick() runs, the devtools
 *     hook lists the pool;
 *   - without: getPool() returns null, tick() is inert (WF-003 in
 *     development builds), the devtools hook lists nothing.
 * (A store's pools block in a tier without pools: store-pools.test.js.)
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { loadFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const pools = hasFeature('pools')
const wait = (ms = 40) => new Promise(r => setTimeout(r, ms))

describe('Pool call sites in shared modules', () => {
  let container, warn
  beforeAll(async () => { await loadFramework() })
  afterEach(() => {
    if (warn) warn.mockRestore()
    warn = null
    if (container) container.remove()
    container = null
  })

  const warned = () => warn.mock.calls.map(c => c.map(String).join(' ')).join('\n')

  it('a component: getPool, tick and the devtools pool list', async () => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const seen = {}
    let ticks = 0
    wildflower.component('pft-comp', {
      state: {},
      init() {
        const p = this.getPool('dots')
        seen.pool = p
        if (p) p.add({ id: 1 })
      },
      tick() { ticks++ }
    })
    container = document.createElement('div')
    container.innerHTML = `
      <div data-component="pft-comp">
        <div data-pool="dots"><template><i class="dot"></i></template></div>
      </div>`
    document.body.appendChild(container)
    if (typeof wildflower.scan === 'function') wildflower.scan(container)
    await wait(150)
    expect('pool' in seen).toBe(true)
    const hook = window.__WF_DEVTOOLS_GLOBAL_HOOK__
    const listed = hook && hook.getPools ? hook.getPools().filter(p => p.owner === 'pft-comp') : null
    if (pools) {
      expect(seen.pool).toBeTruthy()
      expect(container.querySelectorAll('.dot').length).toBe(1)
      expect(ticks).toBeGreaterThan(0)
      if (listed) expect(listed.length).toBe(1)
    } else {
      expect(seen.pool).toBe(null)
      expect(ticks).toBe(0)
      if (listed) expect(listed).toEqual([])
      if (!isMinifiedBuild()) expect(warned()).toContain('WF-003')
    }
  })

  it('a store: tick() runs with pools, and is inert without them', async () => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let ticks = 0
    wildflower.store('pft-store', { state: { n: 0 }, tick() { ticks++ } })
    await wait(100)
    expect(wildflower.getStore('pft-store')).toBeTruthy()
    if (pools) expect(ticks).toBeGreaterThan(0)
    else {
      expect(ticks).toBe(0)
      if (!isMinifiedBuild()) expect(warned()).toContain('WF-003')
    }
    wildflower.unregister('pft-store')
  })
})
