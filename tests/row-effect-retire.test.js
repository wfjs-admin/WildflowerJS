/**
 * Per-list listSink dispatcher correctness — pure flat-text templates.
 *
 * Pure-text bulk lists ride the per-list dispatcher (per-row effects no
 * longer exist anywhere — P4-S6): each item leaf's write applies the row's
 * text synchronously in notifyNode. These tests verify the row still updates
 * on item-prop mutation, survives same-key replace and removal, and — the key
 * correctness property — that a component computed sharing the same item leaf
 * still re-evaluates (shared leaves stay on the non-suppressing sink).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function settle(ms = 120) {
  if (window.wildflower?._forceCompleteRender) await window.wildflower._forceCompleteRender()
  await new Promise(r => setTimeout(r, ms))
}

describe('Phase 3 effect-retire via listSink (pure-text bulk lists)', () => {
  let testContainer
  let wildflower

  beforeAll(async () => { await loadFramework() })

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
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) testContainer.parentNode.removeChild(testContainer)
  })

  function setup(count = 12, withComputed = false) {
    const items = Array.from({ length: count }, (_, i) => ({ id: i, label: `Row ${i}` }))
    testContainer.innerHTML = `
      <div data-component="retire-list">
        ${withComputed ? '<span class="total" data-bind="computed:totalLen"></span>' : ''}
        <ul data-list="items" data-key="id">
          <template>
            <li class="row"><span class="label" data-bind="label"></span></li>
          </template>
        </ul>
      </div>
    `
    wildflower.component('retire-list', {
      state: { items },
      computed: {
        // Reads every item's label -> a shared observer of the same leaves the
        // listSink writes. Must still re-evaluate when a label changes.
        totalLen() { return this.state.items.reduce((n, it) => n + it.label.length, 0) }
      }
    })
    wildflower.scan()
    const component = testContainer.querySelector('[data-component]')
    return wildflower.componentInstances.get(component.dataset.componentId)
  }

  function labels() {
    return Array.from(testContainer.querySelectorAll('li.row .label')).map(el => el.textContent)
  }

  it('renders a bulk pure-text list correctly with the effect retired', async () => {
    setup(12)
    await settle()
    const l = labels()
    expect(l.length).toBe(12)
    expect(l[0]).toBe('Row 0')
    expect(l[11]).toBe('Row 11')
  })

  it('updates a row on item-prop mutation via the listSink (no per-row effect)', async () => {
    const instance = setup(12)
    await settle()
    instance.state.items[5].label = 'Row 5 CHANGED'
    await settle()
    const l = labels()
    expect(l[5]).toBe('Row 5 CHANGED')
    expect(l[4]).toBe('Row 4')
    expect(l[6]).toBe('Row 6')
  })

  it('keeps a shared-leaf component computed live (non-suppression / R2)', async () => {
    setup(12, true)
    await settle()
    const total = () => testContainer.querySelector('.total').textContent
    const component = testContainer.querySelector('[data-component]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)
    // 'Row 0'..'Row 9' = 5 chars, 'Row 10'..'Row 11' = 6 chars -> 10*5 + 2*6 = 62
    expect(total()).toBe('62')
    instance.state.items[0].label = 'Row 0 longer'  // 12 chars (+7)
    await settle()
    // The row text updated AND the computed re-evaluated (the leaf woke its
    // observer because listSink falls through instead of suppressing).
    expect(labels()[0]).toBe('Row 0 longer')
    expect(total()).toBe('69')
  })

  it('survives same-key replace (re-stamp on onItemUpdate)', async () => {
    const instance = setup(12)
    await settle()
    // Same keys (ids 0..11), new objects + new labels.
    instance.state.items = Array.from({ length: 12 }, (_, i) => ({ id: i, label: `New ${i}` }))
    await settle(160)
    const l = labels()
    expect(l[0]).toBe('New 0')
    expect(l[11]).toBe('New 11')
    // The replaced row's new object is wired: mutating it updates the row.
    instance.state.items[3].label = 'New 3 EDIT'
    await settle()
    expect(labels()[3]).toBe('New 3 EDIT')
  })

  it('reconciles after removing a row; detached sinks are inert', async () => {
    const instance = setup(12)
    await settle()
    const removed = instance.state.items[5]
    instance.state.items = instance.state.items.filter(it => it.id !== 5)
    await settle(160)
    let l = labels()
    expect(l.length).toBe(11)
    expect(l).not.toContain('Row 5')
    // Writing to the removed (now-detached) item must not throw and must not
    // corrupt the live rows.
    removed.label = 'ghost'
    await settle()
    l = labels()
    expect(l.length).toBe(11)
    expect(l).not.toContain('ghost')
  })

  it('releases dispatcher entries on remove and clear (no R15 leak)', async () => {
    const instance = setup(12)
    await settle()
    const listEl = testContainer.querySelector('ul[data-list]')
    const dispatcher = listEl._wfListSinkDispatcher
    expect(dispatcher).toBeTruthy()
    expect(dispatcher.rows.size).toBe(12)

    // Remove 3 rows -> rows Map shrinks by 3 (detached rows not pinned).
    instance.state.items = instance.state.items.filter(it => it.id > 2)
    await settle(160)
    expect(dispatcher.rows.size).toBe(9)

    // Full clear -> rows Map empties.
    instance.state.items = []
    await settle(160)
    expect(dispatcher.rows.size).toBe(0)

    // Re-populate -> entries re-created, no carryover from the cleared set.
    instance.state.items = Array.from({ length: 10 }, (_, i) => ({ id: 500 + i, label: `R ${i}` }))
    await settle(160)
    expect(dispatcher.rows.size).toBe(10)
  })

  it('appends a batch; appended rows are reactive', async () => {
    const instance = setup(12)
    await settle()
    instance.state.items = [
      ...instance.state.items,
      ...Array.from({ length: 12 }, (_, i) => ({ id: 100 + i, label: `App ${i}` }))
    ]
    await settle(160)
    expect(labels().length).toBe(24)
    expect(labels()[12]).toBe('App 0')
    instance.state.items[20].label = 'App 8 EDIT'
    await settle()
    expect(labels()[20]).toBe('App 8 EDIT')
  })
})
