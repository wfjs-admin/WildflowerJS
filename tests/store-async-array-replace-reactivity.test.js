/**
 * Two-store async race — PM demo blank-detail-pane regression.
 *
 * Repro: reload /project/p-web/issue/i-5 → detail aside shows but inner
 * content stays blank. Clicking any list row populates it.
 *
 * Demo shape:
 *   - ui store init() runs synchronously, sets currentIssueId from URL.
 *   - pm store init() is async, awaits IDB, then does this.issues = ...
 *   - pm-issue-detail subscribes to BOTH (ui.currentIssueId, pm.issues),
 *     computes issueExists() = !!pm.getIssue(ui.currentIssueId).
 *   - At first computed eval, ui.currentIssueId is set, pm.issues is [].
 *     issueExists → false.
 *   - When pm.issues gets reassigned, the computed should re-evaluate
 *     and become true. The user says it doesn't.
 *
 * This test mirrors that exact shape: store-a sets `currentId` sync at
 * init, store-b is async and reassigns `items`. A component subscribes
 * to both and exposes a binding gated by the cross-store computed.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

describe('Cross-store async whole-array reassignment + subscribed computed', () => {
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

  // Regression for the PM-demo blank-detail-pane bug on Chrome soft reload.
  // Fixed 2026-05-15 (session: slate-heron-37) by registering subscribe-block
  // components as entity-dependents of their stores in subscribePath, so
  // path-relevant store mutations correctly dirty dependent computeds.
  // See docs/PM_DEMO_CHROME_SOFT_RELOAD_DIAGNOSIS_2026-05-15.md.
  it('cross-store computed re-evaluates after async whole-array reassign', async () => {
    testContainer.innerHTML = `
      <div data-component="cross-store-reader">
        <div data-show="hasTarget">
          <span class="target-title" data-bind="targetTitle"></span>
        </div>
      </div>
    `

    // store-a: synchronous init (like ui in the demo — router resolves URL
    // and stamps currentIssueId before the async pm init finishes).
    wildflower.store('idx', {
      state: { currentId: null },
      init() {
        // sync: imagine the router resolving an issue URL right here.
        this.currentId = 'item-2'
      }
    })

    // store-b: async init that ends with a whole-array reassignment.
    // Matches pm.init()'s pattern (await IDB, then this.issues = results[1]).
    wildflower.store('data', {
      state: { items: [] },
      async init() {
        await new Promise(r => setTimeout(r, 10))
        this.items = [
          { id: 'item-1', title: 'One' },
          { id: 'item-2', title: 'Two' },
          { id: 'item-3', title: 'Three' }
        ]
      },
      getItem(id) {
        return this.items.find(function (i) { return i.id === id })
      }
    })

    wildflower.component('cross-store-reader', {
      subscribe: {
        idx: ['currentId'],
        data: ['items']
      },
      computed: {
        hasTarget() {
          return !!this.stores.data.getItem(this.stores.idx.currentId)
        },
        targetTitle() {
          const it = this.stores.data.getItem(this.stores.idx.currentId)
          return it ? it.title : ''
        }
      }
    })

    await waitForCompleteRender()

    // At this moment store-a.currentId is already 'item-2' (sync init), but
    // store-b.items might still be empty (async init in flight).
    //
    // Wait long enough for the async assignment to land + reactivity to flush.
    await new Promise(r => setTimeout(r, 100))
    await waitForCompleteRender()

    const titleEl = testContainer.querySelector('.target-title')
    expect(titleEl).toBeTruthy()
    // If the bug reproduces, textContent will be '' (computed never re-evaluated
    // after async assign). If fixed, it's 'Two'.
    expect(titleEl.textContent).toBe('Two')
  })

  // Sanity: when the second store fires (currentId change after both are
  // settled), the computed should re-evaluate. This is the "click another
  // list item" path that DOES populate the pane.
  it('changing the index after data is settled re-evaluates the computed', async () => {
    testContainer.innerHTML = `
      <div data-component="cross-store-reader-2">
        <span class="target-title" data-bind="targetTitle"></span>
      </div>
    `

    wildflower.store('idx2', {
      state: { currentId: 'item-1' },
      setCurrent(id) { this.currentId = id }
    })
    wildflower.store('data2', {
      state: {
        items: [
          { id: 'item-1', title: 'One' },
          { id: 'item-2', title: 'Two' }
        ]
      },
      getItem(id) {
        return this.items.find(function (i) { return i.id === id })
      }
    })
    wildflower.component('cross-store-reader-2', {
      subscribe: {
        idx2: ['currentId'],
        data2: ['items']
      },
      computed: {
        targetTitle() {
          const it = this.stores.data2.getItem(this.stores.idx2.currentId)
          return it ? it.title : ''
        }
      }
    })

    await waitForCompleteRender()
    expect(testContainer.querySelector('.target-title').textContent).toBe('One')

    wildflower.getStore('idx2').setCurrent('item-2')
    await waitForCompleteRender()
    expect(testContainer.querySelector('.target-title').textContent).toBe('Two')
  })
})
