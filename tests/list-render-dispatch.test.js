/**
 * data-render bindings driven by flat item props on fast-touch templates —
 * the fields P4-S4 moves onto the per-list sink dispatcher. Green before AND
 * after the slice (behavior-preserving): structural toggles per row, negation,
 * fields shared with other kinds, and — the load-bearing case — a subtree
 * revealed by a render flip must show CURRENT values for bindings whose props
 * changed while the block was hidden.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function settle() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 30))
}

describe('List data-render item-prop dispatch', () => {
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
    if (testContainer && testContainer.parentNode) testContainer.parentNode.removeChild(testContainer)
  })

  function mount(templateInner, items) {
    testContainer.innerHTML = `
      <div data-component="render-list">
        <ul data-list="items" data-key="id">
          <template>${templateInner}</template>
        </ul>
      </div>
    `
    wildflower.component('render-list', { state: { items } })
    wildflower.scan()
    const component = testContainer.querySelector('[data-component]')
    return wildflower.componentInstances.get(component.dataset.componentId)
  }

  it('data-render on a flat item prop inserts/removes the block per row', async () => {
    const instance = mount(
      `<li class="row"><span class="name" data-bind="name"></span><div class="detail" data-render="expanded">detail</div></li>`,
      Array.from({ length: 5 }, (_, i) => ({ id: i, name: `N${i}`, expanded: false }))
    )
    await settle()
    const details = () => testContainer.querySelectorAll('li.row .detail')
    expect(details().length).toBe(0)

    instance.state.items[2].expanded = true
    await settle()
    expect(details().length).toBe(1)

    instance.state.items[2].expanded = false
    await settle()
    expect(details().length).toBe(0)
  })

  it('negated data-render ("!prop") stays live', async () => {
    const instance = mount(
      `<li class="row"><div class="fallback" data-render="!loaded">loading…</div></li>`,
      [{ id: 0, loaded: false }]
    )
    await settle()
    const fallbacks = () => testContainer.querySelectorAll('li.row .fallback')
    expect(fallbacks().length).toBe(1)

    instance.state.items[0].loaded = true
    await settle()
    expect(fallbacks().length).toBe(0)
  })

  it('a subtree revealed by a render flip shows CURRENT values for props changed while hidden', async () => {
    const instance = mount(
      `<li class="row">
         <span class="name" data-bind="name"></span>
         <div class="detail" data-render="expanded"><b class="note" data-bind="note"></b></div>
       </li>`,
      [{ id: 0, name: 'a', expanded: true, note: 'first' }]
    )
    await settle()
    expect(testContainer.querySelector('li.row .note').textContent).toBe('first')

    // hide, mutate the inner binding's prop while hidden, reveal
    instance.state.items[0].expanded = false
    await settle()
    expect(testContainer.querySelector('li.row .note')).toBeNull()

    instance.state.items[0].note = 'second'
    await settle()

    instance.state.items[0].expanded = true
    await settle()
    const note = testContainer.querySelector('li.row .note')
    expect(note).not.toBeNull()
    expect(note.textContent).toBe('second')
  })

  it('render + show sharing a field both update on one write', async () => {
    const instance = mount(
      `<li class="row"><div class="block" data-render="open">body</div><em class="hint" data-show="!open">closed</em></li>`,
      [{ id: 0, open: false }]
    )
    await settle()
    const block = () => testContainer.querySelector('li.row .block')
    const hint = () => testContainer.querySelector('li.row .hint')
    expect(block()).toBeNull()
    expect(hint().style.display).not.toBe('none')

    instance.state.items[0].open = true
    await settle()
    expect(block()).not.toBeNull()
    expect(hint().style.display).toBe('none')
  })

  it('a render-prop write that does not flip the condition leaves the row intact', async () => {
    const instance = mount(
      `<li class="row"><div class="big" data-render="count > 3"><span class="c" data-bind="count"></span></div></li>`,
      [{ id: 0, count: 5 }]
    )
    await settle()
    expect(testContainer.querySelector('li.row .c').textContent).toBe('5')

    instance.state.items[0].count = 7
    await settle()
    const c = testContainer.querySelector('li.row .c')
    expect(c).not.toBeNull()
    expect(c.textContent).toBe('7')

    instance.state.items[0].count = 2
    await settle()
    expect(testContainer.querySelector('li.row .big')).toBeNull()
  })

  it('render fields survive a same-key array replace', async () => {
    const instance = mount(
      `<li class="row"><span class="name" data-bind="name"></span><div class="detail" data-render="expanded">d</div></li>`,
      [{ id: 0, name: 'a', expanded: false }, { id: 1, name: 'b', expanded: true }]
    )
    await settle()
    expect(testContainer.querySelectorAll('li.row .detail').length).toBe(1)

    instance.state.items = [{ id: 0, name: 'a2', expanded: true }, { id: 1, name: 'b2', expanded: false }]
    await settle()
    const rows = () => Array.from(testContainer.querySelectorAll('li.row'))
    expect(rows()[0].querySelector('.detail')).not.toBeNull()
    expect(rows()[1].querySelector('.detail')).toBeNull()

    // stamps live against the NEW proxies
    instance.state.items[1].expanded = true
    await settle()
    expect(rows()[1].querySelector('.detail')).not.toBeNull()
  })
})
