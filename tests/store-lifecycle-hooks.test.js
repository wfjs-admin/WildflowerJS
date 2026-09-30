/**
 * The lifecycle a store actually runs.
 *
 * init() runs at registration; destroy() and beforeDestroy() run when the
 * store is unregistered. beforeInit, beforeUpdate and onUpdate are component
 * render hooks: a store has no render, so they are dropped (not bound as
 * methods either), and development builds now warn (WF-219) instead of
 * saying nothing.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { loadFramework, isMinifiedBuild } from './helpers/load-framework.js'

let n = 0
const uniq = (base) => base + (++n)

beforeAll(async () => { await loadFramework() })

async function captureWarnings(fn) {
  const lines = []
  const orig = console.warn
  console.warn = (...a) => { lines.push(a.map(String).join(' ')) }
  try { await fn() } finally { console.warn = orig }
  return lines
}

describe('store lifecycle', () => {
  it('init runs at registration; beforeDestroy then destroy run on unregister', () => {
    const name = uniq('slh')
    const calls = []
    wildflower.store(name, {
      state: {},
      init() { calls.push('init') },
      beforeDestroy() { calls.push('beforeDestroy') },
      destroy() { calls.push('destroy') },
    })
    expect(calls).toEqual(['init'])
    wildflower.unregister(name)
    expect(calls).toEqual(['init', 'beforeDestroy', 'destroy'])
  })

  it('component render hooks are never called on a store, and are not bound as methods', async () => {
    const name = uniq('slhRender')
    const calls = []
    await captureWarnings(() => {
      wildflower.store(name, {
        state: { a: 1 },
        beforeInit() { calls.push('beforeInit') },
        beforeUpdate() { calls.push('beforeUpdate') },
        onUpdate() { calls.push('onUpdate') },
      })
    })
    const s = wildflower.getStore(name)
    s.a = 2
    await new Promise((r) => setTimeout(r, 30))
    expect(calls).toEqual([])
    expect(typeof s.onUpdate).toBe('undefined')
    wildflower.unregister(name)
  })

  it.skipIf(isMinifiedBuild())('development builds warn WF-219 for each render hook on a store', async () => {
    const name = uniq('slhWarn')
    const lines = await captureWarnings(() => {
      wildflower.store(name, { state: {}, beforeInit() {}, beforeUpdate() {}, onUpdate() {} })
    })
    const wf219 = lines.filter((l) => l.includes('WF-219'))
    expect(wf219.some((l) => l.includes('beforeInit'))).toBe(true)
    expect(wf219.some((l) => l.includes('beforeUpdate'))).toBe(true)
    expect(wf219.some((l) => l.includes('onUpdate'))).toBe(true)
    wildflower.unregister(name)
  })
})
