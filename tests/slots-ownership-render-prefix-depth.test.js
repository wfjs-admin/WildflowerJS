/**
 * Slot ownership where the markup around the slots is not static nesting.
 *
 * A component fills its own slot containers with its own slot content, and a
 * component around it takes no part. These cases check that rule where a
 * section is removed and put back by data-render, where the slotted
 * component is a list row, where a slot is itself a component's root several
 * levels deep, and where the attributes are written with the data-wf- prefix.
 * Each case gives the outer component a container and a slot of the same
 * name as the inner one's, so a slot handed to the wrong component shows.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

const settle = async (ms = 80) => {
  if (window.wildflower?._forceCompleteRender) await window.wildflower._forceCompleteRender()
  await new Promise(r => setTimeout(r, ms))
}
let seq = 0
const uname = p => `${p}-so-${++seq}`

describe('Slots: ownership under data-render, in list rows, in nested roots, and with the prefix', () => {
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
  const go = async () => {
    if (wf._setupDynamicComponentDetection) wf._setupDynamicComponentDetection()
    wf.scan()
    await settle()
  }
  const text = (sel) => [...host.querySelectorAll(sel)].map(h => h.textContent.trim())

  it('a slotted panel inside a data-render section keeps its slot through off and on', async () => {
    const page = uname('page'); const panel = uname('panel'); let ctx
    wf.component(page, { state: { open: true }, init() { ctx = this } })
    wf.component(panel, { state: {} })
    host.innerHTML = `<div data-component="${page}">
      <section data-render="open">
        <div data-component="${panel}"><div class="hole" data-slot-container="body"></div><p data-slot="body">panel</p></div>
      </section>
      <div class="pagehole" data-slot-container="body"></div>
      <i data-slot="body">page</i></div>`
    await go()
    expect(text('.hole')).toEqual(['panel'])
    expect(text('.pagehole')).toEqual(['page'])

    ctx.open = false
    await settle()
    expect(text('.hole'), 'the section is out').toEqual([])
    expect(text('.pagehole')).toEqual(['page'])

    ctx.open = true
    await settle()
    expect(text('.hole'), 'one panel, holding its own slot').toEqual(['panel'])
    expect(text('.pagehole'), 'the page still holds its own').toEqual(['page'])
  })

  it('a slotted component in each of twelve list rows, with a slotted component inside it', async () => {
    const page = uname('page'); const card = uname('card'); const tag = uname('tag')
    wf.component(card, { state: {} })
    wf.component(tag, { state: {} })
    wf.component(page, { state: { rows: Array.from({ length: 12 }, (_, i) => ({ id: i, t: 'T' + i })) } })
    host.innerHTML = `<div data-component="${page}"><div class="pagehole" data-slot-container="body"></div>
      <ul data-list="rows" data-key="id"><template><li><div data-component="${card}">
        <span class="hole" data-slot-container="body"></span>
        <div data-component="${tag}"><span class="taghole" data-slot-container="body"></span><u data-slot="body">tag</u></div>
        <b data-slot="body" data-bind="t"></b>
      </div></li></template></ul>
      <i data-slot="body">page</i></div>`
    await go()
    expect(text('.pagehole')).toEqual(['page'])
    expect(text('li .hole'), "each card holds its own row's text").toEqual(Array.from({ length: 12 }, (_, i) => 'T' + i))
    expect(text('li .taghole'), 'and the component inside it holds its own').toEqual(Array.from({ length: 12 }, () => 'tag'))
  })

  it('a slot that is a component root, three levels deep', async () => {
    const a = uname('a'); const b = uname('b'); const c = uname('c'); const d = uname('d')
    for (const n of [a, b, c, d]) wf.component(n, { state: {} })
    host.innerHTML = `<div data-component="${a}"><div class="ah" data-slot-container="x"></div>
      <div data-component="${b}" data-slot="x"><div class="bh" data-slot-container="x"></div>
        <div data-component="${c}" data-slot="x"><div class="ch" data-slot-container="x"></div>
          <div data-component="${d}" data-slot="x"><div class="dh" data-slot-container="x"></div><em data-slot="x">leaf</em></div>
        </div>
      </div></div>`
    await go()
    const q = (s) => host.querySelector(s)
    // Each container's own element children: the one root slotted into it.
    const holds = (s) => [...q(s).children].map(el => el.getAttribute('data-component') || el.tagName.toLowerCase())
    expect(holds('.ah')).toEqual([b])
    expect(holds('.bh')).toEqual([c])
    expect(holds('.ch')).toEqual([d])
    expect(holds('.dh')).toEqual(['em'])
    expect(q('.dh').textContent.trim()).toBe('leaf')
  })

  it('the same rule with data-wf- attributes', async () => {
    const outer = uname('o'); const inner = uname('i')
    wf.component(outer, { state: {} }); wf.component(inner, { state: {} })
    host.innerHTML = `<div data-wf-component="${outer}"><div class="oh" data-wf-slot-container="s"></div>
      <div data-wf-component="${inner}"><div class="ih" data-wf-slot-container="s"></div><span data-wf-slot="s">in</span></div>
      <span data-wf-slot="s">out</span></div>`
    await go()
    expect(text('.oh')).toEqual(['out'])
    expect(text('.ih')).toEqual(['in'])
  })
})
