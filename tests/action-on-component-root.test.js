/**
 * data-action on the same element as data-component
 *
 * The action binder used to scan only descendants of the component root,
 * so `<div data-component="x" data-action="foo">` was silently ignored.
 * Mirrors the same `querySelectorAll(...) + receiver-check` pattern that
 * PortalSystem._processPortaledContentBindings already used.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, isMinifiedBuild } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('data-action on component root', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower

    if (wildflower.componentDefinitions) wildflower.componentDefinitions.clear()
    if (wildflower.componentInstances) wildflower.componentInstances.clear()
    if (wildflower.storeManager?._namedStores) wildflower.storeManager._namedStores.clear()
    if (wildflower._templateCache) {
      for (const k of Object.keys(wildflower._templateCache)) {
        wildflower._templateCache[k]?.clear?.()
      }
    }

    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer?.parentNode) testContainer.parentNode.removeChild(testContainer)
  })

  it('click action on the component root element fires', async () => {
    testContainer.innerHTML = `
      <div id="root" data-component="root-click" data-action="click:onClick">
        <span>inside</span>
      </div>
    `

    let calls = 0
    wildflower.component('root-click', {
      state: { count: 0 },
      onClick() { calls++; this.state.count++ },
    })

    await waitForUpdate()

    const root = testContainer.querySelector('#root')
    root.click()
    await waitForUpdate()

    expect(calls).toBe(1)
  })

  it('keydown action with data-event-key-escape on the component root fires on Esc', async () => {
    testContainer.innerHTML = `
      <div id="root" data-component="root-esc"
           data-action="keydown:onEsc" data-event-key-escape
           tabindex="-1">
        <input id="inner" type="text">
      </div>
    `

    let escCalls = 0
    let otherCalls = 0
    wildflower.component('root-esc', {
      state: { closed: false },
      onEsc() { escCalls++; this.state.closed = true },
      onOther() { otherCalls++ },
    })

    await waitForUpdate()

    const inner = testContainer.querySelector('#inner')
    inner.focus()

    // A non-modifier key should not fire the Escape handler
    inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    await waitForUpdate()
    expect(escCalls).toBe(0)

    // Escape from a focused descendant bubbles to the component root
    inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await waitForUpdate()
    expect(escCalls).toBe(1)
  })

  it('does not double-bind when data-component and data-action are on the same element', async () => {
    testContainer.innerHTML = `
      <div id="root" data-component="root-once" data-action="click:onClick"></div>
    `

    let calls = 0
    wildflower.component('root-once', {
      state: { count: 0 },
      onClick() { calls++ },
    })

    await waitForUpdate()

    const root = testContainer.querySelector('#root')
    root.click()
    await waitForUpdate()

    expect(calls).toBe(1)
  })
})
