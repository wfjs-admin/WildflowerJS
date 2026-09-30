/**
 * What an SSR-adopted component takes from its server-rendered HTML.
 *
 * Adoption reads a component's initial state back out of its markup: each
 * data-bind / data-model value becomes state. Only the component's own
 * bindings belong there. A data-query container's rows are adopted by the
 * query, a data-pool's rows belong to the pool, a nested component's bindings
 * belong to that component, and a binding that names a computed (bare, as
 * the computed: prefix is optional) is derived, not stored. Each of those
 * used to land in the parent's state as a stray field (the status-page demo
 * got name, title, opened and message from its query rows, and its banner
 * computed as a state string).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms))
let n = 0
const uname = (b) => b + '-' + (++n)

describe.skipIf(!hasFeature('ssr'))('SSR adoption reads only the component\'s own bindings', () => {
  let container

  beforeAll(async () => { await loadFramework() })
  beforeEach(() => {
    resetFramework()
    container = document.createElement('div')
    document.body.appendChild(container)
  })
  afterEach(() => { container.remove() })

  it('its own binding is adopted; a bare computed and a nested component\'s binding are not', async () => {
    const parent = uname('ssr-parent'), child = uname('ssr-child')
    container.innerHTML = `
      <div data-component="${parent}" data-ssr="true">
        <span class="own" data-bind="label">Server</span>
        <span class="comp" data-bind="banner">Server banner</span>
        <div data-component="${child}"><span data-bind="childField">Child text</span></div>
      </div>`
    wildflower.component(child, { state: { childField: '' } })
    wildflower.component(parent, {
      state: { label: 'Client' },
      computed: { banner() { return 'Live: ' + this.label } },
    })
    wildflower.scan(container)
    await settle(200)

    const comp = wildflower.getComponent(parent)
    const keys = Object.keys(comp.stateManager._state || comp.state)
    expect(comp.state.label).toBe('Server')
    expect(keys).not.toContain('banner')
    expect(keys).not.toContain('childField')
    expect(container.querySelector('.comp').textContent).toBe('Live: Server')
  })

  it.skipIf(!hasFeature('pools'))('a data-pool row\'s binding is not adopted into the component', async () => {
    const parent = uname('ssr-pool')
    container.innerHTML = `
      <div data-component="${parent}" data-ssr="true">
        <div data-pool="dots"><template><i data-bind="dotLabel"></i></template><i data-bind="dotLabel">x</i></div>
      </div>`
    wildflower.component(parent, { state: {}, pools: { dots: {} } })
    wildflower.scan(container)
    await settle(200)
    const comp = wildflower.getComponent(parent)
    expect(Object.keys(comp.stateManager._state || comp.state)).not.toContain('dotLabel')
  })

  it.skipIf(!hasFeature('query'))('a data-query row\'s binding is not adopted into the component', async () => {
    const parent = uname('ssr-query'), q = uname('svc')
    wildflower.query(q, { from: () => Promise.resolve([{ id: 1, name: 'API' }]), key: 'id' })
    container.innerHTML = `
      <div data-component="${parent}" data-ssr="true">
        <ul data-query="${q}">
          <template><li data-bind="name"></li></template>
          <li data-seed='{"id":1}' data-bind="name">API</li>
        </ul>
      </div>`
    wildflower.component(parent, { state: {} })
    wildflower.scan(container)
    await settle(200)
    const comp = wildflower.getComponent(parent)
    expect(Object.keys(comp.stateManager._state || comp.state)).not.toContain('name')
  })
})
