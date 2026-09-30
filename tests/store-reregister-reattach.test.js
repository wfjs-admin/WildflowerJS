/**
 * A store unregistered and registered again under the same name.
 *
 * Components that declared an interest in it (subscribe: {} with
 * onStoreUpdate, a 'store:name.path' watcher, this.stores.name) stayed
 * attached to the discarded instance and went silent. They now re-attach to
 * the new store when it registers, as a component that set up before its
 * store existed attaches when the store arrives.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))

describe('store registered again: components re-attach', () => {
  let container

  beforeAll(async () => { await loadFramework() })

  beforeEach(() => {
    resetFramework()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => { container.remove() })

  async function mount(name, def) {
    wildflower.component(name, def)
    container.innerHTML = `<div data-component="${name}"></div>`
    wildflower.scan(container)
    await settle()
  }

  it('subscribe: {} with onStoreUpdate hears the new store', async () => {
    wildflower.store('rr-a', { state: { n: 0 } })
    const heard = []
    await mount('rr-sub', {
      state: {},
      subscribe: { 'rr-a': ['n'] },
      onStoreUpdate(store, path, value) { heard.push(value) },
    })
    wildflower.getStore('rr-a').n = 1
    await settle()
    wildflower.unregister('rr-a')
    wildflower.store('rr-a', { state: { n: 0 } })
    await settle()
    wildflower.getStore('rr-a').n = 2
    await settle()
    expect(heard).toContain(1)
    expect(heard).toContain(2)
  })

  it('a store: watcher hears the new store', async () => {
    wildflower.store('rr-b', { state: { n: 0 } })
    const heard = []
    await mount('rr-watch', {
      state: {},
      watch: { 'store:rr-b.n'(v) { heard.push(v) } },
    })
    wildflower.getStore('rr-b').n = 1
    await settle()
    wildflower.unregister('rr-b')
    wildflower.store('rr-b', { state: { n: 0 } })
    await settle()
    wildflower.getStore('rr-b').n = 2
    await settle()
    expect(heard).toEqual([1, 2])
  })

  it('this.stores.name reads the new store', async () => {
    wildflower.store('rr-c', { state: { label: 'old' } })
    let ctx = null
    await mount('rr-ref', {
      state: {},
      subscribe: { 'rr-c': [] },
      init() { ctx = this },
    })
    expect(ctx.stores['rr-c'].label).toBe('old')
    wildflower.unregister('rr-c')
    wildflower.store('rr-c', { state: { label: 'new' } })
    await settle()
    expect(ctx.stores['rr-c'].label).toBe('new')
  })
})
