/**
 * SSR adoption round-trip stays text-safe.
 *
 * The escalation shape of Svelte's CVE-2025-15265 (hydration-key XSS): data a
 * server correctly HTML-escaped becomes executable after passing through the
 * framework's own round-trip. WildflowerJS's equivalent surface is adoption:
 * server-escaped text is parsed into state, and re-renders write it back.
 *
 * The invariant pinned here: adopted text NEVER re-enters the DOM as markup.
 * The clone-setter row path builds its prototype from template parts with
 * empty bind sites, and every text binding writes through textContent/.data,
 * so hostile-looking strings stay inert on every render path — bulk-create
 * (>= 10 rows), per-item (< 10 rows), and plain record bindings. The explicit
 * opt-in sink (data-bind-html / data-type="html") is out of scope: that is
 * the author's declared choice, routed through setHtmlSanitizer.
 *
 * A future renderer optimization that interpolates values into an HTML
 * string would fail these tests. That is their entire purpose.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

// Adoption is an SSR-tier feature; non-SSR builds (core/lite/spa/mini/nano)
// never populate state from server markup, so the round-trip under test does
// not exist there. Same gate as the sibling ssr-*.test.js files.
const describeIfSSR = hasFeature('ssr') ? describe : describe.skip

const PAYLOAD = '<img src=x onerror="window.__wfPwned=true"><script>window.__wfPwned=true<\/script>'
const ESCAPED = PAYLOAD.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function waitForUpdate(ms = 120) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

function ensureComponentScanning(wildflower) {
  if (wildflower._setupDynamicComponentDetection) {
    wildflower._setupDynamicComponentDetection()
  }
}

describeIfSSR('SSR adoption XSS round-trip', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()
    delete window.__wfPwned
    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
    delete window.__wfPwned
  })

  function assertInert(root) {
    expect(window.__wfPwned).toBeUndefined()
    expect(root.querySelector('img')).toBeNull()
    expect(root.querySelector('script')).toBeNull()
  }

  it('adopted record text stays text through mutation and re-render', async () => {
    // Server-escaped hostile content: the DOM textContent is the raw payload,
    // exactly what a correct server-side template engine produces.
    testContainer.innerHTML = `
      <div data-component="xss-record" data-ssr="true">
        <span class="msg" data-bind="msg">${ESCAPED}</span>
      </div>
    `
    wildflower.component('xss-record', { state: { msg: '' } })
    ensureComponentScanning(wildflower)
    wildflower._scanForDynamicComponents()
    await waitForUpdate()

    const comp = wildflower.getComponent('xss-record')
    // Adoption read the escaped markup as the raw text value.
    expect(comp.state.msg).toBe(PAYLOAD)
    assertInert(testContainer)

    // The round-trip: mutate, forcing the framework to write the hostile
    // string back into the DOM. It must go out the text path, not as markup.
    comp.state.msg = PAYLOAD + '!'
    await waitForUpdate()

    expect(testContainer.querySelector('.msg').textContent).toBe(PAYLOAD + '!')
    assertInert(testContainer)
  })

  it('per-item list path (< 10 rows) renders hostile strings inert', async () => {
    wildflower.component('xss-small-list', {
      state: {
        items: [
          { id: 1, name: PAYLOAD },
          { id: 2, name: 'safe' }
        ]
      }
    })
    testContainer.innerHTML = `
      <div data-component="xss-small-list">
        <ul data-list="items" data-key="id">
          <template><li><span data-bind="name"></span></li></template>
        </ul>
      </div>
    `
    ensureComponentScanning(wildflower)
    wildflower._scanForDynamicComponents()
    await waitForUpdate()

    const rows = testContainer.querySelectorAll('li')
    expect(rows.length).toBe(2)
    expect(rows[0].textContent).toBe(PAYLOAD)
    assertInert(testContainer)

    // Update path: patch the hostile value in place.
    const comp = wildflower.getComponent('xss-small-list')
    comp.state.items[0].name = PAYLOAD + '?'
    await waitForUpdate()
    expect(testContainer.querySelectorAll('li')[0].textContent).toBe(PAYLOAD + '?')
    assertInert(testContainer)
  })

  it('bulk clone-setter path (>= 10 rows) renders hostile strings inert', async () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `${PAYLOAD} #${i}` }))
    wildflower.component('xss-bulk-list', { state: { items } })
    testContainer.innerHTML = `
      <div data-component="xss-bulk-list">
        <ul data-list="items" data-key="id">
          <template><li><span data-bind="name"></span></li></template>
        </ul>
      </div>
    `
    ensureComponentScanning(wildflower)
    wildflower._scanForDynamicComponents()
    await waitForUpdate()

    const rows = testContainer.querySelectorAll('li')
    expect(rows.length).toBe(12)
    expect(rows[0].textContent).toBe(`${PAYLOAD} #0`)
    expect(rows[11].textContent).toBe(`${PAYLOAD} #11`)
    assertInert(testContainer)
  })

  it('adopted SSR list rows stay inert through framework re-render', async () => {
    // Server-rendered rows whose escaped text is hostile; adoption parses
    // them, and the first framework render replaces them via the sweep.
    testContainer.innerHTML = `
      <div data-component="xss-ssr-list" data-ssr="true">
        <ul data-list="rows">
          <template><li><span data-bind="label"></span></li></template>
          <li><span data-bind="label">${ESCAPED}</span></li>
          <li><span data-bind="label">plain</span></li>
        </ul>
      </div>
    `
    wildflower.component('xss-ssr-list', {
      state: { rows: [{ label: PAYLOAD }, { label: 'plain' }] }
    })
    ensureComponentScanning(wildflower)
    wildflower._scanForDynamicComponents()
    await waitForUpdate(200)

    const rows = testContainer.querySelectorAll('li')
    expect(rows.length).toBe(2)
    expect(rows[0].textContent).toBe(PAYLOAD)
    assertInert(testContainer)
  })
})
