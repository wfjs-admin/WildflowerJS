/**
 * Bulk create builds a row's binding-element array on first need, not per
 * row at create (2026-09-03, perf/clear-op create path). A plain text
 * template (text bindings, a root class, child actions) writes its text by
 * compiled element path and leaves the array to _rowElements; the first
 * reader (an action dispatch, a sink write) builds and stashes it. Templates
 * whose create loop reads the array (style/attr bindings, a non-root class
 * evaluator, data-event-outside) keep the eager build.
 *
 * White-box on purpose: the pins are the presence/absence of the array and
 * the identity of the elements it resolves, plus the behaviors that rely on
 * it (dispatch on an untouched row, a targeted text write, a full create
 * into a container that still holds a stray child).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

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

// Twelve keyed items: over the bulk threshold (10), so the clone+setter path runs.
function items(n = 12) {
  const out = []
  for (let i = 1; i <= n; i++) out.push({ id: i, label: 'row ' + i, c: 'rgb(0, 0, ' + i + ')' })
  return out
}

// White-box on row expandos (_bindingElements, _compiledMetadata), which the
// production builds mangle: dev/raw lanes only, like the other expando pins.
describe.skipIf(isMinifiedBuild())('bulk create: lazy binding-element array', () => {
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
    testContainer.style.opacity = '0'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  it('a plain text template leaves the array unbuilt; the first dispatch builds it and resolves the right elements', async () => {
    const log = []
    wildflower.component('lazy-els-plain', {
      state: { rows: items(), selectedId: null },
      pick(event, element, details) { log.push(details.item.id + ':' + details.index) }
    })
    testContainer.innerHTML = `
      <div data-component="lazy-els-plain">
        <ul class="rows" data-list="rows" data-key="id">
          <template>
            <li data-bind-class="id === selectedId ? 'on' : ''">
              <span class="n" data-bind="id"></span>
              <a class="act" data-action="pick"><b class="lbl" data-bind="label"></b></a>
            </li>
          </template>
        </ul>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const rows = testContainer.querySelectorAll('.rows > li')
    expect(rows.length).toBe(12)
    // Text written by path, identical to the array-driven write.
    expect(rows[0].querySelector('.n').textContent).toBe('1')
    expect(rows[11].querySelector('.lbl').textContent).toBe('row 12')
    // No row carries the array yet.
    for (const row of rows) {
      expect(row._bindingElements).toBeUndefined()
      expect(row._cachedElementsArray).toBeUndefined()
    }

    // First interaction on an untouched row: dispatch resolves through the
    // compiled metadata, which builds the array for that row only.
    rows[4].querySelector('.lbl').click()
    await waitForCompleteRender()
    expect(log).toEqual(['5:4'])
    const md = rows[4]._compiledMetadata
    const els = rows[4]._bindingElements
    expect(Array.isArray(els)).toBe(true)
    expect(els.length).toBe(md.elementPaths.length)
    // Every compiled index resolves to the element the path names.
    for (const b of md.bindings) expect(els[b.index].textContent).toBe(String(items()[4][b.path]))
    for (const a of md.actions) expect(els[a.index]).toBe(rows[4].querySelector('.act'))
    // Untouched neighbours are still lazy.
    expect(rows[3]._bindingElements).toBeUndefined()
    expect(rows[5]._bindingElements).toBeUndefined()
  })

  it('a sink write to an untouched row builds the array and updates the node', async () => {
    // Root class + text: the row's leaves route through the per-list sink,
    // whose targeted write resolves the element array on first need.
    wildflower.component('lazy-els-write', {
      state: { rows: items(), selectedId: null }
    })
    testContainer.innerHTML = `
      <div data-component="lazy-els-write">
        <ul class="rows" data-list="rows" data-key="id">
          <template>
            <li data-bind-class="id === selectedId ? 'on' : ''"><span class="n" data-bind="id"></span> <b class="lbl" data-bind="label"></b></li>
          </template>
        </ul>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const rows = testContainer.querySelectorAll('.rows > li')
    expect(rows.length).toBe(12)
    expect(rows[7]._bindingElements).toBeUndefined()

    const instance = wildflower.componentInstances.values().next().value
    instance.state.rows[7].label = 'changed'
    await waitForCompleteRender()

    expect(rows[7].querySelector('.lbl').textContent).toBe('changed')
    expect(rows[7].querySelector('.n').textContent).toBe('8')
    expect(Array.isArray(rows[7]._bindingElements) || Array.isArray(rows[7]._cachedElementsArray)).toBe(true)
    // The write touched one row.
    expect(rows[6]._bindingElements).toBeUndefined()
    expect(rows[8]._bindingElements).toBeUndefined()
  })

  it('a pure text template stamps its direct writers by path and stays array-free through a write', async () => {
    wildflower.component('lazy-els-puretext', {
      state: { rows: items() }
    })
    testContainer.innerHTML = `
      <div data-component="lazy-els-puretext">
        <ul class="rows" data-list="rows" data-key="id">
          <template>
            <li><span class="n" data-bind="id"></span> <b class="lbl" data-bind="label"></b></li>
          </template>
        </ul>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const rows = testContainer.querySelectorAll('.rows > li')
    expect(rows.length).toBe(12)
    for (const row of rows) expect(row._bindingElements).toBeUndefined()

    const instance = wildflower.componentInstances.values().next().value
    instance.state.rows[7].label = 'changed'
    instance.state.rows[2].label = 'also'
    await waitForCompleteRender()

    expect(rows[7].querySelector('.lbl').textContent).toBe('changed')
    expect(rows[7].querySelector('.n').textContent).toBe('8')
    expect(rows[2].querySelector('.lbl').textContent).toBe('also')
    expect(rows[2].querySelector('.n').textContent).toBe('3')
  })

  it('templates whose create loop reads the array keep the eager build', async () => {
    wildflower.component('lazy-els-style', {
      state: { rows: items() }
    })
    wildflower.component('lazy-els-childclass', {
      state: { rows: items() }
    })
    testContainer.innerHTML = `
      <div data-component="lazy-els-style">
        <ul class="styled" data-list="rows" data-key="id">
          <template>
            <li><span class="lbl" data-bind="label" data-bind-style="{ color: c }"></span></li>
          </template>
        </ul>
      </div>
      <div data-component="lazy-els-childclass">
        <ul class="classed" data-list="rows" data-key="id">
          <template>
            <li><span class="lbl" data-bind="label" data-bind-class="id > 6 ? 'hi' : 'lo'"></span></li>
          </template>
        </ul>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const styled = testContainer.querySelectorAll('.styled > li')
    expect(styled.length).toBe(12)
    for (const row of styled) expect(Array.isArray(row._bindingElements)).toBe(true)
    expect(styled[2].querySelector('.lbl').style.color).toBe('rgb(0, 0, 3)')

    const classed = testContainer.querySelectorAll('.classed > li')
    expect(classed.length).toBe(12)
    for (const row of classed) expect(Array.isArray(row._bindingElements)).toBe(true)
    expect(classed[5].querySelector('.lbl').classList.contains('lo')).toBe(true)
    expect(classed[6].querySelector('.lbl').classList.contains('hi')).toBe(true)
  })

  it('a full create into a container still holding a stray child replaces it', async () => {
    wildflower.component('lazy-els-stray', {
      state: { rows: items() }
    })
    testContainer.innerHTML = `
      <div data-component="lazy-els-stray">
        <ul class="rows" data-list="rows" data-key="id"><li class="stray">stray</li>
          <template>
            <li class="row" data-bind="label"></li>
          </template>
        </ul>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const list = testContainer.querySelector('.rows')
    expect(list.querySelectorAll('.stray').length).toBe(0)
    expect(list.querySelectorAll('.row').length).toBe(12)
    expect(list.children.length).toBe(12)
  })
})
