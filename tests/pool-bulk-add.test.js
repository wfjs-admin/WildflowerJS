/**
 * WildflowerJS Pool Bulk Add Tests - Vitest Browser Mode
 *
 * Tests for pool.add(array) — bulk add via DocumentFragment for
 * single-operation DOM insertion of multiple items.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

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

describeIfPools('Pool Bulk Add', () => {
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

  // =========================================================================
  // 1. Basic Bulk Add
  // =========================================================================
  describe('Basic Bulk Add', () => {

    it('add(array) renders all items', async () => {
      testContainer.innerHTML = `
        <div data-component="bulk-basic-test">
          <div data-pool="items" data-key="id">
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('bulk-basic-test', {
        state: {},
        pools: { items: {} },
        init() {
          this.pools.items.add([
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
            { id: 3, name: 'Carol' }
          ])
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(3)
      expect(items[0].querySelector('span').textContent).toBe('Alice')
      expect(items[1].querySelector('span').textContent).toBe('Bob')
      expect(items[2].querySelector('span').textContent).toBe('Carol')
    })

    it('add(array) updates pool size correctly', async () => {
      testContainer.innerHTML = `
        <div data-component="bulk-size-test">
          <div data-pool="items" data-key="id">
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('bulk-size-test', {
        state: {},
        pools: { items: {} },
        init() {
          this.pools.items.add([
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' }
          ])
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const instance = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      expect(instance.pools.items.size).toBe(2)
      expect(instance.pools.items.items.length).toBe(2)
    })

    it('add(array) applies data-bind-class expressions', async () => {
      testContainer.innerHTML = `
        <div data-component="bulk-class-test">
          <div data-pool="items" data-key="id">
            <template>
              <div class="item">
                <span data-bind="status"
                      data-bind-class="status === 'active' ? 'badge active' : 'badge inactive'"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('bulk-class-test', {
        state: {},
        pools: { items: {} },
        init() {
          this.pools.items.add([
            { id: 1, status: 'active' },
            { id: 2, status: 'inactive' }
          ])
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const spans = testContainer.querySelectorAll('.item span')
      expect(spans[0].className).toContain('active')
      expect(spans[1].className).toContain('inactive')
    })

    it('add(array) with empty array is a no-op', async () => {
      testContainer.innerHTML = `
        <div data-component="bulk-empty-test">
          <div data-pool="items" data-key="id">
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('bulk-empty-test', {
        state: {},
        pools: { items: {} },
        init() {
          this.pools.items.add([])
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(0)
    })
  })

  // =========================================================================
  // 2. Bulk Add + Single Add Interop
  // =========================================================================
  describe('Interop with Single Add', () => {

    it('single add() still works after bulk add()', async () => {
      testContainer.innerHTML = `
        <div data-component="bulk-then-single-test">
          <div data-pool="items" data-key="id">
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('bulk-then-single-test', {
        state: {},
        pools: { items: {} },
        init() {
          this.pools.items.add([
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' }
          ])
          this.pools.items.add({ id: 3, name: 'Carol' })
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(3)
      expect(items[2].querySelector('span').textContent).toBe('Carol')
    })

    it('bulk add() after single add() appends correctly', async () => {
      testContainer.innerHTML = `
        <div data-component="single-then-bulk-test">
          <div data-pool="items" data-key="id">
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('single-then-bulk-test', {
        state: {},
        pools: { items: {} },
        init() {
          this.pools.items.add({ id: 1, name: 'Alice' })
          this.pools.items.add([
            { id: 2, name: 'Bob' },
            { id: 3, name: 'Carol' }
          ])
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(3)
      expect(instance => instance.pools.items.size).toBeTruthy()
    })
  })

  // =========================================================================
  // 3. Bulk Add with Static Pools
  // =========================================================================
  describe('Bulk Add + Static Pool', () => {

    it('bulk add() works with data-pool-static', async () => {
      testContainer.innerHTML = `
        <div data-component="bulk-static-test">
          <div data-pool="items" data-key="id" data-pool-static>
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('bulk-static-test', {
        state: {},
        pools: { items: {} },
        init() {
          this.pools.items.add([
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
            { id: 3, name: 'Carol' }
          ])
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(3)
      expect(items[0].querySelector('span').textContent).toBe('Alice')
      expect(items[1].querySelector('span').textContent).toBe('Bob')
      expect(items[2].querySelector('span').textContent).toBe('Carol')
    })
  })

  // =========================================================================
  // 4. Bulk Add with Lifecycle Hooks
  // =========================================================================
  describe('Lifecycle Hooks', () => {

    it('onAdd fires for each item in bulk add', async () => {
      const addedItems = []

      testContainer.innerHTML = `
        <div data-component="bulk-hook-test">
          <div data-pool="items" data-key="id">
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('bulk-hook-test', {
        state: {},
        pools: {
          items: {
            onAdd: 'onItemAdded'
          }
        },
        onItemAdded(item) {
          addedItems.push(item.name)
        },
        init() {
          this.pools.items.add([
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
            { id: 3, name: 'Carol' }
          ])
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      expect(addedItems).toEqual(['Alice', 'Bob', 'Carol'])
    })
  })

  // =========================================================================
  // 5. Bulk Add Skips Duplicates
  // =========================================================================
  describe('Duplicate Handling', () => {

    it('bulk add skips items with duplicate keys', async () => {
      testContainer.innerHTML = `
        <div data-component="bulk-dup-test">
          <div data-pool="items" data-key="id">
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('bulk-dup-test', {
        state: {},
        pools: { items: {} },
        init() {
          this.pools.items.add({ id: 1, name: 'Alice' })
          this.pools.items.add([
            { id: 1, name: 'Alice Duplicate' },
            { id: 2, name: 'Bob' }
          ])
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(2)
      expect(items[0].querySelector('span').textContent).toBe('Alice')
      expect(items[1].querySelector('span').textContent).toBe('Bob')
    })
  })

  describe('Bulk remove timing — O(n) on full clear', () => {
    it('removing 1000 entities in sequence stays linear (no O(n²) sub-array indexOf)', async () => {
      // Regression: pool sub-array tracking used Array.prototype.indexOf
      // for removal even though the main pool used O(1) swap-with-last.
      // At 800+ entities the quadratic cleanup was visibly slow. Now uses
      // a stored subIdx for constant-time removal.
      //
      // Sanity-bounded timing test: 1000 sequential removes should
      // complete in well under a second on any non-pathological build.
      // The bug shape produced ~6+ seconds at 1000 on baseline machines.
      testContainer.innerHTML = `
        <div data-component="bulk-remove-timing">
          <div data-pool="items" data-key="id">
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('bulk-remove-timing', {
        state: {},
        init() { pool = this.pool('items') }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const N = 1000
      const items = new Array(N)
      for (let i = 0; i < N; i++) items[i] = { id: i, name: 'n' + i }
      pool.add(items)
      expect(pool.size).toBe(N)

      const start = performance.now()
      for (let i = 0; i < N; i++) pool.remove(i)
      const elapsed = performance.now() - start

      expect(pool.size).toBe(0)
      // Generous bound: 1000ms. Sub-array indexOf bug produced 6000+.
      // Linear behavior typically lands well under 250ms.
      expect(elapsed).toBeLessThan(1000)
    })
  })
})
