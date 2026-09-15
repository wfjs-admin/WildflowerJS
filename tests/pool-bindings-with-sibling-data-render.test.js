/**
 * Regression: does a `data-render` elsewhere in a component stop a POOL in the
 * same component from applying its `data-bind-attr` bindings?
 *
 * Reported from tower-defense-wf-pools (2026-09-14). That demo has a plain
 * <img> bound with data-bind-attr="{ src: throneSprite }" and, further down the
 * same component, a data-pool whose template also binds `src` per entity.
 * Adding data-render to the plain <img> left every pool row's <img> with no
 * src at all — rendering a broken image — while the pool ENTITIES still held
 * correct src values. Removing the data-render fixed it.
 *
 * RESULT (2026-09-14): the defect is real, but NOT as first described, and the
 * difference is the whole point of this file.
 *
 * The presence of a sibling data-render is harmless. Three variants pass: no
 * data-render, one before the pool, one after it. What breaks is the
 * TRANSITION. When the data-render condition starts falsy — so the element
 * begins removed — and later flips truthy, the pool's rows lose their
 * data-bind-attr values. `src` comes back null while the pool entity still
 * holds the correct string.
 *
 * That matches the demo exactly and explains why it looked so strange there:
 * the throne's data-render was bound to a sprite string that is empty until
 * _initGame runs, so the element was removed at parse time and re-inserted at
 * the same moment the pools filled.
 *
 * Both orderings fail, so it is not a race between the flip and the push:
 *   - flip data-render on, then fill the pool
 *   - fill the pool, then flip data-render on
 *
 * Where to look: whatever re-render the data-render transition triggers is
 * clearing or re-creating pool rows without re-applying their attribute
 * bindings. The entity data is untouched, so the fault is in the apply path,
 * not in the pool's storage.
 *
 * The passing tests are not filler. Keep them: they bound the defect, and a fix
 * that makes the two failing cases pass while breaking the ancestor case (where
 * the pool legitimately does not exist until the branch renders) is not a fix.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const describeIfPools = hasFeature('pools') ? describe : describe.skip

async function waitForRAF() {
  await new Promise(resolve => requestAnimationFrame(() => {
    requestAnimationFrame(() => resolve())
  }))
  await new Promise(resolve => setTimeout(resolve, 10))
}

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

const SRC_A = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='
const SRC_B = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

describeIfPools('Pool data-bind-attr alongside a sibling data-render', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()
    testContainer = document.createElement('div')
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  // Builds the same component three ways: without a data-render element, with
  // one before the pool, and with one after it. Everything else is identical,
  // so a difference in outcome isolates data-render as the cause.
  async function mountPool(name, variant) {
    const renderEl = `<img class="solo" data-render="showSolo" data-bind-attr="{ src: soloSrc }">`

    testContainer.innerHTML = `
      <div data-component="${name}">
        ${variant === 'before' ? renderEl : ''}
        <div data-pool="rows" data-key="id">
          <template>
            <img class="row-img" data-bind-attr="{ src: imgSrc }">
          </template>
        </div>
        ${variant === 'after' ? renderEl : ''}
      </div>
    `

    let pool = null
    wildflower.component(name, {
      state: { showSolo: true, soloSrc: SRC_B },
      pools: { rows: {} },
      init() { pool = this.getPool('rows') }
    })
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    pool.push({ id: 1, imgSrc: SRC_A })
    await waitForRAF()

    return testContainer.querySelector('.row-img')
  }

  it('control: pool rows get their bound src when no data-render is present', async () => {
    const img = await mountPool('pool-render-control', 'none')
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toBe(SRC_A)
  })

  it('a sibling data-render BEFORE the pool must not strip the rows\' bound src', async () => {
    const img = await mountPool('pool-render-before', 'before')
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toBe(SRC_A)
  })

  it('a sibling data-render AFTER the pool must not strip the rows\' bound src', async () => {
    const img = await mountPool('pool-render-after', 'after')
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toBe(SRC_A)
  })

  it('the pool entity keeps its own data regardless: the defect is in applying it', async () => {
    // In the demo the entities were always correct and only the DOM was wrong.
    // Pinning that here says where to look: the bind-apply path, not the pool's
    // data or the push.
    testContainer.innerHTML = `
      <div data-component="pool-render-entity">
        <img class="solo" data-render="showSolo" data-bind-attr="{ src: soloSrc }">
        <div data-pool="rows" data-key="id">
          <template>
            <img class="row-img" data-bind-attr="{ src: imgSrc }">
          </template>
        </div>
      </div>
    `
    let pool = null
    wildflower.component('pool-render-entity', {
      state: { showSolo: true, soloSrc: SRC_B },
      pools: { rows: {} },
      init() { pool = this.getPool('rows') }
    })
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    pool.push({ id: 1, imgSrc: SRC_A })
    await waitForRAF()

    const entity = pool.at ? pool.at(0) : pool.items[0]
    expect(entity.imgSrc).toBe(SRC_A)
  })

  // The cases above all start with data-render TRUE. The demo did not: the
  // throne's data-render was bound to a sprite string that starts empty, so the
  // element begins REMOVED and is re-inserted inside the same call that fills
  // the pools. That ordering is the part worth testing.
  it('data-render flipping false -> true while the pool fills must not strip the rows\' src', async () => {
    testContainer.innerHTML = `
      <div data-component="pool-render-flip">
        <img class="solo" data-render="soloSrc" data-bind-attr="{ src: soloSrc }">
        <div data-pool="rows" data-key="id">
          <template>
            <img class="row-img" data-bind-attr="{ src: imgSrc }">
          </template>
        </div>
      </div>
    `
    let inst = null
    let pool = null
    wildflower.component('pool-render-flip', {
      state: { soloSrc: '' },          // falsy: the solo img starts removed
      pools: { rows: {} },
      init() { inst = this; pool = this.getPool('rows') }
    })
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    // Exactly the demo's sequence: flip data-render on, then fill the pool,
    // in one synchronous block.
    inst.state.soloSrc = SRC_B
    pool.push({ id: 1, imgSrc: SRC_A })
    await waitForRAF()

    const rowImg = testContainer.querySelector('.row-img')
    expect(rowImg).toBeTruthy()
    expect(rowImg.getAttribute('src')).toBe(SRC_A)
  })

  it('...and the same with the pool filled first, then data-render flipped on', async () => {
    testContainer.innerHTML = `
      <div data-component="pool-render-flip-2">
        <img class="solo" data-render="soloSrc" data-bind-attr="{ src: soloSrc }">
        <div data-pool="rows" data-key="id">
          <template>
            <img class="row-img" data-bind-attr="{ src: imgSrc }">
          </template>
        </div>
      </div>
    `
    let inst = null
    let pool = null
    wildflower.component('pool-render-flip-2', {
      state: { soloSrc: '' },
      pools: { rows: {} },
      init() { inst = this; pool = this.getPool('rows') }
    })
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    pool.push({ id: 1, imgSrc: SRC_A })
    await waitForRAF()
    inst.state.soloSrc = SRC_B
    await waitForRAF()

    const rowImg = testContainer.querySelector('.row-img')
    expect(rowImg).toBeTruthy()
    expect(rowImg.getAttribute('src')).toBe(SRC_A)
  })

  it('data-render on an ANCESTOR of the pool is a different case: rows appear when it renders', async () => {
    // Not the reported bug, and not expected to fail. Included so a fix for the
    // sibling case is not written in a way that breaks the legitimate one, where
    // the pool genuinely should not exist until the branch renders.
    testContainer.innerHTML = `
      <div data-component="pool-render-ancestor">
        <div data-render="branch">
          <div data-pool="rows" data-key="id">
            <template>
              <img class="row-img" data-bind-attr="{ src: imgSrc }">
            </template>
          </div>
        </div>
      </div>
    `
    let inst = null
    let pool = null
    wildflower.component('pool-render-ancestor', {
      state: { branch: true },
      pools: { rows: {} },
      init() { inst = this; pool = this.getPool('rows') }
    })
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    pool.push({ id: 1, imgSrc: SRC_A })
    await waitForRAF()

    expect(testContainer.querySelector('.row-img')?.getAttribute('src')).toBe(SRC_A)
    expect(inst).toBeTruthy()
  })
})
