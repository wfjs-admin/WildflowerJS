/**
 * WildflowerJS Static Pool Tests - Vitest Browser Mode
 *
 * Tests for data-pool-static (boolean) behavior — pools that skip the
 * rAF flush loop and apply bindings synchronously on add()/update().
 *
 * Also tests pool item order behavior after removal (swap-with-last).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const describeIfPools = hasFeature('pools') ? describe : describe.skip

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

describeIfPools('Static Pool (data-pool-static)', () => {
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
  // 1. Static Pool — Initial Render
  // =========================================================================
  describe('Initial Render', () => {

    it('items render on add() with data-pool-static (boolean)', async () => {
      testContainer.innerHTML = `
        <div data-component="static-init-test">
          <div data-pool="items" data-key="id" data-pool-static>
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('static-init-test', {
        state: {},
        pools: { items: {} },
        init() {
          this.pools.items.add({ id: 1, name: 'Alice' })
          this.pools.items.add({ id: 2, name: 'Bob' })
          this.pools.items.add({ id: 3, name: 'Carol' })
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

    it('items render on add() with data-wf-pool-static (boolean)', async () => {
      testContainer.innerHTML = `
        <div data-component="static-wf-init-test">
          <div data-pool="items" data-key="id" data-wf-pool-static>
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('static-wf-init-test', {
        state: {},
        pools: { items: {} },
        init() {
          this.pools.items.add({ id: 1, name: 'Alice' })
          this.pools.items.add({ id: 2, name: 'Bob' })
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(2)
      expect(items[0].querySelector('span').textContent).toBe('Alice')
      expect(items[1].querySelector('span').textContent).toBe('Bob')
    })

    it('data-bind-class expressions work in static pool templates', async () => {
      testContainer.innerHTML = `
        <div data-component="static-class-test">
          <div data-pool="items" data-key="id" data-pool-static>
            <template>
              <div class="item">
                <span data-bind="status"
                      data-bind-class="status === 'active' ? 'badge active' : 'badge inactive'"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('static-class-test', {
        state: {},
        pools: { items: {} },
        init() {
          this.pools.items.add({ id: 1, status: 'active' })
          this.pools.items.add({ id: 2, status: 'inactive' })
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const spans = testContainer.querySelectorAll('.item span')
      expect(spans.length).toBe(2)
      expect(spans[0].textContent).toBe('active')
      expect(spans[0].className).toContain('badge')
      expect(spans[0].className).toContain('active')
      expect(spans[1].textContent).toBe('inactive')
      expect(spans[1].className).toContain('badge')
      expect(spans[1].className).toContain('inactive')
    })
  })

  // =========================================================================
  // 2. Static Pool — update() Applies Synchronously
  // =========================================================================
  describe('Synchronous Update', () => {

    it('update() reflects in DOM for static pool without waiting for rAF', async () => {
      testContainer.innerHTML = `
        <div data-component="static-update-test">
          <div data-pool="items" data-key="id" data-pool-static>
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('static-update-test', {
        state: {},
        pools: { items: {} },
        init() {
          this.pools.items.add({ id: 1, name: 'Alice' })
          this.pools.items.add({ id: 2, name: 'Bob' })
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const instance = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      instance.pools.items.update(1, { name: 'Alice Updated' })

      // Check immediately — no rAF wait needed for static pools
      const spans = testContainer.querySelectorAll('.item span')
      expect(spans[0].textContent).toBe('Alice Updated')
      expect(spans[1].textContent).toBe('Bob')
    })

    it('update() updates data-bind-class in static pool', async () => {
      testContainer.innerHTML = `
        <div data-component="static-update-class-test">
          <div data-pool="items" data-key="id" data-pool-static>
            <template>
              <div class="item">
                <span data-bind="status"
                      data-bind-class="status === 'active' ? 'badge active' : 'badge inactive'"></span>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('static-update-class-test', {
        state: {},
        pools: { items: {} },
        init() {
          this.pools.items.add({ id: 1, status: 'active' })
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const instance = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      instance.pools.items.update(1, { status: 'inactive' })

      const span = testContainer.querySelector('.item span')
      expect(span.textContent).toBe('inactive')
      expect(span.className).toContain('inactive')
    })

    it('add() after init renders immediately in static pool', async () => {
      testContainer.innerHTML = `
        <div data-component="static-add-later-test">
          <div data-pool="items" data-key="id" data-pool-static>
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('static-add-later-test', {
        state: {},
        pools: { items: {} },
        init() {
          this.pools.items.add({ id: 1, name: 'Alice' })
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const instance = getInstance(wildflower, testContainer.querySelector('[data-component]'))

      // Add another item after init
      instance.pools.items.add({ id: 2, name: 'Bob' })

      // Check immediately
      const items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(2)
      expect(items[1].querySelector('span').textContent).toBe('Bob')
    })
  })

  // =========================================================================
  // 3. Static Pool — remove() Works
  // =========================================================================
  describe('Remove', () => {

    it('remove() removes DOM element from static pool', async () => {
      testContainer.innerHTML = `
        <div data-component="static-remove-test">
          <div data-pool="items" data-key="id" data-pool-static>
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('static-remove-test', {
        state: {},
        pools: { items: {} },
        init() {
          this.pools.items.add({ id: 1, name: 'Alice' })
          this.pools.items.add({ id: 2, name: 'Bob' })
          this.pools.items.add({ id: 3, name: 'Carol' })
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const instance = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      instance.pools.items.remove(2)

      const items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(2)
      expect(instance.pools.items.size).toBe(2)
    })

    it('clear() removes all DOM elements from static pool', async () => {
      testContainer.innerHTML = `
        <div data-component="static-clear-test">
          <div data-pool="items" data-key="id" data-pool-static>
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('static-clear-test', {
        state: {},
        pools: { items: {} },
        init() {
          this.pools.items.add({ id: 1, name: 'Alice' })
          this.pools.items.add({ id: 2, name: 'Bob' })
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const instance = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      instance.pools.items.clear()

      const items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(0)
      expect(instance.pools.items.size).toBe(0)
    })
  })

  // =========================================================================
  // 4. Static Pool — Does NOT Flush on rAF
  // =========================================================================
  describe('No rAF Flush', () => {

    it('direct property mutation does NOT update DOM without update() in static pool', async () => {
      testContainer.innerHTML = `
        <div data-component="static-no-flush-test">
          <div data-pool="items" data-key="id" data-pool-static>
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('static-no-flush-test', {
        state: {},
        pools: { items: {} },
        init() {
          this.pools.items.add({ id: 1, name: 'Alice' })
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const instance = getInstance(wildflower, testContainer.querySelector('[data-component]'))

      // Mutate directly without update()
      const item = instance.pools.items.get(1)
      item.name = 'Changed Directly'

      // Wait for several rAF cycles
      await waitForRAF()
      await waitForRAF()

      // DOM should NOT have updated
      const span = testContainer.querySelector('.item span')
      expect(span.textContent).toBe('Alice')
    })
  })

  // =========================================================================
  // 5. Per-Entity Static (data-pool-static="propName") — Existing Behavior
  // =========================================================================
  describe('Per-Entity Static (existing behavior)', () => {

    it('data-pool-static with a value uses per-entity static property', async () => {
      testContainer.innerHTML = `
        <div data-component="entity-static-test">
          <div data-pool="items" data-key="id" data-pool-static="isLocked">
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('entity-static-test', {
        state: {},
        pools: { items: {} },
        init() {
          this.pools.items.add({ id: 1, name: 'Dynamic', isLocked: false })
          this.pools.items.add({ id: 2, name: 'Static', isLocked: true })
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(2)
      expect(items[0].querySelector('span').textContent).toBe('Dynamic')
      expect(items[1].querySelector('span').textContent).toBe('Static')

      // This pool should still be in the rAF loop (not a static pool)
      const instance = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      const pool = instance.pools.items

      // Mutate the dynamic item directly, wait for rAF flush
      const dynamicItem = pool.get(1)
      dynamicItem.name = 'Updated'
      await waitForRAF()
      await waitForRAF()

      // Dynamic item should have updated via rAF flush
      const updatedItems = testContainer.querySelectorAll('.item span')
      expect(updatedItems[0].textContent).toBe('Updated')
    })
  })

  // =========================================================================
  // 6. Pool Item Order After Removal (swap-with-last)
  // =========================================================================
  describe('Item Order After Removal', () => {

    it('pool.items order changes after remove (swap-with-last)', async () => {
      testContainer.innerHTML = `
        <div data-component="order-test">
          <div data-pool="items" data-key="id" data-pool-static>
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('order-test', {
        state: {},
        pools: { items: {} },
        init() {
          this.pools.items.add({ id: 1, name: 'First' })
          this.pools.items.add({ id: 2, name: 'Second' })
          this.pools.items.add({ id: 3, name: 'Third' })
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const instance = getInstance(wildflower, testContainer.querySelector('[data-component]'))

      // Remove the first item
      instance.pools.items.remove(1)

      // items[0] is now what was the last item (swap-with-last)
      expect(instance.pools.items.items[0].name).toBe('Third')
      expect(instance.pools.items.items[1].name).toBe('Second')
      expect(instance.pools.items.size).toBe(2)

      // But DOM order is insertion order — the first DOM element was removed,
      // Second and Third remain in their original DOM positions
      const domItems = testContainer.querySelectorAll('.item span')
      expect(domItems.length).toBe(2)
    })

    it('pool.get(key) works regardless of array order', async () => {
      testContainer.innerHTML = `
        <div data-component="get-after-remove-test">
          <div data-pool="items" data-key="id" data-pool-static>
            <template>
              <div class="item"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('get-after-remove-test', {
        state: {},
        pools: { items: {} },
        init() {
          this.pools.items.add({ id: 1, name: 'Alice' })
          this.pools.items.add({ id: 2, name: 'Bob' })
          this.pools.items.add({ id: 3, name: 'Carol' })
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const instance = getInstance(wildflower, testContainer.querySelector('[data-component]'))

      // Remove middle item
      instance.pools.items.remove(2)

      // get() still works by key
      expect(instance.pools.items.get(1).name).toBe('Alice')
      expect(instance.pools.items.get(3).name).toBe('Carol')
      expect(instance.pools.items.get(2)).toBeUndefined()
    })
  })

  // =========================================================================
  // 7. Mixed Pools — Static and Live on Same Component
  // =========================================================================
  describe('Mixed Pools', () => {

    it('component can have both static and live pools', async () => {
      testContainer.innerHTML = `
        <div data-component="mixed-pool-test">
          <div data-pool="display" data-key="id" data-pool-static>
            <template>
              <div class="display-item"><span data-bind="label"></span></div>
            </template>
          </div>
          <div data-pool="animated" data-key="id">
            <template>
              <div class="anim-item"><span data-bind="label"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.component('mixed-pool-test', {
        state: {},
        pools: { display: {}, animated: {} },
        init() {
          this.pools.display.add({ id: 1, label: 'Static A' })
          this.pools.display.add({ id: 2, label: 'Static B' })
          this.pools.animated.add({ id: 1, label: 'Live A' })
          this.pools.animated.add({ id: 2, label: 'Live B' })
        }
      })

      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const displayItems = testContainer.querySelectorAll('.display-item span')
      const animItems = testContainer.querySelectorAll('.anim-item span')

      expect(displayItems.length).toBe(2)
      expect(animItems.length).toBe(2)
      expect(displayItems[0].textContent).toBe('Static A')
      expect(animItems[0].textContent).toBe('Live A')
    })
  })
})
