/**
 * Regression: when an OUTER keyed list reconciles a row by key but the row's
 * item OBJECT identity changed (same key, new object — the common case when a
 * computed rebuilds its array of group objects every recompute), the NESTED
 * data-list inside that row must RECONCILE against the new data (reusing its
 * child elements), not tear down and re-create.
 *
 * Bug shape (pre-existing through v1.1; surfaced in the PM-board demo,
 * scarlet-dot-73 2026-06-21): the outer list's onItemUpdate explicitly
 * disposed the nested mapArray, cleared `innerHTML`, and re-rendered it, so a
 * single board update re-created every nested row (and every doubly-nested
 * chip) instead of moving them — ~684 element re-creations for a 26-row board.
 * The fix refreshes the nested reconcile effect in place (its arrayFn reads
 * the just-updated _parentItemProxy live), preserving the nested `prev` so
 * keyed children are reused.
 *
 * This test pins identity: a child element tagged before a parent-identity
 * change must survive it (same DOM node), proving reuse rather than re-create.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

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

describe('nested list reconciles (not re-creates) on parent item-identity change', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()
    if (wildflower._listRelationships) {
      wildflower._listRelationships.clear()
    }
    testContainer = document.createElement('div')
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  it('preserves nested child DOM nodes when the parent group object identity changes', async () => {
    // `groups` is a computed that returns BRAND-NEW group objects every
    // recompute (same `id` keys), exactly like the PM board's groups(). The
    // nested `rows` carry stable item identity (the same state.items array).
    wildflower.component('nested-reuse', {
      state: {
        tick: 0,
        items: [
          { id: 'r1', txt: 'A' },
          { id: 'r2', txt: 'B' },
          { id: 'r3', txt: 'C' }
        ]
      },
      computed: {
        groups() {
          // Read tick so a bump forces a recompute; return a fresh group
          // object (new identity, same id) wrapping the live items array.
          void this.state.tick
          return [{ id: 'g1', rows: this.state.items }]
        }
      },
      bump() { this.state.tick++; }
    })

    testContainer.innerHTML = `
      <div data-component="nested-reuse">
        <div data-list="groups" data-key="id">
          <template>
            <div class="grp">
              <div data-list="rows" data-key="id">
                <template><span class="row" data-bind="txt"></span></template>
              </div>
            </div>
          </template>
        </div>
        <button class="bump" data-action="bump"></button>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const rowsBefore = testContainer.querySelectorAll('.row')
    expect(rowsBefore.length).toBe(3)
    expect(Array.from(rowsBefore).map(r => r.textContent)).toEqual(['A', 'B', 'C'])

    // Tag the live nodes. If the nested list re-creates on the parent-identity
    // change, these exact nodes are discarded and the tags vanish.
    rowsBefore.forEach((r, i) => { r.setAttribute('data-tag', 't' + i); })
    const firstNode = rowsBefore[0]

    // Force the outer `groups` computed to rebuild with a new group object
    // (same key 'g1', new identity) -> outer onItemUpdate -> nested list.
    testContainer.querySelector('.bump').click()
    await waitForCompleteRender()

    const rowsAfter = testContainer.querySelectorAll('.row')
    expect(rowsAfter.length).toBe(3)
    expect(Array.from(rowsAfter).map(r => r.textContent)).toEqual(['A', 'B', 'C'])

    // The decisive assertions: same DOM nodes survived (tags intact, identity
    // preserved). Re-creation would drop the tags and replace the nodes.
    expect(Array.from(rowsAfter).map(r => r.getAttribute('data-tag'))).toEqual(['t0', 't1', 't2'])
    expect(rowsAfter[0]).toBe(firstNode)
  })

  it('reorders nested children (reusing DOM nodes) when the nested order changes on a parent-identity change', async () => {
    // The PM-board priority case: a bulk change re-sorts the nested rows AND
    // hands the outer list a new parent object. The nested list must MOVE its
    // existing keyed children into the new order, not leave them stale and not
    // re-create them.
    wildflower.component('nested-reorder', {
      state: {
        tick: 0,
        items: [{ id: 'r1', txt: 'A' }, { id: 'r2', txt: 'B' }, { id: 'r3', txt: 'C' }]
      },
      computed: {
        groups() { void this.state.tick; return [{ id: 'g1', rows: this.state.items }] }
      },
      // Reverse-ish reorder (C, A, B) using the SAME row objects + a new group
      // object identity (tick bump), mirroring groups() rebuilding each recompute.
      reorder() {
        const it = this.state.items
        this.state.items = [it[2], it[0], it[1]]
        this.state.tick++
      }
    })

    testContainer.innerHTML = `
      <div data-component="nested-reorder">
        <div data-list="groups" data-key="id">
          <template>
            <div class="grp">
              <div data-list="rows" data-key="id">
                <template><span class="row" data-bind="txt"></span></template>
              </div>
            </div>
          </template>
        </div>
        <button class="reorder" data-action="reorder"></button>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const before = testContainer.querySelectorAll('.row')
    expect(Array.from(before).map(r => r.textContent)).toEqual(['A', 'B', 'C'])
    // Tag by content so we can prove nodes were MOVED, not re-created.
    before.forEach(r => { r.setAttribute('data-was', r.textContent) })
    const nodeA = before[0]

    testContainer.querySelector('.reorder').click()
    await waitForCompleteRender()

    const after = testContainer.querySelectorAll('.row')
    // New visual order.
    expect(Array.from(after).map(r => r.textContent)).toEqual(['C', 'A', 'B'])
    // Same nodes, moved: the node that held 'A' is now at index 1 and still the
    // same element (tag intact) — proves move/reuse, not stale and not re-create.
    expect(Array.from(after).map(r => r.getAttribute('data-was'))).toEqual(['C', 'A', 'B'])
    expect(after[1]).toBe(nodeA)
  })

  it('still reflects nested data changes after a parent-identity change', async () => {
    // Reuse must not go stale: after the nested list reconciles in place, a
    // subsequent change to the nested item data must still update the DOM.
    wildflower.component('nested-reuse-live', {
      state: {
        tick: 0,
        items: [{ id: 'r1', txt: 'A' }, { id: 'r2', txt: 'B' }]
      },
      computed: {
        groups() { void this.state.tick; return [{ id: 'g1', rows: this.state.items }] }
      },
      bump() { this.state.tick++; },
      rename() { this.state.items[0].txt = 'Z'; }
    })

    testContainer.innerHTML = `
      <div data-component="nested-reuse-live">
        <div data-list="groups" data-key="id">
          <template>
            <div class="grp">
              <div data-list="rows" data-key="id">
                <template><span class="row" data-bind="txt"></span></template>
              </div>
            </div>
          </template>
        </div>
        <button class="bump" data-action="bump"></button>
        <button class="rename" data-action="rename"></button>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    // Parent-identity change (reconcile-in-place), then mutate a nested item.
    testContainer.querySelector('.bump').click()
    await waitForCompleteRender()
    testContainer.querySelector('.rename').click()
    await waitForCompleteRender()

    const rows = testContainer.querySelectorAll('.row')
    expect(Array.from(rows).map(r => r.textContent)).toEqual(['Z', 'B'])
  })
})
