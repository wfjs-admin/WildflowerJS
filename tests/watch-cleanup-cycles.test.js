/**
 * Watch Cleanup & Cycle Test Suite
 *
 * Tests that watchers are properly cleaned up when components are destroyed,
 * and that mutual-dependency watch cycles don't cause infinite loops.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}



describe('Watch Cleanup & Cycles', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    if (wildflower._initContextSystem) {
      wildflower._contextSystemInitialized = false
      wildflower._initContextSystem()
    }

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

  // ── Cleanup on component destroy ──────────────────────────────────

  describe('Cleanup on component destroy', () => {

    it('watcher does NOT fire after component is destroyed', async () => {
      let callCount = 0

      wildflower.component('cleanup-basic', {
        state: { count: 0 },
        watch: {
          count(newVal) {
            callCount++
          }
        },
        bump() {
          this.state.count++
        }
      })

      testContainer.innerHTML = `
        <div data-component="cleanup-basic">
          <span data-bind="count"></span>
          <button id="cleanup-btn" data-action="bump">+</button>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(100)

      // Trigger watcher once to confirm it works
      testContainer.querySelector('#cleanup-btn').click()
      await waitForUpdate(100)
      expect(callCount).toBe(1)

      // Get instance and destroy
      const el = testContainer.querySelector('[data-component="cleanup-basic"]')
      const instanceId = el.dataset.componentId
      const instance = wildflower.componentInstances.get(instanceId)

      wildflower.destroyComponent(instanceId)
      await waitForUpdate(100)

      // Try to mutate state after destroy — watcher should NOT fire
      const prevCount = callCount
      try {
        instance.state.count = 99
      } catch (e) {
        // May throw if proxy is revoked — that's fine
      }
      await waitForUpdate(100)

      expect(callCount).toBe(prevCount)
    })

    it('multiple watchers all cleaned up on destroy', async () => {
      let aCalls = 0
      let bCalls = 0

      wildflower.component('cleanup-multi', {
        state: { a: 0, b: 0 },
        watch: {
          a() { aCalls++ },
          b() { bCalls++ }
        },
        bumpA() { this.state.a++ },
        bumpB() { this.state.b++ }
      })

      testContainer.innerHTML = `
        <div data-component="cleanup-multi">
          <button id="cm-a" data-action="bumpA">A</button>
          <button id="cm-b" data-action="bumpB">B</button>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(100)

      // Confirm both watchers fire
      testContainer.querySelector('#cm-a').click()
      await waitForUpdate(100)
      testContainer.querySelector('#cm-b').click()
      await waitForUpdate(100)
      expect(aCalls).toBe(1)
      expect(bCalls).toBe(1)

      // Destroy
      const el = testContainer.querySelector('[data-component="cleanup-multi"]')
      const instanceId = el.dataset.componentId
      const instance = wildflower.componentInstances.get(instanceId)

      wildflower.destroyComponent(instanceId)
      await waitForUpdate(100)

      // Mutate after destroy
      const prevA = aCalls
      const prevB = bCalls
      try {
        instance.state.a = 50
        instance.state.b = 50
      } catch (e) {
        // proxy revoked — acceptable
      }
      await waitForUpdate(100)

      expect(aCalls).toBe(prevA)
      expect(bCalls).toBe(prevB)
    })

    it('watcher with store side effect does not fire after destroy', async () => {
      let watcherFiredAfterDestroy = false

      wildflower.store('side-effect-store', {
        state: { log: [] }
      })

      wildflower.component('cleanup-side-effect', {
        state: { trigger: 0 },
        watch: {
          trigger(newVal) {
            watcherFiredAfterDestroy = true
            const store = wildflower.getStore('side-effect-store')
            store.log.push(newVal)
          }
        },
        fire() {
          this.state.trigger++
        }
      })

      testContainer.innerHTML = `
        <div data-component="cleanup-side-effect">
          <button id="cse-btn" data-action="fire">Fire</button>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(100)

      // Fire once to confirm
      testContainer.querySelector('#cse-btn').click()
      await waitForUpdate(100)
      expect(watcherFiredAfterDestroy).toBe(true)

      // Destroy
      const el = testContainer.querySelector('[data-component="cleanup-side-effect"]')
      const instanceId = el.dataset.componentId
      const instance = wildflower.componentInstances.get(instanceId)

      wildflower.destroyComponent(instanceId)
      await waitForUpdate(100)

      // Reset flag and try to trigger
      watcherFiredAfterDestroy = false
      const storeBefore = wildflower.getStore('side-effect-store').log.length

      try {
        instance.state.trigger = 99
      } catch (e) {
        // proxy revoked — acceptable
      }
      await waitForUpdate(100)

      expect(watcherFiredAfterDestroy).toBe(false)
      expect(wildflower.getStore('side-effect-store').log.length).toBe(storeBefore)
    })
  })

  // ── Watch with store subscriptions ────────────────────────────────

  describe('Watch with store subscriptions', () => {

    it('watcher that reads from store still works', async () => {
      let captured = null

      wildflower.store('reader-store', {
        state: { multiplier: 10 }
      })

      wildflower.component('watch-store-read', {
        state: { value: 1 },
        watch: {
          value(newVal) {
            const store = wildflower.getStore('reader-store')
            captured = newVal * store.multiplier
          }
        },
        bump() {
          this.state.value = 5
        }
      })

      testContainer.innerHTML = `
        <div data-component="watch-store-read">
          <button id="wsr-btn" data-action="bump">Bump</button>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(100)

      testContainer.querySelector('#wsr-btn').click()
      await waitForUpdate(100)

      expect(captured).toBe(50)
    })

    it('store-dependent watcher cleaned up when component destroyed', async () => {
      let callCount = 0

      wildflower.store('dep-store', {
        state: { factor: 2 }
      })

      wildflower.component('watch-store-cleanup', {
        state: { input: 0 },
        watch: {
          input(newVal) {
            callCount++
            const store = wildflower.getStore('dep-store')
            // Just access store — proves it was alive during the call
            void store.factor
          }
        },
        setInput() {
          this.state.input++
        }
      })

      testContainer.innerHTML = `
        <div data-component="watch-store-cleanup">
          <button id="wsc-btn" data-action="setInput">Set</button>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(100)

      // Confirm it fires
      testContainer.querySelector('#wsc-btn').click()
      await waitForUpdate(100)
      expect(callCount).toBe(1)

      // Destroy
      const el = testContainer.querySelector('[data-component="watch-store-cleanup"]')
      const instanceId = el.dataset.componentId
      const instance = wildflower.componentInstances.get(instanceId)

      wildflower.destroyComponent(instanceId)
      await waitForUpdate(100)

      // Attempt mutation after destroy
      const prev = callCount
      try {
        instance.state.input = 999
      } catch (e) {
        // proxy revoked
      }
      await waitForUpdate(100)

      expect(callCount).toBe(prev)
    })
  })

  // ── Watch cycles (mutual dependencies) ────────────────────────────

  describe('Watch cycles (mutual dependencies)', () => {

    it('mutual watchers do not cause infinite loop', async () => {
      let aCallCount = 0
      let bCallCount = 0
      const MAX_GUARD = 20

      wildflower.component('watch-cycle', {
        state: { a: 0, b: 0 },
        watch: {
          a(newVal) {
            aCallCount++
            // Update b when a changes — guarded to prevent true infinite loop
            if (aCallCount < MAX_GUARD && newVal !== this.state.b) {
              this.state.b = newVal + 1
            }
          },
          b(newVal) {
            bCallCount++
            // Update a when b changes — guarded
            if (bCallCount < MAX_GUARD && newVal !== this.state.a) {
              this.state.a = newVal + 1
            }
          }
        },
        start() {
          this.state.a = 1
        }
      })

      testContainer.innerHTML = `
        <div data-component="watch-cycle">
          <span id="wc-a" data-bind="a"></span>
          <span id="wc-b" data-bind="b"></span>
          <button id="wc-btn" data-action="start">Start</button>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(100)

      // Trigger the cycle
      testContainer.querySelector('#wc-btn').click()
      await waitForUpdate(300)

      // Both watchers should have fired (the cycle ran).
      // The framework or our guard broke it — we reached this point without hanging.
      expect(aCallCount).toBeGreaterThan(0)
      expect(bCallCount).toBeGreaterThan(0)
      expect(aCallCount).toBeLessThan(MAX_GUARD + 1)
      expect(bCallCount).toBeLessThan(MAX_GUARD + 1)
    })

    it('self-updating watcher converges when guarded', async () => {
      let callCount = 0

      wildflower.component('watch-self-update', {
        state: { value: 0 },
        watch: {
          value(newVal) {
            callCount++
            // Increment up to a small target, then stop
            if (newVal < 5) {
              this.state.value = newVal + 1
            }
          }
        },
        kick() {
          this.state.value = 1
        }
      })

      testContainer.innerHTML = `
        <div data-component="watch-self-update">
          <span id="wsu-val" data-bind="value"></span>
          <button id="wsu-btn" data-action="kick">Kick</button>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(100)

      testContainer.querySelector('#wsu-btn').click()
      await waitForUpdate(300)

      // Watcher should have fired multiple times and converged at value=5
      expect(callCount).toBeGreaterThan(0)
      expect(callCount).toBeLessThanOrEqual(10)
    })
  })

  // ── Deep vs shallow watch ─────────────────────────────────────────

  describe('Deep vs shallow watch', () => {

    it('watch on object fires when nested property changes', async () => {
      let watchFired = false
      let receivedVal = null

      wildflower.component('watch-deep-obj', {
        state: {
          user: { name: 'Alice', age: 30 }
        },
        watch: {
          'user.name'(newVal) {
            watchFired = true
            receivedVal = newVal
          }
        },
        changeName() {
          this.state.user.name = 'Bob'
        }
      })

      testContainer.innerHTML = `
        <div data-component="watch-deep-obj">
          <span id="wdo-name" data-bind="user.name"></span>
          <button id="wdo-btn" data-action="changeName">Change</button>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(100)

      testContainer.querySelector('#wdo-btn').click()
      await waitForUpdate(100)

      expect(watchFired).toBe(true)
      expect(receivedVal).toBe('Bob')
    })

    it('watch on array fires on push', async () => {
      let watchFired = false

      wildflower.component('watch-array-push', {
        state: {
          items: ['a', 'b']
        },
        watch: {
          items(newVal) {
            watchFired = true
          }
        },
        addItem() {
          this.state.items.push('c')
        }
      })

      testContainer.innerHTML = `
        <div data-component="watch-array-push">
          <button id="wap-btn" data-action="addItem">Add</button>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(100)

      testContainer.querySelector('#wap-btn').click()
      await waitForUpdate(100)

      expect(watchFired).toBe(true)
    })

    it('watch on array fires on splice', async () => {
      let watchFired = false

      wildflower.component('watch-array-splice', {
        state: {
          items: ['x', 'y', 'z']
        },
        watch: {
          items(newVal) {
            watchFired = true
          }
        },
        removeMiddle() {
          this.state.items.splice(1, 1)
        }
      })

      testContainer.innerHTML = `
        <div data-component="watch-array-splice">
          <button id="was-btn" data-action="removeMiddle">Remove</button>
        </div>
      `

      wildflower.scan()
      await waitForUpdate(100)

      testContainer.querySelector('#was-btn').click()
      await waitForUpdate(100)

      expect(watchFired).toBe(true)
    })
  })
})
