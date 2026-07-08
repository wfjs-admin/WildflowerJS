/**
 * Regression: a list row's binding that references COMPONENT STATE (not an item
 * prop, not a computed) — e.g. data-show="showAll" — resolves against the component
 * and reacts to it. List-row bindings are item-first with a component-state
 * fallback (outer-scope fallback, like other templating systems).
 *
 * Was a no-op in BOTH renderers (resolved off the item → undefined → hidden,
 * non-reactive). Surfaced by the LR2-census audit.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function r() { if (window.wildflower?._forceCompleteRender) await window.wildflower._forceCompleteRender(); await new Promise(s => setTimeout(s, 50)) }
function scan(w) { if (w._setupDynamicComponentDetection) w._setupDynamicComponentDetection() }
const vis = el => !!el && el.style.display !== 'none'

describe('list row binding referencing component state', () => {
  let c, w
  beforeAll(async () => { await loadFramework() })
  beforeEach(() => {
    w = window.wildflower; resetFramework()
    if (w._initContextSystem) { w._contextSystemInitialized = false; w._initContextSystem() }
    c = document.createElement('div'); c.style.cssText = 'position:absolute;left:-9999px;opacity:0'; document.body.appendChild(c)
  })
  afterEach(() => { if (c?.parentNode) c.parentNode.removeChild(c) })

  it('data-show="<componentState>" shows/hides all rows and reacts', async () => {
    w.component('comp-state-show', {
      state: { items: [{ id: 1, label: 'A' }, { id: 2, label: 'B' }], showAll: true },
      toggle() { this.state.showAll = !this.state.showAll }
    })
    c.innerHTML = `
      <div data-component="comp-state-show">
        <ul data-list="items" data-key="id">
          <template><li><span class="lbl" data-show="showAll" data-bind="label"></span></li></template>
        </ul>
      </div>`
    scan(w); await r()

    let lbls = [...c.querySelectorAll('.lbl')]
    expect(lbls.length).toBe(2)
    expect(lbls.map(vis)).toEqual([true, true])   // showAll = true → both visible

    const inst = w.componentInstances.values().next().value
    inst.toggle()
    await r()
    expect([...c.querySelectorAll('.lbl')].map(vis)).toEqual([false, false])  // reacts → both hide
    inst.toggle()
    await r()
    expect([...c.querySelectorAll('.lbl')].map(vis)).toEqual([true, true])    // reacts back
  })

  it('data-bind="<componentState>" renders the component value when the item lacks it', async () => {
    w.component('comp-state-text', {
      state: { items: [{ id: 1 }, { id: 2 }], heading: 'Hello' }
    })
    c.innerHTML = `
      <div data-component="comp-state-text">
        <ul data-list="items" data-key="id">
          <template><li class="h" data-bind="heading"></li></template>
        </ul>
      </div>`
    scan(w); await r()
    expect([...c.querySelectorAll('.h')].map(li => li.textContent.trim())).toEqual(['Hello', 'Hello'])
  })

  it('REGRESSION: an item prop still shadows a same-named component field', async () => {
    w.component('shadow-test', {
      state: { items: [{ id: 1, label: 'item-A' }, { id: 2, label: 'item-B' }], label: 'COMPONENT' }
    })
    c.innerHTML = `
      <div data-component="shadow-test">
        <ul data-list="items" data-key="id">
          <template><li class="x" data-bind="label"></li></template>
        </ul>
      </div>`
    scan(w); await r()
    // The item's own `label` must win over the component's `label`.
    expect([...c.querySelectorAll('.x')].map(li => li.textContent.trim())).toEqual(['item-A', 'item-B'])
  })
})
