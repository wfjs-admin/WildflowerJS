/**
 * data-cloak tests
 *
 * Tests the data-cloak anti-FOUC system:
 * - Users add [data-cloak] { display: none; } in <head> CSS
 * - Users add data-cloak to elements that should not flash
 * - Framework removes data-cloak after initialization
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('data-cloak', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower

    if (wildflower.componentDefinitions) {
      wildflower.componentDefinitions.clear()
    }
    if (wildflower.componentInstances) {
      wildflower.componentInstances.clear()
    }

    if (wildflower._templateCache) {
      if (wildflower._templateCache.general) wildflower._templateCache.general.clear()
      if (wildflower._templateCache.lists) wildflower._templateCache.lists.clear()
      if (wildflower._templateCache.compiled) wildflower._templateCache.compiled.clear()
      if (wildflower._templateCache.extracted) wildflower._templateCache.extracted.clear()
      if (wildflower._templateCache.fragmentPools) wildflower._templateCache.fragmentPools.clear()
      if (wildflower._templateCache.stats) wildflower._templateCache.stats.clear()
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

  it('removes data-cloak from component element after scan', async () => {
    wildflower.component('cloak-test', {
      state: { visible: true }
    })

    testContainer.innerHTML = `
      <div data-component="cloak-test" data-cloak>
        <div data-show="visible">Content</div>
      </div>
    `

    // data-cloak should be present before scan
    const el = testContainer.querySelector('[data-component="cloak-test"]')
    expect(el.hasAttribute('data-cloak')).toBe(true)

    wildflower.scan()
    await waitForUpdate(200)

    // data-cloak should be removed after framework processes it
    expect(el.hasAttribute('data-cloak')).toBe(false)
  })

  it('removes data-cloak from inner elements after scan', async () => {
    wildflower.component('cloak-inner-test', {
      state: { isOpen: false }
    })

    testContainer.innerHTML = `
      <div data-component="cloak-inner-test">
        <div data-show="isOpen" data-cloak id="cloaked-inner">Modal</div>
      </div>
    `

    const inner = document.getElementById('cloaked-inner')
    expect(inner.hasAttribute('data-cloak')).toBe(true)

    wildflower.scan()
    await waitForUpdate(200)

    // data-cloak removed, but element should still be hidden by data-show
    expect(inner.hasAttribute('data-cloak')).toBe(false)
    expect(inner.style.display).toBe('none')
  })

  it('strips data-cloak from inner elements when a row is re-created in a different data-list (cross-list move)', async () => {
    // Bug repro: list-item moves between sibling data-lists. Framework
    // strips data-cloak on the original mount but does NOT run the
    // strip pass for the re-created copy — the inner element stays
    // hidden by `[data-cloak] { display: none !important }` forever,
    // even when data-show evaluates true.
    //
    // Found 2026-05-11 while building the PM demo's inline-edit cells.
    // Conditions to trigger:
    //   1. Two (or more) sibling data-lists driven by computed splits
    //      of the same source array.
    //   2. Row template contains an element with `data-cloak`.
    //   3. State mutation moves a row from one list's predicate to
    //      another's.
    wildflower.component('cross-list-cloak', {
      state: {
        rows: [
          { id: 'r1', group: 'A', label: 'Row 1' },
          { id: 'r2', group: 'A', label: 'Row 2' }
        ]
      },
      computed: {
        groupA() { return this.state.rows.filter(r => r.group === 'A') },
        groupB() { return this.state.rows.filter(r => r.group === 'B') }
      },
      moveR1ToB() {
        this.state.rows = this.state.rows.map(r =>
          r.id === 'r1' ? { ...r, group: 'B' } : r
        )
      }
    })

    testContainer.innerHTML = `
      <div data-component="cross-list-cloak">
        <button id="move-btn" data-action="moveR1ToB">Move r1</button>
        <div data-list="groupA" data-key="id" class="group-a">
          <template>
            <div class="row">
              <div class="cloaked" data-cloak data-bind="label"></div>
            </div>
          </template>
        </div>
        <div data-list="groupB" data-key="id" class="group-b">
          <template>
            <div class="row">
              <div class="cloaked" data-cloak data-bind="label"></div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(200)

    // Initial: both rows in group A, both .cloaked have data-cloak stripped.
    const cloakedInitial = testContainer.querySelectorAll('.cloaked')
    expect(cloakedInitial.length).toBe(2)
    cloakedInitial.forEach(el => {
      expect(el.hasAttribute('data-cloak')).toBe(false)
    })

    // Move r1 from group A to group B — re-creates r1's row in B's list.
    testContainer.querySelector('#move-btn').click()
    await waitForUpdate(200)

    // After move: group A has 1 row (r2), group B has 1 row (r1).
    const groupARows = testContainer.querySelectorAll('.group-a .row')
    const groupBRows = testContainer.querySelectorAll('.group-b .row')
    expect(groupARows.length).toBe(1)
    expect(groupBRows.length).toBe(1)

    // The bug: the re-created row in group B retains its data-cloak
    // attribute, so the cloaked element inside it stays hidden
    // permanently regardless of data-show.
    const cloakedAfter = testContainer.querySelectorAll('.cloaked')
    expect(cloakedAfter.length).toBe(2)
    cloakedAfter.forEach(el => {
      expect(el.hasAttribute('data-cloak')).toBe(false)
    })
  })

  it('defers cloak strip on subtrees of components registered after framework init', async () => {
    // Regression for the Chrome-observed "appear then hide" flash:
    // - Defer-loaded component scripts call wildflower.component() after
    //   framework init has already run its cloak-strip rAF.
    // - At that rAF, the elements inside the as-yet-unregistered component
    //   subtree have a [data-component] ancestor with no data-component-id.
    //   The framework defers their strip rather than removing the attribute,
    //   so they stay hidden by `[data-cloak] { display: none !important; }`.
    // - When the component eventually registers, _initializeComponentElement
    //   runs the render effect (which writes display:none synchronously for
    //   false data-show), then strips data-cloak from the subtree with the
    //   verdict applied. The cloak attribute only goes away after display
    //   has been correctly committed.
    //
    // Without the fix, the rAF stripped cloak before the component had any
    // chance to render display:none, briefly exposing the modal/section
    // before a later effect run hid it.

    // Put DOM in place BEFORE registering the component. wildflower.scan()
    // here mirrors the framework's initial scan finding a [data-component]
    // element whose definition isn't registered yet.
    testContainer.innerHTML = `
      <div data-component="late-reg-cloak">
        <div data-show="visible" data-cloak id="late-cloaked"></div>
      </div>
    `
    const el = document.getElementById('late-cloaked')
    expect(el.hasAttribute('data-cloak')).toBe(true)

    wildflower.scan()
    // Let the cloak-strip rAF fire. It should DEFER the strip because the
    // ancestor [data-component="late-reg-cloak"] has no data-component-id yet.
    await waitForUpdate(100)

    expect(el.hasAttribute('data-cloak')).toBe(true)
    // Display untouched (CSS rule hides via !important; no inline style needed)
    expect(el.style.display).toBe('')

    // Register the component AFTER framework init / scan. Triggers
    // _initializeComponentElements → _initializeComponentElement, which
    // runs the render effect (writes display:none) and strips cloak.
    wildflower.component('late-reg-cloak', {
      state: { visible: false }
    })

    await waitForUpdate(100)

    expect(el.hasAttribute('data-cloak')).toBe(false)
    expect(el.style.display).toBe('none')
  })

  it('commits a hide verdict synchronously with cloak strip when data-show is falsy', async () => {
    // Regression: cloak removal must not expose an element that data-show
    // would have hidden. The framework evaluates data-show inside the
    // cloak-strip rAF and writes display:none BEFORE removing data-cloak,
    // closing the Chrome-observed race where the cloak strip lands before
    // the render effect's display:none write.
    //
    // What this test pins down: after init, every cloaked+data-show=false
    // element has style.display === 'none' as an inline style (not just
    // hidden by the CSS [data-cloak] rule, which no longer applies once the
    // attribute is gone).
    wildflower.component('cloak-verdict', {
      state: { showA: false, showB: true, hideC: true }
    })

    testContainer.innerHTML = `
      <div data-component="cloak-verdict">
        <div data-show="showA"  data-cloak id="va">A</div>
        <div data-show="showB"  data-cloak id="vb">B</div>
        <div data-show="!hideC" data-cloak id="vc">C</div>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(200)

    const va = document.getElementById('va')
    const vb = document.getElementById('vb')
    const vc = document.getElementById('vc')

    // Cloak attribute is gone on all three
    expect(va.hasAttribute('data-cloak')).toBe(false)
    expect(vb.hasAttribute('data-cloak')).toBe(false)
    expect(vc.hasAttribute('data-cloak')).toBe(false)

    // showA=false → hidden via inline display:none (verdict applied)
    expect(va.style.display).toBe('none')
    // showB=true → visible
    expect(vb.style.display).toBe('')
    // !hideC where hideC=true → false → hidden
    expect(vc.style.display).toBe('none')
  })

  it('removes data-cloak from multiple elements in same component', async () => {
    wildflower.component('cloak-multi-test', {
      state: { showA: false, showB: false }
    })

    testContainer.innerHTML = `
      <div data-component="cloak-multi-test">
        <div data-show="showA" data-cloak class="panel-a">Panel A</div>
        <div data-show="showB" data-cloak class="panel-b">Panel B</div>
        <div>Always visible</div>
      </div>
    `

    const panelA = testContainer.querySelector('.panel-a')
    const panelB = testContainer.querySelector('.panel-b')
    expect(panelA.hasAttribute('data-cloak')).toBe(true)
    expect(panelB.hasAttribute('data-cloak')).toBe(true)

    wildflower.scan()
    await waitForUpdate(200)

    expect(panelA.hasAttribute('data-cloak')).toBe(false)
    expect(panelB.hasAttribute('data-cloak')).toBe(false)
  })
})
