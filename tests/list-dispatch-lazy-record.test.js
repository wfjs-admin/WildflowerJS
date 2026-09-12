/**
 * List action dispatch creates a row's action records per element, on that
 * element's first interaction, instead of every record the row will ever
 * need (2026-09-02, single-pass dispatch step B).
 *
 * The two shapes that lazy creation could break:
 *  - an element declaring several actions ("click:open mouseenter:hover"):
 *    the first event creates the record, the second declared event must
 *    still route through the same record's eventHandlers map;
 *  - two action elements in one row, touched in either order: each gets its
 *    own record independently, with the right item.
 * Plus the routing rule the single walk owns: a click inside a nested
 * list's row reaches the nested list's handler only, never the outer one.
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

describe('list dispatch: per-element action records', () => {
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

  it('an element declaring click and mouseenter dispatches both after the first creates its record', async () => {
    const log = []
    wildflower.component('lazy-record-multi', {
      state: { items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
      open(event, element, details) { log.push('open:' + details.item.id) },
      hover(event, element, details) { log.push('hover:' + details.item.id) }
    })
    testContainer.innerHTML = `
      <div data-component="lazy-record-multi">
        <ul class="rows" data-list="items" data-key="id">
          <template>
            <li><a class="act" data-action="click:open mouseenter:hover" data-bind="label"></a></li>
          </template>
        </ul>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const acts = testContainer.querySelectorAll('.rows .act')
    expect(acts.length).toBe(2)

    // click first on row b (creates the record), then the second declared event
    acts[1].click()
    await waitForCompleteRender()
    acts[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))
    await waitForCompleteRender()
    // and the other order on row a
    acts[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))
    await waitForCompleteRender()
    acts[0].click()
    await waitForCompleteRender()

    expect(log).toEqual(['open:b', 'hover:b', 'hover:a', 'open:a'])
  })

  it('two action elements in one row dispatch independently in either order', async () => {
    const log = []
    wildflower.component('lazy-record-two', {
      state: { items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
      pick(event, element, details) { log.push('pick:' + details.item.id + ':' + details.index) },
      drop(event, element, details) { log.push('drop:' + details.item.id + ':' + details.index) }
    })
    testContainer.innerHTML = `
      <div data-component="lazy-record-two">
        <ul class="rows" data-list="items" data-key="id">
          <template>
            <li>
              <a class="pick" data-action="pick" data-bind="label"></a>
              <a class="drop" data-action="drop"><span class="x">x</span></a>
            </li>
          </template>
        </ul>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const rows = testContainer.querySelectorAll('.rows > li')
    expect(rows.length).toBe(2)
    // second element first on row a (click lands on the inner span), then the first
    rows[0].querySelector('.x').click()
    await waitForCompleteRender()
    rows[0].querySelector('.pick').click()
    await waitForCompleteRender()
    // first element first on row b, then the second
    rows[1].querySelector('.pick').click()
    await waitForCompleteRender()
    rows[1].querySelector('.x').click()
    await waitForCompleteRender()

    expect(log).toEqual(['drop:a:0', 'pick:a:0', 'pick:b:1', 'drop:b:1'])
  })

  it('a click inside a nested list row reaches the nested handler only', async () => {
    const log = []
    wildflower.component('lazy-record-nested', {
      state: {
        groups: [
          { id: 'g1', name: 'G1', children: [{ id: 'c1', label: 'C1' }, { id: 'c2', label: 'C2' }] },
          { id: 'g2', name: 'G2', children: [{ id: 'c3', label: 'C3' }] }
        ]
      },
      pickGroup(event, element, details) { log.push('group:' + details.item.id) },
      pickChild(event, element, details) { log.push('child:' + details.item.id) }
    })
    testContainer.innerHTML = `
      <div data-component="lazy-record-nested">
        <ul class="groups" data-list="groups" data-key="id">
          <template>
            <li>
              <span class="g" data-action="pickGroup" data-bind="name"></span>
              <ul class="children" data-list="children" data-key="id">
                <template>
                  <li><span class="c" data-action="pickChild" data-bind="label"></span></li>
                </template>
              </ul>
            </li>
          </template>
        </ul>
      </div>
    `
    ensureComponentScanning(wildflower)
    await waitForCompleteRender()

    const children = testContainer.querySelectorAll('.children .c')
    expect(children.length).toBe(3)
    children[1].click()
    await waitForCompleteRender()
    testContainer.querySelectorAll('.groups > li > .g')[1].click()
    await waitForCompleteRender()

    expect(log).toEqual(['child:c2', 'group:g2'])
  })
})
