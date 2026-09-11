/**
 * Framework-rendered list rows are skipped by the component scanner, and the
 * list renderer initialises their nested components itself.
 *
 * The MutationObserver's added-node loop skips rows carrying `_listIndex` (the
 * same skip its removed-node loop has always applied), because re-scanning the
 * list renderer's own output finds nothing: `_initializeNestedComponentsInItem`
 * has already handled any nested component in the row. Without the skip, every
 * created row costs a subtree `querySelector('[data-component]')` — 10,000 of
 * them on a 10k-row render.
 *
 * That makes the list renderer's ownership of nested-component init a
 * load-bearing invariant rather than an implementation detail: if it ever stops
 * initialising them, the scanner will no longer be there to cover for it and
 * nested components inside list rows go dead. These tests pin it on both render
 * paths, since only one of them is exercised by any given row count:
 *   - under 10 rows  -> per-item mapFn path
 *   - 10 rows and up -> bulk clone-setter path (which is also where the skip
 *     saves the most work)
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 200) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

function ensureComponentScanning(wildflower) {
  if (wildflower._setupDynamicComponentDetection) {
    wildflower._setupDynamicComponentDetection()
  }
}

describe('List rows skipped by the scanner still initialise nested components', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()
    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  async function mountList(rowCount, hostName, badgeName) {
    let inits = 0
    wildflower.component(badgeName, {
      state: { n: 0 },
      init() { inits++ }
    })
    wildflower.component(hostName, {
      state: { items: Array.from({ length: rowCount }, (_, i) => ({ id: i + 1, label: 'row' + i })) }
    })
    testContainer.innerHTML = `
      <div data-component="${hostName}">
        <ul data-list="items" data-key="id">
          <template>
            <li><span data-bind="label"></span><div data-component="${badgeName}" data-prop-n="id"></div></li>
          </template>
        </ul>
      </div>
    `
    ensureComponentScanning(wildflower)
    wildflower._scanForDynamicComponents()
    await waitForUpdate(300)
    return () => inits
  }

  it('bulk path (>= 10 rows) initialises a nested component in every row', async () => {
    const getInits = await mountList(12, 'obs-skip-host-bulk', 'obs-skip-badge-bulk')

    const rows = testContainer.querySelectorAll('li')
    const badges = testContainer.querySelectorAll('[data-component="obs-skip-badge-bulk"]')
    expect(rows.length).toBe(12)
    expect(badges.length).toBe(12)
    // Every badge is a live instance, not inert markup.
    expect(testContainer.querySelectorAll('[data-component="obs-skip-badge-bulk"][data-component-id]').length).toBe(12)
    expect(getInits()).toBe(12)
  })

  it('per-item path (< 10 rows) initialises a nested component in every row', async () => {
    const getInits = await mountList(4, 'obs-skip-host-small', 'obs-skip-badge-small')

    expect(testContainer.querySelectorAll('li').length).toBe(4)
    expect(testContainer.querySelectorAll('[data-component="obs-skip-badge-small"][data-component-id]').length).toBe(4)
    expect(getInits()).toBe(4)
  })

  it('rows carry _listIndex, which is what the scanner skips on', async () => {
    await mountList(12, 'obs-skip-host-idx', 'obs-skip-badge-idx')

    const rows = testContainer.querySelectorAll('li')
    expect(rows.length).toBe(12)
    // Every row is identifiable as framework-rendered. If this stops holding,
    // the scanner silently resumes querySelector-ing every row on every render.
    rows.forEach(row => {
      expect(row._listIndex).not.toBeUndefined()
    })
  })

  it('a component added into a row AFTER render is still picked up', async () => {
    // The skip applies to the row node itself. Anything inserted later is its
    // own added node, so the scanner must still find it.
    let lateInits = 0
    wildflower.component('obs-skip-late', { state: {}, init() { lateInits++ } })
    await mountList(12, 'obs-skip-host-late', 'obs-skip-badge-late')

    const firstRow = testContainer.querySelector('li')
    const late = document.createElement('div')
    late.setAttribute('data-component', 'obs-skip-late')
    firstRow.appendChild(late)

    ensureComponentScanning(wildflower)
    await waitForUpdate(300)

    expect(lateInits).toBe(1)
    expect(late.getAttribute('data-component-id')).toBeTruthy()
  })
})
