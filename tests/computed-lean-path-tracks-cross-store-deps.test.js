/**
 * Regression: the LEAN re-evaluation path in _evaluateComputedFull (used for
 * computeds with cross-store deps after the first eval) must establish
 * _computedTrackingContext so that cross-store reads register their deps
 * through the tracking proxy.
 *
 * Bug shape (fixed 2026-05-15 in session slate-heron-37):
 *   1. Computed `A` reads `this.stores.s.x` with an early-return BEFORE the
 *      cross-store state read (e.g. `if (!this.stores.other.id) return null`).
 *   2. First eval takes the early-return branch. `s` is NOT registered as a
 *      cross-store dep because the read never happened.
 *   3. _computedsWithExternalDeps.add fired anyway (called from getStore() on
 *      the OTHER store's access), so _externalEvalCount=1 after the first eval.
 *   4. Next eval takes the LEAN path (line ~928 of ComputedPropertyManager.js).
 *   5. Pre-fix: LEAN path called node.fn() WITHOUT setting
 *      _computedTrackingContext. Cross-store reads now go through the raw
 *      context (no tracking proxy) and the dep stays unregistered. Forever.
 *      Mutations to `s.x` would correctly bypass `A` (no dep) — DOM stuck.
 *   6. Post-fix: LEAN path sets the same tracking context as the full path.
 *      Cross-store reads register deps via the tracking proxy, so subsequent
 *      mutations to `s.x` correctly wake `A`.
 *
 * See docs/PM_DEMO_CHROME_SOFT_RELOAD_DIAGNOSIS_2026-05-15.md.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function whenSettled() {
  if (window.wildflower?.whenSettled) {
    await window.wildflower.whenSettled()
  }
  await new Promise(resolve => setTimeout(resolve, 30))
}

describe('LEAN re-eval path registers cross-store deps via tracking proxy', () => {
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

  it('first-eval early-return + later cross-store mutation: dep gets registered on subsequent eval', async () => {
    // Mirrors PM-demo _currentIssue: early-return on missing id before reading
    // pm.issues. Forces the LEAN path to run on the post-mutation re-eval.
    wildflower.store('lean-gate', {
      state: { id: null }
    })
    wildflower.store('lean-data', {
      state: { items: [] }
    })

    testContainer.innerHTML = `
      <div data-component="lean-reader">
        <span class="title" data-bind="targetTitle"></span>
      </div>
    `

    wildflower.component('lean-reader', {
      subscribe: {
        'lean-gate': ['id'],
        'lean-data': ['items']
      },
      computed: {
        // Early-return BEFORE the cross-store read. First eval will skip the
        // lean-data.items read.
        target() {
          const id = this.stores['lean-gate'].id
          if (!id) return null
          const items = this.stores['lean-data'].items
          for (let i = 0; i < items.length; i++) {
            if (items[i].id === id) return items[i]
          }
          return null
        },
        targetTitle() {
          const t = this.computed.target
          return t ? t.title : ''
        }
      }
    })

    await whenSettled()
    // First eval: id=null → early-return. target=null, targetTitle=''.
    expect(testContainer.querySelector('.title').textContent).toBe('')

    // Set the gate id. This wakes target via lean-gate's entity-dep dispatch.
    // target re-evaluates and now reads lean-data.items (empty) → returns null.
    // Pre-fix: LEAN path runs without tracking context. lean-data dep NOT
    //          registered. Subsequent items mutation wouldn't wake target.
    // Post-fix: LEAN path runs WITH tracking context. lean-data dep registered.
    wildflower.getStore('lean-gate').id = 'a'
    await whenSettled()

    // Now mutate lean-data.items. Should wake target via lean-data's entity-dep
    // dispatch IF the dep was correctly registered.
    wildflower.getStore('lean-data').items = [
      { id: 'a', title: 'Found A' },
      { id: 'b', title: 'B' }
    ]
    await whenSettled()
    await whenSettled()  // double-settle for the post-mutation cascade

    // Post-fix: targetTitle should now be 'Found A'.
    expect(testContainer.querySelector('.title').textContent).toBe('Found A')
  })

  it('LEAN path keeps existing deps registered on subsequent evals', async () => {
    // Sanity: a computed whose first eval DID register all cross-store deps
    // still works correctly after multiple LEAN-path re-evals.
    wildflower.store('lean-counter', {
      state: { n: 0 }
    })

    testContainer.innerHTML = `
      <div data-component="lean-mirror">
        <span class="out" data-bind="mirrored"></span>
      </div>
    `

    wildflower.component('lean-mirror', {
      subscribe: { 'lean-counter': ['n'] },
      computed: {
        mirrored() {
          return 'n=' + this.stores['lean-counter'].n
        }
      }
    })

    await whenSettled()
    expect(testContainer.querySelector('.out').textContent).toBe('n=0')

    // Three mutations — each takes the LEAN path (after the first full eval).
    wildflower.getStore('lean-counter').n = 1
    await whenSettled()
    expect(testContainer.querySelector('.out').textContent).toBe('n=1')

    wildflower.getStore('lean-counter').n = 2
    await whenSettled()
    expect(testContainer.querySelector('.out').textContent).toBe('n=2')

    wildflower.getStore('lean-counter').n = 3
    await whenSettled()
    expect(testContainer.querySelector('.out').textContent).toBe('n=3')
  })
})

describe('_resolvePendingStoreDependencies resets _externalEvalCount on dependents', () => {
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

  it('late-arriving store + early-return computed: re-eval establishes the cross-store dep', async () => {
    // The exact PM-demo failing sequence:
    //  1. Component declared subscribe to a store that doesn't exist yet
    //  2. Component's computed early-returns on a DIFFERENT condition during
    //     initial eval
    //  3. Pending dep is queued
    //  4. The store is created AFTER component setup completes
    //  5. _resolvePendingStoreDependencies fires, clears caches
    //  6. Cross-store state mutates, should wake the dependent
    wildflower.store('rspd-gate', {
      state: { currentId: 'a' }   // truthy from start; using 'currentId' to avoid
                                   // collision with store's own `id` property
    })

    testContainer.innerHTML = `
      <div data-component="rspd-reader">
        <span class="out" data-bind="targetTitle"></span>
      </div>
    `

    wildflower.component('rspd-reader', {
      subscribe: {
        'rspd-gate': ['id'],
        'rspd-late': ['items']   // store doesn't exist yet
      },
      computed: {
        target() {
          const id = this.stores['rspd-gate'].currentId
          if (!id) return null
          const lateStore = this.stores['rspd-late']
          if (!lateStore) return null
          const items = lateStore.items
          for (let i = 0; i < items.length; i++) {
            if (items[i].id === id) return items[i]
          }
          return null
        },
        targetTitle() {
          const t = this.computed.target
          return t ? t.title : ''
        }
      }
    })

    await whenSettled()
    expect(testContainer.querySelector('.out').textContent).toBe('')

    // NOW create the late-arriving store with empty state. This triggers
    // _resolvePendingStoreDependencies which retries subscribePath (success
    // this time) and clears the dependent component's computedCache.
    // _externalEvalCount reset on all nodes (Fix #1) means subsequent re-eval
    // of `target` will take the FULL path and register cross-store deps.
    wildflower.store('rspd-late', {
      state: { items: [] }
    })
    await whenSettled()

    // NOW mutate items async (mirrors pm.init's `this.issues = await ...`).
    // This is the post-fix-eligible cascade: rspd-late.items mutation → entity-dep
    // dispatch → dirty-mark dependents → target re-evaluates → returns the item.
    wildflower.getStore('rspd-late').items = [{ id: 'a', title: 'Late title' }]
    await whenSettled()
    await whenSettled()

    // Post-fix: targetTitle resolves to 'Late title' because:
    //  - subscribePath retry registers rspd-reader in rspd-late's entity-deps
    //  - _externalEvalCount reset (Fix #1) forces target's next eval through
    //    full path, re-establishing cross-store tracking on the items read
    //  - LEAN path now sets _computedTrackingContext (Fix #2), so even if we
    //    skipped the reset on a subsequent eval, deps would still register
    //  - Mutation to items wakes target via the entity-dep cascade
    expect(testContainer.querySelector('.out').textContent).toBe('Late title')
  })
})
