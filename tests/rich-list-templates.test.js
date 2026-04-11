/**
 * Rich List Templates Test Suite
 *
 * List templates with multiple binding types on the same elements. Tests that
 * all binding processors correctly respect list scope boundaries and that
 * reactive updates propagate through all binding types on each list item.
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

describe('Rich List Templates', () => {
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

  it('data-bind + data-bind-class on same element in list template', async () => {
    const cn = unique('rlt-bind-class')

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="items">
          <template>
            <span class="item" data-bind="label" data-bind-class="({ 'highlighted': isHighlighted })"></span>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        items: [
          { id: 1, label: 'First', isHighlighted: true },
          { id: 2, label: 'Second', isHighlighted: false },
          { id: 3, label: 'Third', isHighlighted: true }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const items = testContainer.querySelectorAll('.item')
    expect(items.length).toBe(3)
    expect(items[0].textContent).toBe('First')
    expect(items[0].classList.contains('highlighted')).toBe(true)
    expect(items[1].textContent).toBe('Second')
    expect(items[1].classList.contains('highlighted')).toBe(false)
    expect(items[2].textContent).toBe('Third')
    expect(items[2].classList.contains('highlighted')).toBe(true)
  })

  it('data-bind + data-show on same element in list template', async () => {
    const cn = unique('rlt-bind-show')

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="messages">
          <template>
            <div class="msg" data-show="visible">
              <span class="msg-text" data-bind="text"></span>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        messages: [
          { id: 1, text: 'Hello', visible: true },
          { id: 2, text: 'Hidden', visible: false },
          { id: 3, text: 'World', visible: true }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const msgs = testContainer.querySelectorAll('.msg')
    expect(msgs.length).toBe(3)
    expect(msgs[0].classList.contains('wf-show')).toBe(true)
    expect(msgs[0].querySelector('.msg-text').textContent).toBe('Hello')
    expect(msgs[1].classList.contains('wf-show')).toBe(false)
    expect(msgs[2].classList.contains('wf-show')).toBe(true)
  })

  it('data-bind + data-bind-style on same element in list template', async () => {
    const cn = unique('rlt-bind-style')

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="bars">
          <template>
            <div class="bar" data-bind-style="({ width: width })">
              <span class="bar-label" data-bind="label"></span>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        bars: [
          { id: 1, label: 'Bar A', width: '50%' },
          { id: 2, label: 'Bar B', width: '75%' }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const bars = testContainer.querySelectorAll('.bar')
    expect(bars.length).toBe(2)
    expect(bars[0].querySelector('.bar-label').textContent).toBe('Bar A')
    expect(bars[0].style.width).toBe('50%')
    expect(bars[1].querySelector('.bar-label').textContent).toBe('Bar B')
    expect(bars[1].style.width).toBe('75%')
  })

  it('data-bind + data-bind-attr on same element in list template', async () => {
    const cn = unique('rlt-bind-attr')

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="links">
          <template>
            <a class="link" data-bind="label" data-bind-attr="({ href: url, title: tooltip })"></a>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        links: [
          { id: 1, label: 'Google', url: 'https://google.com', tooltip: 'Search engine' },
          { id: 2, label: 'GitHub', url: 'https://github.com', tooltip: 'Code hosting' }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const anchors = testContainer.querySelectorAll('.link')
    expect(anchors.length).toBe(2)
    expect(anchors[0].textContent).toBe('Google')
    expect(anchors[0].getAttribute('href')).toBe('https://google.com')
    expect(anchors[0].getAttribute('title')).toBe('Search engine')
    expect(anchors[1].textContent).toBe('GitHub')
    expect(anchors[1].getAttribute('href')).toBe('https://github.com')
  })

  it('data-bind-html in list template', async () => {
    const cn = unique('rlt-html')

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="entries">
          <template>
            <div class="entry" data-bind-html="content"></div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        entries: [
          { id: 1, content: '<strong>Bold</strong> text' },
          { id: 2, content: '<em>Italic</em> text' }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const entries = testContainer.querySelectorAll('.entry')
    expect(entries.length).toBe(2)
    expect(entries[0].querySelector('strong')).not.toBeNull()
    expect(entries[0].querySelector('strong').textContent).toBe('Bold')
    expect(entries[1].querySelector('em')).not.toBeNull()
  })

  it('data-model (input) in list template binds to item, not component', async () => {
    const cn = unique('rlt-model')
    let componentRef

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="fields">
          <template>
            <div class="field">
              <input class="field-input" type="text" data-model="value" />
              <span class="field-display" data-bind="value"></span>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        fields: [
          { id: 1, value: 'alpha' },
          { id: 2, value: 'beta' }
        ]
      },
      init() { componentRef = this }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const inputs = testContainer.querySelectorAll('.field-input')
    expect(inputs.length).toBe(2)
    expect(inputs[0].value).toBe('alpha')
    expect(inputs[1].value).toBe('beta')

    // Simulate typing in first input
    inputs[0].value = 'alpha-updated'
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
    await waitForCompleteRender()

    // The display should update and the second field should be unaffected
    const displays = testContainer.querySelectorAll('.field-display')
    expect(displays[0].textContent).toBe('alpha-updated')
    expect(displays[1].textContent).toBe('beta')
  })

  it('all binding types combined in one list template (kitchen sink)', async () => {
    const cn = unique('rlt-kitchen')

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="items">
          <template>
            <div class="kit-item"
                 data-bind-class="({ 'active': isActive })"
                 data-show="visible">
              <span class="kit-name" data-bind="name"></span>
              <span class="kit-badge" data-bind-style="({ color: badgeColor })">badge</span>
              <a class="kit-link" data-bind-attr="({ href: url })">link</a>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        items: [
          { id: 1, name: 'Item1', isActive: true, visible: true, badgeColor: 'red', url: '#one' },
          { id: 2, name: 'Item2', isActive: false, visible: false, badgeColor: 'blue', url: '#two' }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const items = testContainer.querySelectorAll('.kit-item')
    expect(items.length).toBe(2)

    // Item 1: active, visible
    expect(items[0].classList.contains('active')).toBe(true)
    expect(items[0].classList.contains('wf-show')).toBe(true)
    expect(items[0].querySelector('.kit-name').textContent).toBe('Item1')
    expect(items[0].querySelector('.kit-badge').style.color).toBe('red')
    expect(items[0].querySelector('.kit-link').getAttribute('href')).toBe('#one')

    // Item 2: not active, hidden
    expect(items[1].classList.contains('active')).toBe(false)
    expect(items[1].classList.contains('wf-show')).toBe(false)
    expect(items[1].querySelector('.kit-name').textContent).toBe('Item2')
  })

  it('mutate item property → all binding types on that item update', async () => {
    const cn = unique('rlt-mutate')
    let componentRef

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="items">
          <template>
            <div class="mut-item" data-show="enabled">
              <span class="mut-label" data-bind="label"
                    data-bind-class="({ 'bold': isBold })"></span>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        items: [
          { id: 1, label: 'Before', enabled: true, isBold: false }
        ]
      },
      init() { componentRef = this }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const label = testContainer.querySelector('.mut-label')
    expect(label.textContent).toBe('Before')
    expect(label.classList.contains('bold')).toBe(false)
    expect(testContainer.querySelector('.mut-item').classList.contains('wf-show')).toBe(true)

    // Mutate multiple properties
    componentRef.state.items[0].label = 'After'
    componentRef.state.items[0].isBold = true
    componentRef.state.items[0].enabled = false
    await waitForCompleteRender()

    expect(label.textContent).toBe('After')
    expect(label.classList.contains('bold')).toBe(true)
    expect(testContainer.querySelector('.mut-item').classList.contains('wf-show')).toBe(false)
  })

  it('list with data-action buttons → action receives correct item context', async () => {
    const cn = unique('rlt-action')
    let receivedDetails = null

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="tasks">
          <template>
            <div class="task-row">
              <span class="task-text" data-bind="text"></span>
              <button class="task-btn" data-action="onTaskClick">Click</button>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        tasks: [
          { id: 1, text: 'Task A' },
          { id: 2, text: 'Task B' },
          { id: 3, text: 'Task C' }
        ]
      },
      onTaskClick(event, element, details) {
        receivedDetails = details
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const buttons = testContainer.querySelectorAll('.task-btn')
    expect(buttons.length).toBe(3)

    // Click the second button
    buttons[1].click()
    await waitForUpdate()

    // The action should have received details with the second item's data
    expect(receivedDetails).not.toBeNull()
    expect(receivedDetails.item).toBeDefined()
    expect(receivedDetails.item.text).toBe('Task B')
  })

  it('nested elements with different binding types at different depths', async () => {
    const cn = unique('rlt-nested-depth')

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="cards">
          <template>
            <div class="card-outer" data-bind-class="({ 'card-active': isActive })">
              <div class="card-inner">
                <span class="card-title" data-bind="title"></span>
                <span class="card-desc" data-show="hasDesc">
                  <span class="desc-text" data-bind="description"></span>
                </span>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        cards: [
          { id: 1, title: 'Card 1', description: 'Desc 1', isActive: true, hasDesc: true },
          { id: 2, title: 'Card 2', description: 'Desc 2', isActive: false, hasDesc: false },
          { id: 3, title: 'Card 3', description: 'Desc 3', isActive: true, hasDesc: true }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const outers = testContainer.querySelectorAll('.card-outer')
    expect(outers.length).toBe(3)

    // Card 1: active class, description shown
    expect(outers[0].classList.contains('card-active')).toBe(true)
    expect(outers[0].querySelector('.card-title').textContent).toBe('Card 1')
    expect(outers[0].querySelector('.card-desc').classList.contains('wf-show')).toBe(true)
    expect(outers[0].querySelector('.desc-text').textContent).toBe('Desc 1')

    // Card 2: no active class, description hidden
    expect(outers[1].classList.contains('card-active')).toBe(false)
    expect(outers[1].querySelector('.card-title').textContent).toBe('Card 2')
    expect(outers[1].querySelector('.card-desc').classList.contains('wf-show')).toBe(false)

    // Card 3: active class, description shown
    expect(outers[2].classList.contains('card-active')).toBe(true)
    expect(outers[2].querySelector('.desc-text').textContent).toBe('Desc 3')
  })
})
