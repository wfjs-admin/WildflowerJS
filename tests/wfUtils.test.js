/**
 * wfUtils.test.js - Vitest Browser Mode Tests for WildflowerJS Utilities
 *
 * Tests the foundational utility module (wfUtils.js) that all framework modules depend on.
 * Priority: P0 (Critical - foundation layer must be validated)
 *
 * Categories:
 *   1. PathResolver (15 tests) - split caching, get/set, normalize, path manipulation
 *   2. ObjectUtils (12 tests) - deepClone, isEqual with circular refs, DOM nodes
 *   3. ArrayDetector (20 tests) - detectAppend, detectSwap, detectSparseUpdate, detectChanges
 *   4. LRUCache (8 tests) - basic operations, eviction behavior
 *   (DualIndexRegistry removed - class was dead weight, see docs/DEAD_WEIGHT_AUDIT.md)
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
  const getArrayDetector = () => window.arrayDetector
  const getLRUCache = () => window.LRUCache
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

  // ============================================================================
  // 3. ARRAYDETECTOR TESTS (20 tests)
  // ============================================================================

  describe('ArrayDetector', () => {
    it('detectAppend() detects basic append', () => {
      const oldArr = [1, 2, 3]
      const newArr = [1, 2, 3, 4, 5]
      const result = getArrayDetector().detectAppend(oldArr, newArr)

      expect(result).toBeDefined()
      expect(result.type).toBe('append')
      expect(result.startIndex).toBe(3)
      expect(result.appendedCount).toBe(2)
      expect(result.newItems).toEqual([4, 5])
    })

    it('detectAppend() detects append with objects', () => {
      const oldArr = [{ id: 1 }, { id: 2 }]
      const newArr = [{ id: 1 }, { id: 2 }, { id: 3 }]
      const result = getArrayDetector().detectAppend(oldArr, newArr)

      expect(result).toBeDefined()
      expect(result.appendedCount).toBe(1)
    })

    it('detectAppend() rejects when existing items changed', () => {
      const oldArr = [1, 2, 3]
      const newArr = [1, 999, 3, 4]
      const result = getArrayDetector().detectAppend(oldArr, newArr)

      expect(result).toBeNull()
    })

    it('detectAppend() rejects shorter arrays', () => {
      const oldArr = [1, 2, 3]
      const newArr = [1, 2]
      const result = getArrayDetector().detectAppend(oldArr, newArr)

      expect(result).toBeNull()
    })

    it('detectAppend() handles empty old array', () => {
      const oldArr = []
      const newArr = [1, 2, 3]
      const result = getArrayDetector().detectAppend(oldArr, newArr)

      expect(result).toBeNull() // Full render needed
    })

    it('detectSwap() detects basic swap', () => {
      const oldArr = [1, 2, 3, 4]
      const newArr = [1, 3, 2, 4] // indices 1 and 2 swapped
      const result = getArrayDetector().detectSwap(oldArr, newArr)

      expect(result).toBeDefined()
      expect(result.type).toBe('swap')
      expect(result.index1).toBe(1)
      expect(result.index2).toBe(2)
    })

    it('detectSwap() detects swap with ID-based objects', () => {
      const oldArr = [{ id: 1 }, { id: 2 }, { id: 3 }]
      const newArr = [{ id: 1 }, { id: 3 }, { id: 2 }]
      const result = getArrayDetector().detectSwap(oldArr, newArr)

      expect(result).toBeDefined()
      expect(result.index1).toBe(1)
      expect(result.index2).toBe(2)
    })

    it('detectSwap() rejects more than 2 position changes', () => {
      const oldArr = [1, 2, 3, 4]
      const newArr = [4, 3, 2, 1]
      const result = getArrayDetector().detectSwap(oldArr, newArr)

      expect(result).toBeNull()
    })

    it('detectSwap() rejects different lengths', () => {
      const oldArr = [1, 2, 3]
      const newArr = [1, 2, 3, 4]
      const result = getArrayDetector().detectSwap(oldArr, newArr)

      expect(result).toBeNull()
    })

    it('detectSwap() rejects arrays with < 2 elements', () => {
      const oldArr = [1]
      const newArr = [2]
      const result = getArrayDetector().detectSwap(oldArr, newArr)

      expect(result).toBeNull()
    })

    it('detectSparseUpdate() detects property changes', () => {
      const oldArr = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }]
      const newArr = [{ id: 1, name: 'A' }, { id: 2, name: 'B-changed' }, { id: 3, name: 'C' }]
      const result = getArrayDetector().detectSparseUpdate(oldArr, newArr)

      expect(result).toBeDefined()
      expect(result.type).toBe('sparse-update')
      expect(result.totalChanges).toBe(1)
      expect(result.changes.has(1)).toBe(true)
    })

    it('detectSparseUpdate() detects multiple sparse changes', () => {
      // Use shared references for unchanged items to pass sample check
      const item2 = { id: 2, count: 0 }
      const item4 = { id: 4, count: 0 }
      const oldArr = [
        { id: 1, count: 0 },
        item2,
        { id: 3, count: 0 },
        item4
      ]
      const newArr = [
        { id: 1, count: 1 },
        item2,
        { id: 3, count: 1 },
        item4
      ]
      const result = getArrayDetector().detectSparseUpdate(oldArr, newArr)

      expect(result).toBeDefined()
      expect(result.totalChanges).toBe(2)
      expect(result.commonProperties).toContain('count')
    })

    it('detectSparseUpdate() rejects ID reorder', () => {
      const oldArr = [{ id: 1 }, { id: 2 }, { id: 3 }]
      const newArr = [{ id: 2 }, { id: 1 }, { id: 3 }]
      const result = getArrayDetector().detectSparseUpdate(oldArr, newArr)

      expect(result).toBeNull()
    })

    it('detectSparseUpdate() rejects too many changes', () => {
      const oldArr = [{ id: 1, v: 0 }, { id: 2, v: 0 }, { id: 3, v: 0 }, { id: 4, v: 0 }]
      const newArr = [{ id: 1, v: 1 }, { id: 2, v: 1 }, { id: 3, v: 1 }, { id: 4, v: 0 }]
      const result = getArrayDetector().detectSparseUpdate(oldArr, newArr, { maxChangeRatio: 0.5 })

      expect(result).toBeNull()
    })

    it('detectSparseUpdate() detects regular interval', () => {
      // Use shared references for unchanged items
      const item2 = { id: 2, v: 0 }
      const item4 = { id: 4, v: 0 }
      const item6 = { id: 6, v: 0 }
      const oldArr = [
        { id: 1, v: 0 }, item2, { id: 3, v: 0 },
        item4, { id: 5, v: 0 }, item6
      ]
      const newArr = [
        { id: 1, v: 1 }, item2, { id: 3, v: 1 },
        item4, { id: 5, v: 1 }, item6
      ]
      const result = getArrayDetector().detectSparseUpdate(oldArr, newArr)

      expect(result).toBeDefined()
      expect(result.interval).toBe(2)
    })

    // detectChanges() tests removed — dead code (Sprint 2)

    it('findChangedIndices() finds changed positions', () => {
      const oldArr = [1, 2, 3, 4, 5]
      const newArr = [1, 9, 3, 9, 5]
      const indices = getArrayDetector().findChangedIndices(oldArr, newArr)

      expect(indices).toEqual([1, 3])
    })
  })

  // ============================================================================
  // 4. LRUCACHE TESTS (8 tests)
  // ============================================================================

  describe('LRUCache', () => {
    it('set and get work correctly', () => {
      const cache = new (getLRUCache())(10)
      cache.set('key1', 'value1')
      expect(cache.get('key1')).toBe('value1')
    })

    it('get() returns undefined for missing keys', () => {
      const cache = new (getLRUCache())(10)
      expect(cache.get('nonexistent')).toBeUndefined()
    })

    it('has() checks key existence', () => {
      const cache = new (getLRUCache())(10)
      cache.set('exists', true)
      expect(cache.has('exists')).toBe(true)
      expect(cache.has('missing')).toBe(false)
    })

    it('delete() removes keys', () => {
      const cache = new (getLRUCache())(10)
      cache.set('key', 'value')
      cache.delete('key')
      expect(cache.has('key')).toBe(false)
      expect(cache.get('key')).toBeUndefined()
    })

    it('clear() removes all entries', () => {
      const cache = new (getLRUCache())(10)
      cache.set('a', 1)
      cache.set('b', 2)
      cache.clear()
      expect(cache.size).toBe(0)
    })

    it('size tracks entry count', () => {
      const cache = new (getLRUCache())(10)
      expect(cache.size).toBe(0)
      cache.set('a', 1)
      cache.set('b', 2)
      expect(cache.size).toBe(2)
    })

    it('evicts oldest entries when full', () => {
      const cache = new (getLRUCache())(3)
      cache.set('a', 1)
      cache.set('b', 2)
      cache.set('c', 3)
      cache.set('d', 4) // Should evict 'a'

      expect(cache.has('a')).toBe(false)
      expect(cache.has('b')).toBe(true)
      expect(cache.has('c')).toBe(true)
      expect(cache.has('d')).toBe(true)
      expect(cache.size).toBe(3)
    })

    it('get() updates recency', () => {
      const cache = new (getLRUCache())(3)
      cache.set('a', 1)
      cache.set('b', 2)
      cache.set('c', 3)

      // Access 'a' to make it most recent
      cache.get('a')

      // Add new entry, should evict 'b' (now oldest)
      cache.set('d', 4)

      expect(cache.has('a')).toBe(true)
      expect(cache.has('b')).toBe(false)
      expect(cache.has('c')).toBe(true)
      expect(cache.has('d')).toBe(true)
    })
  })

})
