/**
 * Pool Pipeline Optimizations — TDD Test Suite
 *
 * Tests for: entity recycling, data-based culling, O(1) removal, pool.update()
 * Written BEFORE implementation — all tests should fail initially.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForRAF() {
  await new Promise(resolve => requestAnimationFrame(() => {
    requestAnimationFrame(() => resolve())
  }))
  await new Promise(resolve => setTimeout(resolve, 10))
}

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

describe('Pool Pipeline Optimizations', () => {
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
    testContainer.style.position = 'fixed'
    testContainer.style.top = '0'
    testContainer.style.left = '0'
    testContainer.style.opacity = '0'
    testContainer.style.pointerEvents = 'none'
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
  // 1. pool.update() Convenience Method
  // =========================================================================
  describe('pool.update()', () => {

    it('pool.update() exists and is a function', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-upd-exists">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-upd-exists', {
        state: {},
        init() { pool = this.pool('items') }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()
      expect(typeof pool.update).toBe('function')
    })

    it('update() patches entity properties', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-upd-patch">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-upd-patch', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, name: 'Alpha', x: 0, y: 0 })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.update(1, { x: 100, y: 200 })
      expect(pool.items[0].x).toBe(100)
      expect(pool.items[0].y).toBe(200)
    })

    it('update() returns the entity object', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-upd-return">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-upd-return', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, name: 'A' })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const result = pool.update(1, { name: 'B' })
      expect(result).toBe(pool.items[0])
      expect(result.name).toBe('B')
    })

    it('update() returns null for nonexistent key', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-upd-null">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-upd-null', {
        state: {},
        init() { pool = this.pool('items') }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      expect(pool.update(999, { x: 1 })).toBeNull()
    })

    it('updated properties render on next rAF', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-upd-render">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-upd-render', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, name: 'Before' })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()
      await waitForRAF()

      const span = testContainer.querySelector('.item span')
      expect(span.textContent).toBe('Before')

      pool.update(1, { name: 'After' })
      await waitForRAF()
      expect(span.textContent).toBe('After')
    })

    it('update() preserves unmentioned properties', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-upd-preserve">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-upd-preserve', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, x: 10, y: 20, name: 'A' })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.update(1, { x: 99 })
      expect(pool.items[0].y).toBe(20)
      expect(pool.items[0].name).toBe('A')
    })

    it('update() works with expression bindings', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-upd-expr">
          <div data-pool="items" data-key="id">
            <template><div class="item" data-bind-style="{ left: x + 'px' }"></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-upd-expr', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, x: 0 })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()
      await waitForRAF()

      const el = testContainer.querySelector('.item')
      expect(el.style.left).toBe('0px')

      pool.update(1, { x: 150 })
      await waitForRAF()
      expect(el.style.left).toBe('150px')
    })

    it('multiple updates between frames are batched', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-upd-batch">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-upd-batch', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, name: 'A' })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()
      await waitForRAF()

      pool.update(1, { name: 'B' })
      pool.update(1, { name: 'C' })
      await waitForRAF()
      expect(testContainer.querySelector('.item span').textContent).toBe('C')
    })
  })

  // =========================================================================
  // 2. O(1) Removal
  // =========================================================================
  describe('O(1) Removal', () => {

    it('remove() from middle leaves correct pool.size', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-o1-size">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-o1-size', {
        state: {},
        init() {
          pool = this.pool('items')
          for (let i = 1; i <= 5; i++) pool.add({ id: i, name: `E${i}` })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.remove(3)
      expect(pool.size).toBe(4)
      expect(pool.items.length).toBe(4)
    })

    it('all remaining entities still renderable after middle removal', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-o1-render">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-o1-render', {
        state: {},
        init() {
          pool = this.pool('items')
          for (let i = 1; i <= 5; i++) pool.add({ id: i, name: `E${i}` })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.remove(3)
      await waitForRAF()

      const items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(4)
      const texts = Array.from(items).map(el => el.querySelector('span').textContent).sort()
      expect(texts).toEqual(['E1', 'E2', 'E4', 'E5'])
    })

    it('remove last entity works correctly', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-o1-last">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-o1-last', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, name: 'A' })
          pool.add({ id: 2, name: 'B' })
          pool.add({ id: 3, name: 'C' })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.remove(3)
      expect(pool.size).toBe(2)
      await waitForRAF()
      const texts = Array.from(testContainer.querySelectorAll('.item span')).map(s => s.textContent).sort()
      expect(texts).toEqual(['A', 'B'])
    })

    it('remove first entity works correctly', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-o1-first">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-o1-first', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, name: 'A' })
          pool.add({ id: 2, name: 'B' })
          pool.add({ id: 3, name: 'C' })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.remove(1)
      expect(pool.size).toBe(2)
      await waitForRAF()
      const texts = Array.from(testContainer.querySelectorAll('.item span')).map(s => s.textContent).sort()
      expect(texts).toEqual(['B', 'C'])
    })

    it('remove only entity works correctly', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-o1-only">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-o1-only', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, name: 'A' })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.remove(1)
      expect(pool.size).toBe(0)
      expect(pool.items.length).toBe(0)
    })

    it('add after remove from middle works', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-o1-addafter">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-o1-addafter', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, name: 'A' })
          pool.add({ id: 2, name: 'B' })
          pool.add({ id: 3, name: 'C' })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.remove(2)
      pool.add({ id: 4, name: 'D' })
      expect(pool.size).toBe(3)
      await waitForRAF()
      const texts = Array.from(testContainer.querySelectorAll('.item span')).map(s => s.textContent).sort()
      expect(texts).toEqual(['A', 'C', 'D'])
    })

    it('sequential removes work correctly', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-o1-seq">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-o1-seq', {
        state: {},
        init() {
          pool = this.pool('items')
          for (let i = 1; i <= 5; i++) pool.add({ id: i, name: `E${i}` })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.remove(3)
      pool.remove(2)
      pool.remove(5)
      expect(pool.size).toBe(2)
      await waitForRAF()
      const names = pool.items.map(i => i.name).sort()
      expect(names).toEqual(['E1', 'E4'])
    })

    it('getElement() still works for remaining entities after removal', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-o1-getel">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-o1-getel', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, name: 'A' })
          pool.add({ id: 2, name: 'B' })
          pool.add({ id: 3, name: 'C' })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.remove(2)
      expect(pool.getElement(1)).toBeDefined()
      expect(pool.getElement(3)).toBeDefined()
      expect(pool.getElement(2)).toBeUndefined()
    })

    it('remove + add interleaved stress test', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-o1-stress">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-o1-stress', {
        state: {},
        init() {
          pool = this.pool('items')
          for (let i = 1; i <= 20; i++) pool.add({ id: i, name: `E${i}` })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      // Remove evens
      for (let i = 2; i <= 20; i += 2) pool.remove(i)
      expect(pool.size).toBe(10)

      // Add 10 more
      for (let i = 21; i <= 30; i++) pool.add({ id: i, name: `E${i}` })
      expect(pool.size).toBe(20)

      // Remove some odds from originals
      pool.remove(1)
      pool.remove(5)
      pool.remove(9)
      expect(pool.size).toBe(17)

      await waitForRAF()
      const items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(17)
    })

    it('items array contains all remaining entities after removals', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-o1-items">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-o1-items', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, name: 'A' })
          pool.add({ id: 2, name: 'B' })
          pool.add({ id: 3, name: 'C' })
          pool.add({ id: 4, name: 'D' })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.remove(2)
      pool.remove(3)
      const ids = pool.items.map(i => i.id).sort((a, b) => a - b)
      expect(ids).toEqual([1, 4])
    })
  })

  // =========================================================================
  // 3. Entity Recycling
  // =========================================================================
  describe('Entity Recycling', () => {

    it('pool.recycleSize is 0 initially', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-rec-init">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-rec-init', {
        state: {},
        init() { pool = this.pool('items') }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()
      expect(pool.recycleSize).toBe(0)
    })

    it('remove() populates the free list', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-rec-pop">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-rec-pop', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, name: 'A' })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.remove(1)
      expect(pool.recycleSize).toBe(1)
    })

    it('add() after remove() reuses recycled DOM node', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-rec-reuse">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-rec-reuse', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, name: 'Alpha' })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const origEl = pool.getElement(1)
      pool.remove(1)
      pool.add({ id: 2, name: 'Beta' })
      const newEl = pool.getElement(2)
      expect(newEl).toBe(origEl) // Same DOM node reused
    })

    it('recycled entity renders new data correctly', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-rec-data">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-rec-data', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, name: 'Alpha' })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()
      await waitForRAF()

      pool.remove(1)
      pool.add({ id: 2, name: 'Beta' })
      await waitForRAF()
      expect(testContainer.querySelector('.item span').textContent).toBe('Beta')
    })

    it('recycled entity clears stale binding cache', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-rec-cache">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-rec-cache', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, name: 'Same' })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()
      await waitForRAF()

      // _poolPrevRaw is now 'Same'
      pool.remove(1)
      // Recycled element's cache should be cleared
      pool.add({ id: 2, name: 'Same' })
      await waitForRAF()
      // Must render 'Same' even though the prev value was also 'Same'
      // (if cache wasn't cleared, textContent might be empty)
      expect(testContainer.querySelector('.item span').textContent).toBe('Same')
    })

    it('add() clones template when free list is empty', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-rec-clone">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-rec-clone', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, name: 'A' })
          pool.add({ id: 2, name: 'B' })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      expect(pool.recycleSize).toBe(0)
      pool.add({ id: 3, name: 'C' })
      expect(pool.size).toBe(3)
      const items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(3)
    })

    it('free list respects maximum size', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-rec-cap">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-rec-cap', {
        state: {},
        init() {
          pool = this.pool('items')
          for (let i = 1; i <= 150; i++) pool.add({ id: i, name: `E${i}` })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      // Remove all 150
      for (let i = 1; i <= 150; i++) pool.remove(i)
      expect(pool.recycleSize).toBeLessThanOrEqual(100)
    })

    it('clear() populates the free list', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-rec-clear">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-rec-clear', {
        state: {},
        init() {
          pool = this.pool('items')
          for (let i = 1; i <= 5; i++) pool.add({ id: i, name: `E${i}` })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.clear()
      expect(pool.recycleSize).toBe(5)
    })

    it('clear() caps free list at max size', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-rec-clearcap">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-rec-clearcap', {
        state: {},
        init() {
          pool = this.pool('items')
          for (let i = 1; i <= 150; i++) pool.add({ id: i, name: `E${i}` })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.clear()
      expect(pool.recycleSize).toBeLessThanOrEqual(100)
    })

    it('recycled DOM node is detached during free list residence', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-rec-detach">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-rec-detach', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, name: 'A' })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const el = pool.getElement(1)
      pool.remove(1)
      expect(el.parentNode).toBeNull()
    })

    it('multiple recycle cycles work correctly', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-rec-multi">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-rec-multi', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, name: 'A' })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const origEl = pool.getElement(1)
      pool.remove(1)
      pool.add({ id: 2, name: 'B' })
      expect(pool.getElement(2)).toBe(origEl)
      pool.remove(2)
      pool.add({ id: 3, name: 'C' })
      expect(pool.getElement(3)).toBe(origEl)
      await waitForRAF()
      expect(testContainer.querySelector('.item span').textContent).toBe('C')
    })

    it('pool.items array is correct after recycled add', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-rec-items">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-rec-items', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, name: 'A' })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.remove(1)
      pool.add({ id: 2, name: 'B' })
      expect(pool.items.length).toBe(1)
      expect(pool.items[0].id).toBe(2)
    })

    it('pool.size is correct through recycle cycles', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-rec-size">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-rec-size', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, name: 'A' })
          pool.add({ id: 2, name: 'B' })
          pool.add({ id: 3, name: 'C' })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.remove(2)
      expect(pool.size).toBe(2)
      expect(pool.recycleSize).toBe(1)

      pool.add({ id: 4, name: 'D' })
      expect(pool.size).toBe(3)
      expect(pool.recycleSize).toBe(0)
    })

    it.skipIf(isMinifiedBuild())('recycled entity has correct _poolItem reference', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-rec-ref">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-rec-ref', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, name: 'Old' })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const el = pool.getElement(1)
      pool.remove(1)
      const newObj = { id: 2, name: 'New' }
      pool.add(newObj)
      expect(el._poolItem).toBe(newObj)
    })

    it('_destroy() clears the free list', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-rec-destroy">
          <div data-pool="items" data-key="id">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `
      let pool, instance
      wildflower.component('pp-rec-destroy', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, name: 'A' })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.remove(1)
      expect(pool.recycleSize).toBe(1)

      // Trigger destroy by removing the component from DOM
      const compEl = testContainer.querySelector('[data-component]')
      instance = getInstance(wildflower, compEl)
      compEl.remove()
      await waitForUpdate(100)

      // After destroy, the pool should be cleaned up
      expect(pool._freeList === null || pool._freeList === undefined || pool._freeList.length === 0).toBe(true)
    })
  })

  // =========================================================================
  // 4. Data-Based Culling
  // =========================================================================
  describe('Data-Based Culling (data-pool-cull-props)', () => {

    it('data-pool-cull-props enables data-based culling', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-cull-basic" style="width:400px;height:300px;position:relative;overflow:hidden;">
          <div data-pool="items" data-key="id" data-pool-cull="50" data-pool-cull-props="x,y">
            <template><div class="item" data-bind-style="{ position: 'absolute', left: x + 'px', top: y + 'px', width: '20px', height: '20px' }"></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-cull-basic', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, x: 100, y: 100 }) // inside
          pool.add({ id: 2, x: 9000, y: 9000 }) // far outside
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()
      await waitForRAF()
      await waitForRAF()

      const el1 = pool.getElement(1)
      const el2 = pool.getElement(2)
      expect(el1.style.display).not.toBe('none')
      expect(el2.style.display).toBe('none')
    })

    it('entity outside container is culled using data properties', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-cull-outside" style="width:400px;height:300px;position:relative;overflow:hidden;">
          <div data-pool="items" data-key="id" data-pool-cull="0" data-pool-cull-props="x,y">
            <template><div class="item" data-bind-style="{ position: 'absolute', left: x + 'px', top: y + 'px', width: '10px', height: '10px' }"></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-cull-outside', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, x: -500, y: -500 })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()
      await waitForRAF()
      await waitForRAF()

      expect(pool.getElement(1).style.display).toBe('none')
    })

    it('entity inside container is visible using data properties', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-cull-inside" style="width:400px;height:300px;position:relative;overflow:hidden;">
          <div data-pool="items" data-key="id" data-pool-cull="0" data-pool-cull-props="x,y">
            <template><div class="item" data-bind-style="{ position: 'absolute', left: x + 'px', top: y + 'px', width: '10px', height: '10px' }"></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-cull-inside', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, x: 50, y: 50 })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()
      await waitForRAF()
      await waitForRAF()

      expect(pool.getElement(1).style.display).not.toBe('none')
    })

    it('entity moving into viewport becomes visible', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-cull-move" style="width:400px;height:300px;position:relative;overflow:hidden;">
          <div data-pool="items" data-key="id" data-pool-cull="0" data-pool-cull-props="x,y">
            <template><div class="item" data-bind-style="{ position: 'absolute', left: x + 'px', top: y + 'px', width: '10px', height: '10px' }"></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-cull-move', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, x: 9000, y: 9000 })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()
      await waitForRAF()
      await waitForRAF()

      expect(pool.getElement(1).style.display).toBe('none')

      // Move into view
      pool.items[0].x = 50
      pool.items[0].y = 50
      await waitForRAF()
      await waitForRAF()

      expect(pool.getElement(1).style.display).not.toBe('none')
    })

    it('custom w,h properties override default size', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-cull-wh" style="width:400px;height:300px;position:relative;overflow:hidden;">
          <div data-pool="items" data-key="id" data-pool-cull="0" data-pool-cull-props="x,y,w,h">
            <template><div class="item" data-bind-style="{ position: 'absolute', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' }"></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-cull-wh', {
        state: {},
        init() {
          pool = this.pool('items')
          // Entity at x:380 with w:100 — overlaps container right edge, should be visible
          pool.add({ id: 1, x: 380, y: 100, w: 100, h: 100 })
          // Entity at x:600 with w:10 — fully outside
          pool.add({ id: 2, x: 600, y: 100, w: 10, h: 10 })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()
      await waitForRAF()
      await waitForRAF()

      expect(pool.getElement(1).style.display).not.toBe('none')
      expect(pool.getElement(2).style.display).toBe('none')
    })

    it('culling padding is respected with data-based culling', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-cull-pad" style="width:400px;height:300px;position:relative;overflow:hidden;">
          <div data-pool="items" data-key="id" data-pool-cull="100" data-pool-cull-props="x,y">
            <template><div class="item" data-bind-style="{ position: 'absolute', left: x + 'px', top: y + 'px', width: '10px', height: '10px' }"></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-cull-pad', {
        state: {},
        init() {
          pool = this.pool('items')
          // Within 100px padding of container edge — should be visible
          pool.add({ id: 1, x: -50, y: 100 })
          // Beyond 100px padding — should be culled
          pool.add({ id: 2, x: -500, y: 100 })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()
      await waitForRAF()
      await waitForRAF()

      expect(pool.getElement(1).style.display).not.toBe('none')
      expect(pool.getElement(2).style.display).toBe('none')
    })

    it('falls back to getBoundingClientRect when cull-props not set', async () => {
      // This test verifies backward compatibility — data-pool-cull without cull-props
      // should use the existing getBoundingClientRect path
      testContainer.innerHTML = `
        <div data-component="pp-cull-fallback" style="width:400px;height:300px;position:relative;overflow:hidden;">
          <div data-pool="items" data-key="id" data-pool-cull="50">
            <template><div class="item" style="position:absolute;width:10px;height:10px;" data-bind-style="{ left: x + 'px', top: y + 'px' }"></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-cull-fallback', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, x: 50, y: 50 })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()
      await waitForRAF()
      await waitForRAF()

      // Should still work via getBoundingClientRect
      expect(pool.getElement(1).style.display).not.toBe('none')
    })

    it('no culling when neither data-pool-cull nor cull-props set', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-cull-none" style="width:400px;height:300px;position:relative;overflow:hidden;">
          <div data-pool="items" data-key="id">
            <template><div class="item" data-bind-style="{ position: 'absolute', left: x + 'px', top: y + 'px', width: '10px', height: '10px' }"></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-cull-none', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, x: 9000, y: 9000 })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()
      await waitForRAF()
      await waitForRAF()

      // No culling — display should not be set to none
      expect(pool.getElement(1).style.display).not.toBe('none')
    })

    it('data-pool-cull-props with custom property names', async () => {
      testContainer.innerHTML = `
        <div data-component="pp-cull-custom" style="width:400px;height:300px;position:relative;overflow:hidden;">
          <div data-pool="items" data-key="id" data-pool-cull="0" data-pool-cull-props="posX,posY">
            <template><div class="item" data-bind-style="{ position: 'absolute', left: posX + 'px', top: posY + 'px', width: '10px', height: '10px' }"></div></template>
          </div>
        </div>
      `
      let pool
      wildflower.component('pp-cull-custom', {
        state: {},
        init() {
          pool = this.pool('items')
          pool.add({ id: 1, posX: 100, posY: 100 })
          pool.add({ id: 2, posX: 9000, posY: 9000 })
        }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()
      await waitForRAF()
      await waitForRAF()

      expect(pool.getElement(1).style.display).not.toBe('none')
      expect(pool.getElement(2).style.display).toBe('none')
    })
  })
})
