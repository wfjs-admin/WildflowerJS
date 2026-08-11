/**
 * List Mount on a Dirty Container
 *
 * A list container can arrive at mount already holding rendered rows that no
 * live instance owns. The production case: data-render captures a
 * cloneNode(true) snapshot of its subtree for re-insertion, and when that
 * snapshot is taken after the lists inside have rendered, it contains the
 * rendered rows as inert copies (cloneNode strips every framework expando and
 * no bindings or delegation reach them). On re-insertion the fresh mount
 * renders the array again next to the stale copies: every row appears twice
 * and the duplicate set is dead.
 *
 * Found live on wildflowerjs.com (2026-08-11): every sidebar section under 10
 * items showed each link twice, the second set non-functional. Sections with
 * 10+ items were clean because the bulk-create path (list-reconciler n >= 10)
 * replaces container contents while the per-item path appends.
 *
 * The invariant under test: when mapArray takes ownership of a container, any
 * element child that is not the <template> predates the mount and must be
 * swept. The SSR path already does this; these tests pin it for the non-SSR
 * mount.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 120) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

function ensureComponentScanning(wildflower) {
  if (wildflower._setupDynamicComponentDetection) {
    wildflower._setupDynamicComponentDetection()
  }
}

describe('List mount on a dirty container', () => {
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
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  async function mountRenderCloneRemount(componentName, html) {
    testContainer.innerHTML = html
    ensureComponentScanning(wildflower)
    wildflower._scanForDynamicComponents()
    await waitForUpdate()

    const original = testContainer.querySelector(`[data-component="${componentName}"]`)
    const renderedBefore = original.querySelectorAll('ul li').length

    // The data-render snapshot: a deep clone taken AFTER rendering. The clone
    // keeps rendered rows and attributes (including data-component-id) but no
    // JS expandos, exactly what cloneNode produces in RenderingCore's
    // _processDataRenderElement.
    const clone = original.cloneNode(true)

    // Remove the original (data-render toggling off) and let the mutation
    // observer's background GC destroy the instance (GC_DELAY_MS = 40).
    original.remove()
    await waitForUpdate(150)

    // Re-insert the stale snapshot (data-render toggling back on) and rescan.
    testContainer.appendChild(clone)
    wildflower._scanForDynamicComponents()
    await waitForUpdate(200)

    return { renderedBefore, remounted: testContainer.querySelector(`[data-component="${componentName}"]`) }
  }

  it('keyless list under the bulk threshold renders exactly one row set after a stale-clone remount', async () => {
    wildflower.component('dirty-remount-keyless', {
      state: {
        items: [
          { id: 1, label: 'Basic Plugins' },
          { id: 2, label: 'Advanced Plugins' }
        ]
      }
    })

    const { renderedBefore, remounted } = await mountRenderCloneRemount('dirty-remount-keyless', `
      <div data-component="dirty-remount-keyless">
        <ul data-list="items">
          <template><li><a data-bind="label"></a></li></template>
        </ul>
      </div>
    `)

    expect(renderedBefore).toBe(2)

    const rows = remounted.querySelectorAll('ul li')
    const texts = Array.from(rows).map(li => li.textContent.trim())
    expect(texts).toEqual(['Basic Plugins', 'Advanced Plugins'])
    expect(rows.length).toBe(2)

    // Every surviving row must be framework-owned (live bindings), not an
    // inert clone. Stale clones carry no expandos at all.
    rows.forEach(li => {
      expect(li._listIndex !== undefined || li._listContext !== undefined).toBe(true)
    })
  })

  it('keyed list under the bulk threshold renders exactly one row set after a stale-clone remount', async () => {
    wildflower.component('dirty-remount-keyed', {
      state: {
        items: [
          { id: 'a', label: 'One' },
          { id: 'b', label: 'Two' },
          { id: 'c', label: 'Three' }
        ]
      }
    })

    const { renderedBefore, remounted } = await mountRenderCloneRemount('dirty-remount-keyed', `
      <div data-component="dirty-remount-keyed">
        <ul data-list="items" data-key="id">
          <template><li><a data-bind="label"></a></li></template>
        </ul>
      </div>
    `)

    expect(renderedBefore).toBe(3)
    expect(remounted.querySelectorAll('ul li').length).toBe(3)
  })

  it('list at the bulk threshold stays clean after a stale-clone remount', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, label: `Item ${i + 1}` }))
    wildflower.component('dirty-remount-bulk', {
      state: { items }
    })

    const { renderedBefore, remounted } = await mountRenderCloneRemount('dirty-remount-bulk', `
      <div data-component="dirty-remount-bulk">
        <ul data-list="items" data-key="id">
          <template><li><a data-bind="label"></a></li></template>
        </ul>
      </div>
    `)

    expect(renderedBefore).toBe(10)
    expect(remounted.querySelectorAll('ul li').length).toBe(10)
  })

  it('remounted rows are interactive: data-action on a fresh row fires', async () => {
    let clicks = 0
    wildflower.component('dirty-remount-action', {
      state: {
        items: [
          { id: 1, label: 'First' },
          { id: 2, label: 'Second' }
        ]
      },
      rowClicked() { clicks++ }
    })

    const { remounted } = await mountRenderCloneRemount('dirty-remount-action', `
      <div data-component="dirty-remount-action">
        <ul data-list="items">
          <template><li><a data-bind="label" data-action="rowClicked"></a></li></template>
        </ul>
      </div>
    `)

    const rows = remounted.querySelectorAll('ul li a')
    expect(rows.length).toBe(2)
    rows.forEach(a => a.click())
    await waitForUpdate(50)
    expect(clicks).toBe(2)
  })
})
