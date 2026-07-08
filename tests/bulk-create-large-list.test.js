/**
 * Bulk-create path coverage (Meadow onBulkCreate).
 *
 * The mapArray bulk-create fast path only triggers for an INITIAL render of a
 * keyed list with >= 10 rows (small lists keep the per-item mapFn path so the
 * white-box tests that assert eager per-row contexts stay valid). The rest of
 * the suite's list tests use small lists, so this file deliberately renders 20+
 * rows to exercise bulk-create and then verifies the things that are deferred or
 * lazy in that path still work: per-item reactive updates, lazy action-context
 * resolution on click, class bindings, and post-bulk reconciliation (remove).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 80) { await new Promise(r => setTimeout(r, ms)) }
async function waitForCompleteRender(ms = 150) {
  if (window.wildflower?._forceCompleteRender) await window.wildflower._forceCompleteRender()
  await new Promise(r => setTimeout(r, ms))
}

describe('Bulk-create large keyed list (Meadow onBulkCreate path)', () => {
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
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  function setup(count = 20) {
    const items = Array.from({ length: count }, (_, i) => ({ id: i, name: `Item ${i}`, selected: false }))
    testContainer.innerHTML = `
      <div data-component="bulk-list">
        <ul data-list="items" data-key="id">
          <template>
            <li class="row" data-bind-class="selected ? 'sel' : ''">
              <span class="name" data-bind="name"></span>
              <button class="pick" data-action="pick">Pick</button>
              <button class="drop" data-action="drop">Drop</button>
            </li>
          </template>
        </ul>
      </div>
    `
    wildflower.component('bulk-list', {
      state: { items },
      pick(event, element, details) {
        // Mutate the clicked row's own item field — exercises lazy context
        // resolution on click AND the per-item reactive class update.
        details.item.selected = !details.item.selected
      },
      drop(event, element, details) {
        this.state.items = this.state.items.filter(it => it.id !== details.item.id)
      }
    })
    wildflower.scan()
    const component = testContainer.querySelector('[data-component]')
    return wildflower.componentInstances.get(component.dataset.componentId)
  }

  it('renders all rows with correct text via the bulk path', async () => {
    setup(20)
    await waitForCompleteRender()
    const rows = testContainer.querySelectorAll('li.row')
    expect(rows.length).toBe(20)
    expect(rows[0].querySelector('.name').textContent).toBe('Item 0')
    expect(rows[9].querySelector('.name').textContent).toBe('Item 9')
    expect(rows[19].querySelector('.name').textContent).toBe('Item 19')
  })

  it('updates a bulk-created row when its item field mutates (deferred per-item effect)', async () => {
    const instance = setup(20)
    await waitForCompleteRender()
    instance.state.items[7].name = 'Item 7 CHANGED'
    await waitForUpdate(100)
    const rows = testContainer.querySelectorAll('li.row')
    expect(rows[7].querySelector('.name').textContent).toBe('Item 7 CHANGED')
    // Untouched rows unchanged
    expect(rows[6].querySelector('.name').textContent).toBe('Item 6')
    expect(rows[8].querySelector('.name').textContent).toBe('Item 8')
  })

  it('resolves a row action lazily on click and reflects the class change', async () => {
    setup(20)
    await waitForCompleteRender()
    const rows = testContainer.querySelectorAll('li.row')
    expect(rows[12].classList.contains('sel')).toBe(false)
    rows[12].querySelector('.pick').click()
    await waitForUpdate(100)
    expect(rows[12].classList.contains('sel')).toBe(true)
    // Only the clicked row toggled
    expect(rows[11].classList.contains('sel')).toBe(false)
    expect(rows[13].classList.contains('sel')).toBe(false)
  })

  it('replaces a whole bulk list with new-keyed rows (replace bulk path)', async () => {
    const instance = setup(20)
    await waitForCompleteRender()
    // Swap the entire array for 20 rows with brand-new ids (no key overlap).
    instance.state.items = Array.from({ length: 20 }, (_, i) => ({ id: 1000 + i, name: `New ${i}`, selected: false }))
    await waitForUpdate(150)
    const rows = testContainer.querySelectorAll('li.row')
    expect(rows.length).toBe(20)
    expect(rows[0].querySelector('.name').textContent).toBe('New 0')
    expect(rows[19].querySelector('.name').textContent).toBe('New 19')
    // New rows are reactive: clicking a replaced row resolves its lazy context.
    rows[3].querySelector('.pick').click()
    await waitForUpdate(100)
    expect(rows[3].classList.contains('sel')).toBe(true)
  })

  it('appends a large batch to a bulk-created list (append bulk path)', async () => {
    const instance = setup(20)
    await waitForCompleteRender()
    instance.state.items = [
      ...instance.state.items,
      ...Array.from({ length: 15 }, (_, i) => ({ id: 100 + i, name: `Appended ${i}`, selected: false }))
    ]
    await waitForUpdate(150)
    const rows = testContainer.querySelectorAll('li.row')
    expect(rows.length).toBe(35)
    // Original rows preserved
    expect(rows[0].querySelector('.name').textContent).toBe('Item 0')
    expect(rows[19].querySelector('.name').textContent).toBe('Item 19')
    // Appended rows present + reactive
    expect(rows[20].querySelector('.name').textContent).toBe('Appended 0')
    expect(rows[34].querySelector('.name').textContent).toBe('Appended 14')
    rows[25].querySelector('.pick').click()
    await waitForUpdate(100)
    expect(rows[25].classList.contains('sel')).toBe(true)
  })

  it('krausest-shape row: component-state class binding + fast-touch item updates', async () => {
    // The row class reads selectedId (COMPONENT state) — class-only, owned by the
    // component refresh effect — while text binds item props. The per-item effect's
    // real deps are just the item props, so fast-touch must stay eligible AND select
    // (selectedId change) must still update the right rows' classes.
    const items = Array.from({ length: 20 }, (_, i) => ({ id: i, label: `Row ${i}` }))
    testContainer.innerHTML = `
      <div data-component="krausest-shape">
        <ul data-list="items" data-key="id">
          <template>
            <li class="row" data-bind-class="id === selectedId ? 'danger' : ''">
              <span class="label" data-bind="label"></span>
              <button class="sel" data-action="select">sel</button>
            </li>
          </template>
        </ul>
      </div>
    `
    wildflower.component('krausest-shape', {
      state: { items, selectedId: null },
      select(event, element, details) { this.state.selectedId = details.item.id }
    })
    wildflower.scan()
    const component = testContainer.querySelector('[data-component]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)
    await waitForCompleteRender()

    let rows = testContainer.querySelectorAll('li.row')
    expect(rows.length).toBe(20)
    expect(rows[4].querySelector('.label').textContent).toBe('Row 4')

    // Per-item update works (fast-touched item-prop edge)
    instance.state.items[4].label = 'Row 4 EDIT'
    await waitForUpdate(100)
    expect(rows[4].querySelector('.label').textContent).toBe('Row 4 EDIT')

    // Select row 4 -> only row 4 gets 'danger' (component refresh effect, O(2))
    rows[4].querySelector('.sel').click()
    await waitForUpdate(100)
    expect(rows[4].classList.contains('danger')).toBe(true)
    expect(rows[3].classList.contains('danger')).toBe(false)

    // Select row 9 -> 4 clears, 9 sets
    rows[9].querySelector('.sel').click()
    await waitForUpdate(100)
    expect(rows[4].classList.contains('danger')).toBe(false)
    expect(rows[9].classList.contains('danger')).toBe(true)
  })

  it('reconciles after removing a row from a bulk-created list', async () => {
    setup(20)
    await waitForCompleteRender()
    let rows = testContainer.querySelectorAll('li.row')
    rows[5].querySelector('.drop').click()
    await waitForUpdate(120)
    rows = testContainer.querySelectorAll('li.row')
    expect(rows.length).toBe(19)
    // Item 5 is gone; the row now at index 5 is the former Item 6
    const names = Array.from(rows).map(r => r.querySelector('.name').textContent)
    expect(names).not.toContain('Item 5')
    expect(names[5]).toBe('Item 6')
  })
})
