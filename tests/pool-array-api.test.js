/**
 * WildflowerJS Pool Array-like API Test Suite
 *
 * PoolHandle exposes a JavaScript-native array-like API (push, length,
 * at, filter, map, find, forEach, iterable) while preserving the
 * key-based identity system the pool is built on.
 *
 * Scope:
 *   - Array mutator: push (delegates to add)
 *   - Array readers: length, at(i), find, filter, map, forEach, some,
 *     every, reduce (delegate to items)
 *   - Iteration: for...of, Symbol.iterator
 *   - Aliases: add/remove/size still work (identical behavior)
 *   - Intentionally absent: splice, pop, indexOf, slice — they assume
 *     stable indices, which swap-with-last storage doesn't provide.
 *     Use remove(key) to delete and at(i) for DOM-ordered positional reads.
 *
 * Not exposed:
 *   - Indexed access (pool[i]) — requires Proxy wrapping, skipped
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature } from './helpers/load-framework.js'

const describeIfPools = hasFeature('pools') ? describe : describe.skip

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

function ensureComponentScanning(wildflower) {
  if (wildflower._setupDynamicComponentDetection) {
    wildflower._setupDynamicComponentDetection()
  }
}

function getInstance(wildflower, el) {
  const compEl = el.closest ? el.closest('[data-component]') : el.querySelector('[data-component]')
  const target = compEl || el
  return wildflower.componentInstances.get(target.dataset.componentId)
}

/**
 * Standard pool setup used by most tests in this file.
 * Returns { instance, pool } for a pool named "items".
 * Uses `this.pool('items')` inside init() (same pattern as existing pool tests).
 */
async function setupPool(wildflower, testContainer, componentName = 'array-api-test') {
  testContainer.innerHTML = `
    <div data-component="${componentName}">
      <div data-pool="items">
        <template>
          <div class="item"><span data-bind="name"></span></div>
        </template>
      </div>
    </div>
  `

  let pool = null
  wildflower.component(componentName, {
    state: {},
    init() { pool = this.pool('items') }
  })
  ensureComponentScanning(wildflower)
  await waitForCompleteRender()

  const compEl = testContainer.querySelector(`[data-component="${componentName}"]`)
  const instance = getInstance(wildflower, compEl)

  return { instance, pool }
}

