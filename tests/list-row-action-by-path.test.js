/**
 * A click on a data-action inside a bulk-created list row that nothing has
 * touched yet. Such a row of a plain text template carries no array of its
 * binding elements, and its action elements carry no attribute, so the
 * dispatch finds which compiled action the clicked element is by that
 * action's compiled path in the row.
 *
 * Every check is the handler that ran and the item and index it was handed,
 * so the file runs on the production builds too, where the row's internals
 * cannot be read by name. Twelve keyed rows is over the
 * bulk threshold, and the templates hold text bindings and actions only.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

const settle = async (ms = 60) => {
  if (window.wildflower?._forceCompleteRender) await window.wildflower._forceCompleteRender()
  await new Promise(r => setTimeout(r, ms))
}
let seq = 0
const uname = p => `${p}-rab-${++seq}`
const items = (n = 12) => Array.from({ length: n }, (_, i) => ({ id: i + 1, label: 'row ' + (i + 1) }))

describe('list rows: an action on an untouched bulk-created row', () => {
  let host, wf
  beforeAll(async () => { await loadFramework() })
  beforeEach(() => {
    wf = window.wildflower
    resetFramework()
    if (wf._listRelationships) wf._listRelationships.clear()
    host = document.createElement('div')
    host.style.cssText = 'position:absolute;left:-9999px'
    document.body.appendChild(host)
  })
  afterEach(() => host.remove())

  const mount = async (name, def, tpl) => {
    wf.component(name, def)
    host.innerHTML = `<div data-component="${name}"><ul class="rows" data-list="rows" data-key="id"><template>${tpl}</template></ul></div>`
    if (wf._setupDynamicComponentDetection) wf._setupDynamicComponentDetection()
    wf.scan && wf.scan()
    await settle()
  }
  const rows = () => [...host.querySelectorAll('.rows > li')]

  it('an action on the row root and one inside it; a click on a child of the action element', async () => {
    const log = []
    const name = uname('c')
    await mount(name, {
      state: { rows: items() },
      pick(e, el, d) { log.push('pick:' + d.item.id) },
      del(e, el, d) { log.push('del:' + d.item.id) },
    }, `<li data-action="pick"><span class="n" data-bind="id"></span><button class="b" data-action="del"><b class="in" data-bind="label"></b></button></li>`)
    expect(rows().length).toBe(12)
    rows()[3].querySelector('.in').click()
    rows()[5].querySelector('.n').click()
    rows()[0].click()
    expect(log).toEqual(['del:4', 'pick:6', 'pick:1'])
  })

  it('after a reverse and a swap, the clicked row reports its own item and index', async () => {
    const log = []
    const name = uname('c')
    let ctx
    await mount(name, {
      state: { rows: items() },
      init() { ctx = this },
      pick(e, el, d) { log.push(d.item.id + '@' + d.index) },
    }, `<li><span class="n" data-bind="id"></span><a class="a" data-action="pick">go</a></li>`)
    ctx.rows = [...ctx.rows].reverse()
    await settle()
    rows()[0].querySelector('.a').click()
    const r = ctx.rows; const t = r[1]; r[1] = r[10]; r[10] = t
    await settle()
    rows()[1].querySelector('.a').click()
    rows()[10].querySelector('.a').click()
    expect(rows().map(li => li.querySelector('.n').textContent).slice(0, 2)).toEqual(['12', '2'])
    expect(log).toEqual(['12@0', '2@1', '11@10'])
  })

  it('a handler that removes its row, then a click on the row that took its place', async () => {
    const log = []
    const name = uname('c')
    await mount(name, {
      state: { rows: items() },
      del(e, el, d) { log.push(d.item.id); this.rows = this.rows.filter(x => x.id !== d.item.id) },
    }, `<li><span class="n" data-bind="id"></span><a class="a" data-action="del">x</a></li>`)
    rows()[2].querySelector('.a').click()
    await settle()
    rows()[2].querySelector('.a').click()
    await settle()
    expect(log).toEqual([3, 4])
    expect(rows().length).toBe(10)
  })

  it('appended rows, and a click on one of them and on an earlier row', async () => {
    const log = []
    const name = uname('c')
    let ctx
    await mount(name, {
      state: { rows: items() },
      init() { ctx = this },
      pick(e, el, d) { log.push(d.item.id) },
    }, `<li><span class="n" data-bind="id"></span><a class="a" data-action="pick">x</a></li>`)
    for (let i = 13; i <= 30; i++) ctx.rows.push({ id: i, label: 'r' + i })
    await settle()
    rows()[25].querySelector('.a').click()
    rows()[1].querySelector('.a').click()
    expect(log).toEqual([26, 2])
  })

  it('an input with only a key action lets a click reach the row action', async () => {
    const log = []
    const name = uname('c')
    await mount(name, {
      state: { rows: items() },
      pick(e, el, d) { log.push('pick:' + d.item.id) },
      key(e, el, d) { log.push('key:' + d.item.id) },
    }, `<li data-action="pick"><span class="n" data-bind="id"></span><input class="i" data-action="keyup:key"></li>`)
    rows()[4].querySelector('.i').click()
    rows()[4].querySelector('.i').dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }))
    expect(log).toEqual(['pick:5', 'key:5'])
  })
})
