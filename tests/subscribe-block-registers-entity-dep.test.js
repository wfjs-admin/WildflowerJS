/**
 * Regression: subscribe-block must register as both path-subscriber AND
 * entity-dependent of the store.
 *
 * Bug shape (Chrome-only on PM demo, fixed 2026-05-15 in subscribePath):
 *   1. Component declares `subscribe: { storeX: ['somePath'] }`.
 *   2. Component has a computed that reads storeX.somePath (directly or via
 *      a store method) AND has an early-return branch that may skip the
 *      cross-store read during the initial computed eval.
 *   3. storeX.somePath is mutated asynchronously after component init.
 *   4. Pre-fix: path-subscriber dispatch fired onStoreUpdate only; computeds
 *      never re-evaluated because the component was missing from the store's
 *      entity-dependent set. DOM binding stayed on its stale cached value.
 *   5. Post-fix: subscribePath now also calls _registerEntityDependent, so
 *      mutations to subscribed paths dirty the component's computeds via the
 *      entity-dep dispatch loop in _handleEntityStateChange.
 *
 * Why Chrome-only on the demo: V8 microtask ordering caused the initial
 * computed eval to take the early-return branch, then the post-router re-eval
 * to hit the cross-RSM cache-hit fast path which doesn't re-track. Firefox's
 * timing happened to register the cross-store dep via the tracking proxy on
 * initial eval. The dep-graph weakness was browser-shared; the surfacing was
 * Chrome-specific.
 *
 * See docs/PM_DEMO_CHROME_SOFT_RELOAD_DIAGNOSIS_2026-05-15.md.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

describe('subscribe-block registers component as entity-dependent', () => {
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

  it('registers subscribing component in store._entityDependents', () => {
    wildflower.store('regr-a', { state: { items: [] } })

    testContainer.innerHTML = '<div data-component="regr-reader-1"></div>'
    wildflower.component('regr-reader-1', {
      subscribe: { 'regr-a': ['items'] },
      state: {}
    })

    return waitForCompleteRender().then(() => {
      const fw = wildflower
      let storeId = null
      let componentId = null
      fw.componentInstances.forEach((inst, id) => {
        if (inst.name === 'store-regr-a') storeId = id
        if (inst.name === 'regr-reader-1') componentId = id
      })
      expect(storeId).toBeTruthy()
      expect(componentId).toBeTruthy()

      const deps = fw._getEntityDependents(storeId)
      expect(deps.has(componentId)).toBe(true)
    })
  })

  it('binding effect on a computed gated by cross-store state wakes when store mutates after subscribe-only declaration', async () => {
    // The exact PM-demo shape: subscribed cross-store path + computed gated
    // by an early-return condition on a different store + async whole-array
    // reassignment on the subscribed store.
    testContainer.innerHTML = `
      <div data-component="regr-reader-2">
        <span class="visible-if-found" data-show="hasMatch">
          <span class="title" data-bind="matchedTitle"></span>
        </span>
      </div>
    `

    wildflower.store('regr-ui', {
      state: { selectedId: null },
      init() {
        // sync: simulate router setting an id BEFORE the data store hydrates
        this.selectedId = 'b'
      }
    })

    wildflower.store('regr-pm', {
      state: { items: [] },
      // Pure helper (no underscore = framework lifecycle won't queue it,
      // but binding from a computed before init isn't the concern here).
      // The fix doesn't depend on this being a method vs a computed —
      // the issue is about how the subscribe block wires entity-deps.
      getItem(id) {
        for (let i = 0; i < this.items.length; i++) {
          if (this.items[i].id === id) return this.items[i]
        }
        return null
      },
      async init() {
        await new Promise(r => setTimeout(r, 10))
        this.items = [
          { id: 'a', title: 'A title' },
          { id: 'b', title: 'B title' },
          { id: 'c', title: 'C title' }
        ]
      }
    })

    wildflower.component('regr-reader-2', {
      subscribe: {
        'regr-ui': ['selectedId'],
        'regr-pm': ['items']
      },
      computed: {
        // Mirrors PM demo's _currentIssue: ui-id early-return, then cross-store read.
        _match() {
          const id = this.stores['regr-ui'].selectedId
          if (!id) return null
          // Cross-store read via store method — this is the path that
          // pre-fix did not always register pm as a tracked dep.
          return this.stores['regr-pm'].getItem(id)
        },
        hasMatch() {
          return !!this.computed._match
        },
        matchedTitle() {
          const m = this.computed._match
          return m ? m.title : ''
        }
      }
    })

    await waitForCompleteRender()
    // wait for the async pm.init to land + reactivity to flush
    await new Promise(r => setTimeout(r, 80))
    await waitForCompleteRender()

    const inner = testContainer.querySelector('[data-show="hasMatch"]')
    const title = testContainer.querySelector('.title')

    expect(inner).toBeTruthy()
    expect(title).toBeTruthy()
    // Before fix: inner stayed display:none, title was empty.
    expect(inner.style.display).not.toBe('none')
    expect(title.textContent).toBe('B title')
  })

  it('path-scoped invalidation still skips mutations to unrelated paths', async () => {
    // Verifies the fix doesn't widen the invalidation surface: a mutation
    // to an UNSUBSCRIBED path on the store should NOT dirty the subscriber's
    // computeds. _entityPathAffectsDependent gates on _storeSubscriptions
    // before the entity-dep dispatch loop runs the dirty-marking block.
    let evalCount = 0

    wildflower.store('regr-multi', {
      state: { tracked: 'initial', untracked: 'initial' }
    })

    testContainer.innerHTML = '<div data-component="regr-reader-3"><span data-bind="probe"></span></div>'
    wildflower.component('regr-reader-3', {
      subscribe: { 'regr-multi': ['tracked'] },
      computed: {
        probe() {
          evalCount++
          return this.stores['regr-multi'].tracked
        }
      }
    })

    await waitForCompleteRender()
    const initialEvalCount = evalCount

    // Mutate the UNSUBSCRIBED path
    wildflower.getStore('regr-multi').untracked = 'changed'
    await waitForCompleteRender()

    // The probe computed should NOT have re-evaluated.
    // (Avoidable propagation: even if it dirty-checked and re-ran, the
    //  value would be unchanged. We're asserting on eval count, not value.)
    expect(evalCount).toBe(initialEvalCount)

    // Now mutate the SUBSCRIBED path — should re-evaluate.
    wildflower.getStore('regr-multi').tracked = 'changed'
    await waitForCompleteRender()
    expect(evalCount).toBeGreaterThan(initialEvalCount)
  })
})
