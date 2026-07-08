/**
 * Does `this.isOpen = true` (top-level, no .state) trigger reactivity in
 * a component method, or must you write `this.state.isOpen = true`?
 *
 * The ai-assistant docs page uses the top-level form; the PM demo and
 * ComponentRegistry docs use the .state form. Settling which is canonical.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('top-level vs .state property access', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    if (wildflower.componentDefinitions) wildflower.componentDefinitions.clear()
    if (wildflower.componentInstances) wildflower.componentInstances.clear()
    if (wildflower._templateCache) {
      for (const k of Object.keys(wildflower._templateCache)) {
        wildflower._templateCache[k]?.clear?.()
      }
    }
    testContainer = document.createElement('div')
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer?.parentNode) testContainer.parentNode.removeChild(testContainer)
  })

  it('top-level this.isOpen = true updates a data-show binding', async () => {
    testContainer.innerHTML = `
      <div data-component="top-level-write">
        <span id="panel" data-show="isOpen">Panel</span>
        <button id="btn" data-action="toggle"></button>
      </div>
    `
    wildflower.component('top-level-write', {
      state: { isOpen: false },
      toggle() { this.isOpen = true; }   // NO .state
    })

    await waitForUpdate()
    const panel = testContainer.querySelector('#panel')
    expect(panel.style.display).toBe('none')

    testContainer.querySelector('#btn').click()
    await waitForUpdate()

    // If top-level write is reactive, the panel becomes visible.
    expect(panel.style.display).not.toBe('none')
  })

  it('top-level read this.isOpen reflects current state value', async () => {
    let observed = null
    testContainer.innerHTML = `
      <div data-component="top-level-read">
        <button id="btn" data-action="check"></button>
      </div>
    `
    wildflower.component('top-level-read', {
      state: { isOpen: true },
      check() { observed = this.isOpen; }
    })

    await waitForUpdate()
    testContainer.querySelector('#btn').click()
    await waitForUpdate()

    expect(observed).toBe(true)
  })
})
