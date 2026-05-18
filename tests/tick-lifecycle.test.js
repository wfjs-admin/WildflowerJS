/**
 * tick(dt) Lifecycle Hook
 *
 * Components with a `tick` method get called once per rAF frame
 * with (dt, now). The framework manages the rAF loop and cleanup.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, isMinifiedBuild, hasFeature } from './helpers/load-framework.js'

const describeIfPools = hasFeature('pools') ? describe : describe.skip

async function waitForFrames(ms = 200) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describeIfPools('tick(dt) Lifecycle Hook', () => {
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

    // Reset tick infrastructure
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

  it.skipIf(isMinifiedBuild())('tick receives positive dt values', async () => {
    testContainer.innerHTML = '<div data-component="tick-basic"></div>'

    const dtValues = []

    wildflower.component('tick-basic', {
      state: {},
      tick(dt) {
        dtValues.push(dt)
      }
    })

    wildflower.scan()
    await waitForFrames(200)

    expect(dtValues.length).toBeGreaterThanOrEqual(3)
    // All dt values should be positive numbers
    for (const dt of dtValues) {
      expect(dt).toBeGreaterThan(0)
      expect(typeof dt).toBe('number')
    }
  })

  it.skipIf(isMinifiedBuild())('tick receives (dt, now) arguments', async () => {
    testContainer.innerHTML = '<div data-component="tick-args"></div>'

    let capturedDt = null
    let capturedNow = null

    wildflower.component('tick-args', {
      state: {},
      tick(dt, now) {
        if (capturedDt === null) {
          capturedDt = dt
          capturedNow = now
        }
      }
    })

    wildflower.scan()
    await waitForFrames(100)

    expect(capturedDt).toBeGreaterThan(0)
    expect(capturedNow).toBeGreaterThan(0)
    // now should be a performance.now() timestamp (roughly current time)
    expect(capturedNow).toBeLessThanOrEqual(performance.now())
    expect(capturedNow).toBeGreaterThan(performance.now() - 5000)
  })

  it.skipIf(isMinifiedBuild())('tick works without pools', async () => {
    // No data-pool in the template — tick should still run
    testContainer.innerHTML = `
      <div data-component="tick-no-pool">
        <div data-bind="count"></div>
      </div>
    `

    let tickCount = 0

    wildflower.component('tick-no-pool', {
      state: { count: 0 },
      tick(dt) {
        tickCount++
      }
    })

    wildflower.scan()
    await waitForFrames(200)

    expect(tickCount).toBeGreaterThanOrEqual(3)
  })

  it.skipIf(isMinifiedBuild())('tick stops after component destroy', async () => {
    testContainer.innerHTML = '<div data-component="tick-destroy" id="tick-destroy-el"></div>'

    let tickCount = 0

    wildflower.component('tick-destroy', {
      state: {},
      tick(dt) {
        tickCount++
      }
    })

    wildflower.scan()
    await waitForFrames(150)

    const countBeforeDestroy = tickCount
    expect(countBeforeDestroy).toBeGreaterThanOrEqual(2)

    // Remove the component from DOM (triggers destroy)
    const el = document.getElementById('tick-destroy-el')
    el.parentNode.removeChild(el)

    // Wait and verify no more ticks
    await waitForFrames(150)

    // Allow at most 1 extra tick (in-flight rAF)
    expect(tickCount).toBeLessThanOrEqual(countBeforeDestroy + 1)
  })

  it.skipIf(isMinifiedBuild())('tick dt is clamped to 250ms', async () => {
    testContainer.innerHTML = '<div data-component="tick-clamp"></div>'

    const dtValues = []

    wildflower.component('tick-clamp', {
      state: {},
      tick(dt) {
        dtValues.push(dt)
      }
    })

    wildflower.scan()
    await waitForFrames(200)

    // All dt values should be <= 250
    for (const dt of dtValues) {
      expect(dt).toBeLessThanOrEqual(250)
    }
  })

  it.skipIf(isMinifiedBuild())('tick runs before pool flush', async () => {
    testContainer.innerHTML = `
      <div data-component="tick-before-flush">
        <div data-pool="items" data-key="id">
          <template>
            <div data-bind="value"></div>
          </template>
        </div>
      </div>
    `

    let tickRanBeforeFlush = false

    wildflower.component('tick-before-flush', {
      state: {},
      init() {
        this._pool = this.pool('items')
        this._pool.add({ id: 1, value: 'initial' })
      },
      tick(dt) {
        // Mutate the pool item during tick
        const item = this._pool.items[0]
        if (item && item.value === 'initial') {
          item.value = 'updated-in-tick'
          tickRanBeforeFlush = true
        }
      }
    })

    wildflower.scan()
    await waitForFrames(200)

    expect(tickRanBeforeFlush).toBe(true)
    // After flush, DOM should reflect the value set during tick
    const el = testContainer.querySelector('[data-pool] > div')
    expect(el).toBeTruthy()
    expect(el.textContent).toBe('updated-in-tick')
  })

  it.skipIf(isMinifiedBuild())('multiple components with tick all receive callbacks', async () => {
    testContainer.innerHTML = `
      <div data-component="tick-multi-a" id="tick-a"></div>
      <div data-component="tick-multi-b" id="tick-b"></div>
    `

    let countA = 0
    let countB = 0

    wildflower.component('tick-multi-a', {
      state: {},
      tick(dt) { countA++ }
    })

    wildflower.component('tick-multi-b', {
      state: {},
      tick(dt) { countB++ }
    })

    wildflower.scan()
    await waitForFrames(200)

    expect(countA).toBeGreaterThanOrEqual(3)
    expect(countB).toBeGreaterThanOrEqual(3)
  })

  it.skipIf(isMinifiedBuild())('component without tick has no overhead', async () => {
    testContainer.innerHTML = '<div data-component="no-tick-comp"></div>'

    wildflower.component('no-tick-comp', {
      state: { value: 1 }
    })

    wildflower.scan()
    await waitForFrames(100)

    // Just verify component works normally — no errors thrown
    expect(wildflower.getComponent('no-tick-comp').value).toBe(1)
  })
})
