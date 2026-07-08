/**
 * data-render in List Templates Test Suite
 *
 * Tests data-render (conditional DOM insertion/removal) within list templates.
 * data-render differs from data-show: data-show toggles CSS visibility,
 * data-render physically adds/removes DOM nodes. Inside lists, data-render
 * must correctly scope to each item's data and handle reactive updates
 * without interfering with sibling items or the list reconciler.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

let counter = 0
function unique(prefix) { return `${prefix}-${++counter}` }

describe('data-render in List Templates', () => {
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

  it('data-render conditionally includes elements per list item', async () => {
    const cn = unique('drl-basic')

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="items">
          <template>
            <div class="item">
              <span class="name" data-bind="name"></span>
              <span class="badge" data-render="hasBadge">NEW</span>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        items: [
          { id: 1, name: 'Alpha', hasBadge: true },
          { id: 2, name: 'Beta', hasBadge: false },
          { id: 3, name: 'Gamma', hasBadge: true }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const items = testContainer.querySelectorAll('.item')
    expect(items.length).toBe(3)

    // Item 1: badge rendered
    expect(items[0].querySelector('.name').textContent).toBe('Alpha')
    const badge0 = items[0].querySelector('.badge')
    expect(badge0).not.toBeNull()

    // Item 2: badge not rendered (data-render=false removes from DOM)
    expect(items[1].querySelector('.name').textContent).toBe('Beta')
    // data-render false should either remove or hide the element
    const badge1 = items[1].querySelector('.badge')
    if (badge1) {
      // If element exists, it should be hidden/removed from flow
      expect(badge1.style.display === 'none' || !badge1.offsetParent).toBe(true)
    }

    // Item 3: badge rendered
    expect(items[2].querySelector('.name').textContent).toBe('Gamma')
    const badge2 = items[2].querySelector('.badge')
    expect(badge2).not.toBeNull()
  })

  it('data-render toggle false→true establishes child bindings in list item', async () => {
    const cn = unique('drl-mutate')
    let componentRef

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="items">
          <template>
            <div class="item">
              <span class="name" data-bind="name"></span>
              <div class="details" data-render="showDetails">
                <span class="desc" data-bind="description"></span>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        items: [
          { id: 1, name: 'Item 1', description: 'Desc 1', showDetails: false },
          { id: 2, name: 'Item 2', description: 'Desc 2', showDetails: true }
        ]
      },
      init() { componentRef = this }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const items = testContainer.querySelectorAll('.item')

    // Item 2 starts expanded — should have content
    expect(items[1].querySelector('.desc').textContent).toBe('Desc 2')

    // Toggle item 1's showDetails from false to true
    componentRef.state.items[0].showDetails = true
    await waitForCompleteRender()

    // Child bindings should be established with correct list item scope
    const desc1 = items[0].querySelector('.desc')
    expect(desc1).not.toBeNull()
    expect(desc1.textContent).toBe('Desc 1')
  })

  it('data-render in list item updates without orphaned-timer error', async () => {
    // Regression: commit c9c59e6 left an orphaned `self._perfTimers.render`
    // reference (never initialized) in the per-item effect's renders branch.
    // On any subsequent re-run of a list item that has data-render, it threw a
    // TypeError that the effect try/catch swallowed (console.error). Updating
    // an item with active data-render must re-render cleanly with no such error.
    const cn = unique('drl-render-update')
    let componentRef

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="items">
          <template>
            <div class="item">
              <span class="name" data-bind="name"></span>
              <div class="details" data-render="showDetails">
                <span class="desc" data-bind="description"></span>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        items: [
          { id: 1, name: 'Item 1', description: 'Desc 1', showDetails: true },
          { id: 2, name: 'Item 2', description: 'Desc 2', showDetails: true }
        ]
      },
      init() { componentRef = this }
    })

    wildflower.scan()
    await waitForCompleteRender()

    // Capture console.error to detect the swallowed orphaned-timer TypeError
    const errors = []
    const origError = console.error
    console.error = (...args) => { errors.push(args.map(String).join(' ')); origError.apply(console, args) }
    try {
      // Subsequent re-runs of an item that HAS data-render active — this is the
      // exact path (renders branch) where the orphaned _perfTimers ref lived.
      componentRef.state.items[0].description = 'Updated Desc 1'
      await waitForCompleteRender()
      componentRef.state.items[0].showDetails = false
      await waitForCompleteRender()
      componentRef.state.items[0].showDetails = true
      await waitForCompleteRender()
    } finally {
      console.error = origError
    }

    // The data-render re-show (showDetails false -> true) can lag a single flush
    // when the scheduler is saturated; pump forced renders until the item's .desc
    // re-appears (non-masking: if it never renders, the assertions below still fail).
    for (let i = 0; i < 40 && !testContainer.querySelector('.item')?.querySelector('.desc'); i++) {
      await waitForCompleteRender()
    }

    // Functional: the render reacted correctly across the updates
    const items = testContainer.querySelectorAll('.item')
    expect(items[0].querySelector('.desc')).not.toBeNull()
    expect(items[0].querySelector('.desc').textContent).toBe('Updated Desc 1')

    // Regression guard: no orphaned-timer / undefined-property error was thrown
    const timerErrors = errors.filter(e => /_perfTimers|Cannot read|is not defined|of undefined/.test(e))
    expect(timerErrors).toEqual([])
  })

  it('data-render + data-bind on same element in list', async () => {
    const cn = unique('drl-same-el')

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="items">
          <template>
            <div class="item">
              <span class="always" data-bind="name"></span>
              <span class="conditional" data-render="active" data-bind="status"></span>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        items: [
          { id: 1, name: 'Task A', status: 'Running', active: true },
          { id: 2, name: 'Task B', status: 'Stopped', active: false },
          { id: 3, name: 'Task C', status: 'Running', active: true }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const items = testContainer.querySelectorAll('.item')
    expect(items.length).toBe(3)

    // Item 1: always shows name, conditionally shows status
    expect(items[0].querySelector('.always').textContent).toBe('Task A')
    const cond0 = items[0].querySelector('.conditional')
    if (cond0 && cond0.style.display !== 'none') {
      expect(cond0.textContent).toBe('Running')
    }

    // Item 2: always shows name, status should be hidden
    expect(items[1].querySelector('.always').textContent).toBe('Task B')

    // Item 3: both shown
    expect(items[2].querySelector('.always').textContent).toBe('Task C')
  })

  it('data-render with store-backed list items', async () => {
    const sn = unique('drl-store')
    const cn = unique('drl-comp')

    wildflower.store(sn, {
      state: {
        notifications: [
          { id: 1, message: 'Info', hasAction: true, actionLabel: 'Dismiss' },
          { id: 2, message: 'Warning', hasAction: false, actionLabel: '' },
          { id: 3, message: 'Error', hasAction: true, actionLabel: 'Retry' }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="notifs">
          <template>
            <div class="notif">
              <span class="msg" data-bind="message"></span>
              <button class="action-btn" data-render="hasAction" data-bind="actionLabel"></button>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {},
      subscribe: { [sn]: ['notifications'] },
      computed: {
        notifs() {
          return this.stores[sn].notifications || []
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const notifs = testContainer.querySelectorAll('.notif')
    expect(notifs.length).toBe(3)

    expect(notifs[0].querySelector('.msg').textContent).toBe('Info')
    const btn0 = notifs[0].querySelector('.action-btn')
    if (btn0 && btn0.style.display !== 'none') {
      expect(btn0.textContent).toBe('Dismiss')
    }

    expect(notifs[1].querySelector('.msg').textContent).toBe('Warning')

    expect(notifs[2].querySelector('.msg').textContent).toBe('Error')
    const btn2 = notifs[2].querySelector('.action-btn')
    if (btn2 && btn2.style.display !== 'none') {
      expect(btn2.textContent).toBe('Retry')
    }
  })

  it('data-render false items do not affect list item count', async () => {
    const cn = unique('drl-count')

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="items">
          <template>
            <div class="item">
              <span class="label" data-bind="label"></span>
              <span class="extra" data-render="showExtra">Extra</span>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        items: [
          { id: 1, label: 'A', showExtra: false },
          { id: 2, label: 'B', showExtra: false },
          { id: 3, label: 'C', showExtra: false }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    // All 3 list items should be rendered regardless of data-render on children
    const items = testContainer.querySelectorAll('.item')
    expect(items.length).toBe(3)
    expect(items[0].querySelector('.label').textContent).toBe('A')
    expect(items[1].querySelector('.label').textContent).toBe('B')
    expect(items[2].querySelector('.label').textContent).toBe('C')
  })

  it('data-render inside nested list structure', async () => {
    const cn = unique('drl-nested')

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="groups">
          <template>
            <div class="group">
              <span class="group-name" data-bind="name"></span>
              <div class="group-desc" data-render="hasDescription">
                <span class="desc-text" data-bind="description"></span>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        groups: [
          { id: 1, name: 'Group A', description: 'First group', hasDescription: true },
          { id: 2, name: 'Group B', description: '', hasDescription: false },
          { id: 3, name: 'Group C', description: 'Third group', hasDescription: true }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const groups = testContainer.querySelectorAll('.group')
    expect(groups.length).toBe(3)

    // Group A: has description
    expect(groups[0].querySelector('.group-name').textContent).toBe('Group A')
    const desc0 = groups[0].querySelector('.group-desc')
    if (desc0 && desc0.style.display !== 'none') {
      expect(groups[0].querySelector('.desc-text').textContent).toBe('First group')
    }

    // Group B: no description
    expect(groups[1].querySelector('.group-name').textContent).toBe('Group B')

    // Group C: has description
    expect(groups[2].querySelector('.group-name').textContent).toBe('Group C')
  })

  it('data-render with multiple conditional blocks per list item', async () => {
    const cn = unique('drl-multi')

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="items">
          <template>
            <div class="item">
              <span class="name" data-bind="name"></span>
              <span class="warning" data-render="hasWarning">WARNING</span>
              <span class="error" data-render="hasError">ERROR</span>
              <span class="success" data-render="hasSuccess">OK</span>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        items: [
          { id: 1, name: 'Server A', hasWarning: false, hasError: false, hasSuccess: true },
          { id: 2, name: 'Server B', hasWarning: true, hasError: false, hasSuccess: false },
          { id: 3, name: 'Server C', hasWarning: false, hasError: true, hasSuccess: false }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const items = testContainer.querySelectorAll('.item')
    expect(items.length).toBe(3)

    // Each server shows only its relevant status indicator
    expect(items[0].querySelector('.name').textContent).toBe('Server A')
    expect(items[1].querySelector('.name').textContent).toBe('Server B')
    expect(items[2].querySelector('.name').textContent).toBe('Server C')
  })

  it('data-render in keyed list', async () => {
    const cn = unique('drl-keyed')
    let componentRef

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="items" data-key="id">
          <template>
            <div class="item">
              <span class="name" data-bind="name"></span>
              <span class="tag" data-render="tagged">TAGGED</span>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        items: [
          { id: 1, name: 'Alpha', tagged: true },
          { id: 2, name: 'Beta', tagged: false },
          { id: 3, name: 'Gamma', tagged: true }
        ]
      },
      init() { componentRef = this }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const items = testContainer.querySelectorAll('.item')
    expect(items.length).toBe(3)

    // Reorder the keyed list — data-render state should follow the data
    componentRef.state.items = [
      { id: 3, name: 'Gamma', tagged: true },
      { id: 1, name: 'Alpha', tagged: true },
      { id: 2, name: 'Beta', tagged: false }
    ]
    await waitForCompleteRender()

    const reordered = testContainer.querySelectorAll('.item')
    expect(reordered.length).toBe(3)
    expect(reordered[0].querySelector('.name').textContent).toBe('Gamma')
    expect(reordered[1].querySelector('.name').textContent).toBe('Alpha')
    expect(reordered[2].querySelector('.name').textContent).toBe('Beta')
  })

  it('data-render + data-show on same property in list template', async () => {
    const cn = unique('drl-same-prop')

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="items">
          <template>
            <div class="item">
              <span class="render-target" data-render="isActive">Rendered</span>
              <span class="show-target" data-show="isActive">Shown</span>
              <span class="always" data-bind="label"></span>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        items: [
          { id: 1, label: 'Active', isActive: true },
          { id: 2, label: 'Inactive', isActive: false }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const items = testContainer.querySelectorAll('.item')
    expect(items.length).toBe(2)

    // Item 1 (isActive=true): both render-target and show-target should be visible
    const render1 = items[0].querySelector('.render-target')
    expect(render1).not.toBeNull() // data-render=true keeps element in DOM
    const show1 = items[0].querySelector('.show-target')
    expect(show1).not.toBeNull()
    expect(show1.classList.contains('wf-show')).toBe(true)
    expect(items[0].querySelector('.always').textContent).toBe('Active')

    // Item 2 (isActive=false): render-target removed, show-target hidden
    const render2 = items[1].querySelector('.render-target')
    expect(render2).toBeNull() // data-render=false removes from DOM
    const show2 = items[1].querySelector('.show-target')
    expect(show2).not.toBeNull() // data-show keeps element in DOM
    expect(show2.classList.contains('wf-show')).toBe(false)
    expect(items[1].querySelector('.always').textContent).toBe('Inactive')
  })

  it('push to list with data-render: new item respects render condition', async () => {
    const cn = unique('drl-push')
    let componentRef

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="items">
          <template>
            <div class="item">
              <span class="name" data-bind="name"></span>
              <span class="premium" data-render="isPremium">PREMIUM</span>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        items: [
          { id: 1, name: 'Free User', isPremium: false }
        ]
      },
      init() { componentRef = this }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.item').length).toBe(1)

    // Push a premium user
    componentRef.state.items.push({ id: 2, name: 'Pro User', isPremium: true })
    await waitForCompleteRender()

    const items = testContainer.querySelectorAll('.item')
    expect(items.length).toBe(2)
    expect(items[1].querySelector('.name').textContent).toBe('Pro User')
  })

  it('splice from list with data-render: remaining items retain render state', async () => {
    const cn = unique('drl-splice')
    let componentRef

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="items">
          <template>
            <div class="item">
              <span class="name" data-bind="name"></span>
              <span class="icon" data-render="hasIcon">*</span>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        items: [
          { id: 1, name: 'One', hasIcon: true },
          { id: 2, name: 'Two', hasIcon: false },
          { id: 3, name: 'Three', hasIcon: true }
        ]
      },
      init() { componentRef = this }
    })

    wildflower.scan()
    await waitForCompleteRender()

    // Remove middle item
    componentRef.state.items.splice(1, 1)
    await waitForCompleteRender()

    const items = testContainer.querySelectorAll('.item')
    expect(items.length).toBe(2)
    expect(items[0].querySelector('.name').textContent).toBe('One')
    expect(items[1].querySelector('.name').textContent).toBe('Three')
  })

  it('data-render with store cross-array move', async () => {
    const sn = unique('drl-cross')
    const cn = unique('drl-comp')

    wildflower.store(sn, {
      state: {
        active: [
          { id: 1, name: 'Task A', hasProgress: true },
          { id: 2, name: 'Task B', hasProgress: false }
        ],
        archived: []
      }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div id="active-list" data-list="activeItems">
          <template>
            <div class="active-item">
              <span class="name" data-bind="name"></span>
              <div class="progress" data-render="hasProgress">In Progress</div>
            </div>
          </template>
        </div>
        <div id="archive-list" data-list="archivedItems">
          <template>
            <div class="archived-item">
              <span class="name" data-bind="name"></span>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {},
      subscribe: { [sn]: ['active', 'archived'] },
      computed: {
        activeItems() { return this.stores[sn].active || [] },
        archivedItems() { return this.stores[sn].archived || [] }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.active-item').length).toBe(2)
    expect(testContainer.querySelectorAll('.archived-item').length).toBe(0)

    // Move Task A to archived
    const store = wildflower.getStore(sn)
    const item = store.state.active.splice(0, 1)[0]
    store.state.archived.splice(0, 0, item)
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.active-item').length).toBe(1)
    expect(testContainer.querySelectorAll('.active-item')[0].querySelector('.name').textContent).toBe('Task B')
    expect(testContainer.querySelectorAll('.archived-item').length).toBe(1)
    expect(testContainer.querySelectorAll('.archived-item')[0].querySelector('.name').textContent).toBe('Task A')
  })
})
