/**
 * Pool Lifecycle Hooks Test Suite - Vitest Browser Mode
 *
 * Tests for declarative pools block and onAdd/onRemove/onClear lifecycle hooks.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
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

function getInstance(wildflower, el) {
  const compEl = el.closest ? el.closest('[data-component]') : el.querySelector('[data-component]')
  const target = compEl || el
  return wildflower.componentInstances.get(target.dataset.componentId)
}

describe('Pool Lifecycle Hooks', () => {
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
      const components = testContainer.querySelectorAll('[data-component-id]')
      components.forEach(el => {
        const id = el.dataset.componentId
        if (id && wildflower.componentInstances?.has(id)) {
          try { wildflower.destroyComponent(id) } catch (e) {}
        }
      })
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  // =========================================================================
  // DECLARATIVE POOLS BLOCK
  // =========================================================================
  describe('Declarative pools block', () => {
    it('pools: { name: {} } creates pool accessible as this.pools.name', async () => {
      let poolRef = null

      wildflower.component('decl-pool-basic', {
        state: {},
        pools: {
          dots: {}
        },
        init() {
          poolRef = this.pools.dots
        }
      })

      testContainer.innerHTML = `
        <div data-component="decl-pool-basic">
          <div data-pool="dots" data-key="id">
            <template><div data-bind-style="{ transform: tf }"></div></template>
          </div>
        </div>
      `
      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForUpdate(100)

      expect(poolRef).toBeDefined()
      expect(typeof poolRef.add).toBe('function')
      expect(typeof poolRef.remove).toBe('function')
      expect(typeof poolRef.clear).toBe('function')
      expect(typeof poolRef.update).toBe('function')
      expect(typeof poolRef.get).toBe('function')
      expect(poolRef.items).toBeDefined()
      expect(typeof poolRef.size).toBe('number')
    })

    it('pools: ["a", "b"] creates multiple pools', async () => {
      let poolA = null, poolB = null

      wildflower.component('decl-pool-multi', {
        state: {},
        pools: ['dots', 'lines'],
        init() {
          poolA = this.pools.dots
          poolB = this.pools.lines
        }
      })

      testContainer.innerHTML = `
        <div data-component="decl-pool-multi">
          <div data-pool="dots" data-key="id">
            <template><div></div></template>
          </div>
          <div data-pool="lines" data-key="id">
            <template><div></div></template>
          </div>
        </div>
      `
      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForUpdate(100)

      expect(poolA).toBeDefined()
      expect(poolB).toBeDefined()
      expect(typeof poolA.add).toBe('function')
      expect(typeof poolB.add).toBe('function')
    })

    it('declarative pool works with add/remove/clear', async () => {
      let instance = null

      wildflower.component('decl-pool-ops', {
        state: {},
        pools: {
          items: {}
        },
        init() {
          instance = this
        }
      })

      testContainer.innerHTML = `
        <div data-component="decl-pool-ops">
          <div data-pool="items" data-key="id">
            <template><div data-bind="name"></div></template>
          </div>
        </div>
      `
      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForUpdate(100)

      instance.pools.items.add({ id: 1, name: 'A' })
      instance.pools.items.add({ id: 2, name: 'B' })
      await waitForRAF()

      expect(instance.pools.items.size).toBe(2)

      instance.pools.items.remove(1)
      await waitForRAF()

      expect(instance.pools.items.size).toBe(1)

      instance.pools.items.clear()
      await waitForRAF()

      expect(instance.pools.items.size).toBe(0)
    })
  })

  // =========================================================================
  // LIFECYCLE HOOKS — INLINE FUNCTIONS
  // =========================================================================
  describe('Lifecycle hooks (inline functions)', () => {
    it('onAdd fires when item is added via pool.add()', async () => {
      const addedItems = []

      wildflower.component('hook-on-add', {
        state: {},
        pools: {
          balls: {
            onAdd(item) {
              addedItems.push(item.id)
            }
          }
        },
        init() {}
      })

      testContainer.innerHTML = `
        <div data-component="hook-on-add">
          <div data-pool="balls" data-key="id">
            <template><div></div></template>
          </div>
        </div>
      `
      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForUpdate(100)

      const inst = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      inst.pools.balls.add({ id: 10, tf: '' })
      inst.pools.balls.add({ id: 20, tf: '' })

      expect(addedItems).toEqual([10, 20])
    })

    it('onRemove fires on individual pool.remove(), not on pool.clear()', async () => {
      const removedItems = []

      wildflower.component('hook-on-remove', {
        state: {},
        pools: {
          balls: {
            onRemove(item) {
              removedItems.push(item.id)
            }
          }
        },
        init() {}
      })

      testContainer.innerHTML = `
        <div data-component="hook-on-remove">
          <div data-pool="balls" data-key="id">
            <template><div></div></template>
          </div>
        </div>
      `
      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForUpdate(100)

      const inst = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      inst.pools.balls.add({ id: 1, tf: '' })
      inst.pools.balls.add({ id: 2, tf: '' })
      inst.pools.balls.add({ id: 3, tf: '' })

      // Individual remove should fire onRemove
      inst.pools.balls.remove(2)
      expect(removedItems).toEqual([2])

      // Clear without onClear defined should fire onRemove for each remaining item
      inst.pools.balls.clear()
      expect(removedItems).toEqual([2, 1, 3])
    })

    it('onAdd receives the item object with correct id', async () => {
      let receivedItem = null

      wildflower.component('hook-add-item', {
        state: {},
        pools: {
          things: {
            onAdd(item) {
              receivedItem = item
            }
          }
        },
        init() {}
      })

      testContainer.innerHTML = `
        <div data-component="hook-add-item">
          <div data-pool="things" data-key="id">
            <template><div></div></template>
          </div>
        </div>
      `
      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForUpdate(100)

      const inst = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      inst.pools.things.add({ id: 42, name: 'test', tf: '' })

      expect(receivedItem).toBeDefined()
      expect(receivedItem.id).toBe(42)
      expect(receivedItem.name).toBe('test')
    })

    it('onRemove receives the item before it is removed', async () => {
      let itemStillInPool = false

      wildflower.component('hook-remove-before', {
        state: {},
        pools: {
          items: {
            onRemove(item) {
              // Item should still be accessible at this point
              itemStillInPool = this.pools.items.get(item.id) !== undefined
            }
          }
        },
        init() {}
      })

      testContainer.innerHTML = `
        <div data-component="hook-remove-before">
          <div data-pool="items" data-key="id">
            <template><div></div></template>
          </div>
        </div>
      `
      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForUpdate(100)

      const inst = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      inst.pools.items.add({ id: 1, tf: '' })
      inst.pools.items.remove(1)

      expect(itemStillInPool).toBe(true)
    })

    it('onAdd/onRemove have this bound to component instance', async () => {
      let addThis = null, removeThis = null

      wildflower.component('hook-this-binding', {
        state: { marker: 'found' },
        pools: {
          items: {
            onAdd(item) {
              addThis = this
            },
            onRemove(item) {
              removeThis = this
            }
          }
        },
        init() {}
      })

      testContainer.innerHTML = `
        <div data-component="hook-this-binding">
          <div data-pool="items" data-key="id">
            <template><div></div></template>
          </div>
        </div>
      `
      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForUpdate(100)

      const inst = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      inst.pools.items.add({ id: 1, tf: '' })
      inst.pools.items.remove(1)

      expect(addThis).toBeDefined()
      expect(addThis.marker).toBe('found')
      expect(removeThis).toBeDefined()
      expect(removeThis.marker).toBe('found')
    })

    it('item._body pattern works (attach in onAdd, cleanup in onRemove)', async () => {
      const resources = new Map()

      wildflower.component('hook-resource', {
        state: {},
        pools: {
          entities: {
            onAdd(item) {
              // Simulate creating an external resource
              const resource = { type: 'physics-body', active: true }
              item._resource = resource
              resources.set(item.id, resource)
            },
            onRemove(item) {
              // Simulate cleaning up the external resource
              if (item._resource) {
                item._resource.active = false
              }
              resources.delete(item.id)
            }
          }
        },
        init() {}
      })

      testContainer.innerHTML = `
        <div data-component="hook-resource">
          <div data-pool="entities" data-key="id">
            <template><div></div></template>
          </div>
        </div>
      `
      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForUpdate(100)

      const inst = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      inst.pools.entities.add({ id: 1, tf: '' })
      inst.pools.entities.add({ id: 2, tf: '' })

      expect(resources.size).toBe(2)
      expect(resources.get(1).active).toBe(true)

      inst.pools.entities.remove(1)

      expect(resources.size).toBe(1)
      expect(resources.has(1)).toBe(false)
    })
  })

  // =========================================================================
  // onClear BEHAVIOR
  // =========================================================================
  describe('onClear behavior', () => {
    it('onClear fires once with full items array on pool.clear()', async () => {
      let clearItems = null
      let clearCallCount = 0

      wildflower.component('hook-on-clear', {
        state: {},
        pools: {
          balls: {
            onClear(items) {
              clearCallCount++
              clearItems = [...items]  // snapshot
            }
          }
        },
        init() {}
      })

      testContainer.innerHTML = `
        <div data-component="hook-on-clear">
          <div data-pool="balls" data-key="id">
            <template><div></div></template>
          </div>
        </div>
      `
      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForUpdate(100)

      const inst = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      inst.pools.balls.add({ id: 1, tf: '' })
      inst.pools.balls.add({ id: 2, tf: '' })
      inst.pools.balls.add({ id: 3, tf: '' })

      inst.pools.balls.clear()

      expect(clearCallCount).toBe(1)
      expect(clearItems.length).toBe(3)
      expect(clearItems.map(i => i.id)).toEqual([1, 2, 3])
    })

    it('when onClear is defined, onRemove is NOT called during clear()', async () => {
      const removedIds = []

      wildflower.component('hook-clear-no-remove', {
        state: {},
        pools: {
          balls: {
            onRemove(item) {
              removedIds.push(item.id)
            },
            onClear(items) {
              // Bulk cleanup — onRemove should NOT fire
            }
          }
        },
        init() {}
      })

      testContainer.innerHTML = `
        <div data-component="hook-clear-no-remove">
          <div data-pool="balls" data-key="id">
            <template><div></div></template>
          </div>
        </div>
      `
      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForUpdate(100)

      const inst = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      inst.pools.balls.add({ id: 1, tf: '' })
      inst.pools.balls.add({ id: 2, tf: '' })

      inst.pools.balls.clear()

      // onRemove should NOT have been called
      expect(removedIds).toEqual([])
    })

    it('when onClear is NOT defined, onRemove fires per item during clear()', async () => {
      const removedIds = []

      wildflower.component('hook-clear-fallback', {
        state: {},
        pools: {
          balls: {
            onRemove(item) {
              removedIds.push(item.id)
            }
            // No onClear — fallback to per-item onRemove
          }
        },
        init() {}
      })

      testContainer.innerHTML = `
        <div data-component="hook-clear-fallback">
          <div data-pool="balls" data-key="id">
            <template><div></div></template>
          </div>
        </div>
      `
      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForUpdate(100)

      const inst = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      inst.pools.balls.add({ id: 1, tf: '' })
      inst.pools.balls.add({ id: 2, tf: '' })
      inst.pools.balls.add({ id: 3, tf: '' })

      inst.pools.balls.clear()

      // onRemove should fire for each item
      expect(removedIds.length).toBe(3)
      expect(removedIds).toContain(1)
      expect(removedIds).toContain(2)
      expect(removedIds).toContain(3)
    })

    it('onClear has this bound to component instance', async () => {
      let clearThis = null

      wildflower.component('hook-clear-this', {
        state: { marker: 'cleartest' },
        pools: {
          items: {
            onClear(items) {
              clearThis = this
            }
          }
        },
        init() {}
      })

      testContainer.innerHTML = `
        <div data-component="hook-clear-this">
          <div data-pool="items" data-key="id">
            <template><div></div></template>
          </div>
        </div>
      `
      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForUpdate(100)

      const inst = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      inst.pools.items.add({ id: 1, tf: '' })
      inst.pools.items.clear()

      expect(clearThis).toBeDefined()
      expect(clearThis.marker).toBe('cleartest')
    })
  })

  // =========================================================================
  // LIFECYCLE HOOKS — STRING REFERENCES
  // =========================================================================
  describe('Lifecycle hooks (string references)', () => {
    it('onAdd: "methodName" resolves to component method', async () => {
      const addedIds = []

      wildflower.component('hook-str-add', {
        state: {},
        pools: {
          items: {
            onAdd: 'handleAdd'
          }
        },
        handleAdd(item) {
          addedIds.push(item.id)
        },
        init() {}
      })

      testContainer.innerHTML = `
        <div data-component="hook-str-add">
          <div data-pool="items" data-key="id">
            <template><div></div></template>
          </div>
        </div>
      `
      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForUpdate(100)

      const inst = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      inst.pools.items.add({ id: 5, tf: '' })
      inst.pools.items.add({ id: 10, tf: '' })

      expect(addedIds).toEqual([5, 10])
    })

    it('onRemove: "methodName" resolves to component method', async () => {
      const removedIds = []

      wildflower.component('hook-str-remove', {
        state: {},
        pools: {
          items: {
            onRemove: 'handleRemove'
          }
        },
        handleRemove(item) {
          removedIds.push(item.id)
        },
        init() {}
      })

      testContainer.innerHTML = `
        <div data-component="hook-str-remove">
          <div data-pool="items" data-key="id">
            <template><div></div></template>
          </div>
        </div>
      `
      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForUpdate(100)

      const inst = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      inst.pools.items.add({ id: 1, tf: '' })
      inst.pools.items.add({ id: 2, tf: '' })
      inst.pools.items.remove(1)

      expect(removedIds).toEqual([1])
    })

    it('onClear: "methodName" resolves to component method', async () => {
      let clearCount = 0

      wildflower.component('hook-str-clear', {
        state: {},
        pools: {
          items: {
            onClear: 'handleClear'
          }
        },
        handleClear(items) {
          clearCount = items.length
        },
        init() {}
      })

      testContainer.innerHTML = `
        <div data-component="hook-str-clear">
          <div data-pool="items" data-key="id">
            <template><div></div></template>
          </div>
        </div>
      `
      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForUpdate(100)

      const inst = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      inst.pools.items.add({ id: 1, tf: '' })
      inst.pools.items.add({ id: 2, tf: '' })
      inst.pools.items.clear()

      expect(clearCount).toBe(2)
    })

    it('string-ref hooks have this bound to component', async () => {
      let hookThis = null

      wildflower.component('hook-str-this', {
        state: { tag: 'stringref' },
        pools: {
          items: {
            onAdd: 'onItemAdd'
          }
        },
        onItemAdd(item) {
          hookThis = this
        },
        init() {}
      })

      testContainer.innerHTML = `
        <div data-component="hook-str-this">
          <div data-pool="items" data-key="id">
            <template><div></div></template>
          </div>
        </div>
      `
      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForUpdate(100)

      const inst = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      inst.pools.items.add({ id: 1, tf: '' })

      expect(hookThis).toBeDefined()
      expect(hookThis.tag).toBe('stringref')
    })
  })

  // =========================================================================
  // BACKWARD COMPATIBILITY
  // =========================================================================
  describe('Backward compatibility', () => {
    it('this.pool(name) still works without pools block', async () => {
      let poolRef = null

      wildflower.component('compat-imperative', {
        state: {},
        init() {
          poolRef = this.pool('dots')
        }
      })

      testContainer.innerHTML = `
        <div data-component="compat-imperative">
          <div data-pool="dots" data-key="id">
            <template><div></div></template>
          </div>
        </div>
      `
      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForUpdate(100)

      expect(poolRef).toBeDefined()
      expect(typeof poolRef.add).toBe('function')

      poolRef.add({ id: 1, tf: '' })
      await waitForRAF()

      expect(poolRef.size).toBe(1)
    })

    it('this.pool(name, { onAdd, onRemove }) imperative form works', async () => {
      const added = []
      const removed = []

      wildflower.component('compat-imperative-hooks', {
        state: {},
        init() {
          this._myPool = this.pool('items', {
            onAdd(item) { added.push(item.id) },
            onRemove(item) { removed.push(item.id) }
          })
        }
      })

      testContainer.innerHTML = `
        <div data-component="compat-imperative-hooks">
          <div data-pool="items" data-key="id">
            <template><div></div></template>
          </div>
        </div>
      `
      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForUpdate(100)

      const inst = getInstance(wildflower, testContainer.querySelector('[data-component]'))
      const myPool = inst.context._myPool || inst.state._myPool
      myPool.add({ id: 1, tf: '' })
      myPool.add({ id: 2, tf: '' })
      myPool.remove(1)

      expect(added).toEqual([1, 2])
      expect(removed).toEqual([1])
    })

    it('pool works normally when no hooks are provided', async () => {
      let poolRef = null

      wildflower.component('compat-no-hooks', {
        state: {},
        pools: {
          items: {}
        },
        init() {
          poolRef = this.pools.items
        }
      })

      testContainer.innerHTML = `
        <div data-component="compat-no-hooks">
          <div data-pool="items" data-key="id">
            <template><div data-bind="name"></div></template>
          </div>
        </div>
      `
      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForUpdate(100)

      poolRef.add({ id: 1, name: 'A' })
      poolRef.add({ id: 2, name: 'B' })
      await waitForRAF()

      expect(poolRef.size).toBe(2)

      poolRef.remove(1)
      await waitForRAF()

      expect(poolRef.size).toBe(1)

      poolRef.clear()
      await waitForRAF()

      expect(poolRef.size).toBe(0)
    })
  })

  // =========================================================================
  // C1: POOL HANDLE CLEANUP ON COMPONENT DESTROY
  // =========================================================================
  describe('Pool handle cleanup on destroy', () => {
    it.skipIf(isMinifiedBuild())('destroyed component pool handles are removed from _activePoolHandles', async () => {
      wildflower.component('pool-cleanup-test', {
        state: {},
        pools: { dots: {} },
        init() {
          this.pools.dots.add({ id: 1, x: 0, y: 0 })
        }
      })

      testContainer.innerHTML = `
        <div data-component="pool-cleanup-test">
          <div data-pool="dots" data-key="id">
            <template><div data-bind-style="{ transform: 'translate(0,0)' }"></div></template>
          </div>
        </div>
      `
      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForUpdate(100)

      const handlesBefore = wildflower._activePoolHandles ? wildflower._activePoolHandles.length : 0
      expect(handlesBefore).toBeGreaterThan(0)

      // Destroy the component
      const compEl = testContainer.querySelector('[data-component-id]')
      const compId = compEl.dataset.componentId
      wildflower.destroyComponent(compId)

      const handlesAfter = wildflower._activePoolHandles ? wildflower._activePoolHandles.length : 0
      expect(handlesAfter).toBe(handlesBefore - 1)
    })

    it.skipIf(isMinifiedBuild())('_activePoolHandles does not accumulate dead handles across multiple create/destroy cycles', async () => {
      wildflower.component('pool-churn-test', {
        state: {},
        pools: { items: {} },
        init() {
          this.pools.items.add({ id: 1 })
        }
      })

      for (let cycle = 0; cycle < 3; cycle++) {
        testContainer.innerHTML = `
          <div data-component="pool-churn-test">
            <div data-pool="items" data-key="id">
              <template><div></div></template>
            </div>
          </div>
        `
        wildflower.scan(testContainer)
        await waitForCompleteRender()
        await waitForUpdate(100)

        const compEl = testContainer.querySelector('[data-component-id]')
        const compId = compEl.dataset.componentId
        wildflower.destroyComponent(compId)
        testContainer.innerHTML = ''
      }

      // After 3 create/destroy cycles, no handles should remain
      const remaining = wildflower._activePoolHandles ? wildflower._activePoolHandles.length : 0
      expect(remaining).toBe(0)
    })
  })
})
