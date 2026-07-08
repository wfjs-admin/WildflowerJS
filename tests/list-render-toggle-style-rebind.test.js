/**
 * Regression: row-elements invalidation after data-render structural toggle
 *
 * When data-render inside a list row toggles off→on, the rendered subtree is
 * recreated via cloneNode — the original nodes are detached. The per-item
 * effect invalidates the row's cached element arrays on renderChanged, but it
 * previously cleared only _cachedElementsArray while most consumers read
 * `_bindingElements || _cachedElementsArray` (preferring the stale one), so
 * subsequent data-bind-style writes landed on the detached original nodes and
 * the visible (attached) elements never updated.
 *
 * Fix: ListRenderer also nulls _bindingElements at the renderChanged site, so
 * consumers fall through to the freshly rebuilt _cachedElementsArray.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

let counter = 0
function unique(prefix) { return `${prefix}-${++counter}` }

describe('list row data-render toggle + style rebind', () => {
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
    testContainer.style.opacity = '0'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  it('style binding inside a data-render block lands on the attached element after off→on toggle', async () => {
    const cn = unique('lrt-style')
    let componentRef

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="items">
          <template>
            <div class="item">
              <span class="name" data-bind="name"></span>
              <div class="block" data-render="expanded">
                <span class="styled" data-bind-style="{ backgroundColor: bg }">x</span>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        items: [
          { id: 1, name: 'One', expanded: true, bg: 'rgb(255, 0, 0)' }
        ]
      },
      init() { componentRef = this }
    })

    wildflower.scan()
    await waitForCompleteRender()

    // Initial render: style applied to the in-DOM element
    const styledBefore = testContainer.querySelector('.styled')
    expect(styledBefore).not.toBeNull()
    expect(styledBefore.style.backgroundColor).toBe('rgb(255, 0, 0)')

    // Structural toggle: data-render off, then back on. The rendered subtree
    // is recreated, so the row's cached element arrays must be invalidated.
    componentRef.state.items[0].expanded = false
    await waitForCompleteRender()
    expect(testContainer.querySelector('.styled')).toBeNull()

    componentRef.state.items[0].expanded = true
    await waitForCompleteRender()

    // The re-show can lag a flush when the scheduler is saturated; pump until
    // the element reappears (non-masking: assertions below still fail if not).
    for (let i = 0; i < 40 && !testContainer.querySelector('.styled'); i++) {
      await waitForCompleteRender()
    }

    const styledAfter = testContainer.querySelector('.styled')
    expect(styledAfter).not.toBeNull()
    expect(styledAfter.isConnected).toBe(true)

    // Now mutate the style-bound prop. With stale _bindingElements the write
    // lands on the detached pre-toggle node and this assertion fails.
    componentRef.state.items[0].bg = 'rgb(0, 128, 0)'
    await waitForCompleteRender()

    const styledCurrent = testContainer.querySelector('.styled')
    expect(styledCurrent).not.toBeNull()
    expect(styledCurrent.isConnected).toBe(true)
    expect(styledCurrent.style.backgroundColor).toBe('rgb(0, 128, 0)')
  })
})
