/**
 * Regression: the async component scanner must register store subscriptions
 * (subscribePath, _registerEntityDependent) BEFORE the first computed-eval
 * microtask flush runs.
 *
 * Bug shape (FF non-deterministic on PM demo soft-reload of /project/<id>
 * and /team/<id>/cycle/<n>; fixed 2026-05-17 by hoisting
 * _setupStoreSubscriptions to a pre-pass in both sync + async orchestrators
 * in ComponentScanning.js):
 *
 *   1. Async scanner runs in phases via processWithIdleYield:
 *        a. Create instances
 *        b. Setup computed properties (addComputed enqueues initial evals)
 *        c. beforeInit hooks
 *        d. Setup features (which includes _setupStoreSubscriptions)
 *      processWithIdleYield can yield via requestIdleCallback between phases
 *      (or between batches within a phase) when sprint budget is exceeded.
 *   2. During a yield, the computed-eval microtask flush runs. The first
 *      body eval happens. If the body early-returns (or reads cross-store
 *      via a bound method whose receiver isn't the tracking proxy), the
 *      tracking proxy never adds the cross-store RSM to the computed
 *      node's externalSources, and _registerEntityDependent never fires
 *      for the cross-store.
 *   3. Between yields, an async store init (e.g. await PMStorage.open())
 *      can resolve and mutate state. The cascade fires for the store's
 *      registered entity-deps — but our component isn't registered yet
 *      (subscribePath hasn't run), so the cascade misses it.
 *   4. By the time subscribePath finally runs in phase (d), the mutation
 *      has already fired. The component's cached null persists; no
 *      future mutation triggers re-evaluation, leaving the DOM stuck on
 *      the empty initial render.
 *
 * Fix: hoist `_setupStoreSubscriptions` to a synchronous pre-pass that
 * runs BEFORE phase (b). Idempotency guard (instance._subscriptionsSetup)
 * makes the original post-features call a no-op.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

describe('scanner registers subscribePath before first computed eval', () => {
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

  it('component is an entity-dep of the store before any computed body runs', async () => {
    // The fix asserts an invariant: subscribePath must run before the first
    // computed eval. We probe that invariant directly by recording the
    // order of (a) entity-dep registration on the store vs (b) the
    // component's computed body first execution.
    const order = []

    wildflower.store('order-store', {
      state: { items: [] }
    })

    testContainer.innerHTML = '<div data-component="order-reader"></div>'
    wildflower.component('order-reader', {
      subscribe: { 'order-store': ['items'] },
      computed: {
        probe() {
          // First body eval — capture the current entity-dep state of the
          // store at the moment the body runs. If subscribePath ran first
          // (the post-fix invariant), this component IS already a
          // registered dep.
          const fw = window.wildflower
          let storeId = null
          let componentId = null
          fw.componentInstances.forEach((inst, id) => {
            if (inst.name === 'store-order-store') storeId = id
            if (inst.name === 'order-reader') componentId = id
          })
          const deps = storeId ? fw._getEntityDependents(storeId) : null
          order.push({
            event: 'computed-body',
            componentRegistered: !!(deps && componentId && deps.has(componentId))
          })
          return this.stores['order-store'].items.length
        }
      }
    })

    await waitForCompleteRender()

    // The probe body should have run at least once, and at the moment it
    // first ran, the component should already have been registered as a
    // store entity-dep — confirming subscribePath was hoisted ahead of
    // computed eval. Pre-fix, the first body run would see
    // componentRegistered === false.
    expect(order.length).toBeGreaterThan(0)
    expect(order[0].componentRegistered).toBe(true)
  })

  it('component picks up async store mutation that fires between scanner phases', async () => {
    // Forces the race: store init does a microtask-boundary delayed
    // mutation. Component reads via a store METHOD (so the tracking
    // proxy can't catch the cross-store dep automatically — it would
    // only register if subscribePath populated the dep first). The
    // body has an early-return on a flag that's only true post-mutation,
    // mirroring the PM demo's _cycle / project shape.
    testContainer.innerHTML = `
      <div data-component="race-reader">
        <span class="count" data-bind="loadedCount"></span>
      </div>
    `

    wildflower.store('race-store', {
      state: { loaded: false, items: [] },
      getCount() {
        if (!this.loaded) return -1
        return this.items.length
      },
      async init() {
        // Defer past at least one microtask + setTimeout boundary so the
        // scanner has every chance to yield between phases before the
        // mutation arrives.
        await new Promise(r => setTimeout(r, 5))
        this.items = [{ id: 1 }, { id: 2 }, { id: 3 }]
        this.loaded = true
      }
    })

    wildflower.component('race-reader', {
      subscribe: { 'race-store': ['loaded', 'items'] },
      computed: {
        loadedCount() {
          // Method call — pre-fix this didn't register the cross-store
          // dep via the tracking proxy because `this` inside the method
          // is the bound raw context, not the tracking proxy.
          return this.stores['race-store'].getCount()
        }
      }
    })

    await waitForCompleteRender()
    await new Promise(r => setTimeout(r, 50))
    await waitForCompleteRender()

    const span = testContainer.querySelector('.count')
    expect(span).toBeTruthy()
    // Pre-fix: stays on '-1' (cached from first eval where loaded=false).
    // Post-fix: subscribePath ran before first eval, so the async store
    // mutation cascade-invalidates the computed and the body re-runs
    // with loaded=true.
    expect(span.textContent).toBe('3')
  })
})
