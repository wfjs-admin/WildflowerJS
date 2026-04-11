/**
 * Data-Render Interaction Tests
 *
 * Tests for data-render combined with other data attributes that were
 * identified as coverage gaps. data-render removes/adds elements from the DOM,
 * so all bindings, models, and features inside must be properly
 * established on reveal and cleaned up on hide.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js'

async function waitForUpdate(ms = 100) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

function ensureComponentScanning(wildflower) {
  if (wildflower._setupDynamicComponentDetection) {
    wildflower._setupDynamicComponentDetection()
  }
}

describe('Data-Render Interactions', () => {
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

  // =========================================================================
  // 1. data-render + data-bind-attr
  // =========================================================================
  describe('data-render + data-bind-attr', () => {

    it('attribute bindings apply when data-render reveals element', async () => {
      testContainer.innerHTML = `
        <div data-component="dr-attr-reveal">
          <div data-render="visible">
            <img id="test-img" data-bind-attr="{ src: imgSrc, alt: imgAlt }">
          </div>
        </div>
      `
      wildflower.component('dr-attr-reveal', {
        state: { visible: false, imgSrc: 'photo.jpg', imgAlt: 'A photo' }
      })
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      // Not in DOM
      expect(testContainer.querySelector('#test-img')).toBeNull()

      // Reveal
      wildflower.getComponent('dr-attr-reveal').visible = true
      await waitForUpdate()

      const img = testContainer.querySelector('#test-img')
      expect(img).not.toBeNull()
      expect(img.getAttribute('src')).toBe('photo.jpg')
      expect(img.getAttribute('alt')).toBe('A photo')
    })

    it('attribute bindings update reactively after reveal', async () => {
      testContainer.innerHTML = `
        <div data-component="dr-attr-reactive">
          <div data-render="visible">
            <img id="test-img2" data-bind-attr="{ src: imgSrc }">
          </div>
        </div>
      `
      wildflower.component('dr-attr-reactive', {
        state: { visible: true, imgSrc: 'initial.jpg' }
      })
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(testContainer.querySelector('#test-img2').getAttribute('src')).toBe('initial.jpg')

      wildflower.getComponent('dr-attr-reactive').imgSrc = 'updated.jpg'
      await waitForUpdate()

      expect(testContainer.querySelector('#test-img2').getAttribute('src')).toBe('updated.jpg')
    })

    it('attribute bindings re-establish after hide and reveal', async () => {
      testContainer.innerHTML = `
        <div data-component="dr-attr-reestablish">
          <div data-render="visible">
            <a id="test-link" data-bind-attr="{ href: url }">Link</a>
          </div>
        </div>
      `
      wildflower.component('dr-attr-reestablish', {
        state: { visible: true, url: '/page-1' }
      })
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(testContainer.querySelector('#test-link').getAttribute('href')).toBe('/page-1')

      // Hide
      const comp = wildflower.getComponent('dr-attr-reestablish')
      comp.visible = false
      await waitForUpdate()
      expect(testContainer.querySelector('#test-link')).toBeNull()

      // Change while hidden
      comp.url = '/page-2'
      await waitForUpdate()

      // Reveal — should show updated value
      comp.visible = true
      await waitForUpdate()

      expect(testContainer.querySelector('#test-link').getAttribute('href')).toBe('/page-2')
    })

    it('boolean attributes (disabled) work inside data-render', async () => {
      testContainer.innerHTML = `
        <div data-component="dr-attr-bool">
          <div data-render="showForm">
            <button id="test-btn" data-bind-attr="{ disabled: isDisabled }">Submit</button>
          </div>
        </div>
      `
      wildflower.component('dr-attr-bool', {
        state: { showForm: true, isDisabled: true }
      })
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const btn = testContainer.querySelector('#test-btn')
      expect(btn.hasAttribute('disabled')).toBe(true)

      wildflower.getComponent('dr-attr-bool').isDisabled = false
      await waitForUpdate()

      expect(btn.hasAttribute('disabled')).toBe(false)
    })
  })

  // =========================================================================
  // 2. data-render + data-model
  // =========================================================================
  describe('data-render + data-model', () => {

    it('model binding establishes on reveal', async () => {
      testContainer.innerHTML = `
        <div data-component="dr-model-reveal">
          <div data-render="showInput">
            <input id="test-input" type="text" data-model="username">
          </div>
        </div>
      `
      wildflower.component('dr-model-reveal', {
        state: { showInput: false, username: 'alice' }
      })
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(testContainer.querySelector('#test-input')).toBeNull()

      wildflower.getComponent('dr-model-reveal').showInput = true
      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      expect(input).not.toBeNull()
      expect(input.value).toBe('alice')
    })

    it('model two-way binding works after reveal', async () => {
      testContainer.innerHTML = `
        <div data-component="dr-model-twoway">
          <div data-render="showInput">
            <input id="test-input2" type="text" data-model="username">
          </div>
          <span id="display" data-bind="username"></span>
        </div>
      `
      wildflower.component('dr-model-twoway', {
        state: { showInput: true, username: 'bob' }
      })
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const input = testContainer.querySelector('#test-input2')
      expect(input.value).toBe('bob')

      // Simulate user typing
      input.value = 'charlie'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()

      expect(wildflower.getComponent('dr-model-twoway').username).toBe('charlie')
    })

    it('model re-establishes with current state after toggle', async () => {
      testContainer.innerHTML = `
        <div data-component="dr-model-toggle">
          <div data-render="showInput">
            <input id="test-input3" type="text" data-model="name">
          </div>
        </div>
      `
      wildflower.component('dr-model-toggle', {
        state: { showInput: true, name: 'initial' }
      })
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      expect(testContainer.querySelector('#test-input3').value).toBe('initial')

      const comp = wildflower.getComponent('dr-model-toggle')
      comp.showInput = false
      await waitForUpdate()

      comp.name = 'changed'
      await waitForUpdate()

      expect(comp.name).toBe('changed')

      comp.showInput = true
      await waitForUpdate()

      expect(testContainer.querySelector('#test-input3').value).toBe('changed')
    })

    it('checkbox model works inside data-render', async () => {
      testContainer.innerHTML = `
        <div data-component="dr-model-checkbox">
          <div data-render="showOptions">
            <input id="test-check" type="checkbox" data-model="agreed">
          </div>
        </div>
      `
      wildflower.component('dr-model-checkbox', {
        state: { showOptions: false, agreed: true }
      })
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      wildflower.getComponent('dr-model-checkbox').showOptions = true
      await waitForUpdate()

      const checkbox = testContainer.querySelector('#test-check')
      expect(checkbox).not.toBeNull()
      expect(checkbox.checked).toBe(true)
    })

    it('select model works inside data-render', async () => {
      testContainer.innerHTML = `
        <div data-component="dr-model-select">
          <div data-render="showPicker">
            <select id="test-select" data-model="color">
              <option value="red">Red</option>
              <option value="blue">Blue</option>
              <option value="green">Green</option>
            </select>
          </div>
        </div>
      `
      wildflower.component('dr-model-select', {
        state: { showPicker: false, color: 'blue' }
      })
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      wildflower.getComponent('dr-model-select').showPicker = true
      await waitForUpdate()

      const select = testContainer.querySelector('#test-select')
      expect(select).not.toBeNull()
      expect(select.value).toBe('blue')
    })
  })

  // =========================================================================
  // 3. data-render + data-pool
  // =========================================================================
  describe('data-render + data-pool', () => {

    afterEach(() => {
      if (wildflower._poolLoopRunning) {
        wildflower._poolLoopRunning = false
        if (wildflower._poolLoopId) {
          cancelAnimationFrame(wildflower._poolLoopId)
          wildflower._poolLoopId = null
        }
      }
    })

    it('pool is accessible even when data-render starts false', async () => {
      // Pools are initialized during component setup regardless of
      // data-render state — the pool container is scanned before
      // data-render removes it from the DOM.
      testContainer.innerHTML = `
        <div data-component="dr-pool-reveal">
          <div data-render="showPool">
            <div data-pool="sprites" data-key="id">
              <template><div class="sprite"><span data-bind="name"></span></div></template>
            </div>
          </div>
        </div>
      `
      wildflower.component('dr-pool-reveal', {
        state: { showPool: false }
      })
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = wildflower.getComponent('dr-pool-reveal')
      const pool = comp.pool('sprites')
      // Pool handle exists (setup happens before data-render removes element)
      expect(pool).not.toBeNull()
    })

    it('pool entities render when data-render reveals container', async () => {
      testContainer.innerHTML = `
        <div data-component="dr-pool-render">
          <div data-render="showPool">
            <div data-pool="sprites" data-key="id">
              <template><div class="sprite"><span data-bind="name"></span></div></template>
            </div>
          </div>
        </div>
      `
      wildflower.component('dr-pool-render', {
        state: { showPool: true }
      })
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = wildflower.getComponent('dr-pool-render')
      const pool = comp.pool('sprites')
      pool.add({ id: 1, name: 'Entity 1' })

      await new Promise(resolve => requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve())
      }))
      await new Promise(resolve => setTimeout(resolve, 10))

      const sprites = testContainer.querySelectorAll('.sprite')
      expect(sprites.length).toBe(1)
      expect(sprites[0].querySelector('span').textContent).toBe('Entity 1')
    })
  })

  // =========================================================================
  // 4. data-render + data-cloak
  // =========================================================================
  describe('data-render + data-cloak', () => {

    // KNOWN LIMITATION: data-cloak is NOT stripped for elements inside
    // data-render blocks because they aren't in the DOM during the initial
    // scan that strips data-cloak. The workaround is to not use data-cloak
    // inside data-render — data-render already prevents flash by removing
    // the element from the DOM entirely.
    // See commit e62f364 for context.
    it('content inside data-render does not flash before hide', async () => {
      testContainer.innerHTML = `
        <div data-component="dr-cloak-noflash">
          <div data-render="visible" data-cloak>
            <p id="noflash-content">Should not flash</p>
          </div>
        </div>
      `
      wildflower.component('dr-cloak-noflash', {
        state: { visible: false }
      })
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      // Element should not be in DOM when condition is false
      expect(testContainer.querySelector('#noflash-content')).toBeNull()
    })
  })

  // =========================================================================
  // 5. data-render + watch
  // =========================================================================
  describe('data-render + watch', () => {

    it('watcher fires when data-render condition changes', async () => {
      let watchCalls = []
      testContainer.innerHTML = `
        <div data-component="dr-watch-fire">
          <div data-render="panelOpen">
            <p>Panel content</p>
          </div>
        </div>
      `
      wildflower.component('dr-watch-fire', {
        state: { panelOpen: false },
        watch: {
          panelOpen(newVal) {
            watchCalls.push(newVal)
          }
        }
      })
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      wildflower.getComponent('dr-watch-fire').panelOpen = true
      await waitForUpdate()

      expect(watchCalls).toContain(true)
    })

    it('watcher on property inside data-render block fires after reveal', async () => {
      let watchCalls = []
      testContainer.innerHTML = `
        <div data-component="dr-watch-inner">
          <div data-render="visible">
            <span data-bind="count"></span>
          </div>
        </div>
      `
      wildflower.component('dr-watch-inner', {
        state: { visible: true, count: 0 },
        watch: {
          count(newVal) {
            watchCalls.push(newVal)
          }
        }
      })
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      wildflower.getComponent('dr-watch-inner').count = 5
      await waitForUpdate()

      expect(watchCalls).toContain(5)
    })
  })

  // =========================================================================
  // 6. data-render rapid toggling stress
  // =========================================================================
  describe('data-render rapid toggling', () => {

    it('survives 50 rapid toggles without errors', async () => {
      testContainer.innerHTML = `
        <div data-component="dr-rapid-50">
          <div data-render="visible">
            <span id="rapid-content" data-bind="label"></span>
          </div>
        </div>
      `
      wildflower.component('dr-rapid-50', {
        state: { visible: false, label: 'Hello' }
      })
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = wildflower.getComponent('dr-rapid-50')
      // Toggle 50 times synchronously
      for (let i = 0; i < 50; i++) {
        comp.visible = !comp.visible
      }
      // After 50 toggles (even number), visible = false
      await waitForUpdate()

      expect(testContainer.querySelector('#rapid-content')).toBeNull()
    })

    it('survives 51 rapid toggles ending visible', async () => {
      testContainer.innerHTML = `
        <div data-component="dr-rapid-51">
          <div data-render="visible">
            <span id="rapid-content2" data-bind="label"></span>
          </div>
        </div>
      `
      wildflower.component('dr-rapid-51', {
        state: { visible: false, label: 'World' }
      })
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = wildflower.getComponent('dr-rapid-51')
      // Toggle 51 times (odd number), visible = true
      for (let i = 0; i < 51; i++) {
        comp.visible = !comp.visible
      }
      await waitForUpdate()

      const el = testContainer.querySelector('#rapid-content2')
      expect(el).not.toBeNull()
      expect(el.textContent).toBe('World')
    })

    it('no duplicate action handlers after rapid toggles', async () => {
      let clickCount = 0
      testContainer.innerHTML = `
        <div data-component="dr-rapid-actions">
          <div data-render="visible">
            <button id="rapid-btn" data-action="handleClick">Click</button>
          </div>
        </div>
      `
      wildflower.component('dr-rapid-actions', {
        state: { visible: false },
        handleClick() { clickCount++ }
      })
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = wildflower.getComponent('dr-rapid-actions')
      // Toggle 20 times, end visible
      for (let i = 0; i < 21; i++) {
        comp.visible = !comp.visible
      }
      await waitForUpdate()

      const btn = testContainer.querySelector('#rapid-btn')
      expect(btn).not.toBeNull()
      btn.click()
      await waitForUpdate()

      expect(clickCount).toBe(1)
    })
  })

  // =========================================================================
  // 7. data-render + data-show on same element
  // =========================================================================
  describe('data-render + data-show interaction', () => {

    it('data-render and data-show on different elements with same condition', async () => {
      testContainer.innerHTML = `
        <div data-component="dr-show-same">
          <div data-render="active">
            <p id="rendered">Rendered</p>
          </div>
          <div data-show="active">
            <p id="shown">Shown</p>
          </div>
        </div>
      `
      wildflower.component('dr-show-same', {
        state: { active: false }
      })
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      // data-render: removed from DOM
      expect(testContainer.querySelector('#rendered')).toBeNull()
      // data-show: hidden but in DOM
      const shown = testContainer.querySelector('#shown')
      expect(shown).not.toBeNull()

      // Toggle on
      wildflower.getComponent('dr-show-same').active = true
      await waitForUpdate()

      expect(testContainer.querySelector('#rendered')).not.toBeNull()
      expect(testContainer.querySelector('#shown').parentElement.style.display).not.toBe('none')
    })

    it('data-show inside data-render works after reveal', async () => {
      testContainer.innerHTML = `
        <div data-component="dr-show-nested">
          <div data-render="panelOpen">
            <p id="always-text">Always visible in panel</p>
            <p id="conditional-text" data-show="showExtra">Extra info</p>
          </div>
        </div>
      `
      wildflower.component('dr-show-nested', {
        state: { panelOpen: false, showExtra: false }
      })
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const comp = wildflower.getComponent('dr-show-nested')
      comp.panelOpen = true
      await waitForUpdate()

      expect(testContainer.querySelector('#always-text')).not.toBeNull()
      const extra = testContainer.querySelector('#conditional-text')
      expect(extra).not.toBeNull()
      expect(extra.style.display).toBe('none')

      // Toggle data-show
      comp.showExtra = true
      await waitForUpdate()

      expect(testContainer.querySelector('#conditional-text').style.display).not.toBe('none')
    })
  })

  // =========================================================================
  // 8. data-render with multiple binding types on same element
  // =========================================================================
  describe('data-render with combined bindings', () => {

    it('element with data-bind + data-bind-class + data-bind-style inside data-render', async () => {
      testContainer.innerHTML = `
        <div data-component="dr-combined">
          <div data-render="visible">
            <span id="multi-bind"
              data-bind="label"
              data-bind-class="className"
              data-bind-style="{ color: textColor }">
            </span>
          </div>
        </div>
      `
      wildflower.component('dr-combined', {
        state: { visible: false, label: 'Hello', className: 'badge', textColor: 'red' }
      })
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      wildflower.getComponent('dr-combined').visible = true
      await waitForUpdate()

      const el = testContainer.querySelector('#multi-bind')
      expect(el).not.toBeNull()
      expect(el.textContent).toBe('Hello')
      expect(el.classList.contains('badge')).toBe(true)
      expect(el.style.color).toBe('red')
    })

    it('all bindings update reactively after data-render reveal', async () => {
      testContainer.innerHTML = `
        <div data-component="dr-combined-reactive">
          <div data-render="visible">
            <div id="multi-reactive"
              data-bind="text"
              data-bind-class="cls"
              data-bind-style="{ fontSize: size }"
              data-bind-attr="{ title: tip }">
            </div>
          </div>
        </div>
      `
      wildflower.component('dr-combined-reactive', {
        state: { visible: true, text: 'A', cls: 'old', size: '12px', tip: 'tooltip1' }
      })
      ensureComponentScanning(wildflower)
      await waitForUpdate()

      const el = testContainer.querySelector('#multi-reactive')
      expect(el.textContent).toBe('A')

      const comp = wildflower.getComponent('dr-combined-reactive')
      comp.text = 'B'
      comp.cls = 'new'
      comp.size = '20px'
      comp.tip = 'tooltip2'
      await waitForUpdate()

      expect(el.textContent).toBe('B')
      expect(el.classList.contains('new')).toBe(true)
      expect(el.style.fontSize).toBe('20px')
      expect(el.getAttribute('title')).toBe('tooltip2')
    })
  })
})
