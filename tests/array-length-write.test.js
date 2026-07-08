/**
 * Characterization: direct array length writes (arr.length = N) on a bound
 * data-list. These manual length writes are the paths that still reach the
 * array length set-trap handling. Captures current behavior so it is preserved
 * across internal refactors of that path.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

const wait = (ms = 60) => new Promise(r => setTimeout(r, ms))

describe('direct array length writes on a bound list', () => {
  let container, wf
  beforeAll(async () => { await loadFramework() })
  beforeEach(() => {
    wf = window.wildflower
    resetFramework()
    container = document.createElement('div')
    container.style.position = 'absolute'; container.style.left = '-9999px'
    document.body.appendChild(container)
  })
  afterEach(() => { if (container?.parentNode) container.parentNode.removeChild(container) })

  async function mount() {
    wf.component('len-write', {
      state: { rows: [] },
      init() {
        this.state.rows = [
          { id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 3, label: 'c' },
          { id: 4, label: 'd' }, { id: 5, label: 'e' }
        ]
        window.__lw = this.state
      },
      computed: { count() { return this.state.rows.length } }
    })
    container.innerHTML = `<div data-component="len-write"><span id="c" data-bind="count"></span><ul data-list="rows" data-key="id"><template><li data-bind="label"></li></template></ul></div>`
    wf.scan()
    await wait(150)
  }
  const labels = () => Array.from(container.querySelectorAll('li')).map(li => li.textContent)
  const count = () => container.querySelector('#c').textContent

  it('arr.length = 0 clears the rendered list', async () => {
    await mount()
    expect(labels()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(count()).toBe('5')
    window.__lw.rows.length = 0
    await wait()
    expect(labels()).toEqual([])
    expect(count()).toBe('0')
  })

  it('arr.length = 2 truncates the rendered list', async () => {
    await mount()
    window.__lw.rows.length = 2
    await wait()
    expect(labels()).toEqual(['a', 'b'])
    expect(count()).toBe('2')
  })

  it('index write then length truncate in the same tick renders correctly', async () => {
    await mount()
    // Replace an item by index, then truncate, synchronously. This is the only
    // pattern that can set hasIndexMutations before a length decrease.
    window.__lw.rows[1] = { id: 9, label: 'B2' }
    window.__lw.rows.length = 3
    await wait()
    expect(labels()).toEqual(['a', 'B2', 'c'])
    expect(count()).toBe('3')
  })
})
