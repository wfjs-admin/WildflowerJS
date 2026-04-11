/**
 * Regression test: data-action inside data-render fires twice
 *
 * Root cause: ContextManager._processActionElement (data-render insertion path)
 * added event listeners without checking boundActionsCache. Later,
 * _executeHtmlBindForEffect's setTimeout called _bindComponentActions which
 * DID check boundActionsCache but found no entry — so it added a second listener.
 *
 * Fix: Added boundActionsCache guard to _processActionElement.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, isMinifiedBuild } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('data-render + data-action duplicate listener bug', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower

    if (wildflower.componentDefinitions) wildflower.componentDefinitions.clear()
    if (wildflower.componentInstances) wildflower.componentInstances.clear()
    if (wildflower.storeManager && wildflower.storeManager._namedStores) {
      wildflower.storeManager._namedStores.clear()
    }
    if (wildflower._templateCache) {
      if (wildflower._templateCache.general) wildflower._templateCache.general.clear()
      if (wildflower._templateCache.lists) wildflower._templateCache.lists.clear()
      if (wildflower._templateCache.compiled) wildflower._templateCache.compiled.clear()
      if (wildflower._templateCache.extracted) wildflower._templateCache.extracted.clear()
      if (wildflower._templateCache.fragmentPools) wildflower._templateCache.fragmentPools.clear()
      if (wildflower._templateCache.stats) wildflower._templateCache.stats.clear()
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

  it.skipIf(isMinifiedBuild())('action inside data-render + data-bind-html should fire exactly once per click', async () => {
    // The "Hammurabi bug": data-render inserts DOM with data-action button,
    // then data-bind-html update triggers _bindComponentActions via setTimeout,
    // which added a SECOND listener because _processActionElement didn't use boundActionsCache.

    testContainer.innerHTML = `
      <div data-component="render-action-test">
        <div data-render="showIntro">
          <button id="start-btn" data-action="startGame">Start</button>
        </div>
        <div data-render="showGame">
          <div data-show="inputVisible">
            <button id="submit-btn" data-action="handleSubmit">Submit</button>
          </div>
          <div data-bind-html="report"></div>
          <div data-bind="turn"></div>
        </div>
      </div>
    `

    let fireCount = 0

    wildflower.component('render-action-test', {
      state: {
        phase: 'intro',
        inputVisible: false,
        turn: 1,
        report: ''
      },
      computed: {
        showIntro() { return this.phase === 'intro'; },
        showGame() { return this.phase === 'playing'; }
      },
      startGame() {
        this.state.phase = 'playing'
        this.state.inputVisible = true
        this.state.report = '<div>Game started</div>'
      },
      handleSubmit() {
        fireCount++
        this.state.inputVisible = false
        this.state.report = '<div>Turn ' + this.state.turn + ' done</div>'
        this.state.turn++
        this.state.inputVisible = true
      }
    })

    wildflower.scan()
    await waitForUpdate(100)

    // Click Start to trigger data-render transition (intro → game)
    const startBtn = document.getElementById('start-btn')
    expect(startBtn).toBeTruthy()
    startBtn.click()
    await waitForUpdate(200)

    // Now the game DOM is rendered via data-render
    const submitBtn = document.getElementById('submit-btn')
    expect(submitBtn).toBeTruthy()

    // Play turn 1 — this triggers data-bind-html update
    fireCount = 0
    submitBtn.click()
    await waitForUpdate(200)

    expect(fireCount).toBe(1)
    expect(wildflower.getComponent('render-action-test').turn).toBe(2)

    // Play turn 2 — the bug would cause double-fire here
    fireCount = 0
    submitBtn.click()
    await waitForUpdate(200)

    expect(fireCount).toBe(1)
    expect(wildflower.getComponent('render-action-test').turn).toBe(3)
  })

  it.skipIf(isMinifiedBuild())('5 consecutive clicks should each fire exactly once', async () => {
    testContainer.innerHTML = `
      <div data-component="multi-render-test">
        <div data-render="showIntro">
          <button id="start-btn-multi" data-action="startGame">Start</button>
        </div>
        <div data-render="showGame">
          <div data-show="inputVisible">
            <button id="submit-btn-multi" data-action="handleSubmit">Submit</button>
          </div>
          <div data-bind-html="report"></div>
        </div>
      </div>
    `

    const fireCounts = []

    wildflower.component('multi-render-test', {
      state: {
        phase: 'intro',
        inputVisible: false,
        turn: 1,
        report: ''
      },
      computed: {
        showIntro() { return this.phase === 'intro'; },
        showGame() { return this.phase === 'playing'; }
      },
      startGame() {
        this.state.phase = 'playing'
        this.state.inputVisible = true
        this.state.report = '<div>Started</div>'
      },
      handleSubmit() {
        fireCounts.push(this.state.turn)
        this.state.inputVisible = false
        this.state.report = '<div>Turn ' + this.state.turn + '</div>'
        this.state.turn++
        this.state.inputVisible = true
      }
    })

    wildflower.scan()
    await waitForUpdate(100)

    document.getElementById('start-btn-multi').click()
    await waitForUpdate(200)

    const btn = document.getElementById('submit-btn-multi')

    for (let i = 0; i < 5; i++) {
      btn.click()
      await waitForUpdate(200)
    }

    // Each click should fire exactly once, advancing turns 1→5
    expect(fireCounts).toEqual([1, 2, 3, 4, 5])
  })
})
