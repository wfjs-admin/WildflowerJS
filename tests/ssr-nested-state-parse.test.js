/**
 * Regression: SSR state parsing must round-trip NESTED lists into the parent
 * item's state. _parseListsIntoState used to run querySelectorAll('[data-bind]')
 * on each outer item, which descended into the inner list — so the parent item
 * got a bogus last-wins inner field and NO nested array. After activation a
 * re-render of the parent then drew the inner lists empty.
 *
 * Renderer-agnostic bug (the parser runs during SSR activation regardless of
 * renderer). Surfaced by the LR2 spike; the fix belongs on the live renderer.
 *
 * The component carries only MINIMAL state so the nested data can come ONLY from
 * the SSR-parsed DOM — isolating the parser.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

const describeIfSSR = hasFeature('ssr') ? describe : describe.skip

describeIfSSR('SSR nested-list state parsing', () => {
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
    testContainer.style.cssText = 'position:absolute;left:-9999px;opacity:0'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) testContainer.parentNode.removeChild(testContainer)
  })

  it('parses a nested list into the parent item state (not flattened)', async () => {
    testContainer.innerHTML = `
      <div id="ssr-np" data-component="ssr-nested-parse" data-ssr="true">
        <div data-list="categories">
          <template>
            <div class="category">
              <h3 data-bind="name"></h3>
              <ul data-list="items"><template><li data-bind="title"></li></template></ul>
            </div>
          </template>
          <div class="category">
            <h3 data-bind="name">Electronics</h3>
            <ul data-list="items">
              <template><li data-bind="title"></li></template>
              <li data-bind="title">Phone</li>
              <li data-bind="title">Laptop</li>
            </ul>
          </div>
          <div class="category">
            <h3 data-bind="name">Books</h3>
            <ul data-list="items">
              <template><li data-bind="title"></li></template>
              <li data-bind="title">Fiction</li>
            </ul>
          </div>
        </div>
      </div>
    `
    // Minimal state: the nested arrays must come from the SSR-parsed DOM.
    wildflower.component('ssr-nested-parse', { state: { categories: [] } })

    const element = testContainer.querySelector('#ssr-np')
    wildflower.ssrManager.prepareElement(element)
    wildflower.scan()
    await waitForUpdate(100)
    wildflower.ssrManager.activateAllComponents()
    await waitForUpdate(100)

    const instance = wildflower.componentInstances.get(element.dataset.componentId)
    const cats = instance.state.categories

    // Parser must reconstruct the OUTER list…
    expect(cats.length).toBe(2)
    expect(cats.map(c => c.name)).toEqual(['Electronics', 'Books'])

    // …AND the nested arrays into each parent item (the bug: these were undefined,
    // and `title` was a bogus last-wins inner value on the parent).
    expect(cats[0].title).toBeUndefined()
    expect(Array.isArray(cats[0].items)).toBe(true)
    expect(cats[0].items.map(i => i.title)).toEqual(['Phone', 'Laptop'])
    expect(cats[1].items.map(i => i.title)).toEqual(['Fiction'])
  })
})
