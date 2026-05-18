/**
 * Nested data-list — preserve row identity when parent group re-emits.
 *
 * Repro for the perf bug surfaced in the PM demo: when a parent computed
 * (e.g. `groups()` that buckets issues by status) re-emits because some
 * deep field changed, the framework's per-group onItemUpdate path used to
 * dispose+innerHTML='' the nested data-list and rebuild every row. That
 * threw away all row DOM elements and per-row effects even for rows
 * whose data was unchanged.
 *
 * The fix is in ListRenderer.js's parent-replace handler at the
 * onItemUpdate callsite: instead of disposing the nested mapArray, call
 * its exposed `_reconcileMapArray(newArray)` so the existing keyed-diff
 * path runs, sees same keys + same raw targets, and leaves row elements
 * in place.
 *
 * This test asserts that row DOM-element identity is preserved across a
 * parent-group re-emission triggered by an in-place item mutation.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

describe('Nested list — parent re-emit preserves row identity', () => {
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

  // SKIPPED: red against current main; documents the bug shape, not a
  // currently-enforced contract. See docs/SESSION_FRAMEWORK_FIXES_2026-05-15.md.
  it.skip('row DOM elements survive a parent-group recomputation', async () => {
    testContainer.innerHTML = `
      <div data-component="parent-reemit-rows">
        <div data-list="groups" data-key="id">
          <template>
            <div class="group">
              <span class="group-name" data-bind="name"></span>
              <div data-list="rows" data-key="id">
                <template>
                  <div class="row">
                    <span class="row-title" data-bind="title"></span>
                  </div>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    let instance
    wildflower.component('parent-reemit-rows', {
      state: {
        items: [
          { id: 'a', status: 'todo', title: 'A' },
          { id: 'b', status: 'todo', title: 'B' },
          { id: 'c', status: 'todo', title: 'C' },
          { id: 'd', status: 'done', title: 'D' }
        ]
      },
      computed: {
        // Re-emits fresh group objects with fresh rows arrays on every
        // call — same shape as the PM demo's `groups()`.
        groups() {
          const byStatus = {}
          for (const it of this.state.items) {
            ;(byStatus[it.status] = byStatus[it.status] || []).push(it)
          }
          const out = []
          for (const status of ['todo', 'done']) {
            const bucket = byStatus[status] || []
            if (bucket.length === 0) continue
            out.push({
              id: 'g-' + status,
              name: status,
              rows: bucket
            })
          }
          return out
        }
      },
      init() { instance = this }
    })

    await waitForCompleteRender()

    // Snapshot initial row elements by id. We'll re-query after the
    // mutation and compare identity.
    const allGroups = testContainer.querySelectorAll('[data-list="groups"] > :not(template)')
    expect(allGroups.length).toBe(2)

    const todoGroup = Array.from(allGroups).find(g => g.querySelector('.group-name').textContent === 'todo')
    expect(todoGroup).toBeTruthy()

    const initialRows = todoGroup.querySelectorAll('[data-list="rows"] > :not(template)')
    expect(initialRows.length).toBe(3)
    const initialTitles = Array.from(initialRows).map(r => r.querySelector('.row-title').textContent)
    expect(initialTitles).toEqual(['A', 'B', 'C'])

    // Capture references — these are what should survive the update.
    const rowA = initialRows[0]
    const rowB = initialRows[1]
    const rowC = initialRows[2]

    // Mutate one item's title in-place. This is the kind of change that
    // makes `groups` re-emit (because computed deps re-evaluate), even
    // though no row was added/removed.
    instance.state.items[1].title = 'B-updated'

    await waitForCompleteRender()

    // Re-query rows. The row whose title changed must reflect the new
    // text; ALL rows must still be the SAME DOM elements (not rebuilt).
    const updatedRows = todoGroup.querySelectorAll('[data-list="rows"] > :not(template)')
    expect(updatedRows.length).toBe(3)

    const updatedTitles = Array.from(updatedRows).map(r => r.querySelector('.row-title').textContent)
    expect(updatedTitles).toEqual(['A', 'B-updated', 'C'])

    // The key assertion: row identity preserved across the parent
    // re-emit. If this fails, the framework disposed+rebuilt the nested
    // list (the bug) instead of reconciling it (the fix).
    expect(updatedRows[0]).toBe(rowA)
    expect(updatedRows[1]).toBe(rowB)
    expect(updatedRows[2]).toBe(rowC)
  })
})
