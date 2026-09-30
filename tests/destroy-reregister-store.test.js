/**
 * After wildflower.destroy(), registering a store under a name it had before
 * builds a new store. destroy() used to leave the store manager's name table
 * in place, so store(name, ...) handed back the dead store, with its old
 * state and destroyed pools.
 *
 * In its own file: destroy() tears the whole framework down.
 */
import { it, expect, beforeAll } from 'vitest'
import { loadFramework, hasFeature } from './helpers/load-framework.js'

let wf
beforeAll(async () => { await loadFramework(); wf = window.wildflower })

it('a store registered again after destroy() is a new store', () => {
  const withPools = hasFeature('pools')
  wf.store('reborn', withPools ? { state: { v: 1 }, pools: { a: {} } } : { state: { v: 1 } })
  const first = wf.getStore('reborn')
  wf.destroy()
  wf.store('reborn', withPools ? { state: { v: 2 }, pools: { a: {} } } : { state: { v: 2 } })
  const again = wf.getStore('reborn')
  expect(again).not.toBe(first)
  expect(again.v).toBe(2)
  if (withPools) {
    expect(() => { again.pools.a.push({ id: 1 }); again.pools.a.remove(1) }).not.toThrow()
  }
})
