/**
 * A path listener below an object that is replaced wholesale.
 *
 * obj = { a: 2 } and obj = { ...obj, a: 2 } change obj.a as surely as
 * obj.a = 2 does. The write is reported at 'obj', so a listener on 'obj.a'
 * used to be silent for the first two forms: watch (components, stores,
 * plugins, and 'store:' keys), subscribe(), and subscribe: {} with
 * onStoreUpdate. Bindings and computeds were already right (they track the
 * reads they make). Each listener below the replaced path now hears it, with
 * its own old and new values, and only when its value changed.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { loadFramework, hasFeature, waitForCompleteRender } from './helpers/load-framework.js'

let n = 0
const live = []
const uniq = (base) => base + (++n)
const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => { await loadFramework() })
afterEach(() => { while (live.length) wildflower.unregister(live.pop()) })

async function mount(name, def) {
  live.push(name)
  let ctx = null
  const init = def.init
  wildflower.component(name, { ...def, init() { ctx = this; if (init) init.call(this) } })
  const host = document.createElement('div')
  host.innerHTML = `<div data-component="${name}"></div>`
  document.body.appendChild(host)
  if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection()
  await waitForCompleteRender()
  await wait()
  return ctx
}

describe('component watch below a replaced object', () => {
  it('hears the replacement with its own old and new values, and only when its value changed', async () => {
    const calls = []
    const c = await mount(uniq('wr-comp'), {
      state: { obj: { a: 1, b: 1 } },
      watch: { 'obj.a'(nv, ov, path) { calls.push([nv, ov, path]) } },
    })
    c.obj = { a: 2, b: 1 }
    expect(calls).toEqual([[2, 1, 'obj.a']])
    c.obj = { ...c.obj, b: 5 }           // a unchanged
    expect(calls.length).toBe(1)
    c.obj = { a: 2, b: 5 }               // equal content
    expect(calls.length).toBe(1)
    c.obj = {}                           // a removed
    expect(calls.at(-1)).toEqual([undefined, 2, 'obj.a'])
  })

  it('reaches several levels down', async () => {
    const calls = []
    const c = await mount(uniq('wr-deep'), {
      state: { a: { b: { c: 1 } } },
      watch: { 'a.b.c'(nv, ov) { calls.push([nv, ov]) } },
    })
    c.a = { b: { c: 9 } }
    expect(calls).toEqual([[9, 1]])
  })

  it('an in-place write still fires once', async () => {
    const calls = []
    const c = await mount(uniq('wr-inplace'), {
      state: { obj: { a: 1 } },
      watch: { 'obj.a'(nv) { calls.push(nv) } },
    })
    c.obj.a = 3
    expect(calls).toEqual([3])
  })
})

describe('store listeners below a replaced object', () => {
  it('a store\'s own watch', () => {
    const name = uniq('wrStore'); live.push(name)
    const calls = []
    wildflower.store(name, { state: { obj: { a: 1 } }, watch: { 'obj.a'(nv, ov) { calls.push([nv, ov]) } } })
    wildflower.getStore(name).obj = { a: 2 }
    expect(calls).toEqual([[2, 1]])
  })

  it('subscribe()', () => {
    const name = uniq('wrSub'); live.push(name)
    const calls = []
    wildflower.store(name, { state: { obj: { a: 1 } } })
    const s = wildflower.getStore(name)
    s.subscribe('obj.a', (nv, ov, path) => calls.push([nv, ov, path]))
    s.obj = { a: 2 }
    expect(calls).toEqual([[2, 1, 'obj.a']])
    s.obj = { ...s.obj }
    expect(calls.length).toBe(1)
  })

  it('a component watch with a store: key', async () => {
    const store = uniq('wrKey'); live.push(store)
    wildflower.store(store, { state: { obj: { a: 1 } } })
    const calls = []
    await mount(uniq('wr-keyed'), { state: {}, watch: { [`store:${store}.obj.a`](nv, ov) { calls.push([nv, ov]) } } })
    wildflower.getStore(store).obj = { a: 2 }
    expect(calls).toEqual([[2, 1]])
  })

  it('subscribe: {} with onStoreUpdate', async () => {
    const store = uniq('wrUpd'); live.push(store)
    wildflower.store(store, { state: { obj: { a: 1 } } })
    const calls = []
    await mount(uniq('wr-upd'), {
      subscribe: { [store]: ['obj.a'] },
      state: {},
      onStoreUpdate(name, path, nv, ov) { calls.push([name, path, nv, ov]) },
    })
    wildflower.getStore(store).obj = { a: 2 }
    await wait()
    expect(calls).toEqual([[store, 'obj.a', 2, 1]])
  })
})

describe.skipIf(!hasFeature('plugins'))('plugin watch below a replaced object', () => {
  it('hears the replacement', () => {
    const calls = []
    const name = uniq('wrPlugin')
    wildflower.plugin({
      name,
      state: { obj: { a: 1 } },
      watch: { 'obj.a'(nv, ov) { calls.push([nv, ov]) } },
      replace() { this.obj = { a: 2 } },
    })
    wildflower['$' + name].replace()
    expect(calls).toEqual([[2, 1]])
  })
})
