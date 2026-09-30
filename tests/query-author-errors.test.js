/**
 * An exception from the application's own query code reaches the console.
 *
 * A function `from` that throws or rejects set only the query's error field,
 * so in any build nothing said why a list stayed empty. It now prints once,
 * when the failure lands (after any retries), in every build. A throwing
 * `params` function warned in development only; it now reaches the console
 * in production too.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms))

suite('query author errors reach the console', () => {
  let lines, origError, origWarn

  beforeAll(async () => { await loadFramework() })

  beforeEach(() => {
    resetFramework()
    lines = []
    origError = console.error
    origWarn = console.warn
    const cap = (...a) => lines.push(a.map((x) => (x && x.message) || String(x)).join(' '))
    console.error = cap
    console.warn = cap
  })

  afterEach(() => {
    console.error = origError
    console.warn = origWarn
  })

  it('a function from() that throws is printed once, and still sets error', async () => {
    wildflower.query('qae-a', { from: () => { throw new Error('qae-throw') } })
    const q = wildflower.getQuery('qae-a')
    await settle()
    expect(q.error).toBe('qae-throw')
    expect(lines.filter((l) => l.includes('qae-throw')).length).toBe(1)
  })

  it('a function from() that rejects is printed', async () => {
    wildflower.query('qae-b', { from: async () => { throw new Error('qae-reject') } })
    wildflower.getQuery('qae-b')
    await settle()
    expect(lines.some((l) => l.includes('qae-reject'))).toBe(true)
  })

  it('a params() function that throws is printed', async () => {
    wildflower.query('qae-c', {
      from: async () => [],
      params: () => { throw new Error('qae-params') },
    })
    wildflower.getQuery('qae-c')
    await settle()
    expect(lines.some((l) => l.includes('qae-params'))).toBe(true)
  })
})
