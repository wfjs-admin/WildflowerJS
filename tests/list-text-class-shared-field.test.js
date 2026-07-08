/**
 * A flat field read by BOTH a plain text binding and a class binding, on a
 * fast-touch template that keeps its per-row effect (a data-show on another
 * field disqualifies retire). The text binding is not pure (the class reads
 * the same field), so the per-list sink's text spec cannot own it — the field
 * must stay on the effect path (or the dispatcher must apply BOTH kinds).
 *
 * Pins the S2a decorative-stamping gate: a shared text+class field must not
 * be sink-stamped as decorative-only, or the effect-head early-exit skips the
 * full rebind and the text goes permanently stale.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function settle() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 30))
}

describe('List shared text+class field stays live', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()
    if (wildflower._initContextSystem) {
      wildflower._contextSystemInitialized = false
      wildflower._initContextSystem()
    }
    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) testContainer.parentNode.removeChild(testContainer)
  })

  function setup(count = 8) {
    const items = Array.from({ length: count }, (_, i) => ({ id: i, status: 'ok', active: true }))
    testContainer.innerHTML = `
      <div data-component="shared-field-list">
        <ul data-list="items" data-key="id">
          <template>
            <li class="row">
              <span class="status" data-bind="status" data-bind-class="status"></span>
              <em class="flag" data-show="active">on</em>
            </li>
          </template>
        </ul>
      </div>
    `
    wildflower.component('shared-field-list', {
      state: { items }
    })
    wildflower.scan()
    const component = testContainer.querySelector('[data-component]')
    return wildflower.componentInstances.get(component.dataset.componentId)
  }

  it('updates BOTH the text and the class when the shared field changes', async () => {
    const instance = setup(8)
    await settle()
    const cells = () => Array.from(testContainer.querySelectorAll('li.row .status'))
    expect(cells().length).toBe(8)
    expect(cells()[3].textContent).toBe('ok')
    expect(cells()[3].classList.contains('ok')).toBe(true)

    instance.state.items[3].status = 'warn'
    await settle()

    expect(cells()[3].textContent).toBe('warn')
    expect(cells()[3].classList.contains('warn')).toBe(true)
    // neighbor untouched
    expect(cells()[2].textContent).toBe('ok')
  })

  it('stays live across a second change to the same field', async () => {
    const instance = setup(8)
    await settle()
    const cell = () => testContainer.querySelectorAll('li.row .status')[5]

    instance.state.items[5].status = 'warn'
    await settle()
    expect(cell().textContent).toBe('warn')

    instance.state.items[5].status = 'err'
    await settle()
    expect(cell().textContent).toBe('err')
    expect(cell().classList.contains('err')).toBe(true)
  })
})
