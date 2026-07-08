/**
 * WildflowerJS Framework Dispose Test Suite
 *
 * Tests that _dispose() clears the context registry GC interval
 * and releases resources when the framework instance is torn down.
 * Covers issue 2.19 from V1 RC1 Final Code Review.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { loadFramework } from './helpers/load-framework.js'

describe('Framework _dispose()', () => {
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  it('does not throw when called', () => {
    wildflower = window.wildflower
    expect(() => wildflower._dispose()).not.toThrow()
  })

  it('disposes the records factory if present', () => {
    wildflower = window.wildflower

    // If the records factory exists and has dispose, it should be called
    let disposeCalled = false
    const savedRecords = wildflower._contextRecords

    wildflower._contextRecords = {
      dispose: () => { disposeCalled = true }
    }

    wildflower._dispose()

    expect(disposeCalled).toBe(true)

    // Restore
    wildflower._contextRecords = savedRecords
  })

  it('handles _dispose() when the records factory has no dispose method', () => {
    wildflower = window.wildflower

    const savedRecords = wildflower._contextRecords
    wildflower._contextRecords = {}

    expect(() => wildflower._dispose()).not.toThrow()

    // Restore
    wildflower._contextRecords = savedRecords
  })

  it('handles _dispose() when the records factory is null', () => {
    wildflower = window.wildflower

    const savedRecords = wildflower._contextRecords
    wildflower._contextRecords = null

    expect(() => wildflower._dispose()).not.toThrow()

    // Restore
    wildflower._contextRecords = savedRecords
  })
})
