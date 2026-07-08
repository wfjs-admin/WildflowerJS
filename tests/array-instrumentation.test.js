/**
 * Array mutator instrumentation: reactive-array removals.
 *
 * Reactive-array splice/shift/pop run against the raw target (bypassing the
 * per-element proxy trap storm) and fire one structural notification. These
 * tests lock in the JS array-method contracts (return values), reactivity
 * (DOM + length-dependent computeds update), and the isSpliceInProgress
 * contract (a removal on a list with item-level computeds stays correct).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

const wait = (ms = 60) => new Promise(r => setTimeout(r, ms))

describe('Array mutator instrumentation (removals)', () => {
  let container
  let wf

  beforeAll(async () => { await loadFramework() })

  beforeEach(() => {
    wf = window.wildflower
    resetFramework()
    container = document.createElement('div')
    container.style.position = 'absolute'
    container.style.left = '-9999px'
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (container && container.parentNode) container.parentNode.removeChild(container)
  })

  async function mountList() {
    wf.component('arr-instr', {
      state: { rows: [] },
      init() {
        this.state.rows = [
          { id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 3, label: 'c' },
          { id: 4, label: 'd' }, { id: 5, label: 'e' }
        ]
        window.__t = this.state
      },
      computed: {
        count() { return this.state.rows.length }
      }
    })
    container.innerHTML = `
      <div data-component="arr-instr">
        <span id="count" data-bind="count"></span>
        <ul data-list="rows" data-key="id">
          <template><li data-bind="label"></li></template>
        </ul>
      </div>`
    wf.scan()
    await wait(150)
  }

  const labels = () => Array.from(container.querySelectorAll('li')).map(li => li.textContent)

  it('splice(start, n) removes rows, returns removed elements, updates DOM + computed', async () => {
    await mountList()
    expect(labels()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(container.querySelector('#count').textContent).toBe('5')

    const removed = window.__t.rows.splice(1, 2) // remove b, c
    await wait()

    expect(removed.map(r => r.label)).toEqual(['b', 'c'])
    expect(labels()).toEqual(['a', 'd', 'e'])
    expect(container.querySelector('#count').textContent).toBe('3')
  })

  it('splice(start) deletes to end', async () => {
    await mountList()
    const removed = window.__t.rows.splice(2) // remove c, d, e
    await wait()
    expect(removed.map(r => r.label)).toEqual(['c', 'd', 'e'])
    expect(labels()).toEqual(['a', 'b'])
    expect(container.querySelector('#count').textContent).toBe('2')
  })

  it('shift returns the first element (not an array) and updates the list', async () => {
    await mountList()
    const first = window.__t.rows.shift()
    await wait()
    expect(Array.isArray(first)).toBe(false)
    expect(first.label).toBe('a')
    expect(labels()).toEqual(['b', 'c', 'd', 'e'])
    expect(container.querySelector('#count').textContent).toBe('4')
  })

  it('pop returns the last element (not an array) and updates the list', async () => {
    await mountList()
    const last = window.__t.rows.pop()
    await wait()
    expect(Array.isArray(last)).toBe(false)
    expect(last.label).toBe('e')
    expect(labels()).toEqual(['a', 'b', 'c', 'd'])
    expect(container.querySelector('#count').textContent).toBe('4')
  })

  it('splice with inserts replaces, shifts survivors, and returns removed', async () => {
    await mountList()
    const removed = window.__t.rows.splice(1, 1, { id: 9, label: 'x' }, { id: 10, label: 'y' })
    await wait()
    expect(removed.map(r => r.label)).toEqual(['b'])
    expect(labels()).toEqual(['a', 'x', 'y', 'c', 'd', 'e'])
    expect(container.querySelector('#count').textContent).toBe('6')
  })

  it('splice(start, 0) is a no-op removal (returns [])', async () => {
    await mountList()
    const removed = window.__t.rows.splice(2, 0)
    await wait()
    expect(removed).toEqual([])
    expect(labels()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('isSpliceInProgress contract: removal on a list with item-level computeds stays correct', async () => {
    wf.component('arr-instr-ic', {
      state: { rows: [] },
      init() {
        this.state.rows = [
          { id: 1, n: 10 }, { id: 2, n: 20 }, { id: 3, n: 30 }, { id: 4, n: 40 }
        ]
        window.__ic = this.state
      },
      computed: {
        doubled(item) { return item.n * 2 }
      }
    })
    container.innerHTML = `
      <div data-component="arr-instr-ic">
        <ul data-list="rows" data-key="id">
          <template><li data-bind="doubled"></li></template>
        </ul>
      </div>`
    wf.scan()
    await wait(150)
    expect(Array.from(container.querySelectorAll('li')).map(li => li.textContent)).toEqual(['20', '40', '60', '80'])

    window.__ic.rows.splice(0, 2) // remove first two
    await wait()
    // Survivors' item-level computed must still resolve against the correct items.
    expect(Array.from(container.querySelectorAll('li')).map(li => li.textContent)).toEqual(['60', '80'])

    // Mutating a surviving item's source prop still reacts after the splice.
    window.__ic.rows[0].n = 100
    await wait()
    expect(Array.from(container.querySelectorAll('li')).map(li => li.textContent)).toEqual(['200', '80'])
  })

  it('repeated near-start splices keep indices and rendering consistent', async () => {
    await mountList()
    window.__t.rows.splice(1, 1) // a,c,d,e
    await wait(40)
    window.__t.rows.splice(1, 1) // a,d,e
    await wait(40)
    window.__t.rows.splice(0, 1) // d,e
    await wait()
    expect(labels()).toEqual(['d', 'e'])
    expect(container.querySelector('#count').textContent).toBe('2')
  })

  it('push appends rows, returns new length, updates DOM + computed', async () => {
    await mountList()
    const len = window.__t.rows.push({ id: 6, label: 'f' }, { id: 7, label: 'g' })
    await wait()
    expect(len).toBe(7)
    expect(labels()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    expect(container.querySelector('#count').textContent).toBe('7')
  })

  it('a newly-pushed row reacts to its own prop change', async () => {
    await mountList()
    window.__t.rows.push({ id: 6, label: 'f' })
    await wait()
    expect(labels()).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    window.__t.rows[5].label = 'F!'
    await wait()
    expect(labels()).toEqual(['a', 'b', 'c', 'd', 'e', 'F!'])
  })

  it('push onto an empty list renders rows', async () => {
    wf.component('arr-instr-empty', {
      state: { rows: [] },
      init() { window.__e = this.state }
    })
    container.innerHTML = `
      <div data-component="arr-instr-empty">
        <ul data-list="rows" data-key="id"><template><li data-bind="label"></li></template></ul>
      </div>`
    wf.scan()
    await wait(150)
    expect(container.querySelectorAll('li').length).toBe(0)
    window.__e.rows.push({ id: 1, label: 'x' }, { id: 2, label: 'y' })
    await wait()
    expect(Array.from(container.querySelectorAll('li')).map(li => li.textContent)).toEqual(['x', 'y'])
  })

  it('unshift prepends rows and returns the new length', async () => {
    await mountList()
    const len = window.__t.rows.unshift({ id: 0, label: 'z' }, { id: -1, label: 'w' })
    await wait()
    expect(len).toBe(7)
    expect(labels()).toEqual(['z', 'w', 'a', 'b', 'c', 'd', 'e'])
    expect(container.querySelector('#count').textContent).toBe('7')
  })

  it('splice pure insert (deleteCount 0) inserts without removing', async () => {
    await mountList()
    const removed = window.__t.rows.splice(2, 0, { id: 8, label: 'q' })
    await wait()
    expect(removed).toEqual([])
    expect(labels()).toEqual(['a', 'b', 'q', 'c', 'd', 'e'])
    expect(container.querySelector('#count').textContent).toBe('6')
  })

  it('a row inserted via splice reacts to its own prop change', async () => {
    await mountList()
    window.__t.rows.splice(1, 0, { id: 9, label: 'ins' })
    await wait()
    expect(labels()).toEqual(['a', 'ins', 'b', 'c', 'd', 'e'])
    window.__t.rows[1].label = 'INS!'
    await wait()
    expect(labels()).toEqual(['a', 'INS!', 'b', 'c', 'd', 'e'])
  })
})
