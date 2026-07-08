/**
 * data-show with a string state field that transitions from '' to a
 * non-empty value should toggle visibility, and a paired data-bind on
 * the same element should update its textContent.
 *
 * Repro of behavior observed in the docs Modals page demo: a
 * status-message span with `data-show="msg" data-bind="msg"` stayed
 * hidden after `closeDialog()` set `state.msg = 'Dialog closed'`.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('data-show with string state transition', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    if (wildflower.componentDefinitions) wildflower.componentDefinitions.clear()
    if (wildflower.componentInstances) wildflower.componentInstances.clear()
    if (wildflower.storeManager?._namedStores) wildflower.storeManager._namedStores.clear()
    if (wildflower._templateCache) {
      for (const k of Object.keys(wildflower._templateCache)) {
        wildflower._templateCache[k]?.clear?.()
      }
    }
    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer?.parentNode) testContainer.parentNode.removeChild(testContainer)
  })

  it('empty string -> non-empty: span becomes visible AND text updates', async () => {
    testContainer.innerHTML = `
      <div data-component="show-bind-string">
        <span id="target" data-show="message" data-bind="message"></span>
        <button id="trigger" data-action="setMsg"></button>
      </div>
    `

    wildflower.component('show-bind-string', {
      state: { message: '' },
      setMsg() { this.state.message = 'Hello'; }
    })

    await waitForUpdate()

    const target = testContainer.querySelector('#target')
    const trigger = testContainer.querySelector('#trigger')

    // Initial: empty string is falsy, span hidden, text empty
    expect(target.style.display).toBe('none')
    expect(target.textContent).toBe('')

    trigger.click()
    await waitForUpdate()

    // After mutation: span visible, text rendered
    expect(target.style.display).not.toBe('none')
    expect(target.textContent).toBe('Hello')
  })

  it('span between button and a portaled-style sibling still updates (closeDialog repro)', async () => {
    // The exact shape from www/pages/docs/modals.html: a status span
    // sits between the opening button and the scrim div. The scrim has
    // data-show on it too. closeDialog mutates three fields in a row.
    testContainer.innerHTML = `
      <div data-component="share-doc-repro">
        <button id="open-btn" data-action="openDialog">Open</button>
        <span id="status" data-show="lastAction" data-bind="lastAction"></span>
        <div class="scrim" data-show="open" data-action="closeDialog" data-event-self>
          <div class="dialog">
            <input data-bind="shareUrl" readonly>
            <button id="close-btn" data-action="closeDialog">Close</button>
          </div>
        </div>
      </div>
    `

    wildflower.component('share-doc-repro', {
      state: { open: false, shareUrl: '', copied: false, lastAction: '' },
      openDialog() {
        this.state.shareUrl = 'https://example.com/x';
        this.state.open = true;
      },
      closeDialog() {
        this.state.open = false;
        this.state.copied = false;
        this.state.lastAction = 'Dialog closed';
      }
    })

    await waitForUpdate()

    const status = testContainer.querySelector('#status')
    expect(status.style.display).toBe('none')

    // Open then close, exactly like the demo
    testContainer.querySelector('#open-btn').click()
    await waitForUpdate()
    testContainer.querySelector('#close-btn').click()
    await waitForUpdate()

    expect(status.textContent).toBe('Dialog closed')
    expect(status.style.display).not.toBe('none')
  })

  it('demo scanned inside another component (codeExample shape) still updates the span', async () => {
    // codeExample is itself a component. It injects demo HTML into
    // .preview-content (a descendant of its element) and calls
    // wildflower.scan(previewContent). This puts the demo in a nested
    // component scope. Verify the data-show + data-bind span still
    // reacts when the demo's state mutates.
    testContainer.innerHTML = `
      <div data-component="outer-wrapper">
        <div class="preview-content"></div>
      </div>
    `

    wildflower.component('outer-wrapper', {
      state: {},
    })

    await waitForUpdate()

    const previewContent = testContainer.querySelector('.preview-content')
    previewContent.innerHTML = `
      <div data-component="demo-inside">
        <button id="open-btn" data-action="openDialog">Open</button>
        <span id="status" data-show="lastAction" data-bind="lastAction"></span>
        <div class="scrim" data-show="open" data-action="closeDialog" data-event-self>
          <button id="close-btn" data-action="closeDialog">Close</button>
        </div>
      </div>
    `

    wildflower.component('demo-inside', {
      state: { open: false, copied: false, lastAction: '' },
      openDialog() { this.state.open = true; },
      closeDialog() {
        this.state.open = false;
        this.state.copied = false;
        this.state.lastAction = 'Dialog closed';
      },
    })

    // Mirror codeExample's invocation
    wildflower.scan(previewContent)
    await waitForUpdate()

    const status = previewContent.querySelector('#status')
    expect(status).toBeTruthy()
    expect(status.style.display).toBe('none')

    previewContent.querySelector('#open-btn').click()
    await waitForUpdate()
    previewContent.querySelector('#close-btn').click()
    await waitForUpdate()

    expect(status.textContent).toBe('Dialog closed')
    expect(status.style.display).not.toBe('none')
  })

  it('three sequential state mutations in one method propagate all three', async () => {
    // Mirrors closeDialog() in the modal docs demo:
    //   this.state.open = false; this.state.copied = false;
    //   this.state.lastAction = 'Dialog closed';
    testContainer.innerHTML = `
      <div data-component="triple-mutate">
        <span id="open-flag"   data-bind="open"></span>
        <span id="copied-flag" data-bind="copied"></span>
        <span id="action-text" data-show="lastAction" data-bind="lastAction"></span>
        <button id="trigger" data-action="closeIt"></button>
      </div>
    `

    wildflower.component('triple-mutate', {
      state: { open: true, copied: true, lastAction: '' },
      closeIt() {
        this.state.open = false;
        this.state.copied = false;
        this.state.lastAction = 'Dialog closed';
      }
    })

    await waitForUpdate()

    const actionText = testContainer.querySelector('#action-text')
    // Initial: lastAction is '', span hidden, no text
    expect(actionText.style.display).toBe('none')

    testContainer.querySelector('#trigger').click()
    await waitForUpdate()

    expect(testContainer.querySelector('#open-flag').textContent).toBe('false')
    expect(testContainer.querySelector('#copied-flag').textContent).toBe('false')
    expect(actionText.style.display).not.toBe('none')
    expect(actionText.textContent).toBe('Dialog closed')
  })
})
