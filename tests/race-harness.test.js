/**
 * Race-harness — Plan B from
 * docs/future/REACTIVITY_HARDENING_PROPOSAL_2026-05-17.md.
 *
 * Fuzzes async timing across the lifecycle to catch the *class* of
 * ordering bug rather than specific instances. Each parameterized scenario
 * runs across a delay matrix; if any combination fails, an ordering race
 * exists. The proposal calls out a few patterns explicitly:
 *
 *   - Component + store with async init that mutates at delay D
 *     {0, 1, 5, 10, 50, 100}ms.
 *   - Component subscribing to N ∈ {1, 2, 4} stores with varying mutation
 *     timings.
 *   - Computed using method-call cross-store read + early-return.
 *   - Rapid mount/unmount of components subscribed to the same store.
 *
 * Assertions cover DOM state AND internal cache state (when possible),
 * since "DOM happens to be right by accident" is a known failure mode.
 *
 * Companion: tests/lifecycle-invariants.test.js (Plan A) — focused
 * single-invariant tests; this file is the parameterized race surface.
 *
 * Author: amber-otter-23, 2026-05-17.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

const DELAY_MATRIX = [0, 1, 5, 10, 50, 100]

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

function freshContainer() {
  const c = document.createElement('div')
  c.style.position = 'absolute'
  c.style.left = '-9999px'
  c.style.opacity = '0'
  document.body.appendChild(c)
  return c
}

function cleanup(container) {
  if (container && container.parentNode) {
    container.parentNode.removeChild(container)
  }
}

function resetFw(wildflower) {
  resetFramework()
  if (wildflower._initContextSystem) {
    wildflower._contextSystemInitialized = false
    wildflower._initContextSystem()
  }
  if (wildflower._listRelationships) {
    wildflower._listRelationships.clear()
  }
  if (wildflower._poolLoopRunning) {
    wildflower._poolLoopRunning = false
    if (wildflower._poolLoopId) {
      cancelAnimationFrame(wildflower._poolLoopId)
      wildflower._poolLoopId = null
    }
  }
}

describe('race harness', () => {
  let wildflower

  beforeAll(async () => {
    await loadFramework()
    wildflower = window.wildflower
  })

  // =========================================================================
  // Scenario 1: async-init store mutation at various delays
  //
  // Mirrors the PM-demo bug shape (slate-heron-37 / russet-lichen-19):
  // store's async init() delays N ms then mutates state. A component reads
  // the post-mutation state via a method call with early-return. The
  // cascade must reach the component for every D in DELAY_MATRIX.
  // =========================================================================
  describe('async-init store mutation timing', () => {
    for (const D of DELAY_MATRIX) {
      it(`delay=${D}ms: component picks up async store mutation`, async () => {
        const container = freshContainer()
        resetFw(wildflower)

        const STORE = `race-s1-d${D}`
        const COMP = `race-s1-c-d${D}`

        wildflower.store(STORE, {
          state: { loaded: false, items: [] },
          getCount() {
            if (!this.loaded) return -1
            return this.items.length
          },
          async init() {
            await new Promise(r => setTimeout(r, D))
            this.items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]
            this.loaded = true
          }
        })

        wildflower.component(COMP, {
          subscribe: { [STORE]: ['loaded', 'items'] },
          computed: {
            count() {
              return this.stores[STORE].getCount()
            }
          }
        })

        container.innerHTML = `<div data-component="${COMP}"><span class="v" data-bind="count"></span></div>`
        ensureComponentScanning(wildflower)
        await waitForCompleteRender()
        // Extra buffer for the longest delays in the matrix.
        await new Promise(r => setTimeout(r, Math.max(50, D + 50)))
        await waitForCompleteRender()

        const span = container.querySelector('.v')
        expect(span, `delay=${D}: span exists`).toBeTruthy()
        expect(span.textContent, `delay=${D}: post-mutation count rendered`).toBe('5')

        cleanup(container)
      })
    }
  })

  // =========================================================================
  // Scenario 2: multi-store subscribe with varying mutation timings
  //
  // A component subscribing to 1, 2, and 4 stores simultaneously. Each
  // store mutates at a different delay. All cascades must fire and the
  // computed must reflect the final combined state. Catches order-dependent
  // dep-registration races that single-store tests miss.
  // =========================================================================
  describe('multi-store subscribe with interleaved mutations', () => {
    for (const N of [1, 2, 4]) {
      it(`N=${N} stores: component aggregates final state`, async () => {
        const container = freshContainer()
        resetFw(wildflower)

        const stores = []
        for (let i = 0; i < N; i++) {
          const name = `race-s2-store-${N}-${i}`
          const delay = (i + 1) * 3 // 3, 6, 9, 12ms — within microtask + setTimeout precision
          wildflower.store(name, {
            state: { value: 0 },
            async init() {
              await new Promise(r => setTimeout(r, delay))
              this.value = (i + 1) * 10
            }
          })
          stores.push(name)
        }

        const subscribe = {}
        for (const s of stores) subscribe[s] = ['value']

        const COMP = `race-s2-c-n${N}`
        wildflower.component(COMP, {
          subscribe,
          computed: {
            sum() {
              let s = 0
              for (const name of stores) s += this.stores[name].value
              return s
            }
          }
        })

        container.innerHTML = `<div data-component="${COMP}"><span class="s" data-bind="sum"></span></div>`
        ensureComponentScanning(wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 60))
        await waitForCompleteRender()

        // Expected: 10 + 20 + ... = sum_{i=1..N} 10*i = 10 * N(N+1)/2
        const expected = 10 * N * (N + 1) / 2
        const span = container.querySelector('.s')
        expect(span.textContent, `N=${N}: aggregated sum`).toBe(String(expected))

        cleanup(container)
      })
    }
  })

  // =========================================================================
  // Scenario 3: method-call cross-store read + early-return cascade
  //
  // The exact bug shape from the PM-demo regression (and the doc's Medium
  // risk category). Computed body reads `this.stores['x'].method()` where
  // the method early-returns based on a flag. First eval returns the
  // early-return value; mutation must invalidate.
  //
  // This is also tested in I-CROSS-STORE-METHOD-CALL but here we sweep the
  // mutation timing to verify the cascade fires regardless of when the
  // mutation lands relative to scanner phases.
  // =========================================================================
  describe('method-call cross-store with early-return', () => {
    for (const D of [0, 5, 50]) {
      it(`delay=${D}ms: early-return computed re-evaluates post-mutation`, async () => {
        const container = freshContainer()
        resetFw(wildflower)

        const STORE = `race-s3-store-${D}`
        const COMP = `race-s3-comp-${D}`

        wildflower.store(STORE, {
          state: { ready: false, val: 'init' },
          read() {
            if (!this.ready) return '<pending>'
            return this.val
          }
        })

        wildflower.component(COMP, {
          subscribe: { [STORE]: ['ready', 'val'] },
          computed: {
            out() {
              return this.stores[STORE].read()
            }
          }
        })

        container.innerHTML = `<div data-component="${COMP}"><span class="o" data-bind="out"></span></div>`
        ensureComponentScanning(wildflower)
        await waitForCompleteRender()

        // Mutate at the test-level (not async init) so we can sweep the
        // delay independently of store init scheduling.
        await new Promise(r => setTimeout(r, D))
        const store = wildflower.getStore(STORE)
        store.val = 'loaded'
        store.ready = true
        await waitForCompleteRender()

        const span = container.querySelector('.o')
        expect(span.textContent, `delay=${D}: cascade reached computed`).toBe('loaded')

        cleanup(container)
      })
    }
  })

  // =========================================================================
  // Scenario 4: rapid mount/unmount stress
  //
  // Mount + unmount the same component repeatedly while a store mutation
  // fires in the background. No leaks, no stale watchers firing on
  // destroyed instances, no thrown errors.
  // =========================================================================
  describe('rapid mount/unmount stress', () => {
    it('repeated mount + remove + scan does not leak or throw', async () => {
      const container = freshContainer()
      resetFw(wildflower)

      let watcherFiredAfterDestroy = 0
      const destroyedIds = new Set()

      wildflower.store('race-s4-store', {
        state: { tick: 0 }
      })

      wildflower.component('race-s4-comp', {
        subscribe: { 'race-s4-store': ['tick'] },
        watch: {
          'stores.race-s4-store.tick'(newVal) {
            // If this fires for an instance whose element has been removed
            // AND the instance has been destroyed, count it.
            const myId = this._id
            if (destroyedIds.has(myId)) {
              watcherFiredAfterDestroy++
            }
          }
        },
        init() {
          // Capture id for the post-destroy watcher-leak detector.
          const el = this.element || (this.$ && this.$.root)
          const id = el?.dataset?.componentId
          this._id = id
        }
      })

      ensureComponentScanning(wildflower)
      const store = wildflower.getStore('race-s4-store')

      for (let cycle = 0; cycle < 10; cycle++) {
        container.innerHTML = '<div data-component="race-s4-comp"></div>'
        wildflower.scan(container)
        // Let init() macrotask fire so _initReady is set + watchers are wired.
        await new Promise(r => setTimeout(r, 5))

        // Mutate mid-life — should hit the live watcher.
        store.tick = cycle * 2 + 1

        // Tear down: remove DOM element + destroy instance.
        const el = container.querySelector('[data-component-id]')
        if (el) {
          destroyedIds.add(el.dataset.componentId)
          const id = el.dataset.componentId
          el.remove()
          wildflower.destroyComponent(id)
        }

        // Mutate again AFTER teardown — must not reach the destroyed instance.
        store.tick = cycle * 2 + 2
        await new Promise(r => setTimeout(r, 5))
      }

      await waitForCompleteRender()

      // After 10 cycles, no watcher on a destroyed instance should have fired.
      expect(watcherFiredAfterDestroy, 'no leaked watchers').toBe(0)

      cleanup(container)
    })
  })

  // =========================================================================
  // Scenario 5: concurrent component initialization with shared store
  //
  // Multiple components mounted in the same scan, all subscribed to the
  // same store that mutates between scanner phases. Every component must
  // see the post-mutation state. Catches per-component dep-registration
  // gaps that single-component tests miss.
  // =========================================================================
  describe('concurrent component init with shared store mutation', () => {
    for (const N of [3, 10]) {
      it(`N=${N} components: all see post-mutation store state`, async () => {
        const container = freshContainer()
        resetFw(wildflower)

        const STORE = `race-s5-store-${N}`
        const COMP = `race-s5-comp-${N}`

        wildflower.store(STORE, {
          state: { v: 0 },
          async init() {
            await new Promise(r => setTimeout(r, 5))
            this.v = 999
          }
        })

        wildflower.component(COMP, {
          subscribe: { [STORE]: ['v'] },
          computed: {
            display() {
              return this.stores[STORE].v
            }
          }
        })

        let html = ''
        for (let i = 0; i < N; i++) {
          html += `<div data-component="${COMP}"><span class="v" data-bind="display"></span></div>`
        }
        container.innerHTML = html

        ensureComponentScanning(wildflower)
        await waitForCompleteRender()
        await new Promise(r => setTimeout(r, 60))
        await waitForCompleteRender()

        const spans = container.querySelectorAll('.v')
        expect(spans.length, `${N} components rendered`).toBe(N)
        for (let i = 0; i < spans.length; i++) {
          expect(spans[i].textContent, `component[${i}] saw post-mutation value`).toBe('999')
        }

        cleanup(container)
      })
    }
  })
})