describeIfPools('Pool Array-like API', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    if (wildflower._contextRegistry) {
      wildflower._contextRegistry.contexts?.clear()
      wildflower._contextRegistry.contextsByType?.clear()
      wildflower._contextRegistry.contextsByComponent?.clear()
      wildflower._contextRegistry.dependencies?.clear()
      wildflower._contextRegistry._contextTypeCache?.clear()
      wildflower._contextRegistry._contextModificationCounter = 0
    }
    if (wildflower._listRelationships) {
      wildflower._listRelationships.clear()
    }

    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    testContainer.style.opacity = '0'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (wildflower._poolLoopRunning) {
      wildflower._poolLoopRunning = false
      if (wildflower._poolLoopId) {
        cancelAnimationFrame(wildflower._poolLoopId)
        wildflower._poolLoopId = null
      }
    }
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  // ==========================================================================
  // 1. length
  // ==========================================================================
  describe('length', () => {

    it('pool.length returns 0 for empty pool', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      expect(pool.length).toBe(0)
    })

    it('pool.length matches number of items after add', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.add({ id: 1, name: 'A' })
      pool.add({ id: 2, name: 'B' })
      expect(pool.length).toBe(2)
    })

    it('pool.length tracks push operations', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.push({ id: 1, name: 'A' })
      pool.push({ id: 2, name: 'B' })
      pool.push({ id: 3, name: 'C' })
      expect(pool.length).toBe(3)
    })

    it('pool.length decreases after remove', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.add({ id: 1, name: 'A' })
      pool.add({ id: 2, name: 'B' })
      pool.remove(1)
      expect(pool.length).toBe(1)
    })

    it('pool.length === pool.size (alias relationship)', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.add({ id: 1, name: 'A' })
      pool.add({ id: 2, name: 'B' })
      expect(pool.length).toBe(pool.size)
    })
  })

  // ==========================================================================
  // 2. push
  // ==========================================================================
  describe('push', () => {

    it('pool.push(obj) adds a single entity', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.push({ id: 1, name: 'A' })
      expect(pool.length).toBe(1)
      expect(pool.get(1)).toBeDefined()
      expect(pool.get(1).name).toBe('A')
    })

    it('pool.push(obj) behaves identically to pool.add(obj)', async () => {
      testContainer.innerHTML = `
        <div data-component="push-test-1">
          <div data-pool="items"><template><div class="item"></div></template></div>
        </div>
        <div data-component="push-test-2">
          <div data-pool="items"><template><div class="item"></div></template></div>
        </div>
      `

      let p1 = null, p2 = null
      wildflower.component('push-test-1', { state: {}, init() { p1 = this.pool('items') } })
      wildflower.component('push-test-2', { state: {}, init() { p2 = this.pool('items') } })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      p1.push({ id: 1, name: 'A' })
      p2.add({ id: 1, name: 'A' })

      expect(p1.length).toBe(p2.length)
      expect(p1.get(1).name).toBe(p2.get(1).name)
    })

    it('pool.push(array) adds multiple entities (matches add bulk behavior)', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.push([
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
        { id: 3, name: 'C' }
      ])
      expect(pool.length).toBe(3)
    })
  })

  // ==========================================================================
  // 3. Array readers (delegate to items)
  //
  // Pools expose only index-stable-safe methods. splice/pop/indexOf/slice
  // are intentionally absent — the items array reshuffles on every remove()
  // via swap-with-last, so any "remove at index i" operation would silently
  // target a different entity than the caller expected. Use remove(key)
  // instead, and at(i) for DOM-ordered positional access.
  // ==========================================================================
  describe('array readers', () => {

    it('pool.find() returns the first matching entity', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.add({ id: 1, name: 'apple' })
      pool.add({ id: 2, name: 'banana' })
      pool.add({ id: 3, name: 'cherry' })

      const found = pool.find(x => x.name === 'banana')
      expect(found).toBeDefined()
      expect(found.id).toBe(2)
    })

    it('pool.find() returns undefined if no match', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.add({ id: 1, name: 'apple' })
      expect(pool.find(x => x.name === 'zebra')).toBeUndefined()
    })

    it('pool.filter() returns an array of matching entities', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.add({ id: 1, name: 'A', active: true })
      pool.add({ id: 2, name: 'B', active: false })
      pool.add({ id: 3, name: 'C', active: true })

      const active = pool.filter(x => x.active)
      expect(Array.isArray(active)).toBe(true)
      expect(active.length).toBe(2)
      expect(active.every(x => x.active)).toBe(true)
    })

    it('pool.map() returns an array of transformed values', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.add({ id: 1, name: 'A' })
      pool.add({ id: 2, name: 'B' })

      const names = pool.map(x => x.name)
      expect(names).toEqual(expect.arrayContaining(['A', 'B']))
      expect(names.length).toBe(2)
    })

    it('pool.forEach() invokes callback for each entity', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.add({ id: 1, name: 'A' })
      pool.add({ id: 2, name: 'B' })
      pool.add({ id: 3, name: 'C' })

      const seen = []
      pool.forEach(x => seen.push(x.name))

      expect(seen.length).toBe(3)
      expect(seen).toEqual(expect.arrayContaining(['A', 'B', 'C']))
    })

    it('pool.some() returns true if any match', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.add({ id: 1, active: false })
      pool.add({ id: 2, active: true })
      expect(pool.some(x => x.active)).toBe(true)
      expect(pool.some(x => x.id > 100)).toBe(false)
    })

    it('pool.every() returns true only if all match', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.add({ id: 1, active: true })
      pool.add({ id: 2, active: true })
      expect(pool.every(x => x.active)).toBe(true)

      pool.add({ id: 3, active: false })
      expect(pool.every(x => x.active)).toBe(false)
    })

    it('pool.reduce() aggregates values', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.add({ id: 1, value: 10 })
      pool.add({ id: 2, value: 20 })
      pool.add({ id: 3, value: 30 })

      const sum = pool.reduce((acc, x) => acc + x.value, 0)
      expect(sum).toBe(60)
    })

  })

  // ==========================================================================
  // 5. Iteration
  // ==========================================================================
  describe('iteration', () => {

    it('for...of pool iterates all entities', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.add({ id: 1, name: 'A' })
      pool.add({ id: 2, name: 'B' })
      pool.add({ id: 3, name: 'C' })

      const names = []
      for (const item of pool) {
        names.push(item.name)
      }

      expect(names.length).toBe(3)
      expect(names).toEqual(expect.arrayContaining(['A', 'B', 'C']))
    })

    it('pool has Symbol.iterator', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      expect(typeof pool[Symbol.iterator]).toBe('function')
    })

    it('[...pool] spread produces an array of entities', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.add({ id: 1, name: 'A' })
      pool.add({ id: 2, name: 'B' })

      const arr = [...pool]
      expect(Array.isArray(arr)).toBe(true)
      expect(arr.length).toBe(2)
    })

    it('Array.from(pool) produces an array of entities', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.add({ id: 1, name: 'A' })
      pool.add({ id: 2, name: 'B' })

      const arr = Array.from(pool)
      expect(arr.length).toBe(2)
    })
  })

  // ==========================================================================
  // 6. Backward compatibility
  // ==========================================================================
  describe('backward compatibility', () => {

    it('existing pool.add() still works', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.add({ id: 1, name: 'A' })
      expect(pool.size).toBe(1)
      expect(pool.get(1)).toBeDefined()
    })

    it('existing pool.remove() still works', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.add({ id: 1, name: 'A' })
      pool.remove(1)
      expect(pool.size).toBe(0)
    })

    it('existing pool.items is still accessible', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.add({ id: 1, name: 'A' })
      expect(Array.isArray(pool.items)).toBe(true)
      expect(pool.items.length).toBe(1)
    })

    it('existing pool.clear() still works', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.add({ id: 1, name: 'A' })
      pool.add({ id: 2, name: 'B' })
      pool.clear()
      expect(pool.size).toBe(0)
    })

    it('existing pool.get() still works', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.add({ id: 42, name: 'X' })
      expect(pool.get(42).name).toBe('X')
    })

    it('push and add interoperate (same identity semantics)', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      pool.add({ id: 1, name: 'original' })
      // push with same id should be treated as duplicate (per existing add semantics)
      pool.push({ id: 1, name: 'duplicate' })
      expect(pool.size).toBe(1)
      expect(pool.get(1).name).toBe('original')
    })
  })

  // ==========================================================================
  // 7. DOM sync (mutations via new API still drive rendering)
  // ==========================================================================
  describe('DOM sync via array methods', () => {

    it('pool.push() renders a DOM element', async () => {
      const { instance, pool } = await setupPool(wildflower, testContainer)
      pool.push({ id: 1, name: 'Alpha' })
      await waitForCompleteRender()

      const poolEl = testContainer.querySelector('[data-pool="items"]')
      const items = poolEl.querySelectorAll('.item')
      expect(items.length).toBe(1)
    })

  })

  // ==========================================================================
  // 8. Negative — methods we deliberately don't expose
  //
  // Documented here so a future contributor restoring them must face the
  // rationale first. See PoolRenderer.js near the array-readers block.
  // ==========================================================================
  describe('index-unstable methods are not exposed', () => {
    it('pool does not expose splice / pop / indexOf / slice', async () => {
      const { pool } = await setupPool(wildflower, testContainer)
      expect(pool.splice).toBeUndefined()
      expect(pool.pop).toBeUndefined()
      expect(pool.indexOf).toBeUndefined()
      expect(pool.slice).toBeUndefined()
    })
  })
})
