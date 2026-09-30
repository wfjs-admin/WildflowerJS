/**
 * Store and plugin errors reach their onError, as a component's do.
 *
 * - init() errors, sync or async, go to the store's onError, or to the
 *   console in every build when it has none.
 * - A method that throws goes to its entity's onError when it has one, and
 *   the call returns undefined, as a component action's does. With no
 *   onError the error is thrown to the caller, unchanged.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

let n = 0
const uniq = (base) => base + (++n)
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))

describe('store and plugin error routing', () => {
  let errs, origError

  beforeAll(async () => { await loadFramework() })

  beforeEach(() => {
    resetFramework()
    errs = []
    origError = console.error
    console.error = (...a) => errs.push(a.map((x) => (x && x.message) || String(x)).join(' '))
  })

  afterEach(() => { console.error = origError })

  it('a store init() error goes to the store\'s onError', () => {
    const seen = []
    wildflower.store(uniq('ser'), {
      state: {},
      init() { throw new Error('ser-init') },
      onError(error, info) { seen.push([error.message, info.lifecycle]); return true },
    })
    expect(seen).toEqual([['ser-init', 'init']])
  })

  it('an async store init() rejection goes to the store\'s onError', async () => {
    const seen = []
    wildflower.store(uniq('serAsync'), {
      state: {},
      async init() { throw new Error('ser-async') },
      onError(error, info) { seen.push([error.message, info.lifecycle]); return true },
    })
    await settle()
    expect(seen).toEqual([['ser-async', 'init']])
  })

  it('an async store init() rejection with no onError reaches the console in every build', async () => {
    // Development prints the cause as a WF-903 "Caused by" warning line.
    const origWarn = console.warn
    console.warn = (...a) => errs.push(a.map((x) => (x && x.message) || String(x)).join(' '))
    try {
      wildflower.store(uniq('serAsyncLog'), { state: {}, async init() { throw new Error('ser-async-log') } })
      await settle()
    } finally { console.warn = origWarn }
    expect(errs.some((e) => e.includes('ser-async-log'))).toBe(true)
  })

  it('a store method error goes to the store\'s onError, and the call returns undefined', () => {
    const seen = []
    const name = uniq('serMethod')
    wildflower.store(name, {
      state: {},
      boom() { throw new Error('ser-method') },
      onError(error, info) { seen.push([error.message, info.methodName]); return true },
    })
    expect(wildflower.getStore(name).boom()).toBe(undefined)
    expect(seen).toEqual([['ser-method', 'boom']])
  })

  it('a store computed error goes to the store\'s onError', () => {
    const seen = []
    const name = uniq('serComputed')
    wildflower.store(name, {
      state: { bad: false },
      computed: { risky() { if (this.bad) throw new Error('ser-computed'); return 1 } },
      onError(error) { seen.push(error.message); return true },
    })
    const s = wildflower.getStore(name)
    s.bad = true
    try { void s.risky } catch { /* a computed read rethrows */ }
    expect(seen).toContain('ser-computed')
  })

  it('a store watcher error goes to the store\'s onError', () => {
    const seen = []
    const name = uniq('serWatch')
    wildflower.store(name, {
      state: { a: 1 },
      watch: { a() { throw new Error('ser-watch') } },
      onError(error) { seen.push(error.message); return true },
    })
    wildflower.getStore(name).a = 2
    expect(seen).toContain('ser-watch')
  })

  it.skipIf(!hasFeature('pools'))('a store tick() error goes to the store\'s onError', async () => {
    const seen = []
    wildflower.store(uniq('serTick'), {
      state: {},
      tick() { throw new Error('ser-tick') },
      onError(error) { seen.push(error.message); return true },
    })
    await settle(80)
    expect(seen).toContain('ser-tick')
  })

  it('a store method error with no onError is thrown to the caller', () => {
    const name = uniq('serThrow')
    wildflower.store(name, { state: {}, boom() { throw new Error('ser-throw') } })
    expect(() => wildflower.getStore(name).boom()).toThrow('ser-throw')
  })

  it.skipIf(!hasFeature('plugins'))('a plugin method error goes to the plugin\'s onError', () => {
    const seen = []
    const name = uniq('perMethod')
    wildflower.plugin({
      name,
      state: {},
      boom() { throw new Error('per-method') },
      onError(error, info) { seen.push([error.message, info.methodName]); return true },
    })
    expect(wildflower['$' + name].boom()).toBe(undefined)
    expect(seen).toEqual([['per-method', 'boom']])
  })

  it.skipIf(!hasFeature('plugins'))('a plugin method error with no onError is thrown to the caller', () => {
    const name = uniq('perThrow')
    wildflower.plugin({ name, boom() { throw new Error('per-throw') } })
    expect(() => wildflower['$' + name].boom()).toThrow('per-throw')
  })
})
