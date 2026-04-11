/**
 * WildflowerJS Keyboard Events Test Suite - Vitest Browser Mode
 *
 * Tests for keyboard event handling with data-event-key-* modifiers.
 * Part of the test suite gap analysis coverage expansion.
 *
 * NOTE: Some tests are skipped due to a discovered issue where _handleActionWithContext
 * does not check key modifiers. The key modifier check at line ~13973 in wildflowerJS.js
 * only runs when the context system is NOT initialized, but in normal operation with
 * context system enabled, _handleActionWithContext is called which bypasses the check.
 *
 * Positive tests (testing that the right key DOES trigger) pass because the handler is
 * called for all keys. Negative tests (testing that wrong keys DON'T trigger) fail.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to create keyboard events
function createKeyboardEvent(type, key, options = {}) {
  return new KeyboardEvent(type, {
    key: key,
    code: options.code || `Key${key.toUpperCase()}`,
    ctrlKey: options.ctrlKey || false,
    altKey: options.altKey || false,
    shiftKey: options.shiftKey || false,
    metaKey: options.metaKey || false,
    bubbles: true,
    cancelable: true
  })
}

describe('Keyboard Events', () => {
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

    // Clear template cache
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

  describe('Basic keyup/keydown events', () => {
    it('should handle keyup events', async () => {
      testContainer.innerHTML = `
        <div data-component="keyup-test">
          <input id="test-input" data-action="keyup:handleKeyUp" />
          <div id="key-display" data-bind="lastKey"></div>
        </div>
      `

      wildflower.component('keyup-test', {
        state: {
          lastKey: ''
        },
        handleKeyUp(event) {
          this.state.lastKey = event.key
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#key-display')

      expect(display.textContent).toBe('')

      // Dispatch keyup event
      input.dispatchEvent(createKeyboardEvent('keyup', 'a'))
      await waitForUpdate()

      expect(display.textContent).toBe('a')

      // Try another key
      input.dispatchEvent(createKeyboardEvent('keyup', 'Enter'))
      await waitForUpdate()

      expect(display.textContent).toBe('Enter')
    })

    it('should handle keydown events', async () => {
      testContainer.innerHTML = `
        <div data-component="keydown-test">
          <input id="test-input" data-action="keydown:handleKeyDown" />
          <div id="key-display" data-bind="lastKey"></div>
        </div>
      `

      wildflower.component('keydown-test', {
        state: {
          lastKey: ''
        },
        handleKeyDown(event) {
          this.state.lastKey = event.key
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#key-display')

      expect(display.textContent).toBe('')

      // Dispatch keydown event
      input.dispatchEvent(createKeyboardEvent('keydown', 'b'))
      await waitForUpdate()

      expect(display.textContent).toBe('b')
    })
  })

  describe('data-event-key-enter', () => {
    it('should trigger handler when Enter key is pressed', async () => {
      testContainer.innerHTML = `
        <div data-component="enter-key-test">
          <input id="test-input" data-action="keyup:submit" data-event-key-enter />
          <div id="submit-count" data-bind="submitCount"></div>
        </div>
      `

      wildflower.component('enter-key-test', {
        state: {
          submitCount: 0
        },
        submit() {
          this.state.submitCount++
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#submit-count')

      expect(display.textContent).toBe('0')

      // Press Enter - should trigger
      input.dispatchEvent(createKeyboardEvent('keyup', 'Enter'))
      await waitForUpdate()
      expect(display.textContent).toBe('1')

      // Press Enter again
      input.dispatchEvent(createKeyboardEvent('keyup', 'Enter'))
      await waitForUpdate()
      expect(display.textContent).toBe('2')
    })

    it('should NOT trigger on other keys', async () => {
      testContainer.innerHTML = `
        <div data-component="enter-only-test">
          <input id="test-input" data-action="keyup:submit" data-event-key-enter />
          <div id="submit-count" data-bind="submitCount"></div>
        </div>
      `

      wildflower.component('enter-only-test', {
        state: {
          submitCount: 0
        },
        submit() {
          this.state.submitCount++
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#submit-count')

      expect(display.textContent).toBe('0')

      // Press 'a' - should NOT trigger
      input.dispatchEvent(createKeyboardEvent('keyup', 'a'))
      await waitForUpdate()
      expect(display.textContent).toBe('0')

      // Press Tab - should NOT trigger
      input.dispatchEvent(createKeyboardEvent('keyup', 'Tab'))
      await waitForUpdate()
      expect(display.textContent).toBe('0')

      // Press Enter - should trigger
      input.dispatchEvent(createKeyboardEvent('keyup', 'Enter'))
      await waitForUpdate()
      expect(display.textContent).toBe('1')
    })
  })

  describe('data-event-key-escape', () => {
    it('should trigger handler when Escape key is pressed', async () => {
      testContainer.innerHTML = `
        <div data-component="escape-key-test">
          <input id="test-input" data-action="keyup:cancel" data-event-key-escape />
          <div id="cancel-count" data-bind="cancelCount"></div>
        </div>
      `

      wildflower.component('escape-key-test', {
        state: {
          cancelCount: 0
        },
        cancel() {
          this.state.cancelCount++
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#cancel-count')

      expect(display.textContent).toBe('0')

      // Press Escape - should trigger
      input.dispatchEvent(createKeyboardEvent('keyup', 'Escape'))
      await waitForUpdate()
      expect(display.textContent).toBe('1')
    })

    it('should also work with data-event-key-esc alias', async () => {
      testContainer.innerHTML = `
        <div data-component="esc-alias-test">
          <input id="test-input" data-action="keyup:cancel" data-event-key-esc />
          <div id="cancel-count" data-bind="cancelCount"></div>
        </div>
      `

      wildflower.component('esc-alias-test', {
        state: {
          cancelCount: 0
        },
        cancel() {
          this.state.cancelCount++
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#cancel-count')

      // Press Escape - should trigger with 'esc' alias
      input.dispatchEvent(createKeyboardEvent('keyup', 'Escape'))
      await waitForUpdate()
      expect(display.textContent).toBe('1')
    })
  })

  describe('data-event-key-tab', () => {
    it('should trigger handler when Tab key is pressed', async () => {
      testContainer.innerHTML = `
        <div data-component="tab-key-test">
          <input id="test-input" data-action="keydown:handleTab" data-event-key-tab />
          <div id="tab-count" data-bind="tabCount"></div>
        </div>
      `

      wildflower.component('tab-key-test', {
        state: {
          tabCount: 0
        },
        handleTab() {
          this.state.tabCount++
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#tab-count')

      expect(display.textContent).toBe('0')

      // Press Tab - should trigger
      input.dispatchEvent(createKeyboardEvent('keydown', 'Tab'))
      await waitForUpdate()
      expect(display.textContent).toBe('1')
    })
  })

  describe('data-event-key-space', () => {
    it('should trigger handler when Space key is pressed', async () => {
      testContainer.innerHTML = `
        <div data-component="space-key-test">
          <button id="test-button" data-action="keydown:handleSpace" data-event-key-space>
            Press Space
          </button>
          <div id="space-count" data-bind="spaceCount"></div>
        </div>
      `

      wildflower.component('space-key-test', {
        state: {
          spaceCount: 0
        },
        handleSpace() {
          this.state.spaceCount++
        }
      })

      await waitForUpdate()

      const button = testContainer.querySelector('#test-button')
      const display = testContainer.querySelector('#space-count')

      expect(display.textContent).toBe('0')

      // Press Space - should trigger
      button.dispatchEvent(createKeyboardEvent('keydown', ' '))
      await waitForUpdate()
      expect(display.textContent).toBe('1')
    })
  })

  describe('Arrow key modifiers', () => {
    it('should handle arrow up/down/left/right', async () => {
      testContainer.innerHTML = `
        <div data-component="arrow-key-test">
          <input id="up-input" data-action="keydown:moveUp" data-event-key-up style="display:none" />
          <input id="down-input" data-action="keydown:moveDown" data-event-key-down style="display:none" />
          <input id="left-input" data-action="keydown:moveLeft" data-event-key-left style="display:none" />
          <input id="right-input" data-action="keydown:moveRight" data-event-key-right style="display:none" />
          <div id="direction" data-bind="direction"></div>
        </div>
      `

      wildflower.component('arrow-key-test', {
        state: {
          direction: 'none'
        },
        moveUp() {
          this.state.direction = 'up'
        },
        moveDown() {
          this.state.direction = 'down'
        },
        moveLeft() {
          this.state.direction = 'left'
        },
        moveRight() {
          this.state.direction = 'right'
        }
      })

      await waitForUpdate()

      const upInput = testContainer.querySelector('#up-input')
      const downInput = testContainer.querySelector('#down-input')
      const leftInput = testContainer.querySelector('#left-input')
      const rightInput = testContainer.querySelector('#right-input')
      const display = testContainer.querySelector('#direction')

      expect(display.textContent).toBe('none')

      // Test arrow up
      upInput.dispatchEvent(createKeyboardEvent('keydown', 'ArrowUp'))
      await waitForUpdate()
      expect(display.textContent).toBe('up')

      // Test arrow down
      downInput.dispatchEvent(createKeyboardEvent('keydown', 'ArrowDown'))
      await waitForUpdate()
      expect(display.textContent).toBe('down')

      // Test arrow left
      leftInput.dispatchEvent(createKeyboardEvent('keydown', 'ArrowLeft'))
      await waitForUpdate()
      expect(display.textContent).toBe('left')

      // Test arrow right
      rightInput.dispatchEvent(createKeyboardEvent('keydown', 'ArrowRight'))
      await waitForUpdate()
      expect(display.textContent).toBe('right')
    })
  })

  describe('Modifier keys (Ctrl, Alt, Shift, Meta)', () => {
    it('should trigger when Ctrl key is held', async () => {
      testContainer.innerHTML = `
        <div data-component="ctrl-key-test">
          <input id="test-input" data-action="keydown:handleCtrl" data-event-key-ctrl />
          <div id="ctrl-count" data-bind="ctrlCount"></div>
        </div>
      `

      wildflower.component('ctrl-key-test', {
        state: {
          ctrlCount: 0
        },
        handleCtrl() {
          this.state.ctrlCount++
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#ctrl-count')

      expect(display.textContent).toBe('0')

      // Press key with Ctrl - should trigger
      input.dispatchEvent(createKeyboardEvent('keydown', 'a', { ctrlKey: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('1')
    })

    it('should NOT trigger without Ctrl key held', async () => {
      testContainer.innerHTML = `
        <div data-component="ctrl-required-test">
          <input id="test-input" data-action="keydown:handleCtrl" data-event-key-ctrl />
          <div id="ctrl-count" data-bind="ctrlCount"></div>
        </div>
      `

      wildflower.component('ctrl-required-test', {
        state: {
          ctrlCount: 0
        },
        handleCtrl() {
          this.state.ctrlCount++
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#ctrl-count')

      expect(display.textContent).toBe('0')

      // Press 'a' without Ctrl - should NOT trigger
      input.dispatchEvent(createKeyboardEvent('keydown', 'a'))
      await waitForUpdate()
      expect(display.textContent).toBe('0')

      // Press 's' without Ctrl - should NOT trigger
      input.dispatchEvent(createKeyboardEvent('keydown', 's'))
      await waitForUpdate()
      expect(display.textContent).toBe('0')

      // Press 'a' with Ctrl - should trigger
      input.dispatchEvent(createKeyboardEvent('keydown', 'a', { ctrlKey: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('1')
    })

    it('should trigger when Shift key is held', async () => {
      testContainer.innerHTML = `
        <div data-component="shift-key-test">
          <input id="test-input" data-action="keydown:handleShift" data-event-key-shift />
          <div id="shift-count" data-bind="shiftCount"></div>
        </div>
      `

      wildflower.component('shift-key-test', {
        state: {
          shiftCount: 0
        },
        handleShift() {
          this.state.shiftCount++
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#shift-count')

      expect(display.textContent).toBe('0')

      // Press key with Shift - should trigger
      input.dispatchEvent(createKeyboardEvent('keydown', 'A', { shiftKey: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('1')
    })

    it('should trigger when Alt key is held', async () => {
      testContainer.innerHTML = `
        <div data-component="alt-key-test">
          <input id="test-input" data-action="keydown:handleAlt" data-event-key-alt />
          <div id="alt-count" data-bind="altCount"></div>
        </div>
      `

      wildflower.component('alt-key-test', {
        state: {
          altCount: 0
        },
        handleAlt() {
          this.state.altCount++
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#alt-count')

      expect(display.textContent).toBe('0')

      // Press key with Alt - should trigger
      input.dispatchEvent(createKeyboardEvent('keydown', 'a', { altKey: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('1')
    })

    it('should trigger when Meta key is held (Command on Mac)', async () => {
      testContainer.innerHTML = `
        <div data-component="meta-key-test">
          <input id="test-input" data-action="keydown:handleMeta" data-event-key-meta />
          <div id="meta-count" data-bind="metaCount"></div>
        </div>
      `

      wildflower.component('meta-key-test', {
        state: {
          metaCount: 0
        },
        handleMeta() {
          this.state.metaCount++
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#meta-count')

      expect(display.textContent).toBe('0')

      // Press key with Meta - should trigger
      input.dispatchEvent(createKeyboardEvent('keydown', 'a', { metaKey: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('1')
    })
  })

  describe('Key combinations (Ctrl+key)', () => {
    it('should handle Ctrl+S combination when pressed correctly', async () => {
      testContainer.innerHTML = `
        <div data-component="ctrl-s-test">
          <input id="test-input" data-action="keydown:save" data-event-key-ctrl+s />
          <div id="save-count" data-bind="saveCount"></div>
        </div>
      `

      wildflower.component('ctrl-s-test', {
        state: {
          saveCount: 0
        },
        save() {
          this.state.saveCount++
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#save-count')

      expect(display.textContent).toBe('0')

      // Press Ctrl+S - should trigger
      input.dispatchEvent(createKeyboardEvent('keydown', 's', { ctrlKey: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('1')
    })

    it('should NOT trigger for just S key without Ctrl', async () => {
      testContainer.innerHTML = `
        <div data-component="ctrl-s-only-test">
          <input id="test-input" data-action="keydown:save" data-event-key-ctrl+s data-event-prevent />
          <div id="save-count" data-bind="saveCount"></div>
        </div>
      `

      wildflower.component('ctrl-s-only-test', {
        state: {
          saveCount: 0
        },
        save() {
          this.state.saveCount++
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#save-count')

      expect(display.textContent).toBe('0')

      // Press 's' without Ctrl - should NOT trigger
      input.dispatchEvent(createKeyboardEvent('keydown', 's'))
      await waitForUpdate()
      expect(display.textContent).toBe('0')

      // Press Ctrl without 's' - should NOT trigger
      input.dispatchEvent(createKeyboardEvent('keydown', 'Control', { ctrlKey: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('0')

      // Press Ctrl+S - should trigger
      input.dispatchEvent(createKeyboardEvent('keydown', 's', { ctrlKey: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('1')
    })

    it('should handle Ctrl+Z combination', async () => {
      testContainer.innerHTML = `
        <div data-component="ctrl-z-test">
          <input id="test-input" data-action="keydown:undo" data-event-key-ctrl+z />
          <div id="undo-count" data-bind="undoCount"></div>
        </div>
      `

      wildflower.component('ctrl-z-test', {
        state: {
          undoCount: 0
        },
        undo() {
          this.state.undoCount++
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#undo-count')

      expect(display.textContent).toBe('0')

      // Press Ctrl+Z - should trigger
      input.dispatchEvent(createKeyboardEvent('keydown', 'z', { ctrlKey: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('1')
    })

    it('should handle Meta+C (Cmd+C on Mac) combination', async () => {
      testContainer.innerHTML = `
        <div data-component="meta-c-test">
          <input id="test-input" data-action="keydown:copy" data-event-key-meta+c />
          <div id="copy-count" data-bind="copyCount"></div>
        </div>
      `

      wildflower.component('meta-c-test', {
        state: {
          copyCount: 0
        },
        copy() {
          this.state.copyCount++
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#copy-count')

      expect(display.textContent).toBe('0')

      // Press Meta+C - should trigger
      input.dispatchEvent(createKeyboardEvent('keydown', 'c', { metaKey: true }))
      await waitForUpdate()
      expect(display.textContent).toBe('1')
    })
  })

  describe('Multiple key handlers on different elements', () => {
    it('should handle Enter and Escape on separate inputs', async () => {
      testContainer.innerHTML = `
        <div data-component="multi-key-test">
          <input id="enter-input" data-action="keyup:submit" data-event-key-enter />
          <input id="escape-input" data-action="keyup:cancel" data-event-key-escape />
          <div id="action" data-bind="lastAction"></div>
        </div>
      `

      wildflower.component('multi-key-test', {
        state: {
          lastAction: 'none'
        },
        submit() {
          this.state.lastAction = 'submit'
        },
        cancel() {
          this.state.lastAction = 'cancel'
        }
      })

      await waitForUpdate()

      const enterInput = testContainer.querySelector('#enter-input')
      const escapeInput = testContainer.querySelector('#escape-input')
      const display = testContainer.querySelector('#action')

      expect(display.textContent).toBe('none')

      // Press Enter on enter-input
      enterInput.dispatchEvent(createKeyboardEvent('keyup', 'Enter'))
      await waitForUpdate()
      expect(display.textContent).toBe('submit')

      // Press Escape on escape-input
      escapeInput.dispatchEvent(createKeyboardEvent('keyup', 'Escape'))
      await waitForUpdate()
      expect(display.textContent).toBe('cancel')
    })
  })

  describe('Combined with other event modifiers', () => {
    it('should work with data-event-prevent on Enter', async () => {
      testContainer.innerHTML = `
        <div data-component="enter-prevent-test">
          <form id="test-form">
            <input id="test-input"
                   data-action="keydown:handleSubmit"
                   data-event-key-enter
                   data-event-prevent />
          </form>
          <div id="submit-count" data-bind="submitCount"></div>
        </div>
      `

      wildflower.component('enter-prevent-test', {
        state: {
          submitCount: 0
        },
        handleSubmit(event) {
          this.state.submitCount++
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#submit-count')

      expect(display.textContent).toBe('0')

      // Create a keyboard event
      const event = createKeyboardEvent('keydown', 'Enter')

      input.dispatchEvent(event)
      await waitForUpdate()

      // Handler should have been called
      expect(display.textContent).toBe('1')
    })
  })

  describe('Specific key detection', () => {
    it('should handle Delete and Backspace keys', async () => {
      testContainer.innerHTML = `
        <div data-component="delete-key-test">
          <input id="test-input" data-action="keydown:handleDelete" data-event-key-delete />
          <div id="delete-count" data-bind="deleteCount"></div>
        </div>
      `

      wildflower.component('delete-key-test', {
        state: {
          deleteCount: 0
        },
        handleDelete() {
          this.state.deleteCount++
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#delete-count')

      expect(display.textContent).toBe('0')

      // Press Delete - should trigger
      input.dispatchEvent(createKeyboardEvent('keydown', 'Delete'))
      await waitForUpdate()
      expect(display.textContent).toBe('1')

      // Backspace should also trigger (per implementation)
      input.dispatchEvent(createKeyboardEvent('keydown', 'Backspace'))
      await waitForUpdate()
      expect(display.textContent).toBe('2')
    })
  })

  describe('Handler receives keyboard event data', () => {
    it('should provide key information in event object', async () => {
      testContainer.innerHTML = `
        <div data-component="key-info-test">
          <input id="test-input" data-action="keydown:handleKey" />
          <div id="key-info" data-bind="keyInfo"></div>
        </div>
      `

      wildflower.component('key-info-test', {
        state: {
          keyInfo: ''
        },
        handleKey(event) {
          this.state.keyInfo = `key=${event.key},ctrl=${event.ctrlKey},shift=${event.shiftKey}`
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#test-input')
      const display = testContainer.querySelector('#key-info')

      // Press a key with modifiers
      input.dispatchEvent(createKeyboardEvent('keydown', 'a', { ctrlKey: true, shiftKey: true }))
      await waitForUpdate()

      expect(display.textContent).toBe('key=a,ctrl=true,shift=true')
    })
  })
})
