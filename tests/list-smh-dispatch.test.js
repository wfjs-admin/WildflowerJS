/**
 * Show/html/model bindings driven by flat item props on fast-touch templates —
 * the fields P4-S3 moves onto the per-list sink dispatcher. These tests pin the
 * observable behavior on both sides of that slice (they must be green before
 * AND after): targeted item-prop writes must update the bound DOM aspect, stay
 * live across repeated writes and same-key array replaces, and not disturb
 * sibling rows.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function settle() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 30))
}

describe('List show/html/model item-prop dispatch', () => {
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
      <div data-component="smh-list">
        <ul data-list="items" data-key="id">
          <template>${templateInner}</template>
        </ul>
      </div>
    `
    wildflower.component('smh-list', { state: { items } })
    wildflower.scan()
    const component = testContainer.querySelector('[data-component]')
    return wildflower.componentInstances.get(component.dataset.componentId)
  }

  it('data-show on a flat item prop toggles per row on targeted writes', async () => {
    const instance = mount(
      `<li class="row"><span class="name" data-bind="name"></span><em class="badge" data-show="active">active</em></li>`,
      Array.from({ length: 6 }, (_, i) => ({ id: i, name: `N${i}`, active: true }))
    )
    await settle()
    const badges = () => Array.from(testContainer.querySelectorAll('li.row .badge'))
    expect(badges().length).toBe(6)
    expect(badges()[2].style.display).not.toBe('none')

    instance.state.items[2].active = false
    await settle()
    expect(badges()[2].style.display).toBe('none')
    expect(badges()[1].style.display).not.toBe('none')

    instance.state.items[2].active = true
    await settle()
    expect(badges()[2].style.display).not.toBe('none')
  })

  it('negated data-show ("!prop") stays live', async () => {
    const instance = mount(
      `<li class="row"><em class="off" data-show="!active">inactive</em></li>`,
      [{ id: 0, active: true }, { id: 1, active: false }]
    )
    await settle()
    const offs = () => Array.from(testContainer.querySelectorAll('li.row .off'))
    expect(offs()[0].style.display).toBe('none')
    expect(offs()[1].style.display).not.toBe('none')

    instance.state.items[0].active = false
    await settle()
    expect(offs()[0].style.display).not.toBe('none')
  })

  it('data-show expression over two item props re-evaluates on either prop', async () => {
    const instance = mount(
      `<li class="row"><em class="hot" data-show="score > limit">hot</em></li>`,
      [{ id: 0, score: 5, limit: 10 }]
    )
    await settle()
    const hot = () => testContainer.querySelector('li.row .hot')
    expect(hot().style.display).toBe('none')

    instance.state.items[0].score = 20
    await settle()
    expect(hot().style.display).not.toBe('none')

    instance.state.items[0].limit = 30
    await settle()
    expect(hot().style.display).toBe('none')
  })

  it('data-bind-html on a flat item prop rewrites per row', async () => {
    const instance = mount(
      `<li class="row"><div class="body" data-bind-html="html"></div></li>`,
      [{ id: 0, html: '<b>one</b>' }, { id: 1, html: '<i>two</i>' }]
    )
    await settle()
    const bodies = () => Array.from(testContainer.querySelectorAll('li.row .body'))
    expect(bodies()[0].innerHTML).toBe('<b>one</b>')

    instance.state.items[0].html = '<u>uno</u>'
    await settle()
    expect(bodies()[0].innerHTML).toBe('<u>uno</u>')
    expect(bodies()[1].innerHTML).toBe('<i>two</i>')
  })

  it('data-model input reflects targeted item-prop writes (apply direction)', async () => {
    const instance = mount(
      `<li class="row"><input class="field" data-model="draft"></li>`,
      [{ id: 0, draft: 'a' }, { id: 1, draft: 'b' }]
    )
    await settle()
    const inputs = () => Array.from(testContainer.querySelectorAll('li.row .field'))
    expect(inputs()[0].value).toBe('a')

    instance.state.items[0].draft = 'edited'
    await settle()
    expect(inputs()[0].value).toBe('edited')
    expect(inputs()[1].value).toBe('b')
  })

  it('data-model input direction still writes back to the item', async () => {
    const instance = mount(
      `<li class="row"><input class="field" data-model="draft"></li>`,
      [{ id: 0, draft: 'a' }]
    )
    await settle()
    const input = testContainer.querySelector('li.row .field')
    input.value = 'typed'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    expect(instance.state.items[0].draft).toBe('typed')
  })

  it('show + text on the SAME field updates both aspects', async () => {
    const instance = mount(
      `<li class="row"><span class="msg" data-bind="msg"></span><em class="has" data-show="msg">has message</em></li>`,
      [{ id: 0, msg: 'hello' }]
    )
    await settle()
    const msg = () => testContainer.querySelector('li.row .msg')
    const has = () => testContainer.querySelector('li.row .has')
    expect(msg().textContent).toBe('hello')
    expect(has().style.display).not.toBe('none')

    instance.state.items[0].msg = ''
    await settle()
    expect(msg().textContent).toBe('')
    expect(has().style.display).toBe('none')
  })

  it('show + class on the SAME field updates both aspects', async () => {
    const instance = mount(
      `<li class="row"><span class="cell" data-bind-class="level" data-show="level">x</span></li>`,
      [{ id: 0, level: 'high' }]
    )
    await settle()
    const cell = () => testContainer.querySelector('li.row .cell')
    expect(cell().classList.contains('high')).toBe(true)
    expect(cell().style.display).not.toBe('none')

    instance.state.items[0].level = 'low'
    await settle()
    expect(cell().classList.contains('low')).toBe(true)
    expect(cell().style.display).not.toBe('none')
  })

  it('smh fields survive a same-key array replace', async () => {
    const instance = mount(
      `<li class="row"><span class="name" data-bind="name"></span><em class="badge" data-show="active">on</em></li>`,
      [{ id: 0, name: 'a', active: true }, { id: 1, name: 'b', active: true }]
    )
    await settle()
    instance.state.items = [{ id: 0, name: 'a2', active: false }, { id: 1, name: 'b2', active: true }]
    await settle()
    const rows = () => Array.from(testContainer.querySelectorAll('li.row'))
    expect(rows()[0].querySelector('.name').textContent).toBe('a2')
    expect(rows()[0].querySelector('.badge').style.display).toBe('none')

    // stamps must be live against the NEW proxies
    instance.state.items[0].active = true
    await settle()
    expect(rows()[0].querySelector('.badge').style.display).not.toBe('none')
  })

  it('multi-prop write in one flush applies all aspects (DT-03 widening)', async () => {
    const instance = mount(
      `<li class="row"><span class="name" data-bind="name"></span><em class="badge" data-show="active">on</em><input class="field" data-model="draft"></li>`,
      [{ id: 0, name: 'a', active: true, draft: 'd' }]
    )
    await settle()
    const row = () => testContainer.querySelector('li.row')
    instance.state.items[0].name = 'a9'
    instance.state.items[0].active = false
    instance.state.items[0].draft = 'd9'
    await settle()
    expect(row().querySelector('.name').textContent).toBe('a9')
    expect(row().querySelector('.badge').style.display).toBe('none')
    expect(row().querySelector('.field').value).toBe('d9')
  })
})
