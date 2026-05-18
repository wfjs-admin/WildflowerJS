/**
 * Regression: clicking a data-list row whose template is on the
 * canUseInnerHTML fast path must dispatch its data-action handler, even
 * though the attribute itself is stripped from the rendered DOM for
 * krausest-benchmark perf reasons.
 *
 * Bug shape (surfaced 2026-05-17, amber-otter-23, PM demo icon picker):
 *
 *   Row template: outer <span data-bind-class="X" data-action="Y"> with
 *   inner <span data-bind="Z">. The inner-binding shape (text only, no
 *   data-bind-style / data-bind-attr) flips canUseInnerHTML to true →
 *   the strip pass removes data-action from the rendered row → the click
 *   delegation handler (_handleDelegatedActionWithListItem) tries to
 *   read the missing attribute via _getAttr(actionEl, 'action') and
 *   silently returns false. No console warning, no visible feedback,
 *   just dead clicks. The neighboring color picker worked because its
 *   data-bind-style on the inner disqualified canUseInnerHTML.
 *
 * Fix: the action stripping stays (DOM bloat matters at krausest's 10K
 * rows), but the delegation handler now falls back to the compiled
 * metadata (listItem._compiledMetadata.actions[i].actionName) when the
 * DOM attribute is missing. Same outcome, no DOM-bloat regression.
 *
 * Companion memory: feedback_data_list_action_stripped_text_only_inner.md.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

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

describe('list-row data-action survives template strip', () => {
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

  it('clicking a row whose template is on the innerHTML fast path dispatches its action', async () => {
    // Reproduces the PM demo icon-picker shape: row root has BOTH
    // data-bind-class AND data-action, inner has only data-bind text.
    // This combination produced silent dead-clicks because the row's
    // class is applied via metadata (no DOM attribute needed) and the
    // action is stripped — but the action delegation tried to read the
    // stripped attribute.
    const clicks = []
    wildflower.component('action-strip-click-victim', {
      state: {
        items: [
          { id: 'x', label: 'X', cls: 'pick-row' },
          { id: 'y', label: 'Y', cls: 'pick-row' }
        ]
      },
      pick(event, element, details) {
        clicks.push(details && details.item ? details.item.id : null)
      }
    })
    testContainer.innerHTML = `
      <div data-component="action-strip-click-victim">
        <ul class="picker" data-list="items" data-key="id">
          <template>
            <li data-bind-class="cls" data-action="pick">
              <span data-bind="label"></span>
            </li>
          </template>
        </ul>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const rows = testContainer.querySelectorAll('.picker .pick-row')
    expect(rows.length).toBe(2)
    rows[0].click()
    rows[1].click()
    rows[0].click()
    await waitForCompleteRender()

    expect(clicks).toEqual(['x', 'y', 'x'])
  })

  it('row click is not stolen by an outer FORM data-action when row data-action was stripped', async () => {
    // Exact PM-demo shape: the data-list lives inside a <form data-action="submit">.
    // When the row's data-action is stripped at compile time,
    // event.target.closest('[data-action]') walks PAST the row and finds
    // the FORM. The FORM-skip check in the click delegation handler
    // bails out, never reaching the metadata fallback — silent dead-click.
    // Fix: reject any actionEl outside the list boundary so the metadata
    // fallback gets a chance to find the stripped row action.
    const picks = []
    const submits = []
    wildflower.component('row-vs-form-action', {
      state: {
        items: [
          { id: 'p', label: 'P', cls: 'pf-row' },
          { id: 'q', label: 'Q', cls: 'pf-row' }
        ]
      },
      pick(event, element, details) {
        picks.push(details && details.item ? details.item.id : null)
      },
      submit() {
        submits.push('submit')
      }
    })
    testContainer.innerHTML = `
      <div data-component="row-vs-form-action">
        <form data-action="submit" novalidate>
          <ul class="pf-picker" data-list="items" data-key="id">
            <template>
              <li data-bind-class="cls" data-action="pick">
                <span data-bind="label"></span>
              </li>
            </template>
          </ul>
        </form>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const rows = testContainer.querySelectorAll('.pf-picker .pf-row')
    expect(rows.length).toBe(2)
    rows[0].click()
    rows[1].click()
    await waitForCompleteRender()

    expect(picks).toEqual(['p', 'q'])
    // Row clicks must NOT trigger the form's submit (form actions fire on
    // submit events, not click events, and the row's action shouldn't
    // bubble to the form via the stripped-attribute lookup path).
    expect(submits).toEqual([])
  })

  it('event:method syntax on the row root also survives the strip', async () => {
    // The previous fix only kept the attribute alive; verify that the
    // event-prefix parsing path (data-action="mouseover:hover") works too.
    const events = []
    wildflower.component('action-strip-event-syntax-victim', {
      state: {
        items: [{ id: '1', label: 'One' }, { id: '2', label: 'Two' }]
      },
      hover(event, element, details) {
        events.push(details.item.id)
      }
    })
    testContainer.innerHTML = `
      <div data-component="action-strip-event-syntax-victim">
        <ul class="picker" data-list="items" data-key="id">
          <template>
            <li class="row" data-action="mouseover:hover">
              <span data-bind="label"></span>
            </li>
          </template>
        </ul>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const rows = testContainer.querySelectorAll('.picker .row')
    rows[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    rows[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await waitForCompleteRender()

    expect(events).toEqual(['1', '2'])
  })
})
