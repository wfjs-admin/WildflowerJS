/**
 * List event delegation registers only the event types the row template
 * declares.
 *
 * Bug shape (found 2026-09-02 while attributing 04_select): mount extracts
 * the container's <template>, removes it from the DOM and parks it in the
 * stored-template cache. _addListGenericEventDelegation then ran
 * listElement.querySelector('template'), found nothing, and took the
 * "no template" fallback: keydown, keyup, keypress, input, change, mouseover
 * and mouseout listeners on EVERY list container, click-only templates
 * included. Each hover boundary crossing ran a full delegated action
 * resolution for nothing.
 *
 * Fix: the scan reads the template from the stored-template cache (or the
 * resolved data-use-template), so a click-only template registers no generic
 * listeners and a template declaring keydown / mouseenter registers exactly
 * keydown and the bubbling mouseover it is synthesized from. The all-events
 * fallback survives only for lists with no template anywhere.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

const GENERIC = ['keydown', 'keyup', 'keypress', 'input', 'change', 'mouseover', 'mouseout']

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

function ensureComponentScanning(wildflower) {
  if (wildflower._setupDynamicComponentDetection) {
    wildflower._setupDynamicComponentDetection()
  }
}

// Record the event types registered on an element from this point on.
function recordListeners(el) {
  const seen = []
  const orig = el.addEventListener
  el.addEventListener = function (type, ...rest) {
    seen.push(type)
    return orig.call(this, type, ...rest)
  }
  return seen
}

describe('list delegation registers only the declared event types', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()
    if (wildflower._listRelationships) {
      wildflower._listRelationships.clear()
    }
    testContainer = document.createElement('div')
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    testContainer.style.opacity = '0'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  it('a click-only row template gets click delegation and no generic listeners', async () => {
    const picks = []
    wildflower.component('delegation-click-only', {
      state: { items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
      pick(event, element, details) { picks.push(details.item.id) }
    })
    testContainer.innerHTML = `
      <div data-component="delegation-click-only">
        <ul class="rows" data-list="items" data-key="id">
          <template>
            <li><a class="pick" data-action="pick"><span data-bind="label"></span></a></li>
          </template>
        </ul>
      </div>
    `
    const list = testContainer.querySelector('.rows')
    const seen = recordListeners(list)
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    expect(seen).toContain('click')
    for (const type of GENERIC) expect(seen, `${type} should not be delegated`).not.toContain(type)

    // The click path still works through the delegated listener.
    const rows = testContainer.querySelectorAll('.rows .pick')
    expect(rows.length).toBe(2)
    rows[1].click()
    await waitForCompleteRender()
    expect(picks).toEqual(['b'])

    // A hover crossing on a row is not routed anywhere (no listener, no handler).
    rows[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))
    await waitForCompleteRender()
    expect(picks).toEqual(['b'])
  })

  it('a template declaring keydown and mouseenter registers exactly keydown and mouseover, and both dispatch', async () => {
    const keys = []
    const hovers = []
    wildflower.component('delegation-declared-events', {
      state: { items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
      onKey(event, element, details) { keys.push(details.item.id + ':' + event.key) },
      onHover(event, element, details) { hovers.push(details.item.id) }
    })
    testContainer.innerHTML = `
      <div data-component="delegation-declared-events">
        <ul class="rows" data-list="items" data-key="id">
          <template>
            <li>
              <input class="field" data-action="keydown:onKey" />
              <span class="hover" data-action="mouseenter:onHover" data-bind="label"></span>
            </li>
          </template>
        </ul>
      </div>
    `
    const list = testContainer.querySelector('.rows')
    const seen = recordListeners(list)
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    expect(seen).toContain('keydown')
    expect(seen).toContain('mouseover')
    for (const type of ['keyup', 'keypress', 'input', 'change', 'mouseout']) {
      expect(seen, `${type} should not be delegated`).not.toContain(type)
    }

    const fields = testContainer.querySelectorAll('.rows .field')
    const hoverEls = testContainer.querySelectorAll('.rows .hover')
    expect(fields.length).toBe(2)

    fields[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }))
    await waitForCompleteRender()
    expect(keys).toEqual(['b:x'])

    // mouseenter is synthesized from a bubbling mouseover whose relatedTarget
    // is outside the action element.
    hoverEls[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))
    await waitForCompleteRender()
    expect(hovers).toEqual(['a'])
  })

  it('a data-use-template row resolves to the named template and registers its declared events', async () => {
    const keys = []
    wildflower.component('delegation-use-template', {
      state: { items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
      onKey(event, element, details) { keys.push(details.item.id + ':' + event.key) }
    })
    testContainer.innerHTML = `
      <div data-component="delegation-use-template">
        <template data-item-template="rowTpl">
          <li><input class="field" data-action="keydown:onKey" /><span data-bind="label"></span></li>
        </template>
        <ul class="rows" data-list="items" data-key="id">
          <template data-use-template="rowTpl"></template>
        </ul>
      </div>
    `
    const list = testContainer.querySelector('.rows')
    const seen = recordListeners(list)
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    expect(seen).toContain('keydown')
    for (const type of ['keyup', 'keypress', 'input', 'change', 'mouseover', 'mouseout']) {
      expect(seen, `${type} should not be delegated`).not.toContain(type)
    }

    const fields = testContainer.querySelectorAll('.rows .field')
    expect(fields.length).toBe(2)
    fields[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'y', bubbles: true, cancelable: true }))
    await waitForCompleteRender()
    expect(keys).toEqual(['a:y'])
  })
})
