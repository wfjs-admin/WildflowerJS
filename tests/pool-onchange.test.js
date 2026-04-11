/**
 * pool.onChange — Callback on pool mutations
 *
 * Setting pool.onChange = fn registers a callback that fires
 * on add(), remove(), and clear() with the pool as argument.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, isMinifiedBuild } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('pool.onChange Callback', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower

    if (wildflower.componentDefinitions) wildflower.componentDefinitions.clear()
    if (wildflower.componentInstances) wildflower.componentInstances.clear()
    if (wildflower.storeManager && wildflower.storeManager._namedStores) {
      wildflower.storeManager._namedStores.clear()
    }
    if (wildflower._templateCache) {
      if (wildflower._templateCache.general) wildflower._templateCache.general.clear()
      if (wildflower._templateCache.lists) wildflower._templateCache.lists.clear()
      if (wildflower._templateCache.compiled) wildflower._templateCache.compiled.clear()
      if (wildflower._templateCache.extracted) wildflower._templateCache.extracted.clear()
      if (wildflower._templateCache.fragmentPools) wildflower._templateCache.fragmentPools.clear()
      if (wildflower._templateCache.stats) wildflower._templateCache.stats.clear()
    }
    if (wildflower._tickableInstances) wildflower._tickableInstances.length = 0

    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    testContainer.style.opacity = '0'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  it.skipIf(isMinifiedBuild())('onChange fires on add with correct size', async () => {
    testContainer.innerHTML = `
      <div data-component="onchange-add">
        <div data-pool="items" data-key="id">
          <template><div data-bind="name"></div></template>
        </div>
      </div>
    `

    let lastSize = -1
    let callCount = 0

    wildflower.component('onchange-add', {
      state: {},
      init() {
        const pool = this.pool('items')
        pool.onChange = (p) => {
          lastSize = p.size
          callCount++
        }
        pool.add({ id: 1, name: 'First' })
        pool.add({ id: 2, name: 'Second' })
      }
    })

    wildflower.scan()
    await waitForUpdate(100)

    expect(callCount).toBe(2)
    expect(lastSize).toBe(2)
  })

  it.skipIf(isMinifiedBuild())('onChange fires on remove with correct size', async () => {
    testContainer.innerHTML = `
      <div data-component="onchange-remove">
        <div data-pool="items" data-key="id">
          <template><div data-bind="name"></div></template>
        </div>
      </div>
    `

    let sizes = []

    wildflower.component('onchange-remove', {
      state: {},
      init() {
        const pool = this.pool('items')
        pool.add({ id: 1, name: 'First' })
        pool.add({ id: 2, name: 'Second' })
        pool.add({ id: 3, name: 'Third' })

        pool.onChange = (p) => { sizes.push(p.size) }

        pool.remove(2)
        pool.remove(1)
      }
    })

    wildflower.scan()
    await waitForUpdate(100)

    expect(sizes).toEqual([2, 1])
  })

  it.skipIf(isMinifiedBuild())('onChange fires on clear with size 0', async () => {
    testContainer.innerHTML = `
      <div data-component="onchange-clear">
        <div data-pool="items" data-key="id">
          <template><div data-bind="name"></div></template>
        </div>
      </div>
    `

    let lastSize = -1

    wildflower.component('onchange-clear', {
      state: {},
      init() {
        const pool = this.pool('items')
        pool.add({ id: 1, name: 'First' })
        pool.add({ id: 2, name: 'Second' })

        pool.onChange = (p) => { lastSize = p.size }
        pool.clear()
      }
    })

    wildflower.scan()
    await waitForUpdate(100)

    expect(lastSize).toBe(0)
  })

  it.skipIf(isMinifiedBuild())('no error when onChange is not set', async () => {
    testContainer.innerHTML = `
      <div data-component="onchange-null">
        <div data-pool="items" data-key="id">
          <template><div data-bind="name"></div></template>
        </div>
      </div>
    `

    wildflower.component('onchange-null', {
      state: {},
      init() {
        const pool = this.pool('items')
        // No onChange set — should not throw
        pool.add({ id: 1, name: 'Test' })
        pool.remove(1)
        pool.add({ id: 2, name: 'Test2' })
        pool.clear()
      }
    })

    wildflower.scan()
    await waitForUpdate(100)

    // Just verify no crash
    expect(true).toBe(true)
  })

  it.skipIf(isMinifiedBuild())('pool.size is already updated when callback fires', async () => {
    testContainer.innerHTML = `
      <div data-component="onchange-timing">
        <div data-pool="items" data-key="id">
          <template><div data-bind="name"></div></template>
        </div>
      </div>
    `

    let sizeAtCallback = -1

    wildflower.component('onchange-timing', {
      state: {},
      init() {
        const pool = this.pool('items')
        pool.onChange = (p) => { sizeAtCallback = p.size }
        pool.add({ id: 1, name: 'First' })
      }
    })

    wildflower.scan()
    await waitForUpdate(100)

    // Size should be 1 when callback fires (entity already added)
    expect(sizeAtCallback).toBe(1)
  })
})
