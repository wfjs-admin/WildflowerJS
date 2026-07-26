/**
 * wfUtils.test.js - Vitest Browser Mode Tests for WildflowerJS Utilities
 *
 * Tests the foundational utility module (wfUtils.js) that all framework modules depend on.
 * Priority: P0 (Critical - foundation layer must be validated)
 *
 * Categories:
 *   1. PathResolver (15 tests) - split caching, get/set, normalize, path manipulation
 *   2. ObjectUtils (12 tests) - deepClone, isEqual with circular refs, DOM nodes
 *   (ArrayDetector + LRUCache removed 2026-07-08 — unreferenced dead code, tree-shaken
 *    from all bundles; see docs/future/CORE_CARTOGRAPHY_AND_TIGHTENING_PLAN_2026-07-08.md A4)
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode } from './helpers/load-framework.js'

describe('WildflowerJS Utilities (wfUtils.js)', () => {
  beforeAll(async () => {
    await loadFramework()
  })

  // Helper to get utilities (ensures they're loaded)
  const getPathResolver = () => window.pathResolver
  const getObjectUtils = () => window.objectUtils
  // ============================================================================
  // 1. PATHRESOLVER TESTS (15 tests)
  // ============================================================================

  describe('PathResolver', () => {
    it('split() splits dot-notation paths', () => {
      const parts = getPathResolver().split('user.profile.name')
      expect(parts).toEqual(['user', 'profile', 'name'])
    })

    it('split() handles single segment paths', () => {
      const parts = getPathResolver().split('name')
      expect(parts).toEqual(['name'])
    })

    it('split() handles empty/null input', () => {
      expect(getPathResolver().split('')).toEqual([])
      expect(getPathResolver().split(null)).toEqual([])
      expect(getPathResolver().split(undefined)).toEqual([])
    })

    it('split() caches results', () => {
      const path = 'cache.test.path'
      const first = getPathResolver().split(path)
      const second = getPathResolver().split(path)
      expect(first).toBe(second) // Same reference (cached)
    })

    it('get() retrieves nested values', () => {
      const obj = { user: { profile: { name: 'John' } } }
      expect(getPathResolver().get(obj, 'user.profile.name')).toBe('John')
    })

    it('get() retrieves simple properties', () => {
      const obj = { name: 'John' }
      expect(getPathResolver().get(obj, 'name')).toBe('John')
    })

    it('get() returns undefined for missing paths', () => {
      const obj = { user: { name: 'John' } }
      expect(getPathResolver().get(obj, 'user.profile.name')).toBeUndefined()
    })

    it('get() handles null in path chain', () => {
      const obj = { user: null }
      expect(getPathResolver().get(obj, 'user.profile.name')).toBeUndefined()
    })

    it('set() sets nested values', () => {
      const obj = { user: { profile: {} } }
      getPathResolver().set(obj, 'user.profile.name', 'John')
      expect(obj.user.profile.name).toBe('John')
    })

    it('set() creates intermediate objects', () => {
      const obj = {}
      getPathResolver().set(obj, 'user.profile.name', 'John')
      expect(obj.user.profile.name).toBe('John')
    })

    it('set() creates arrays for numeric indices', () => {
      const obj = {}
      getPathResolver().set(obj, 'items.0.name', 'First')
      expect(Array.isArray(obj.items)).toBe(true)
      expect(obj.items[0].name).toBe('First')
    })

    it('normalize() converts bracket notation', () => {
      expect(getPathResolver().normalize('items[0].name')).toBe('items.0.name')
      expect(getPathResolver().normalize('arr[0][1].value')).toBe('arr.0.1.value')
    })

    it('getBase() and getNested() work correctly', () => {
      expect(getPathResolver().getBase('a.b.c')).toBe('a')
      expect(getPathResolver().getNested('a.b.c')).toBe('b.c')
      expect(getPathResolver().getBase('single')).toBe('single')
      expect(getPathResolver().getNested('single')).toBe('')
    })

    // getLast(), getParent(), isNested() removed — dead code (Sprint 2)
  })

  // ============================================================================
  // 2. OBJECTUTILS TESTS (12 tests)
  // ============================================================================

  describe('ObjectUtils', () => {
    it('deepClone() clones simple objects', () => {
      const original = { a: 1, b: 2, c: 3 }
      const clone = getObjectUtils().deepClone(original)
      expect(clone).toEqual(original)
      clone.a = 999
      expect(original.a).toBe(1) // Original unchanged
    })

    it('deepClone() clones nested objects', () => {
      const original = { user: { profile: { name: 'John' } } }
      const clone = getObjectUtils().deepClone(original)
      clone.user.profile.name = 'Jane'
      expect(original.user.profile.name).toBe('John')
    })

    it('deepClone() clones arrays', () => {
      const original = [1, [2, 3], { a: 4 }]
      const clone = getObjectUtils().deepClone(original)
      clone[1][0] = 999
      expect(original[1][0]).toBe(2)
    })

    it('deepClone() handles circular references', () => {
      const original = { a: 1 }
      original.self = original

      expect(() => {
        const clone = getObjectUtils().deepClone(original)
        expect(clone.a).toBe(1)
        expect(clone.self).toBe(clone)
      }).not.toThrow()
    })

    it('deepClone() preserves DOM nodes by reference', () => {
      const div = document.createElement('div')
      div.id = 'test-node'
      const original = { element: div, data: { value: 1 } }
      const clone = getObjectUtils().deepClone(original)

      expect(clone.element).toBe(div) // Same reference
      expect(clone.data).not.toBe(original.data) // Different reference
    })

    it('deepClone() handles primitives', () => {
      expect(getObjectUtils().deepClone(42)).toBe(42)
      expect(getObjectUtils().deepClone('hello')).toBe('hello')
      expect(getObjectUtils().deepClone(true)).toBe(true)
      expect(getObjectUtils().deepClone(null)).toBe(null)
    })

    it('isEqual() compares simple values', () => {
      expect(getObjectUtils().isEqual(1, 1)).toBe(true)
      expect(getObjectUtils().isEqual(1, 2)).toBe(false)
      expect(getObjectUtils().isEqual('a', 'a')).toBe(true)
      expect(getObjectUtils().isEqual('a', 'b')).toBe(false)
    })

    it('isEqual() compares objects', () => {
      expect(getObjectUtils().isEqual({ a: 1 }, { a: 1 })).toBe(true)
      expect(getObjectUtils().isEqual({ a: 1 }, { a: 2 })).toBe(false)
      expect(getObjectUtils().isEqual({ a: 1 }, { b: 1 })).toBe(false)
    })

    it('isEqual() compares nested objects', () => {
      const a = { user: { profile: { name: 'John' } } }
      const b = { user: { profile: { name: 'John' } } }
      const c = { user: { profile: { name: 'Jane' } } }

      expect(getObjectUtils().isEqual(a, b)).toBe(true)
      expect(getObjectUtils().isEqual(a, c)).toBe(false)
    })

    it('isEqual() compares arrays', () => {
      expect(getObjectUtils().isEqual([1, 2, 3], [1, 2, 3])).toBe(true)
      expect(getObjectUtils().isEqual([1, 2, 3], [1, 2, 4])).toBe(false)
      expect(getObjectUtils().isEqual([1, 2], [1, 2, 3])).toBe(false)
    })

    it('isEqual() handles circular references', () => {
      const a = { value: 1 }
      a.self = a
      const b = { value: 1 }
      b.self = b

      expect(() => {
        expect(getObjectUtils().isEqual(a, b)).toBe(true)
      }).not.toThrow()
    })

    it('isEqual() handles primitive wrappers', () => {
      expect(getObjectUtils().isEqual(new Number(5), new Number(5))).toBe(true)
      expect(getObjectUtils().isEqual(new Number(5), new Number(6))).toBe(false)
      expect(getObjectUtils().isEqual(new String('a'), new String('a'))).toBe(true)
    })
  })


})
