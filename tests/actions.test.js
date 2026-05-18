/**
 * WildflowerJS Actions Test Suite - Vitest Browser Mode
 *
 * Tests for data-action event handling.
 * Migrated from unitTestSuite.js ACTION CONTEXT section.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, getListItems, isMinifiedBuild} from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to wait for complete render cycle (for lists)
async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

describe('Action Context', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower

    // Simple reset
    if (wildflower.componentDefinitions) {
      wildflower.componentDefinitions.clear()
    }
    if (wildflower.componentInstances) {
      wildflower.componentInstances.clear()
    }
    if (wildflower.storeManager && wildflower.storeManager._namedStores) {
      wildflower.storeManager._namedStores.clear()
    }

    // CRITICAL: Clear template cache to prevent cross-test contamination
    if (wildflower._templateCache) {
      if (wildflower._templateCache.general) wildflower._templateCache.general.clear()
      if (wildflower._templateCache.lists) wildflower._templateCache.lists.clear()
      if (wildflower._templateCache.compiled) wildflower._templateCache.compiled.clear()
      if (wildflower._templateCache.extracted) wildflower._templateCache.extracted.clear()
      if (wildflower._templateCache.fragmentPools) wildflower._templateCache.fragmentPools.clear()
      if (wildflower._templateCache.stats) wildflower._templateCache.stats.clear()
    }

    // Create test container
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

  it.skipIf(isMinifiedBuild())('Basic action handling', async () => {
    testContainer.innerHTML = `
      <div data-component="action-test">
        <button id="increment-button" data-action="incrementCount">Increment</button>
        <div id="count-display" data-bind="count"></div>
      </div>
    `

    let actionCallCount = 0
    wildflower.component('action-test', {
      state: {
        count: 0
      },
      incrementCount(event, element) {
        this.state.count++
        actionCallCount++
      }
    })

    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="action-test"]')
    const button = component.querySelector('#increment-button')
    const display = component.querySelector('#count-display')

    // Verify action context was created
    const registry = wildflower._contextRegistry
    const actionContext = registry.getContextForElement(button)
    expect(actionContext).toBeDefined()
    expect(actionContext.type).toBe('action')
    expect(actionContext.path).toBe('incrementCount')

    // Test initial state
    expect(display.textContent).toBe('0')
    expect(actionCallCount).toBe(0)

    // Trigger the action
    button.click()
    await waitForUpdate()

    // Test state after action
    expect(display.textContent).toBe('1')
    expect(actionCallCount).toBe(1)

    // Trigger again
    button.click()
    await waitForUpdate()

    // Test final state
    expect(display.textContent).toBe('2')
    expect(actionCallCount).toBe(2)
  })

  it.skipIf(isMinifiedBuild())('Event type specification in actions', async () => {
    testContainer.innerHTML = `
      <div data-component="event-action-test">
        <input id="name-input" data-action="input:updateName" value="">
        <button id="reset-button" data-action="click:resetName">Reset</button>
        <div id="name-display" data-bind="name"></div>
      </div>
    `

    wildflower.component('event-action-test', {
      state: {
        name: ''
      },
      updateName(event, element) {
        this.state.name = element.value
      },
      resetName() {
        this.state.name = ''
      }
    })

    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="event-action-test"]')
    const input = component.querySelector('#name-input')
    const resetButton = component.querySelector('#reset-button')
    const display = component.querySelector('#name-display')

    // Verify action contexts were created with correct event types
    const registry = wildflower._contextRegistry
    const inputContext = registry.getContextForElement(input)
    const buttonContext = registry.getContextForElement(resetButton)

    expect(inputContext).toBeDefined()
    expect(inputContext.type).toBe('action')
    expect(inputContext.data.event).toBe('input')

    expect(buttonContext).toBeDefined()
    expect(buttonContext.type).toBe('action')
    expect(buttonContext.data.event).toBe('click')

    // Test initial state
    expect(display.textContent).toBe('')

    // Trigger input action
    input.value = 'Test Name'
    input.dispatchEvent(new Event('input'))
    await waitForUpdate()

    // Test state after input
    expect(display.textContent).toBe('Test Name')

    // Trigger reset action
    resetButton.click()
    await waitForUpdate()

    // Test state after reset
    expect(display.textContent).toBe('')
  })

  it.skipIf(isMinifiedBuild())('Multiple actions on one element', async () => {
    testContainer.innerHTML = `
      <div data-component="multi-action-test">
        <div id="interaction-area"
             data-action="click:handleClick mouseover:handleMouseOver mouseout:handleMouseOut">
          Interact with me
        </div>
        <div id="event-display" data-bind="lastEvent"></div>
      </div>
    `

    wildflower.component('multi-action-test', {
      state: {
        lastEvent: 'none'
      },
      handleClick() {
        this.state.lastEvent = 'click'
      },
      handleMouseOver() {
        this.state.lastEvent = 'mouseover'
      },
      handleMouseOut() {
        this.state.lastEvent = 'mouseout'
      }
    })

    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="multi-action-test"]')
    const componentId = component.dataset.componentId
    const interactionArea = component.querySelector('#interaction-area')
    const display = component.querySelector('#event-display')

    // Verify action contexts were created for all event types
    const registry = wildflower._contextRegistry
    const actionContexts = registry.getContextsByType('action')
      .filter(ctx => ctx.componentInstance && ctx.componentInstance.id === componentId)

    expect(actionContexts.length).toBe(3)

    const clickContext = actionContexts.find(ctx => ctx.data && ctx.data.event === 'click')
    const mouseoverContext = actionContexts.find(ctx => ctx.data && ctx.data.event === 'mouseover')
    const mouseoutContext = actionContexts.find(ctx => ctx.data && ctx.data.event === 'mouseout')

    expect(clickContext).toBeDefined()
    expect(mouseoverContext).toBeDefined()
    expect(mouseoutContext).toBeDefined()

    // Test initial state
    expect(display.textContent).toBe('none')

    // Trigger click event
    interactionArea.click()
    await waitForUpdate()

    expect(display.textContent).toBe('click')

    // Trigger mouseover event
    interactionArea.dispatchEvent(new MouseEvent('mouseover'))
    await waitForUpdate()

    expect(display.textContent).toBe('mouseover')

    // Trigger mouseout event
    interactionArea.dispatchEvent(new MouseEvent('mouseout'))
    await waitForUpdate()

    expect(display.textContent).toBe('mouseout')
  })

  it.skipIf(isMinifiedBuild())('Actions in list items', async () => {
    testContainer.innerHTML = `
      <div data-component="list-action-test">
        <ul data-list="items">
          <template>
            <li>
              <span class="item-name" data-bind="name"></span>
              <button class="remove-button" data-action="removeItem">Remove</button>
              <button class="toggle-button" data-action="toggleActive">Toggle</button>
            </li>
          </template>
        </ul>
        <div id="item-count" data-bind="computed:itemCount"></div>
      </div>
    `

    wildflower.component('list-action-test', {
      state: {
        items: [
          { id: 1, name: 'Item 1', active: true },
          { id: 2, name: 'Item 2', active: false },
          { id: 3, name: 'Item 3', active: true }
        ]
      },
      computed: {
        itemCount() {
          return this.state.items.length
        }
      },
      removeItem(event, element, details) {
        const { index } = details
        const updatedItems = [...this.state.items]
        updatedItems.splice(index, 1)
        this.state.items = updatedItems
      },
      toggleActive(event, element, details) {
        const { index } = details
        const updatedItems = [...this.state.items]
        updatedItems[index] = {
          ...updatedItems[index],
          active: !updatedItems[index].active
        }
        this.state.items = updatedItems
      }
    })

    await waitForCompleteRender()
    await waitForUpdate(100)

    const component = testContainer.querySelector('[data-component="list-action-test"]')
    const componentId = component.dataset.componentId
    const instance = wildflower.componentInstances.get(componentId)

    const itemCount = component.querySelector('#item-count')
    const listElement = component.querySelector('[data-list="items"]')
    let listItems = getListItems(listElement)

    expect(listItems.length).toBe(3)
    expect(itemCount.textContent).toBe('3')

    // Get first item's remove button
    const firstRemoveButton = listItems[0].querySelector('.remove-button')

    // Verify action context in list item exists with correct properties
    const registry = wildflower._contextRegistry
    const actionContext = registry.getContextForElement(firstRemoveButton)
    expect(actionContext).toBeDefined()
    expect(actionContext.type).toBe('action')
    expect(actionContext.path).toBe('removeItem')

    // Verify parent-child relationship
    expect(actionContext.parent).toBeDefined()
    expect(actionContext.parent.type).toBe('list')

    // Click the button
    firstRemoveButton.click()

    await waitForCompleteRender()
    await waitForUpdate(100)

    // Verify item was removed
    listItems = getListItems(listElement)
    expect(listItems.length).toBe(2)
    expect(itemCount.textContent).toBe('2')

    // Test toggle action on the new first item
    const firstToggleButton = listItems[0].querySelector('.toggle-button')
    const firstItemActive = instance.state.items[0].active

    firstToggleButton.click()
    await waitForUpdate()

    // Verify item was toggled
    expect(instance.state.items[0].active).toBe(!firstItemActive)
  })

  // Hover events (mouseover / mouseout / mouseenter / mouseleave) on
  // data-list row children were originally a gap: only the
  // ALL_GENERIC_EVENTS whitelist (keydown/keyup/keypress/input/change
  // plus click/submit/focus) got delegated listeners, so
  // data-action="mouseenter:..." on a list-row template silently did
  // nothing. The four tests below pin that fixed contract — both the
  // bubbling pair (mouseover/mouseout) and the synthesized enter/leave
  // semantics need to fire from list rows.
  it.skipIf(isMinifiedBuild())('mouseover on list-item element fires data-action', async () => {
    testContainer.innerHTML = `
      <div data-component="list-mouseover-test">
        <ul data-list="rows" data-key="id">
          <template>
            <li class="row" data-action="mouseover:onEnter">
              <span data-bind="name"></span>
            </li>
          </template>
        </ul>
      </div>
    `
    wildflower.component('list-mouseover-test', {
      state: { rows: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], lastSeen: null },
      onEnter(event, element, details) { this.state.lastSeen = details && details.item ? details.item.id : null }
    })
    await waitForCompleteRender()
    await waitForUpdate(50)

    const component = testContainer.querySelector('[data-component="list-mouseover-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)
    const rows = component.querySelectorAll('.row')
    expect(rows.length).toBe(2)

    rows[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await waitForUpdate(50)
    expect(instance.state.lastSeen).toBe('b')
  })

  it.skipIf(isMinifiedBuild())('mouseout on list-item element fires data-action', async () => {
    testContainer.innerHTML = `
      <div data-component="list-mouseout-test">
        <ul data-list="rows" data-key="id">
          <template>
            <li class="row" data-action="mouseout:onLeave">
              <span data-bind="name"></span>
            </li>
          </template>
        </ul>
      </div>
    `
    wildflower.component('list-mouseout-test', {
      state: { rows: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], leftId: null },
      onLeave(event, element, details) { this.state.leftId = details && details.item ? details.item.id : null }
    })
    await waitForCompleteRender()
    await waitForUpdate(50)

    const component = testContainer.querySelector('[data-component="list-mouseout-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)
    const rows = component.querySelectorAll('.row')

    rows[0].dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    await waitForUpdate(50)
    expect(instance.state.leftId).toBe('a')
  })

  it.skipIf(isMinifiedBuild())('mouseenter on list-item element fires data-action (synthesized from mouseover)', async () => {
    testContainer.innerHTML = `
      <div data-component="list-mouseenter-test">
        <ul data-list="rows" data-key="id">
          <template>
            <li class="row" data-action="mouseenter:onEnter">
              <span class="inner" data-bind="name"></span>
            </li>
          </template>
        </ul>
      </div>
    `
    wildflower.component('list-mouseenter-test', {
      state: { rows: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], entered: [] },
      onEnter(event, element, details) {
        if (details && details.item) this.state.entered = this.state.entered.concat(details.item.id)
      }
    })
    await waitForCompleteRender()
    await waitForUpdate(50)

    const component = testContainer.querySelector('[data-component="list-mouseenter-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)
    const rows = component.querySelectorAll('.row')

    // Enter row A from outside (relatedTarget is the document body).
    rows[0].dispatchEvent(new MouseEvent('mouseover', {
      bubbles: true, relatedTarget: document.body
    }))
    await waitForUpdate(50)
    expect(Array.from(instance.state.entered)).toEqual(['a'])

    // Move from row A's outer to row A's inner span — still inside the
    // row, mouseenter must NOT fire again.
    const innerOfA = rows[0].querySelector('.inner')
    innerOfA.dispatchEvent(new MouseEvent('mouseover', {
      bubbles: true, relatedTarget: rows[0]
    }))
    await waitForUpdate(50)
    expect(Array.from(instance.state.entered)).toEqual(['a'])  // still just one entry

    // Enter row B from outside — fires once.
    rows[1].dispatchEvent(new MouseEvent('mouseover', {
      bubbles: true, relatedTarget: document.body
    }))
    await waitForUpdate(50)
    expect(Array.from(instance.state.entered)).toEqual(['a', 'b'])
  })

  it.skipIf(isMinifiedBuild())('data-event-outside fires once per element, not once per re-registration', async () => {
    // _setupOutsideClickHandler used to add a fresh document-level
    // click listener every time it was invoked. If the same element
    // and methodName got re-registered (e.g., a component re-scan or
    // any path that calls it twice), each prior listener stayed alive
    // and the user's handler ran N times per click. After the fix the
    // registry is keyed by (element, methodName) so duplicate
    // registrations are idempotent.
    testContainer.innerHTML = `
      <div data-component="outside-dedupe-test">
        <span class="watcher" data-action="onOutside" data-event-outside>watcher</span>
        <div id="outside-target">outside</div>
      </div>
    `
    wildflower.component('outside-dedupe-test', {
      state: { fires: 0 },
      onOutside() { this.state.fires += 1 }
    })
    await waitForCompleteRender()
    await waitForUpdate(50)

    const component = testContainer.querySelector('[data-component="outside-dedupe-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)
    const watcher = component.querySelector('.watcher')
    const outsideTarget = component.querySelector('#outside-target')

    expect(watcher).toBeTruthy()

    // Re-register the same outside-click handler several times.
    // Pre-fix each call added another document listener; post-fix
    // they collapse to the same registry entry.
    for (let i = 0; i < 4; i++) {
      wildflower._setupOutsideClickHandler(watcher, instance, 'onOutside')
    }

    outsideTarget.click()
    await waitForUpdate(50)

    // Exactly one fire, not five.
    expect(instance.state.fires).toBe(1)
  })

  it.skipIf(isMinifiedBuild())('data-event-outside on a data-list row child fires when clicking outside the row', async () => {
    // The PM demo's inline-edit cells live inside a data-list and need
    // outside-click to close their popovers. Without framework support,
    // the click delegation never wires _setupOutsideClickHandler for
    // row-template children, so data-event-outside there is a silent
    // no-op and demos resort to a manual document.addEventListener.
    //
    // This test reproduces the bug: two rows, each with a span that
    // declares data-action + data-event-outside. A click on an element
    // outside any row must invoke the handler once per visible row.
    testContainer.innerHTML = `
      <div data-component="list-outside-test">
        <ul data-list="rows" data-key="id">
          <template>
            <li class="row">
              <span class="watcher" data-action="onOutside" data-event-outside data-bind="label"></span>
            </li>
          </template>
        </ul>
        <div id="elsewhere">outside the rows</div>
      </div>
    `
    wildflower.component('list-outside-test', {
      state: {
        rows: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        fires: []
      },
      onOutside(event, element) {
        this.state.fires = this.state.fires.concat(element.textContent)
      }
    })
    await waitForCompleteRender()
    await waitForUpdate(50)

    const component = testContainer.querySelector('[data-component="list-outside-test"]')
    const watchers = component.querySelectorAll('.watcher')
    const elsewhere = component.querySelector('#elsewhere')

    expect(watchers.length).toBe(2)
    expect(watchers[0].textContent).toBe('A')

    elsewhere.click()
    await waitForUpdate(50)

    const instance = wildflower.componentInstances.get(component.dataset.componentId)
    expect(Array.from(instance.state.fires).sort()).toEqual(['A', 'B'])
  })

  it.skipIf(isMinifiedBuild())('data-event-outside on a data-list row child receives details.item', async () => {
    // T1.2: an outside-click handler on a row-template child must receive
    // (event, el, details) with details.item populated — matching regular
    // row action handlers. Before the fix it got only (event, el), forcing
    // demos to walk the DOM for the framework-private _itemData property.
    testContainer.innerHTML = `
      <div data-component="list-outside-details-test">
        <ul data-list="rows" data-key="id">
          <template>
            <li class="row">
              <span class="watcher" data-action="onOutside" data-event-outside data-bind="label"></span>
            </li>
          </template>
        </ul>
        <div id="elsewhere">outside the rows</div>
      </div>
    `
    wildflower.component('list-outside-details-test', {
      state: {
        rows: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        seen: []
      },
      onOutside(event, element, details) {
        this.state.seen = this.state.seen.concat({
          hasDetails: !!details,
          id: details && details.item ? details.item.id : null,
          index: details ? details.index : null,
          length: details ? details.length : null
        })
      }
    })
    await waitForCompleteRender()
    await waitForUpdate(50)

    const component = testContainer.querySelector('[data-component="list-outside-details-test"]')
    const elsewhere = component.querySelector('#elsewhere')
    elsewhere.click()
    await waitForUpdate(50)

    const instance = wildflower.componentInstances.get(component.dataset.componentId)
    const seen = Array.from(instance.state.seen)
    expect(seen.length).toBe(2)
    const byId = {}
    seen.forEach(s => { byId[s.id] = s })
    expect(byId['a']).toBeTruthy()
    expect(byId['b']).toBeTruthy()
    expect(byId['a'].hasDetails).toBe(true)
    expect(byId['a'].index).toBe(0)
    expect(byId['b'].index).toBe(1)
    expect(byId['a'].length).toBe(2)
  })

  it.skipIf(isMinifiedBuild())('data-event-outside on a non-list element still works after the row-details change', async () => {
    // Backward-compat guard for T1.2: a plain (non-list) data-event-outside
    // handler must keep working. It receives (event, el) — the new third
    // `details` arg is undefined for non-list handlers, harmlessly ignored.
    testContainer.innerHTML = `
      <div data-component="non-list-outside-test">
        <span class="watcher" data-action="onOutside" data-event-outside>watcher</span>
        <div id="outside-target">outside</div>
      </div>
    `
    wildflower.component('non-list-outside-test', {
      state: { fires: 0, sawDetails: 'unset' },
      onOutside(event, element, details) {
        this.state.fires += 1
        this.state.sawDetails = details === undefined ? 'undefined' : 'defined'
      }
    })
    await waitForCompleteRender()
    await waitForUpdate(50)

    const component = testContainer.querySelector('[data-component="non-list-outside-test"]')
    const outsideTarget = component.querySelector('#outside-target')
    outsideTarget.click()
    await waitForUpdate(50)

    const instance = wildflower.componentInstances.get(component.dataset.componentId)
    expect(instance.state.fires).toBe(1)
    expect(instance.state.sawDetails).toBe('undefined')
  })

  it.skipIf(isMinifiedBuild())('multi-action input+change on a list-item input element (kanban color-picker pattern)', async () => {
    // Mirrors the kanban-wf demo's column color picker:
    //   <input data-model="settingsColor"
    //          data-action="input:onPreview change:onCommit">
    // inside a data-list. Both events are in the framework's
    // delegated event whitelist (input/change/keydown/keyup/keypress).
    // Probes whether the single-context-per-element limit silently
    // drops one of the two handlers.
    testContainer.innerHTML = `
      <div data-component="list-input-change-test">
        <ul data-list="rows" data-key="id">
          <template>
            <li>
              <input class="picker" data-model="value" data-action="input:onPreview change:onCommit">
            </li>
          </template>
        </ul>
      </div>
    `
    wildflower.component('list-input-change-test', {
      state: {
        rows: [{ id: 'a', value: 'A' }],
        previewLog: [],
        commitLog: []
      },
      onPreview(event, element, details) {
        this.state.previewLog = this.state.previewLog.concat(event.target.value)
      },
      onCommit(event, element, details) {
        this.state.commitLog = this.state.commitLog.concat(event.target.value)
      }
    })
    await waitForCompleteRender()
    await waitForUpdate(50)

    const component = testContainer.querySelector('[data-component="list-input-change-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)
    const picker = component.querySelector('.picker')

    picker.value = 'preview1'
    picker.dispatchEvent(new Event('input', { bubbles: true }))
    await waitForUpdate(50)
    picker.value = 'committed'
    picker.dispatchEvent(new Event('change', { bubbles: true }))
    await waitForUpdate(50)

    expect(Array.from(instance.state.previewLog)).toEqual(['preview1'])
    expect(Array.from(instance.state.commitLog)).toEqual(['committed'])
  })

  it.skipIf(isMinifiedBuild())('multiple actions on a list-item element (click + mouseenter) all fire', async () => {
    // Reproduces the gap exposed by the PM demo's favorites rows:
    // an `<a>` inside a data-list template carries
    //   data-action="gotoX mouseenter:hoverX mouseleave:unhoverX"
    // For non-list elements this works (direct per-eventType listeners).
    // For list-row elements, the framework's per-row context creation
    // only registers ONE action per element — subsequent defs are
    // skipped. So the click handler fires but the hover handlers go
    // silently nowhere.
    testContainer.innerHTML = `
      <div data-component="multi-list-action-test">
        <ul data-list="rows" data-key="id">
          <template>
            <li class="row" data-action="click:onClick mouseenter:onEnter mouseleave:onLeave">
              <span data-bind="name"></span>
            </li>
          </template>
        </ul>
      </div>
    `
    wildflower.component('multi-list-action-test', {
      state: {
        rows: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
        clicked: null, entered: null, left: null
      },
      onClick(event, element, details) { this.state.clicked = details && details.item ? details.item.id : null },
      onEnter(event, element, details) { this.state.entered = details && details.item ? details.item.id : null },
      onLeave(event, element, details) { this.state.left    = details && details.item ? details.item.id : null }
    })
    await waitForCompleteRender()
    await waitForUpdate(50)

    const component = testContainer.querySelector('[data-component="multi-list-action-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)
    const rows = component.querySelectorAll('.row')

    rows[1].click()
    await waitForUpdate(50)
    expect(instance.state.clicked).toBe('b')

    rows[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))
    await waitForUpdate(50)
    expect(instance.state.entered).toBe('a')

    rows[0].dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    await waitForUpdate(50)
    expect(instance.state.left).toBe('a')
  })

  it.skipIf(isMinifiedBuild())('mouseleave on list-item element fires data-action (synthesized from mouseout)', async () => {
    testContainer.innerHTML = `
      <div data-component="list-mouseleave-test">
        <ul data-list="rows" data-key="id">
          <template>
            <li class="row" data-action="mouseleave:onLeave">
              <span class="inner" data-bind="name"></span>
            </li>
          </template>
        </ul>
      </div>
    `
    wildflower.component('list-mouseleave-test', {
      state: { rows: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], left: [] },
      onLeave(event, element, details) {
        if (details && details.item) this.state.left = this.state.left.concat(details.item.id)
      }
    })
    await waitForCompleteRender()
    await waitForUpdate(50)

    const component = testContainer.querySelector('[data-component="list-mouseleave-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)
    const rows = component.querySelectorAll('.row')

    // Move from row A's inner span to row A itself — still inside the
    // row, mouseleave must NOT fire.
    const innerOfA = rows[0].querySelector('.inner')
    innerOfA.dispatchEvent(new MouseEvent('mouseout', {
      bubbles: true, relatedTarget: rows[0]
    }))
    await waitForUpdate(50)
    expect(Array.from(instance.state.left)).toEqual([])

    // Leave row A entirely (relatedTarget outside the row) — fires once.
    rows[0].dispatchEvent(new MouseEvent('mouseout', {
      bubbles: true, relatedTarget: document.body
    }))
    await waitForUpdate(50)
    expect(Array.from(instance.state.left)).toEqual(['a'])
  })

  it.skipIf(isMinifiedBuild())('Action context cleanup on component destruction', async () => {
    testContainer.innerHTML = `
      <div data-component="cleanup-action-test">
        <button id="test-button" data-action="testAction">Test Action</button>
      </div>
    `

    let actionCallCount = 0

    wildflower.component('cleanup-action-test', {
      state: {},
      testAction() {
        actionCallCount++
      }
    })

    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="cleanup-action-test"]')
    const componentId = component.dataset.componentId
    const button = component.querySelector('#test-button')

    // Verify action context was created
    const registry = wildflower._contextRegistry
    const initialActionContexts = registry.getContextsByType('action')
      .filter(ctx => ctx.componentInstance && ctx.componentInstance.id === componentId)

    expect(initialActionContexts.length).toBe(1)

    // Test action handler works
    button.click()
    expect(actionCallCount).toBe(1)

    // Destroy the component
    wildflower.destroyComponent(componentId)
    await waitForUpdate()

    // Verify component is destroyed
    expect(wildflower.componentInstances.has(componentId)).toBe(false)

    // Verify context was removed
    const remainingActionContexts = registry.getContextsByType('action')
      .filter(ctx => ctx.componentInstance && ctx.componentInstance.id === componentId)
    expect(remainingActionContexts.length).toBe(0)

    // Try to trigger action again - should not increment
    // (button may still be in DOM but handler should be detached)
    if (button.parentNode) {
      button.click()
      // Action should not have been called again
      expect(actionCallCount).toBe(1)
    }
  })
})
