/**
 * Regression: a BARE position-frame token in a list row's data-show / data-render
 * (data-show="_last", data-render="_first", etc.) must resolve against the row's
 * position frame, both at initial paint AND after a structural change (add/remove
 * shifts which row is _last).
 *
 * data-show already worked. data-render="_last" was broken two ways, fixed here:
 *   1. Initial: _evaluateListItemCondition read a bare token off the item
 *      (→ undefined → removed on every row). Now resolves _index/_first/_last/
 *      _length against the row frame (used by both show and render).
 *   2. Structural: the reconcile sweep (_updateListContextClassBindings) re-evaluated
 *      data-show position tokens but not data-render. Now it re-evaluates the row's
 *      render contexts too, so the element toggles when _last shifts on add/remove.
 * Found during the LR2-salvage audit; the LR2-era isListContextVar compile flag did
 * NOT fix this (that flag feeds the per-item effect, which never runs for a bare
 * position token — it forms no reactive dep).
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) await window.wildflower._forceCompleteRender()
  await new Promise(resolve => setTimeout(resolve, 50))
}
function ensureComponentScanning(wildflower) {
  if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection()
}
const visible = el => !!el && el.style.display !== 'none'

describe('list-row bare position-frame token in data-show / data-render', () => {
  let testContainer, wildflower
  beforeAll(async () => { await loadFramework() })
  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()
    if (wildflower._initContextSystem) { wildflower._contextSystemInitialized = false; wildflower._initContextSystem() }
    testContainer = document.createElement('div')
    testContainer.style.cssText = 'position:absolute;left:-9999px;opacity:0'
    document.body.appendChild(testContainer)
  })
  afterEach(() => { if (testContainer?.parentNode) testContainer.parentNode.removeChild(testContainer) })

  it('data-show="_last" / "_first" resolve against the position frame', async () => {
    wildflower.component('pos-show', {
      state: { items: [{ id: 1, label: 'A' }, { id: 2, label: 'B' }, { id: 3, label: 'C' }] }
    })
    testContainer.innerHTML = `
      <div data-component="pos-show">
        <ul data-list="items" data-key="id">
          <template>
            <li>
              <span data-bind="label"></span>
              <em class="first-badge" data-show="_first">first</em>
              <em class="last-badge" data-show="_last">last</em>
            </li>
          </template>
        </ul>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const rows = testContainer.querySelectorAll('li')
    expect(rows.length).toBe(3)

    const firstBadges = [...testContainer.querySelectorAll('.first-badge')]
    const lastBadges = [...testContainer.querySelectorAll('.last-badge')]
    expect(firstBadges.length).toBe(3)
    expect(lastBadges.length).toBe(3)

    // _first → only row 0's badge visible; _last → only row 2's badge visible.
    expect(firstBadges.map(visible)).toEqual([true, false, false])
    expect(lastBadges.map(visible)).toEqual([false, false, true])
  })

  it('data-render="_last" keeps the element only on the last row (+ reacts to append)', async () => {
    wildflower.component('pos-render', {
      state: { items: [{ id: 1, label: 'A' }, { id: 2, label: 'B' }, { id: 3, label: 'C' }] },
      add() { this.state.items.push({ id: 4, label: 'D' }) }
    })
    testContainer.innerHTML = `
      <div data-component="pos-render">
        <ul data-list="items" data-key="id">
          <template>
            <li>
              <span data-bind="label"></span>
              <em class="last-only" data-render="_last">tail</em>
            </li>
          </template>
        </ul>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    let rows = testContainer.querySelectorAll('li')
    expect(rows.length).toBe(3)
    // data-render removes the element when false → only the last row has it.
    expect([...rows].map(li => !!li.querySelector('.last-only'))).toEqual([false, false, true])

    // Append a row → _last shifts: old last row drops the element, new last gains it.
    const instance = wildflower.componentInstances.get(testContainer.querySelector('[data-component]').dataset.componentId)
    instance.add()
    await waitForCompleteRender()

    rows = testContainer.querySelectorAll('li')
    expect(rows.length).toBe(4)
    expect([...rows].map(li => !!li.querySelector('.last-only'))).toEqual([false, false, false, true])
  })
})
