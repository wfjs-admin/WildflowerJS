/**
 * Regression: a list over an array of PRIMITIVES rendered with data-bind="$this"
 * (or its alias "$item") must render each primitive value. It used to throw
 * `TypeError: Cannot use 'in' operator to search for '$this' in <value>` (the
 * `v in itemProxy` site, where itemProxy is the raw primitive) and render empty.
 *
 * $this is a documented feature (llms.txt). Existing fixtures only asserted row
 * COUNT, which hid the empty render. Surfaced by the LR2-census audit.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) await window.wildflower._forceCompleteRender()
  await new Promise(s => setTimeout(s, 50))
}
function ensureComponentScanning(w) { if (w._setupDynamicComponentDetection) w._setupDynamicComponentDetection() }

describe('list of primitives with $this / $item', () => {
  let c, w
  beforeAll(async () => { await loadFramework() })
  beforeEach(() => {
    w = window.wildflower
    resetFramework()
    if (w._initContextSystem) { w._contextSystemInitialized = false; w._initContextSystem() }
    c = document.createElement('div'); c.style.cssText = 'position:absolute;left:-9999px;opacity:0'; document.body.appendChild(c)
  })
  afterEach(() => { if (c?.parentNode) c.parentNode.removeChild(c) })

  it('renders primitive values via $this', async () => {
    w.component('prim-this', { state: { colors: ['red', 'green', 'blue'] } })
    c.innerHTML = `
      <div data-component="prim-this">
        <ul data-list="colors"><template><li data-bind="$this"></li></template></ul>
      </div>`
    ensureComponentScanning(w)
    await waitForCompleteRender()

    const items = [...c.querySelectorAll('li')]
    expect(items.length).toBe(3)
    expect(items.map(li => li.textContent.trim())).toEqual(['red', 'green', 'blue'])
  })

  it('is reactive: appending a primitive adds a row', async () => {
    w.component('prim-react', {
      state: { colors: ['red', 'green'] },
      add() { this.state.colors.push('blue') }
    })
    c.innerHTML = `
      <div data-component="prim-react">
        <ul data-list="colors"><template><li data-bind="$this"></li></template></ul>
      </div>`
    ensureComponentScanning(w)
    await waitForCompleteRender()
    expect([...c.querySelectorAll('li')].map(li => li.textContent.trim())).toEqual(['red', 'green'])

    const inst = w.componentInstances.values().next().value
    inst.add()
    await waitForCompleteRender()
    expect([...c.querySelectorAll('li')].map(li => li.textContent.trim())).toEqual(['red', 'green', 'blue'])
  })

  it('renders duplicate primitive values as separate rows', async () => {
    w.component('prim-dup', { state: { colors: ['red', 'red', 'green'] } })
    c.innerHTML = `
      <div data-component="prim-dup">
        <ul data-list="colors"><template><li data-bind="$this"></li></template></ul>
      </div>`
    ensureComponentScanning(w)
    await waitForCompleteRender()
    expect([...c.querySelectorAll('li')].map(li => li.textContent.trim())).toEqual(['red', 'red', 'green'])
  })

  it('renders primitive values via $item alias', async () => {
    w.component('prim-item', { state: { nums: [10, 20, 30] } })
    c.innerHTML = `
      <div data-component="prim-item">
        <ul data-list="nums"><template><li data-bind="$item"></li></template></ul>
      </div>`
    ensureComponentScanning(w)
    await waitForCompleteRender()

    const items = [...c.querySelectorAll('li')]
    expect(items.length).toBe(3)
    expect(items.map(li => li.textContent.trim())).toEqual(['10', '20', '30'])
  })
})
