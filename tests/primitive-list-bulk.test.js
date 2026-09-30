/**
 * A data-list of primitives rendered with data-bind="$this" at bulk sizes.
 *
 * Found by the AI-surface eval (th1): with 10 or more strings, every row
 * rendered, but empty. Below that size the rows showed their values. Seen
 * on component state and store paths alike, set at mount or assigned later,
 * on dev and min builds.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms))
const words = (n) => Array.from({ length: n }, (_, i) => 'w' + i)

describe.skipIf(!hasFeature('lists'))('primitive data-list at bulk sizes', () => {
  let host

  beforeAll(async () => { await loadFramework() })
  beforeEach(() => {
    resetFramework()
    host = document.createElement('div')
    document.body.appendChild(host)
  })
  afterEach(() => { host.remove() })

  async function mount(name, def, listAttr) {
    let ctx = null
    wildflower.component(name, { ...def, init() { ctx = this } })
    host.innerHTML = `<div data-component="${name}"><ul class="r" data-list="${listAttr}"><template><li data-bind="$this"></li></template></ul></div>`
    wildflower.scan(host)
    await settle()
    return () => ctx
  }
  const texts = () => [...host.querySelectorAll('.r li')].map((li) => li.textContent)

  it('3 strings from state render (control)', async () => {
    await mount('plb-a', { state: { items: words(3) } }, 'items')
    expect(texts()).toEqual(words(3))
  })

  it('10 strings from state at mount render', async () => {
    await mount('plb-b', { state: { items: words(10) } }, 'items')
    expect(texts()).toEqual(words(10))
  })

  it('10 strings assigned after mount render', async () => {
    const ctx = await mount('plb-c', { state: { items: [] } }, 'items')
    ctx().items = words(10)
    await settle()
    expect(texts()).toEqual(words(10))
  })

  it('10 numbers render', async () => {
    const ctx = await mount('plb-d', { state: { items: [] } }, 'items')
    ctx().items = Array.from({ length: 10 }, (_, i) => i * 2)
    await settle()
    expect(texts()).toEqual(Array.from({ length: 10 }, (_, i) => String(i * 2)))
  })

  it('10 strings on a store path render', async () => {
    wildflower.store('plbstore', { state: { items: words(10) } })
    await mount('plb-e', { state: {}, subscribe: ['plbstore'] }, '$plbstore.items')
    expect(texts()).toEqual(words(10))
  })
})
