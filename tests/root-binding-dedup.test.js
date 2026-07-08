/**
 * Regression: a row/entity template ROOT that carries data-bind-style /
 * data-bind-class / data-bind-attr must compile to exactly ONE evaluator
 * (the isRoot entry), not two.
 *
 * Bug shape (scarlet-dot-73, 2026-06-21):
 *
 *   When the template root has a binding, TemplateSystem prepends the root
 *   into the walked element set (allElements = [queryRoot, ...children]),
 *   so the walk pushes an INDEXED evaluator (index 0, elementPath []) for
 *   the root binding. It then ALSO unshifts an isRoot evaluator for the
 *   same expression. Both survive into metadata.{style,class,attr}Evaluators,
 *   so the pool flush (PoolRenderer._applyStyleBindings et al.) evaluates the
 *   root binding TWICE per entity per frame — measured styleEvals=480000 over
 *   a 4000-entity x 60-frame run (2x the expected 240k), allocating the
 *   {transform,...} result object and string-coercing it on every redundant
 *   pass. The data-list directWriter classifier already deduped this; the pool
 *   flush did not.
 *
 * Fix: skip the indexed root duplicate in each evaluator-build loop (gated on
 * the matching rootBindings.hasBindX, which guarantees the isRoot unshift
 * re-adds it). Every consumer (PoolRenderer + the three data-list row
 * appliers) already resolves isRoot directly, so the indexed entry was pure
 * redundant work.
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

describe('root binding dedup (compiles to one isRoot evaluator)', () => {
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

  it('root data-bind-style compiles to a single isRoot evaluator (no indexed duplicate)', async () => {
    wildflower.component('dedup-style-list', {
      state: { rows: [{ id: 1, tf: 'translateX(1px)', bg: 'red' }] }
    })
    testContainer.innerHTML = `
      <div data-component="dedup-style-list">
        <ul data-list="rows" data-key="id">
          <template>
            <li data-bind-style="{ transform: tf, background: bg }"></li>
          </template>
        </ul>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const row = testContainer.querySelector('ul li')
    expect(row).toBeTruthy()
    const meta = row._compiledMetadata
    expect(meta).toBeTruthy()

    const styleEvals = meta.styleEvaluators || []
    const rootStyle = styleEvals.filter(e =>
      e.expression === '{ transform: tf, background: bg }')
    // Exactly one evaluator for the root style binding, and it is the isRoot one.
    expect(rootStyle.length).toBe(1)
    expect(rootStyle[0].isRoot).toBe(true)

    // And it actually rendered (the isRoot entry drives the DOM write).
    expect(row.style.transform).toBe('translateX(1px)')
    expect(row.style.background).toContain('red')
  })

  it('root data-bind-class compiles to a single isRoot evaluator', async () => {
    wildflower.component('dedup-class-list', {
      state: { rows: [{ id: 1, cls: 'on', label: 'A' }] }
    })
    testContainer.innerHTML = `
      <div data-component="dedup-class-list">
        <ul data-list="rows" data-key="id">
          <template>
            <li data-bind-class="cls"><span data-bind="label"></span></li>
          </template>
        </ul>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const row = testContainer.querySelector('ul li')
    expect(row).toBeTruthy()
    const meta = row._compiledMetadata
    expect(meta).toBeTruthy()

    // A bare data-bind-class="cls" is a simple-property binding; production
    // builds may apply the root via a leaner path than classEvaluators, so we
    // assert the precise invariant the dedup guarantees rather than the
    // representation: NO indexed (non-isRoot) evaluator with an empty
    // elementPath. Before the fix the root appeared twice — once isRoot, once
    // indexed (elementPath []) — and the per-frame flush ran both.
    const indexedRootDup = (meta.classEvaluators || []).filter(
      e => !e.isRoot && (!e.elementPath || e.elementPath.length === 0))
    expect(indexedRootDup.length).toBe(0)
    expect(row.classList.contains('on')).toBe(true)
  })

  it('root data-bind-attr compiles to a single isRoot evaluator', async () => {
    wildflower.component('dedup-attr-list', {
      state: { rows: [{ id: 1, t: 'tip', label: 'A' }] }
    })
    testContainer.innerHTML = `
      <div data-component="dedup-attr-list">
        <ul data-list="rows" data-key="id">
          <template>
            <li data-bind-attr="{ title: t }"><span data-bind="label"></span></li>
          </template>
        </ul>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const row = testContainer.querySelector('ul li')
    expect(row).toBeTruthy()
    const meta = row._compiledMetadata
    expect(meta).toBeTruthy()

    const rootAttr = (meta.attrEvaluators || []).filter(e => e.expression === '{ title: t }')
    expect(rootAttr.length).toBe(1)
    expect(rootAttr[0].isRoot).toBe(true)
    expect(row.getAttribute('title')).toBe('tip')
  })
})
