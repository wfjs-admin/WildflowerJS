/**
 * Pool + Store Integration Test Suite - Vitest Browser Mode
 *
 * Tests for the interaction between data-pool (high-performance entity rendering)
 * and stores (global reactive state). Both are well-tested independently; this
 * suite validates they work correctly together.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature } from './helpers/load-framework.js'

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



function getInstance(wildflower, el) {
  const compEl = el.closest ? el.closest('[data-component]') : el.querySelector('[data-component]')
  const target = compEl || el
  return wildflower.componentInstances.get(target.dataset.componentId)
}

describeIfPools('Pool + Store Integration', () => {
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
    if (wildflower._activePoolHandles) wildflower._activePoolHandles.length = 0

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
  // 1. Store-Backed Pool Data
  // =========================================================================
  describe('Store-backed pool data', () => {

    it.skipIf(isMinifiedBuild())('component subscribes to store and populates pool from store data in init', async () => {
      wildflower.store('psi-enemies', {
        state: {
          entities: [
            { id: 1, name: 'Goblin', hp: 30 },
            { id: 2, name: 'Orc', hp: 50 }
          ]
        }
      })

      wildflower.component('psi-store-to-pool', {
        state: {},
        subscribe: { 'psi-enemies': ['entities'] },
        pools: { enemies: {} },
        init() {
          const store = wildflower.getStore('psi-enemies')
          const entities = store.entities
          for (const entity of entities) {
            this.pools.enemies.add({ ...entity })
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="psi-store-to-pool">
          <div data-pool="enemies" data-key="id">
            <template>
              <div class="enemy"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForRAF()

      const items = testContainer.querySelectorAll('.enemy')
      expect(items.length).toBe(2)
    })

    it.skipIf(isMinifiedBuild())('store mutation triggers pool add via onStoreUpdate', async () => {
      const spawnStore = wildflower.store('psi-spawn', {
        state: {
          queue: []
        },
        spawnEnemy(enemy) {
          this.state.queue = [...this.state.queue, enemy]
        }
      })

      let poolRef = null

      wildflower.component('psi-spawn-comp', {
        state: {},
        subscribe: { 'psi-spawn': ['queue'] },
        pools: { units: {} },
        init() {
          poolRef = this.pools.units
        },
        onStoreUpdate(storeName, path, newValue, oldValue) {
          if (storeName === 'psi-spawn' && path === 'queue') {
            // newValue is the updated queue array
            for (const item of newValue) {
              if (!this.pools.units.get(item.id)) {
                this.pools.units.add({ ...item })
              }
            }
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="psi-spawn-comp">
          <div data-pool="units" data-key="id">
            <template>
              <div class="unit"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForRAF()

      // Pool starts empty
      expect(testContainer.querySelectorAll('.unit').length).toBe(0)

      // Mutate the store via its returned proxy
      spawnStore.state.queue = [{ id: 1, name: 'Dragon' }]
      await waitForUpdate(200)
      await waitForRAF()

      expect(testContainer.querySelectorAll('.unit').length).toBe(1)
    })

    it.skipIf(isMinifiedBuild())('store mutation triggers pool remove via onStoreUpdate', async () => {
      const despawnStore = wildflower.store('psi-despawn', {
        state: {
          activeIds: [1, 2, 3]
        }
      })

      wildflower.component('psi-despawn-comp', {
        state: {},
        subscribe: { 'psi-despawn': ['activeIds'] },
        pools: { dots: {} },
        init() {
          const store = wildflower.getStore('psi-despawn')
          for (const id of store.activeIds) {
            this.pools.dots.add({ id, label: 'dot-' + id })
          }
        },
        onStoreUpdate(storeName, path, newValue, oldValue) {
          if (storeName === 'psi-despawn' && path === 'activeIds') {
            const activeIds = new Set(newValue)
            // Remove pool items no longer in the store
            for (const item of [...this.pools.dots.items]) {
              if (!activeIds.has(item.id)) {
                this.pools.dots.remove(item.id)
              }
            }
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="psi-despawn-comp">
          <div data-pool="dots" data-key="id">
            <template>
              <div class="dot"><span data-bind="label"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForRAF()

      expect(testContainer.querySelectorAll('.dot').length).toBe(3)

      // Remove id 2 via store mutation
      despawnStore.state.activeIds = [1, 3]
      await waitForUpdate(200)
      await waitForRAF()

      const dots = testContainer.querySelectorAll('.dot')
      expect(dots.length).toBe(2)
    })
  })

  // =========================================================================
  // 2. Pool Actions Reading Store State
  // =========================================================================
  describe('Pool actions reading store state', () => {

    it.skipIf(isMinifiedBuild())('data-action in pool template accesses store via this.stores', async () => {
      wildflower.store('psi-config', {
        state: {
          multiplier: 10
        }
      })

      let actionResult = null

      wildflower.component('psi-action-store', {
        state: {},
        subscribe: { 'psi-config': ['multiplier'] },
        pools: { items: {} },
        init() {
          this.pools.items.add({ id: 1, name: 'Alpha', value: 5 })
        },
        applyMultiplier(item) {
          actionResult = item.value * this.stores['psi-config'].multiplier
        }
      })

      testContainer.innerHTML = `
        <div data-component="psi-action-store">
          <div data-pool="items" data-key="id">
            <template>
              <div class="item" data-action="click:applyMultiplier"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForRAF()

      const item = testContainer.querySelector('.item')
      expect(item).not.toBeNull()

      item.click()
      await waitForUpdate()

      expect(actionResult).toBe(50) // 5 * 10
    })

    it.skipIf(isMinifiedBuild())('pool item action modifies store state', async () => {
      wildflower.store('psi-score', {
        state: {
          totalScore: 0
        },
        addPoints(pts) {
          this.state.totalScore += pts
        }
      })

      wildflower.component('psi-action-modify-store', {
        state: {},
        subscribe: { 'psi-score': ['totalScore'] },
        pools: { targets: {} },
        init() {
          this.pools.targets.add({ id: 1, name: 'Target A', points: 25 })
          this.pools.targets.add({ id: 2, name: 'Target B', points: 50 })
        },
        hitTarget(item) {
          const store = wildflower.getStore('psi-score')
          store.addPoints(item.points)
        }
      })

      testContainer.innerHTML = `
        <div data-component="psi-action-modify-store">
          <div data-pool="targets" data-key="id">
            <template>
              <div class="target" data-action="click:hitTarget"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForRAF()

      const targets = testContainer.querySelectorAll('.target')
      expect(targets.length).toBe(2)

      // Click first target
      targets[0].click()
      await waitForUpdate()

      const store = wildflower.getStore('psi-score')
      expect(store.totalScore).toBe(25)

      // Click second target
      targets[1].click()
      await waitForUpdate()

      expect(store.totalScore).toBe(75)
    })
  })

  // =========================================================================
  // 3. Pool Props from Store
  // =========================================================================
  describe('Pool props derived from store state', () => {

    it.skipIf(isMinifiedBuild())('pool props initialized from store state', async () => {
      wildflower.store('psi-theme', {
        state: {
          color: 'red',
          scale: 2
        }
      })

      let propsRef = null

      wildflower.component('psi-props-from-store', {
        state: {},
        subscribe: { 'psi-theme': ['color', 'scale'] },
        pools: {
          particles: {
            props: { color: 'default', scale: 1 }
          }
        },
        init() {
          const store = wildflower.getStore('psi-theme')
          this.pools.particles.props.color = store.color
          this.pools.particles.props.scale = store.scale
          this.pools.particles.add({ id: 1, x: 10, y: 20 })
          propsRef = this.pools.particles.props
        }
      })

      testContainer.innerHTML = `
        <div data-component="psi-props-from-store">
          <div data-pool="particles" data-key="id">
            <template>
              <div class="particle" data-bind-style="{ transform: 'translate(' + x + 'px,' + y + 'px) scale(' + $props.scale + ')' }"></div>
            </template>
          </div>
        </div>
      `

      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForRAF()

      expect(propsRef).toBeDefined()
      expect(propsRef.color).toBe('red')
      expect(propsRef.scale).toBe(2)
    })

    it.skipIf(isMinifiedBuild())('store state change updates pool props via onStoreUpdate', async () => {
      const visualStore = wildflower.store('psi-visual', {
        state: {
          opacity: 1.0
        }
      })

      let poolRef = null

      wildflower.component('psi-props-update', {
        state: {},
        subscribe: { 'psi-visual': ['opacity'] },
        pools: {
          sprites: {
            props: { opacity: 1.0 }
          }
        },
        init() {
          poolRef = this.pools.sprites
          const store = wildflower.getStore('psi-visual')
          this.pools.sprites.props.opacity = store.opacity
          this.pools.sprites.add({ id: 1, x: 0, y: 0 })
        },
        onStoreUpdate(storeName, path, newValue, oldValue) {
          if (storeName === 'psi-visual' && path === 'opacity') {
            this.pools.sprites.props.opacity = newValue
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="psi-props-update">
          <div data-pool="sprites" data-key="id">
            <template>
              <div class="sprite" data-bind-style="{ opacity: $props.opacity }"></div>
            </template>
          </div>
        </div>
      `

      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForRAF()

      expect(poolRef.props.opacity).toBe(1.0)

      // Mutate store directly
      visualStore.state.opacity = 0.5
      await waitForUpdate(200)
      await waitForRAF()

      expect(poolRef.props.opacity).toBe(0.5)
    })
  })

  // =========================================================================
  // 4. Cleanup — Store Subscription + Pool Both Cleaned on Destroy
  // =========================================================================
  describe('Cleanup', () => {

    it.skipIf(isMinifiedBuild())('component with store subscription and pool: both cleaned up on destroy', async () => {
      wildflower.store('psi-cleanup-store', {
        state: {
          value: 'hello'
        }
      })

      let initCalled = false
      let destroyCalled = false

      wildflower.component('psi-cleanup-comp', {
        state: {},
        subscribe: { 'psi-cleanup-store': ['value'] },
        pools: { entities: {} },
        init() {
          initCalled = true
          this.pools.entities.add({ id: 1, name: 'Entity' })
          this.pools.entities.add({ id: 2, name: 'Entity2' })
        },
        destroy() {
          destroyCalled = true
        }
      })

      testContainer.innerHTML = `
        <div data-component="psi-cleanup-comp">
          <div data-pool="entities" data-key="id">
            <template>
              <div class="entity"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForRAF()

      expect(initCalled).toBe(true)
      expect(testContainer.querySelectorAll('.entity').length).toBe(2)

      // Get component ID before destroying
      const compEl = testContainer.querySelector('[data-component-id]')
      const compId = compEl.dataset.componentId
      expect(wildflower.componentInstances.has(compId)).toBe(true)

      // Destroy the component
      wildflower.destroyComponent(compId)
      compEl.remove() // prevent MutationObserver re-scan
      await waitForUpdate(100)

      expect(destroyCalled).toBe(true)
      expect(wildflower.componentInstances.has(compId)).toBe(false)
    })

    it.skipIf(isMinifiedBuild())('pool does not receive updates after component destroy', async () => {
      wildflower.store('psi-post-destroy', {
        state: {
          items: [{ id: 1, name: 'A' }]
        },
        addItem(item) {
          this.state.items = [...this.state.items, item]
        }
      })

      let updateCount = 0

      wildflower.component('psi-post-destroy-comp', {
        state: {},
        subscribe: { 'psi-post-destroy': ['items'] },
        pools: { things: {} },
        init() {
          const store = wildflower.getStore('psi-post-destroy')
          for (const item of store.items) {
            this.pools.things.add({ ...item })
          }
        },
        onStoreUpdate(storeName) {
          if (storeName === 'psi-post-destroy') {
            updateCount++
          }
        }
      })

      testContainer.innerHTML = `
        <div data-component="psi-post-destroy-comp">
          <div data-pool="things" data-key="id">
            <template>
              <div class="thing"><span data-bind="name"></span></div>
            </template>
          </div>
        </div>
      `

      wildflower.scan(testContainer)
      await waitForCompleteRender()
      await waitForRAF()

      expect(testContainer.querySelectorAll('.thing').length).toBe(1)

      // Destroy the component
      const compEl = testContainer.querySelector('[data-component-id]')
      const compId = compEl.dataset.componentId
      wildflower.destroyComponent(compId)
      compEl.remove()
      await waitForUpdate(100)

      const updateCountBeforeMutation = updateCount

      // Mutate the store after destroy
      const store = wildflower.getStore('psi-post-destroy')
      store.addItem({ id: 2, name: 'B' })
      await waitForUpdate(100)
      await waitForRAF()

      // onStoreUpdate should NOT have been called after destroy
      expect(updateCount).toBe(updateCountBeforeMutation)
    })
  })
})
