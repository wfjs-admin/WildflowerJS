/**
 * RowCompiler mode parity (Phase 1: composed-emitter create path).
 *
 * The bulk-create text-build step runs through the per-template emitter set
 * (composed mode) by default for eligible flat item-prop templates, and falls
 * back to the unchanged inline loop when forced to 'generic'. Output must be
 * identical in both modes. These tests exercise the force flag
 * (globalThis.__WF_FORCE_ROWCOMPILE__) and assert byte-identical row text across
 * the two modes, on a pure-text list (>= 10 rows triggers the bulk path).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForCompleteRender(ms = 150) {
  if (window.wildflower?._forceCompleteRender) await window.wildflower._forceCompleteRender()
  await new Promise(r => setTimeout(r, ms))
}

describe('RowCompiler mode parity (composed vs generic create text path)', () => {
  let testContainer
  let wildflower

  beforeAll(async () => { await loadFramework() })

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
    // Always clear the force flag so one test cannot leak into the next.
    delete globalThis.__WF_FORCE_ROWCOMPILE__
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  function render(componentName, count) {
    const items = Array.from({ length: count }, (_, i) => ({ id: i, label: `Row ${i}` }))
    testContainer.innerHTML = `
      <div data-component="${componentName}">
        <ul data-list="items" data-key="id">
          <template>
            <li class="row"><span class="label" data-bind="label"></span></li>
          </template>
        </ul>
      </div>
    `
    wildflower.component(componentName, {
      state: { items },
      bump(event, element, details) { details.item.label = details.item.label + '!' }
    })
    wildflower.scan()
  }

  function rowLabels() {
    return Array.from(testContainer.querySelectorAll('li.row .label')).map(el => el.textContent)
  }

  it('renders correct text in composed (default/auto) mode', async () => {
    render('rc-composed', 12)
    await waitForCompleteRender()
    const labels = rowLabels()
    expect(labels.length).toBe(12)
    expect(labels[0]).toBe('Row 0')
    expect(labels[11]).toBe('Row 11')
  })

  it('renders identical text when forced to generic mode', async () => {
    globalThis.__WF_FORCE_ROWCOMPILE__ = 'generic'
    render('rc-generic', 12)
    await waitForCompleteRender()
    const labels = rowLabels()
    expect(labels.length).toBe(12)
    expect(labels[0]).toBe('Row 0')
    expect(labels[11]).toBe('Row 11')
  })

  it('produces the same output in both modes for the same data', async () => {
    // Composed (default)
    render('rc-parity-a', 15)
    await waitForCompleteRender()
    const composed = rowLabels()

    // Generic (forced)
    resetFramework()
    if (wildflower._initContextSystem) {
      wildflower._contextSystemInitialized = false
      wildflower._initContextSystem()
    }
    globalThis.__WF_FORCE_ROWCOMPILE__ = 'generic'
    render('rc-parity-b', 15)
    await waitForCompleteRender()
    const generic = rowLabels()

    expect(generic).toEqual(composed)
    expect(composed.length).toBe(15)
  })

  it('keeps the per-row update effect after a composed build', async () => {
    // Phase 1 leaves onDeferredEffects intact: rows built by the composed path
    // must still update reactively when an item prop mutates.
    render('rc-update', 12)
    await waitForCompleteRender()
    const component = testContainer.querySelector('[data-component]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)
    instance.state.items[5].label = 'Row 5 CHANGED'
    await waitForCompleteRender(120)
    const labels = rowLabels()
    expect(labels[5]).toBe('Row 5 CHANGED')
    expect(labels[4]).toBe('Row 4')
    expect(labels[6]).toBe('Row 6')
  })
})
