/**
 * WildflowerJS Data-Pool Test Suite - Vitest Browser Mode
 *
 * Tests for data-pool entity pool rendering functionality.
 * data-pool is a high-performance renderer for plain objects (no reactive proxy),
 * using pre-compiled evaluators and a shared rAF loop.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

// Helper to wait for framework processing (component init, DOM scanning)
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to wait for at least one rAF flush
async function waitForRAF() {
  await new Promise(resolve => requestAnimationFrame(() => {
    // Wait one more frame to ensure the pool flush has applied
    requestAnimationFrame(() => resolve())
  }))
  // Small buffer for any remaining async work
  await new Promise(resolve => setTimeout(resolve, 10))
}

// Helper to wait for complete render cycle
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

// Get the component instance from a data-component element
function getInstance(wildflower, el) {
  const compEl = el.closest ? el.closest('[data-component]') : el.querySelector('[data-component]')
  const target = compEl || el
  return wildflower.componentInstances.get(target.dataset.componentId)
}

describe('Data-Pool Entity Pool Rendering', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    // Clear the context registry to prevent cross-test contamination
    if (wildflower._contextRegistry) {
      wildflower._contextRegistry.contexts?.clear()
      wildflower._contextRegistry.contextsByType?.clear()
      wildflower._contextRegistry.contextsByComponent?.clear()
      wildflower._contextRegistry.dependencies?.clear()
      wildflower._contextRegistry._contextTypeCache?.clear()
      wildflower._contextRegistry._contextModificationCounter = 0
    }

    // Clear list relationships
    if (wildflower._listRelationships) {
      wildflower._listRelationships.clear()
    }

    // Create test container (offscreen to avoid layout noise)
    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    testContainer.style.opacity = '0'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    // Stop any running pool loops
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
  // 1. Basic Pool Operations
  // =========================================================================
  describe('Basic Pool Operations', () => {

    it.skipIf(isMinifiedBuild())('pool container detected and initialized from data-pool attribute', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-init-test">
          <div data-pool="enemies">
            <template>
              <div class="enemy"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('pool-init-test', {
        state: {}
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const compEl = testContainer.querySelector('[data-component="pool-init-test"]')
      const instance = getInstance(wildflower, compEl)
      expect(instance).toBeDefined()
      expect(instance._pools).toBeDefined()
      expect(instance._pools.size).toBe(1)
      expect(instance._pools.has('enemies')).toBe(true)
    })

    it('this.pool("name") returns a PoolHandle', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-handle-test">
          <div data-pool="units">
            <template>
              <div><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let poolHandle = null
      wildflower.component('pool-handle-test', {
        state: {},
        init() {
          poolHandle = this.pool('units')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      expect(poolHandle).not.toBeNull()
      expect(poolHandle.name).toBe('units')
      expect(typeof poolHandle.add).toBe('function')
      expect(typeof poolHandle.remove).toBe('function')
      expect(typeof poolHandle.clear).toBe('function')
      expect(typeof poolHandle.getElement).toBe('function')
    })

    it('this.pool("nonexistent") returns null', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-null-test">
          <div data-pool="items">
            <template>
              <div><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let result = 'not-set'
      wildflower.component('pool-null-test', {
        state: {},
        init() {
          result = this.pool('nonexistent')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      expect(result).toBeNull()
    })

    it('add() creates DOM element from template', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-add-test">
          <div class="pool-container" data-pool="bullets">
            <template>
              <div class="bullet"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-add-test', {
        state: {},
        init() {
          pool = this.pool('bullets')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.add({ id: 1, name: 'Bullet A' })
      await waitForRAF()

      const container = testContainer.querySelector('.pool-container')
      const items = container.querySelectorAll('.bullet')
      expect(items.length).toBe(1)
    })

    it.skipIf(isMinifiedBuild())('add() with duplicate key warns and ignores', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-dup-test">
          <div class="pool-container" data-pool="entities">
            <template>
              <div class="entity"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-dup-test', {
        state: {},
        init() {
          pool = this.pool('entities')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      pool.add({ id: 1, name: 'First' })
      pool.add({ id: 1, name: 'Duplicate' })

      expect(pool.size).toBe(1)
      expect(pool.items.length).toBe(1)
      expect(pool.items[0].name).toBe('First')

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Duplicate key'))

      warnSpy.mockRestore()
    })

    it.skipIf(isMinifiedBuild())('add() with missing key property warns', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-nokey-test">
          <div data-pool="things">
            <template>
              <div><span data-bind="label"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-nokey-test', {
        state: {},
        init() {
          pool = this.pool('things')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Object has no 'id' property (the default key)
      pool.add({ label: 'No ID' })

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing key property'))

      warnSpy.mockRestore()
    })

    it('remove() removes DOM element', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-remove-test">
          <div class="pool-container" data-pool="items">
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-remove-test', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.add({ id: 1, name: 'A' })
      pool.add({ id: 2, name: 'B' })
      await waitForRAF()

      const container = testContainer.querySelector('.pool-container')
      expect(container.querySelectorAll('.item').length).toBe(2)

      const result = pool.remove(1)
      expect(result).toBe(true)
      expect(container.querySelectorAll('.item').length).toBe(1)
      expect(pool.size).toBe(1)
    })

    it('remove() returns false for nonexistent key', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-remove-false-test">
          <div data-pool="items">
            <template>
              <div><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-remove-false-test', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.add({ id: 1, name: 'A' })
      const result = pool.remove(999)
      expect(result).toBe(false)
      expect(pool.size).toBe(1)
    })

    it('clear() removes all DOM elements', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-clear-test">
          <div class="pool-container" data-pool="items">
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-clear-test', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.add({ id: 1, name: 'A' })
      pool.add({ id: 2, name: 'B' })
      pool.add({ id: 3, name: 'C' })
      await waitForRAF()

      const container = testContainer.querySelector('.pool-container')
      expect(container.querySelectorAll('.item').length).toBe(3)

      pool.clear()
      expect(container.querySelectorAll('.item').length).toBe(0)
      expect(pool.size).toBe(0)
      expect(pool.items.length).toBe(0)
    })

    it('pool.size reflects current count', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-size-test">
          <div data-pool="items">
            <template>
              <div><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-size-test', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      expect(pool.size).toBe(0)

      pool.add({ id: 1, name: 'A' })
      expect(pool.size).toBe(1)

      pool.add({ id: 2, name: 'B' })
      expect(pool.size).toBe(2)

      pool.remove(1)
      expect(pool.size).toBe(1)

      pool.clear()
      expect(pool.size).toBe(0)
    })

    it('pool.items is the raw array', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-items-test">
          <div data-pool="items">
            <template>
              <div><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-items-test', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      expect(Array.isArray(pool.items)).toBe(true)
      expect(pool.items.length).toBe(0)

      const obj = { id: 1, name: 'Test' }
      pool.add(obj)

      expect(pool.items.length).toBe(1)
      expect(pool.items[0]).toBe(obj) // Same reference, not proxied
    })
  })

  // =========================================================================
  // 2. Template Binding
  // =========================================================================
  describe('Template Binding', () => {

    it('data-bind text content updates on rAF', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-bind-text">
          <div class="pool-container" data-pool="items">
            <template>
              <div class="item">
                <span class="name" data-bind="name"></span>
                <span class="score" data-bind="score"></span>
              </div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-bind-text', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const entity = { id: 1, name: 'Hero', score: 100 }
      pool.add(entity)
      await waitForRAF()

      const container = testContainer.querySelector('.pool-container')
      const item = container.querySelector('.item')
      expect(item.querySelector('.name').textContent).toBe('Hero')
      expect(item.querySelector('.score').textContent).toBe('100')

      // Mutate the plain object directly
      entity.name = 'Champion'
      entity.score = 250

      // After next rAF flush, DOM should reflect updated values
      await waitForRAF()
      expect(item.querySelector('.name').textContent).toBe('Champion')
      expect(item.querySelector('.score').textContent).toBe('250')
    })

    it('data-show toggles visibility', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-show-test">
          <div class="pool-container" data-pool="items">
            <template>
              <div class="item">
                <span class="label" data-bind="label"></span>
                <span class="badge" data-show="active">Active</span>
              </div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-show-test', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const entity = { id: 1, label: 'Item 1', active: true }
      pool.add(entity)
      await waitForRAF()

      const badge = testContainer.querySelector('.badge')
      // data-show=true should be visible
      expect(badge.style.display).not.toBe('none')

      // Toggle off
      entity.active = false
      await waitForRAF()
      expect(badge.style.display).toBe('none')

      // Toggle on
      entity.active = true
      await waitForRAF()
      expect(badge.style.display).not.toBe('none')
    })

    it('multiple bindings in same template work', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-multi-bind">
          <div class="pool-container" data-pool="players">
            <template>
              <div class="player">
                <span class="name" data-bind="name"></span>
                <span class="hp" data-bind="hp"></span>
                <span class="level" data-bind="level"></span>
              </div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-multi-bind', {
        state: {},
        init() {
          pool = this.pool('players')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.add({ id: 'p1', name: 'Archer', hp: 80, level: 5 })
      pool.add({ id: 'p2', name: 'Mage', hp: 50, level: 8 })
      await waitForRAF()

      const players = testContainer.querySelectorAll('.player')
      expect(players.length).toBe(2)

      expect(players[0].querySelector('.name').textContent).toBe('Archer')
      expect(players[0].querySelector('.hp').textContent).toBe('80')
      expect(players[0].querySelector('.level').textContent).toBe('5')

      expect(players[1].querySelector('.name').textContent).toBe('Mage')
      expect(players[1].querySelector('.hp').textContent).toBe('50')
      expect(players[1].querySelector('.level').textContent).toBe('8')
    })
  })

  // =========================================================================
  // 3. rAF Flush Behavior
  // =========================================================================
  describe('rAF Flush Behavior', () => {

    it('DOM not updated synchronously on property mutation', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-sync-test">
          <div class="pool-container" data-pool="items">
            <template>
              <div class="item"><span class="val" data-bind="value"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-sync-test', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const entity = { id: 1, value: 'initial' }
      pool.add(entity)
      await waitForRAF()

      const span = testContainer.querySelector('.val')
      expect(span.textContent).toBe('initial')

      // Mutate synchronously — DOM should NOT update immediately
      entity.value = 'changed'
      // Check immediately (same microtask) — should still be old value
      expect(span.textContent).toBe('initial')

      // After rAF flush, value updates
      await waitForRAF()
      expect(span.textContent).toBe('changed')
    })

    it('multiple property changes flushed in single frame', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-batch-test">
          <div class="pool-container" data-pool="items">
            <template>
              <div class="item">
                <span class="a" data-bind="a"></span>
                <span class="b" data-bind="b"></span>
                <span class="c" data-bind="c"></span>
              </div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-batch-test', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const entity = { id: 1, a: '1', b: '2', c: '3' }
      pool.add(entity)
      await waitForRAF()

      // Change all three properties in the same synchronous block
      entity.a = 'X'
      entity.b = 'Y'
      entity.c = 'Z'

      // None updated yet
      expect(testContainer.querySelector('.a').textContent).toBe('1')

      // All updated in one rAF
      await waitForRAF()
      expect(testContainer.querySelector('.a').textContent).toBe('X')
      expect(testContainer.querySelector('.b').textContent).toBe('Y')
      expect(testContainer.querySelector('.c').textContent).toBe('Z')
    })
  })

  // =========================================================================
  // 4. Structural Operations
  // =========================================================================
  describe('Structural Operations', () => {

    it('adding multiple entities in sequence', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-multi-add">
          <div class="pool-container" data-pool="items">
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-multi-add', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.add({ id: 1, name: 'First' })
      pool.add({ id: 2, name: 'Second' })
      pool.add({ id: 3, name: 'Third' })
      await waitForRAF()

      const container = testContainer.querySelector('.pool-container')
      const items = container.querySelectorAll('.item')
      expect(items.length).toBe(3)
      expect(pool.size).toBe(3)
      expect(pool.items.length).toBe(3)
    })

    it('removing from middle of pool', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-remove-mid">
          <div class="pool-container" data-pool="items">
            <template>
              <div class="item"><span class="name" data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-remove-mid', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.add({ id: 1, name: 'A' })
      pool.add({ id: 2, name: 'B' })
      pool.add({ id: 3, name: 'C' })
      await waitForRAF()

      // Remove middle element
      pool.remove(2)
      await waitForRAF()

      const container = testContainer.querySelector('.pool-container')
      const items = container.querySelectorAll('.item')
      expect(items.length).toBe(2)
      expect(pool.size).toBe(2)

      // Remaining items: A and C
      const names = Array.from(items).map(el => el.querySelector('.name').textContent)
      expect(names).toEqual(['A', 'C'])
    })

    it('add() after remove() reuses no stale references', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-reuse-test">
          <div class="pool-container" data-pool="items">
            <template>
              <div class="item"><span class="name" data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-reuse-test', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.add({ id: 1, name: 'Original' })
      await waitForRAF()

      // Remove the entity
      pool.remove(1)
      expect(pool.size).toBe(0)

      // Add a new entity with the same key
      pool.add({ id: 1, name: 'Replacement' })
      await waitForRAF()

      const container = testContainer.querySelector('.pool-container')
      const items = container.querySelectorAll('.item')
      expect(items.length).toBe(1)
      expect(items[0].querySelector('.name').textContent).toBe('Replacement')
    })

    it('clear() then add() works correctly', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-clear-add">
          <div class="pool-container" data-pool="items">
            <template>
              <div class="item"><span class="name" data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-clear-add', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.add({ id: 1, name: 'A' })
      pool.add({ id: 2, name: 'B' })
      await waitForRAF()

      pool.clear()
      const container = testContainer.querySelector('.pool-container')
      expect(container.querySelectorAll('.item').length).toBe(0)

      // Add new entities after clear
      pool.add({ id: 10, name: 'X' })
      pool.add({ id: 20, name: 'Y' })
      await waitForRAF()

      const items = container.querySelectorAll('.item')
      expect(items.length).toBe(2)
      expect(items[0].querySelector('.name').textContent).toBe('X')
      expect(items[1].querySelector('.name').textContent).toBe('Y')
      expect(pool.size).toBe(2)
    })
  })

  // =========================================================================
  // 5. Component Lifecycle
  // =========================================================================
  describe('Component Lifecycle', () => {

    it('pool accessible in init()', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-init-access">
          <div class="pool-container" data-pool="items">
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let poolInInit = null
      let addedInInit = false
      wildflower.component('pool-init-access', {
        state: {},
        init() {
          poolInInit = this.pool('items')
          if (poolInInit) {
            poolInInit.add({ id: 1, name: 'Added in init' })
            addedInInit = true
          }
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()
      await waitForRAF()

      expect(poolInInit).not.toBeNull()
      expect(addedInInit).toBe(true)

      const container = testContainer.querySelector('.pool-container')
      const items = container.querySelectorAll('.item')
      expect(items.length).toBe(1)
    })

    it.skipIf(isMinifiedBuild())('pool cleaned up on component destroy', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-destroy-test">
          <div class="pool-container" data-pool="entities">
            <template>
              <div class="entity"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-destroy-test', {
        state: {},
        init() {
          pool = this.pool('entities')
          pool.add({ id: 1, name: 'A' })
          pool.add({ id: 2, name: 'B' })
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()
      await waitForRAF()

      expect(pool.size).toBe(2)

      // Destroy the component via framework API
      const compEl = testContainer.querySelector('[data-component="pool-destroy-test"]')
      const componentId = compEl.dataset.componentId
      wildflower.destroyComponent(componentId)
      await waitForUpdate(50)

      // Pool should be cleaned up — internal references nulled
      expect(pool._container).toBeNull()
    })

    it('multiple pools on same component', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-multi-pool">
          <div class="enemies-container" data-pool="enemies">
            <template>
              <div class="enemy"><span data-bind="name"></span></div>
            </template>
          </div>
          <div class="bullets-container" data-pool="bullets">
            <template>
              <div class="bullet"><span data-bind="type"></span></div>
            </template>
          </div>
        </div>
      `

      let enemyPool = null
      let bulletPool = null
      wildflower.component('pool-multi-pool', {
        state: {},
        init() {
          enemyPool = this.pool('enemies')
          bulletPool = this.pool('bullets')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      expect(enemyPool).not.toBeNull()
      expect(bulletPool).not.toBeNull()
      expect(enemyPool).not.toBe(bulletPool)

      enemyPool.add({ id: 'e1', name: 'Goblin' })
      enemyPool.add({ id: 'e2', name: 'Orc' })
      bulletPool.add({ id: 'b1', type: 'fire' })
      await waitForRAF()

      expect(enemyPool.size).toBe(2)
      expect(bulletPool.size).toBe(1)

      const enemies = testContainer.querySelectorAll('.enemy')
      const bullets = testContainer.querySelectorAll('.bullet')
      expect(enemies.length).toBe(2)
      expect(bullets.length).toBe(1)
    })
  })

  // =========================================================================
  // 6. data-key Behavior
  // =========================================================================
  describe('data-key Behavior', () => {

    it('default key is "id"', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-default-key">
          <div class="pool-container" data-pool="items">
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-default-key', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      // Should use 'id' as key property by default
      pool.add({ id: 42, name: 'Test' })
      expect(pool.size).toBe(1)

      // Can retrieve element by id value
      const el = pool.getElement(42)
      expect(el).toBeDefined()
      expect(el).not.toBeNull()
    })

    it('custom data-key attribute respected', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-custom-key">
          <div class="pool-container" data-pool="items" data-key="uid">
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-custom-key', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      // Use custom key property 'uid'
      pool.add({ uid: 'abc', name: 'Custom Key' })
      expect(pool.size).toBe(1)

      const el = pool.getElement('abc')
      expect(el).toBeDefined()
      expect(el).not.toBeNull()
    })

    it('getElement(key) returns correct DOM element', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-getelement">
          <div class="pool-container" data-pool="items">
            <template>
              <div class="item"><span class="name" data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-getelement', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.add({ id: 'a', name: 'Alpha' })
      pool.add({ id: 'b', name: 'Beta' })
      pool.add({ id: 'c', name: 'Gamma' })
      await waitForRAF()

      const elA = pool.getElement('a')
      const elB = pool.getElement('b')
      const elC = pool.getElement('c')

      expect(elA.querySelector('.name').textContent).toBe('Alpha')
      expect(elB.querySelector('.name').textContent).toBe('Beta')
      expect(elC.querySelector('.name').textContent).toBe('Gamma')

      // Nonexistent key returns undefined
      expect(pool.getElement('z')).toBeUndefined()
    })
  })

  // =========================================================================
  // 7. Edge Cases
  // =========================================================================
  describe('Edge Cases', () => {

    it('pool with no entities (empty state)', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-empty">
          <div class="pool-container" data-pool="items">
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-empty', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      expect(pool.size).toBe(0)
      expect(pool.items.length).toBe(0)

      const container = testContainer.querySelector('.pool-container')
      expect(container.querySelectorAll('.item').length).toBe(0)

      // Operations on empty pool should not throw
      expect(pool.remove('nonexistent')).toBe(false)
      expect(() => pool.clear()).not.toThrow()
    })

    it('pool with single entity', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-single">
          <div class="pool-container" data-pool="items">
            <template>
              <div class="item"><span class="name" data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-single', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.add({ id: 'only', name: 'Solo' })
      await waitForRAF()

      expect(pool.size).toBe(1)
      const container = testContainer.querySelector('.pool-container')
      expect(container.querySelector('.name').textContent).toBe('Solo')

      // Remove the single entity
      pool.remove('only')
      expect(pool.size).toBe(0)
      expect(container.querySelectorAll('.item').length).toBe(0)
    })

    it('rapid add/remove cycles', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-rapid">
          <div class="pool-container" data-pool="items">
            <template>
              <div class="item"><span class="name" data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-rapid', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      // Rapid add/remove without waiting for rAF between
      pool.add({ id: 1, name: 'A' })
      pool.add({ id: 2, name: 'B' })
      pool.remove(1)
      pool.add({ id: 3, name: 'C' })
      pool.remove(2)
      pool.add({ id: 4, name: 'D' })

      await waitForRAF()

      // Should have entities 3 and 4
      expect(pool.size).toBe(2)
      const container = testContainer.querySelector('.pool-container')
      const items = container.querySelectorAll('.item')
      expect(items.length).toBe(2)

      const names = Array.from(items).map(el => el.querySelector('.name').textContent)
      expect(names).toEqual(['C', 'D'])
    })

    it('entity with complex nested properties in bindings', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-nested">
          <div class="pool-container" data-pool="items">
            <template>
              <div class="item">
                <span class="name" data-bind="name"></span>
                <span class="count" data-bind="count"></span>
              </div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-nested', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      // Entity with various value types
      pool.add({ id: 1, name: 'Complex', count: 0 })
      await waitForRAF()

      const item = testContainer.querySelector('.item')
      expect(item.querySelector('.name').textContent).toBe('Complex')
      expect(item.querySelector('.count').textContent).toBe('0')

      // Update with different types
      pool.items[0].count = 999
      pool.items[0].name = 'Updated'
      await waitForRAF()

      expect(item.querySelector('.name').textContent).toBe('Updated')
      expect(item.querySelector('.count').textContent).toBe('999')
    })

    it('add() returns the same object for chaining', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-chain">
          <div data-pool="items">
            <template>
              <div><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-chain', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const obj = { id: 1, name: 'Test' }
      const returned = pool.add(obj)
      expect(returned).toBe(obj)
    })

    it('remove then re-add same key renders new data correctly', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-readd">
          <div class="pool-container" data-pool="items">
            <template>
              <div class="item"><span class="name" data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-readd', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.add({ id: 1, name: 'V1' })
      await waitForRAF()

      const firstEl = pool.getElement(1)
      expect(firstEl).toBeDefined()

      pool.remove(1)
      pool.add({ id: 1, name: 'V2' })
      await waitForRAF()

      const secondEl = pool.getElement(1)
      expect(secondEl).toBeDefined()
      // DOM node may be recycled (same element) — what matters is correct rendering
      expect(secondEl.querySelector('.name').textContent).toBe('V2')
    })

    it.skipIf(isMinifiedBuild())('pool loop stops when all pools are empty', async () => {
      testContainer.innerHTML = `
        <div data-component="pool-loop-stop">
          <div data-pool="items">
            <template>
              <div><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('pool-loop-stop', {
        state: {},
        init() {
          pool = this.pool('items')
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      // Add entity — loop should start
      pool.add({ id: 1, name: 'A' })
      await waitForRAF()
      expect(wildflower._poolLoopRunning).toBe(true)

      // Remove all entities — loop should stop
      pool.clear()
      await waitForRAF()
      expect(wildflower._poolLoopRunning).toBe(false)
    })
  })

  // =========================================================================
  // 8. Spatial Culling (data-pool-cull)
  // =========================================================================
  describe('Spatial Culling (data-pool-cull)', () => {

    it('entities outside the container are hidden via visibility:hidden', async () => {
      testContainer.style.left = '0px'
      testContainer.style.opacity = '1'
      testContainer.innerHTML = `
        <div data-component="cull-test">
          <div data-pool="entities" data-key="id" data-pool-cull="50"
               style="position:relative;width:400px;height:300px;overflow:visible;">
            <template>
              <div class="entity"
                   data-bind-style="{ position: 'absolute', left: x + 'px', top: y + 'px', width: '20px', height: '20px' }">
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('cull-test', { state: {} })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const comp = wildflower.getComponent('cull-test')
      const pool = comp.pool('entities')

      // Entity inside viewport
      pool.add({ id: 1, x: 100, y: 100 })
      // Entity far outside viewport (beyond 50px padding)
      pool.add({ id: 2, x: 9000, y: 9000 })
      // Entity just outside viewport but within padding
      pool.add({ id: 3, x: 420, y: 150 })

      await waitForRAF()

      const el1 = pool.getElement(1)
      const el2 = pool.getElement(2)
      const el3 = pool.getElement(3)

      // Inside viewport — visible
      expect(el1.style.visibility).not.toBe('hidden')
      // Far outside — culled
      expect(el2.style.visibility).toBe('hidden')
      // Within padding — visible
      expect(el3.style.visibility).not.toBe('hidden')
    })

    it('culled entity becomes visible when it moves into viewport', async () => {
      testContainer.style.left = '0px'
      testContainer.style.opacity = '1'
      testContainer.innerHTML = `
        <div data-component="cull-move-test">
          <div data-pool="entities" data-key="id" data-pool-cull="20"
               style="position:relative;width:400px;height:300px;overflow:visible;">
            <template>
              <div class="entity"
                   data-bind-style="{ position: 'absolute', left: x + 'px', top: y + 'px', width: '20px', height: '20px' }">
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('cull-move-test', { state: {} })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const comp = wildflower.getComponent('cull-move-test')
      const pool = comp.pool('entities')

      // Start outside viewport
      pool.add({ id: 1, x: 5000, y: 5000 })
      await waitForRAF()

      const el = pool.getElement(1)
      expect(el.style.visibility).toBe('hidden')

      // Move into viewport
      pool.items[0].x = 100
      pool.items[0].y = 100
      await waitForRAF()

      expect(el.style.visibility).not.toBe('hidden')
    })

    it('pool without data-pool-cull does not cull entities', async () => {
      testContainer.innerHTML = `
        <div data-component="no-cull-test">
          <div data-pool="entities" data-key="id"
               style="position:relative;width:400px;height:300px;">
            <template>
              <div class="entity"
                   data-bind-style="{ position: 'absolute', left: x + 'px', top: y + 'px' }">
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('no-cull-test', { state: {} })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const comp = wildflower.getComponent('no-cull-test')
      const pool = comp.pool('entities')

      // Entity way outside container — no cull attribute so it stays visible
      pool.add({ id: 1, x: 9000, y: 9000 })
      await waitForRAF()

      const el = pool.getElement(1)
      expect(el.style.visibility).not.toBe('hidden')
    })

    it('culling padding is respected', async () => {
      testContainer.style.left = '0px'
      testContainer.style.opacity = '1'
      testContainer.innerHTML = `
        <div data-component="cull-padding-test">
          <div data-pool="entities" data-key="id" data-pool-cull="200"
               style="position:relative;width:400px;height:300px;overflow:visible;">
            <template>
              <div class="entity"
                   data-bind-style="{ position: 'absolute', left: x + 'px', top: y + 'px', width: '20px', height: '20px' }">
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('cull-padding-test', { state: {} })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const comp = wildflower.getComponent('cull-padding-test')
      const pool = comp.pool('entities')

      // Entity 500px outside container — within 200px padding? No (500 > 200+400)
      pool.add({ id: 1, x: 550, y: 150 })
      // Entity 150px outside container — within 200px padding? Yes
      pool.add({ id: 2, x: 550, y: 150 })

      // Actually let's be precise: container is 400px wide starting at its offset.
      // Entity at x=550 is 150px outside the right edge. With 200px padding, it's within bounds.
      await waitForRAF()

      const el1 = pool.getElement(1)
      // 550px from container left, container is 400px wide, 550-400 = 150px outside, padding is 200 — visible
      expect(el1.style.visibility).not.toBe('hidden')
    })
  })

  // =========================================================================
  // 9. Z-Index Auto-Sort (data-pool-sort)
  // =========================================================================
  describe('Z-Index Auto-Sort (data-pool-sort)', () => {

    it('entities get z-index from specified property', async () => {
      testContainer.innerHTML = `
        <div data-component="sort-test">
          <div data-pool="entities" data-key="id" data-pool-sort="y"
               style="position:relative;width:400px;height:300px;">
            <template>
              <div class="entity"
                   data-bind-style="{ position: 'absolute', left: x + 'px', top: y + 'px' }">
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('sort-test', { state: {} })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const comp = wildflower.getComponent('sort-test')
      const pool = comp.pool('entities')

      pool.add({ id: 1, x: 10, y: 200 })
      pool.add({ id: 2, x: 10, y: 50 })
      pool.add({ id: 3, x: 10, y: 300 })

      await waitForRAF()

      const el1 = pool.getElement(1)
      const el2 = pool.getElement(2)
      const el3 = pool.getElement(3)

      // Higher y = higher z-index (ascending sort)
      const z1 = parseInt(el1.style.zIndex) || 0
      const z2 = parseInt(el2.style.zIndex) || 0
      const z3 = parseInt(el3.style.zIndex) || 0

      expect(z3).toBeGreaterThan(z1)
      expect(z1).toBeGreaterThan(z2)
    })

    it('z-index updates when entity position changes', async () => {
      testContainer.innerHTML = `
        <div data-component="sort-update-test">
          <div data-pool="entities" data-key="id" data-pool-sort="y"
               style="position:relative;width:400px;height:300px;">
            <template>
              <div class="entity"
                   data-bind-style="{ position: 'absolute', left: x + 'px', top: y + 'px' }">
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('sort-update-test', { state: {} })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const comp = wildflower.getComponent('sort-update-test')
      const pool = comp.pool('entities')

      pool.add({ id: 1, x: 10, y: 100 })
      pool.add({ id: 2, x: 10, y: 200 })

      await waitForRAF()

      const el1 = pool.getElement(1)
      const el2 = pool.getElement(2)

      // Initially entity 2 has higher z-index (y=200 > y=100)
      expect(parseInt(el2.style.zIndex) || 0).toBeGreaterThan(parseInt(el1.style.zIndex) || 0)

      // Swap positions
      pool.items[0].y = 300
      pool.items[1].y = 50

      await waitForRAF()

      // Now entity 1 should have higher z-index (y=300 > y=50)
      expect(parseInt(el1.style.zIndex) || 0).toBeGreaterThan(parseInt(el2.style.zIndex) || 0)
    })

    it('pool without data-pool-sort does not set z-index', async () => {
      testContainer.innerHTML = `
        <div data-component="no-sort-test">
          <div data-pool="entities" data-key="id"
               style="position:relative;width:400px;height:300px;">
            <template>
              <div class="entity"
                   data-bind-style="{ position: 'absolute', left: x + 'px', top: y + 'px' }">
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('no-sort-test', { state: {} })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const comp = wildflower.getComponent('no-sort-test')
      const pool = comp.pool('entities')

      pool.add({ id: 1, x: 10, y: 200 })
      await waitForRAF()

      const el = pool.getElement(1)
      // No sort attribute — z-index should not be set
      expect(el.style.zIndex).toBe('')
    })

    it('data-pool-sort with desc reverses sort direction', async () => {
      testContainer.innerHTML = `
        <div data-component="sort-desc-test">
          <div data-pool="entities" data-key="id" data-pool-sort="y:desc"
               style="position:relative;width:400px;height:300px;">
            <template>
              <div class="entity"
                   data-bind-style="{ position: 'absolute', left: x + 'px', top: y + 'px' }">
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('sort-desc-test', { state: {} })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const comp = wildflower.getComponent('sort-desc-test')
      const pool = comp.pool('entities')

      pool.add({ id: 1, x: 10, y: 200 })
      pool.add({ id: 2, x: 10, y: 50 })

      await waitForRAF()

      const el1 = pool.getElement(1)
      const el2 = pool.getElement(2)

      // desc: higher y = LOWER z-index
      const z1 = parseInt(el1.style.zIndex) || 0
      const z2 = parseInt(el2.style.zIndex) || 0
      expect(z2).toBeGreaterThan(z1)
    })
  })
})
