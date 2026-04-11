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

  it('disposes context registry if present', () => {
    wildflower = window.wildflower

    // If context registry exists and has dispose, it should be called
    let disposeCalled = false
    const savedRegistry = wildflower._contextRegistry

    wildflower._contextRegistry = {
      dispose: () => { disposeCalled = true }
    }

    wildflower._dispose()

    expect(disposeCalled).toBe(true)

    // Restore
    wildflower._contextRegistry = savedRegistry
  })

  it('handles _dispose() when context registry has no dispose method', () => {
    wildflower = window.wildflower

    const savedRegistry = wildflower._contextRegistry
    wildflower._contextRegistry = {}

    expect(() => wildflower._dispose()).not.toThrow()

    // Restore
    wildflower._contextRegistry = savedRegistry
  })

  it('handles _dispose() when context registry is null', () => {
    wildflower = window.wildflower

    const savedRegistry = wildflower._contextRegistry
    wildflower._contextRegistry = null

    expect(() => wildflower._dispose()).not.toThrow()

    // Restore
    wildflower._contextRegistry = savedRegistry
  })
})
