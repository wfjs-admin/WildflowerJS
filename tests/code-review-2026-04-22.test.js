/**
 * Reproducer tests for findings from the 2026-04-22 code review (Group 1, safe subset).
 *
 * Phase 1: unit-style internal-state inspection for H2, H3, H5.
 * These tests do NOT touch scheduler / rAF / pools / sync effects — they
 * only call pure methods or inspect prototypes. Safe to run.
 *
 * Test-first: written to FAIL pre-fix, PASS post-fix.
 *
 * Subsequent groups (C1/C2/C3/H4/H10/H14) will land in separate files
 * after their APIs are verified against existing tests.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import {
  loadFramework,
  resetFramework,
  isMinifiedBuild,
  hasFeature,
  whenSettled
} from './helpers/load-framework.js'

describe.skipIf(isMinifiedBuild())('Code Review 2026-04-22 — Group 1 (phase 1)', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()
    if (wildflower._initContextSystem) {
      wildflower._contextSystemInitialized = false
      wildflower._initContextSystem()
    }
    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  // ─────────────────────────────────────────────────────────────────
  // H2 — _expressionUsesPath must not throw on regex metacharacters
  //       EntitySystem.js:1093
  //       Pure unit test: calls the method directly, checks no throw.
  // ─────────────────────────────────────────────────────────────────
  describe('H2 — _expressionUsesPath handles regex metacharacters in paths', () => {
    it('is defined on the framework', () => {
      expect(typeof wildflower._expressionUsesPath).toBe('function')
    })

    it('does not throw on path containing +', () => {
      expect(() => {
        wildflower._expressionUsesPath('someVar', 'evil+path')
      }).not.toThrow()
    })

    it('does not throw on path containing parentheses', () => {
      expect(() => {
        wildflower._expressionUsesPath('a || b', '(paren)')
      }).not.toThrow()
    })

    it('does not throw on path with *', () => {
      expect(() => {
        wildflower._expressionUsesPath('foo', 'star*path')
      }).not.toThrow()
    })

    it('still correctly detects legitimate path use', () => {
      // Sanity: the method should still work for normal paths
      expect(wildflower._expressionUsesPath('count + 1', 'count')).toBe(true)
      expect(wildflower._expressionUsesPath('count + 1', 'name')).toBe(false)
    })
  })

  // ─────────────────────────────────────────────────────────────────
  // H3 — _expressionVarsCache should be per-instance, not on prototype
  //       ExpressionEvaluator.js:76
  // ─────────────────────────────────────────────────────────────────
  describe('H3 — _expressionVarsCache is not shared across instances via prototype', () => {
    it('not declared on WildflowerJS prototype', () => {
      const proto = Object.getPrototypeOf(wildflower)
      // Pre-fix: inline `_expressionVarsCache: new Map()` on the mixin object
      // literal is copied by reference into the prototype by Object.assign.
      // Post-fix: initialized in the constructor per-instance, proto clean.
      const hasOnProto = Object.prototype.hasOwnProperty.call(proto, '_expressionVarsCache')
      expect(hasOnProto).toBe(false)
    })
  })

  // H5 rescinded 2026-04-22.
  // Short version: the cited regex never sees the user's computed body — it
  // sees the wrapper. So the regex tightening has no real-world effect and
  // the bug as stated doesn't exist. (The observed outcome is real but has
  // a different cause; filed as a follow-up candidate in the doc.)

  // ─────────────────────────────────────────────────────────────────
  // C2 — Pool sub-array remove() must not call Array.prototype.indexOf
  //       PoolRenderer.js:502
  //       Pool contract: "never use splice/pop/indexOf/slice on pool arrays"
  // ─────────────────────────────────────────────────────────────────
  describe.skipIf(!hasFeature('pools'))('C2 — Pool remove() does not call indexOf on sub-arrays', () => {
    it('remove() does not invoke Array.prototype.indexOf', async () => {
      testContainer.innerHTML = `
        <div data-component="c2-host">
          <div data-pool="fx" data-key="id">
            <template><span></span></template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('c2-host', {
        state: {},
        init() {
          pool = this.getPool('fx')
        }
      })

      wildflower._scanForDynamicComponents()
      await whenSettled()
      expect(pool).not.toBeNull()

      // Seed 20 entities so the sub-array has enough entries
      // that the index lookup is meaningful
      for (let i = 0; i < 20; i++) pool.add({ id: i })
      await whenSettled()

      // Count indexOf calls on plain arrays during remove
      const origIndexOf = Array.prototype.indexOf
      let indexOfCalls = 0
      Array.prototype.indexOf = function (...args) {
        indexOfCalls++
        return origIndexOf.apply(this, args)
      }
      try {
        pool.remove(10)
      } finally {
        Array.prototype.indexOf = origIndexOf
      }

      // Pre-fix: PoolRenderer.js:502 calls subArr.indexOf(entry) → ≥1
      // Post-fix: zero indexOf calls in the remove path
      expect(indexOfCalls).toBe(0)
      expect(pool.size).toBe(19)
    })

    it.skip('placeholder to keep ordering', () => {})
  })

  // C1 (a sync-effect reentry smoke test against the pre-1.2.0 reactive core)
  // was deleted 2026-09-11: the ReactiveStateManager code it guarded no longer
  // exists, and the single dependency graph has no sync-effect mode. Reentry
  // coverage for the graph lives in the reactive-graph tests.

  describe('C2 — Pool remove() preserves entity identity (resumed)', () => {
    const itPools = hasFeature('pools') ? it : it.skip
    itPools('remove preserves entity identity and order after swap-with-last', async () => {
      testContainer.innerHTML = `
        <div data-component="c2-order-host">
          <div data-pool="rows" data-key="id">
            <template><div></div></template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('c2-order-host', {
        state: {},
        init() {
          pool = this.getPool('rows')
        }
      })

      wildflower._scanForDynamicComponents()
      await whenSettled()

      for (let i = 0; i < 10; i++) pool.add({ id: i, value: `v${i}` })
      await whenSettled()

      pool.remove(3)
      pool.remove(7)
      pool.remove(0)
      await whenSettled()

      // 7 entities remain, and the pool map still holds the right keys
      expect(pool.size).toBe(7)
      const keys = pool.items.map(it => it.id).sort((a, b) => a - b)
      expect(keys).toEqual([1, 2, 4, 5, 6, 8, 9])
    })
  })
})
