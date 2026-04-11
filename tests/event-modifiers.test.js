/**
 * WildflowerJS Event Modifiers Test Suite - Vitest Browser Mode
 *
 * Tests for data-event-* attributes that modify event behavior:
 * - data-event-prevent (preventDefault)
 * - data-event-stop (stopPropagation)
 * - data-event-once (fire once only)
 * - data-event-debounce="ms" (debounce handler)
 * - data-event-throttle="ms" (throttle handler)
 * - data-event-self (only if target matches element)
 * - data-event-capture (capture phase)
 * - data-event-passive (passive listener)
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Event Modifiers', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower

    // Reset framework state
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

  describe('data-event-prevent (preventDefault)', () => {
    it('should call preventDefault on link click', async () => {
      // Using a link since preventDefault for links is explicitly handled in the framework
      testContainer.innerHTML = `
        <div data-component="prevent-link-test">
          <a href="#test-hash" id="test-link" data-action="handleClick" data-event-prevent>
            Click Link
          </a>
          <div id="click-count" data-bind="clickCount"></div>
        </div>
      `

      let preventDefaultCalled = false

      wildflower.component('prevent-link-test', {
        state: {
          clickCount: 0
        },
        handleClick(event) {
          preventDefaultCalled = event.defaultPrevented
          this.state.clickCount++
        }
      })

      await waitForUpdate()

      const link = testContainer.querySelector('#test-link')
      const clickCount = testContainer.querySelector('#click-count')
      const originalHash = window.location.hash

      link.click()
      await waitForUpdate()

      // Handler should have been called
      expect(clickCount.textContent).toBe('1')
      // preventDefault should have been called
      expect(preventDefaultCalled).toBe(true)
      // Hash should not have changed
      expect(window.location.hash).toBe(originalHash)
    })

    it('should prevent link navigation', async () => {
      testContainer.innerHTML = `
        <div data-component="link-prevent-test">
          <a href="#should-not-navigate" id="test-link" data-action="handleClick" data-event-prevent>
            Click Me
          </a>
          <div id="clicked" data-bind="clicked"></div>
        </div>
      `

      wildflower.component('link-prevent-test', {
        state: {
          clicked: 'no'
        },
        handleClick(event) {
          this.state.clicked = 'yes'
        }
      })

      await waitForUpdate()

      const link = testContainer.querySelector('#test-link')
      const clicked = testContainer.querySelector('#clicked')
      const originalHash = window.location.hash

      link.click()
      await waitForUpdate()

      // Handler should have been called
      expect(clicked.textContent).toBe('yes')
      // Hash should not have changed
      expect(window.location.hash).toBe(originalHash)
    })
  })

  describe('data-event-stop (stopPropagation)', () => {
    it('should stop event from bubbling to parent', async () => {
      testContainer.innerHTML = `
        <div data-component="stop-test">
          <div id="parent" data-action="parentClicked">
            <button id="child" data-action="childClicked" data-event-stop>
              Click Child
            </button>
          </div>
          <div id="parent-count" data-bind="parentClicks"></div>
          <div id="child-count" data-bind="childClicks"></div>
        </div>
      `

      wildflower.component('stop-test', {
        state: {
          parentClicks: 0,
          childClicks: 0
        },
        parentClicked() {
          this.state.parentClicks++
        },
        childClicked() {
          this.state.childClicks++
        }
      })

      await waitForUpdate()

      const child = testContainer.querySelector('#child')
      const parentCount = testContainer.querySelector('#parent-count')
      const childCount = testContainer.querySelector('#child-count')

      // Click the child button
      child.click()
      await waitForUpdate()

      // Child handler should have been called
      expect(childCount.textContent).toBe('1')
      // Parent handler should NOT have been called due to stopPropagation
      expect(parentCount.textContent).toBe('0')
    })

    it('should verify stopPropagation prevents native listener from firing', async () => {
      // Compare: button WITH data-event-stop should NOT bubble to native listener
      // vs button WITHOUT should bubble
      testContainer.innerHTML = `
        <div data-component="bubble-compare-test">
          <div id="outer-with-stop">
            <button id="btn-with-stop" data-action="handleClick" data-event-stop>
              With Stop
            </button>
          </div>
          <div id="count" data-bind="clickCount"></div>
        </div>
      `

      let outerReceivedEvent = false

      wildflower.component('bubble-compare-test', {
        state: {
          clickCount: 0
        },
        handleClick() {
          this.state.clickCount++
        }
      })

      await waitForUpdate()

      const outer = testContainer.querySelector('#outer-with-stop')
      const button = testContainer.querySelector('#btn-with-stop')
      const count = testContainer.querySelector('#count')

      // Add native listener on outer
      outer.addEventListener('click', () => {
        outerReceivedEvent = true
      })

      // Click button with stop - native listener should NOT fire
      button.click()
      await waitForUpdate()

      // Handler should have been called
      expect(count.textContent).toBe('1')
      // Native listener should NOT have received event
      expect(outerReceivedEvent).toBe(false)
    })
  })

  describe('data-event-once', () => {
    it('should only fire the handler once', async () => {
      testContainer.innerHTML = `
        <div data-component="once-test">
          <button id="once-btn" data-action="handleClick" data-event-once>
            Click Once
          </button>
          <div id="count" data-bind="count"></div>
        </div>
      `

      wildflower.component('once-test', {
        state: {
          count: 0
        },
        handleClick() {
          this.state.count++
        }
      })

      await waitForUpdate()

      const button = testContainer.querySelector('#once-btn')
      const count = testContainer.querySelector('#count')

      // First click should work
      button.click()
      await waitForUpdate()
      expect(count.textContent).toBe('1')

      // Second click should not increment
      button.click()
      await waitForUpdate()
      expect(count.textContent).toBe('1')

      // Third click should also not increment
      button.click()
      await waitForUpdate()
      expect(count.textContent).toBe('1')
    })
  })

  describe('data-event-debounce', () => {
    it('should debounce rapid events', async () => {
      testContainer.innerHTML = `
        <div data-component="debounce-test">
          <input id="search-input" data-action="input:handleInput" data-event-debounce="100">
          <div id="search-count" data-bind="searchCount"></div>
          <div id="last-value" data-bind="lastValue"></div>
        </div>
      `

      wildflower.component('debounce-test', {
        state: {
          searchCount: 0,
          lastValue: ''
        },
        handleInput(event, element) {
          this.state.searchCount++
          this.state.lastValue = element.value
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#search-input')
      const searchCount = testContainer.querySelector('#search-count')
      const lastValue = testContainer.querySelector('#last-value')

      // Rapidly type multiple characters
      input.value = 'a'
      input.dispatchEvent(new Event('input'))
      input.value = 'ab'
      input.dispatchEvent(new Event('input'))
      input.value = 'abc'
      input.dispatchEvent(new Event('input'))
      input.value = 'abcd'
      input.dispatchEvent(new Event('input'))

      // Immediately after, count should still be 0 (debounced)
      await waitForUpdate(20)
      expect(searchCount.textContent).toBe('0')

      // Wait for debounce to complete (100ms + buffer)
      await waitForUpdate(150)

      // Handler should have been called only once with final value
      expect(searchCount.textContent).toBe('1')
      expect(lastValue.textContent).toBe('abcd')
    })

    it('should use default 300ms if no value specified', async () => {
      testContainer.innerHTML = `
        <div data-component="debounce-default-test">
          <input id="input" data-action="input:handleInput" data-event-debounce>
          <div id="count" data-bind="count"></div>
        </div>
      `

      wildflower.component('debounce-default-test', {
        state: {
          count: 0
        },
        handleInput() {
          this.state.count++
        }
      })

      await waitForUpdate()

      const input = testContainer.querySelector('#input')
      const count = testContainer.querySelector('#count')

      // Type something
      input.value = 'test'
      input.dispatchEvent(new Event('input'))

      // After 100ms, should not have fired yet
      await waitForUpdate(100)
      expect(count.textContent).toBe('0')

      // After 350ms total, should have fired
      await waitForUpdate(300)
      expect(count.textContent).toBe('1')
    })
  })

  describe('data-event-throttle', () => {
    it('should throttle rapid events', async () => {
      testContainer.innerHTML = `
        <div data-component="throttle-test">
          <div id="scroll-area" style="height: 100px; overflow: auto;"
               data-action="scroll:handleScroll" data-event-throttle="100">
            <div style="height: 500px;">Scrollable content</div>
          </div>
          <div id="scroll-count" data-bind="scrollCount"></div>
        </div>
      `

      wildflower.component('throttle-test', {
        state: {
          scrollCount: 0
        },
        handleScroll() {
          this.state.scrollCount++
        }
      })

      await waitForUpdate()

      const scrollArea = testContainer.querySelector('#scroll-area')
      const scrollCount = testContainer.querySelector('#scroll-count')

      // Dispatch multiple scroll events rapidly
      for (let i = 0; i < 10; i++) {
        scrollArea.dispatchEvent(new Event('scroll'))
      }

      await waitForUpdate(50)

      // With throttle, we should see fewer calls than events
      // First call happens immediately, then throttled
      const countAfterRapid = parseInt(scrollCount.textContent)
      expect(countAfterRapid).toBeGreaterThanOrEqual(1)
      expect(countAfterRapid).toBeLessThan(10)

      // Wait for throttle window to pass
      await waitForUpdate(150)

      // One more scroll should work
      scrollArea.dispatchEvent(new Event('scroll'))
      await waitForUpdate(50)

      const finalCount = parseInt(scrollCount.textContent)
      expect(finalCount).toBeGreaterThan(countAfterRapid)
    })
  })

  describe('data-event-self', () => {
    it('should only fire when event.target matches the element', async () => {
      testContainer.innerHTML = `
        <div data-component="self-test">
          <div id="parent-div" data-action="handleClick" data-event-self style="padding: 20px; background: #eee;">
            <button id="child-btn">Child Button</button>
          </div>
          <div id="count" data-bind="count"></div>
          <div id="last-target" data-bind="lastTarget"></div>
        </div>
      `

      wildflower.component('self-test', {
        state: {
          count: 0,
          lastTarget: 'none'
        },
        handleClick(event) {
          this.state.count++
          this.state.lastTarget = event.target.id || event.target.tagName
        }
      })

      await waitForUpdate()

      const parentDiv = testContainer.querySelector('#parent-div')
      const childBtn = testContainer.querySelector('#child-btn')
      const count = testContainer.querySelector('#count')

      // Click child button - event.target will be the button, not the div
      // With data-event-self, handler should NOT fire because target !== element
      childBtn.click()
      await waitForUpdate()

      // Handler should NOT have been called because event.target was the button
      expect(count.textContent).toBe('0')

      // Now dispatch event directly on parent div
      parentDiv.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await waitForUpdate()

      // Handler should have been called because event.target is the div itself
      expect(count.textContent).toBe('1')
    })

    it('should fire normally without data-event-self', async () => {
      testContainer.innerHTML = `
        <div data-component="no-self-test">
          <div id="parent-div" data-action="handleClick" style="padding: 20px;">
            <button id="child-btn">Child Button</button>
          </div>
          <div id="count" data-bind="count"></div>
        </div>
      `

      wildflower.component('no-self-test', {
        state: {
          count: 0
        },
        handleClick() {
          this.state.count++
        }
      })

      await waitForUpdate()

      const childBtn = testContainer.querySelector('#child-btn')
      const count = testContainer.querySelector('#count')

      // Click child button - without data-event-self, bubbled events should trigger handler
      childBtn.click()
      await waitForUpdate()

      // Handler SHOULD be called (no self restriction)
      expect(count.textContent).toBe('1')
    })
  })

  describe('Combined modifiers', () => {
    it('should support multiple modifiers on same element', async () => {
      testContainer.innerHTML = `
        <div data-component="combined-test">
          <div id="outer">
            <button id="btn"
                    data-action="handleClick"
                    data-event-prevent
                    data-event-stop>
              Click Me
            </button>
          </div>
          <div id="outer-count" data-bind="outerClicks"></div>
          <div id="click-count" data-bind="clickCount"></div>
        </div>
      `

      wildflower.component('combined-test', {
        state: {
          outerClicks: 0,
          clickCount: 0
        },
        handleClick(event) {
          this.state.clickCount++
        }
      })

      await waitForUpdate()

      const button = testContainer.querySelector('#btn')
      const outer = testContainer.querySelector('#outer')
      const outerCount = testContainer.querySelector('#outer-count')
      const clickCount = testContainer.querySelector('#click-count')
      const component = testContainer.querySelector('[data-component="combined-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Add native listener on outer to detect if stopPropagation worked
      outer.addEventListener('click', () => {
        instance.state.outerClicks++
      })

      button.click()
      await waitForUpdate()

      // Click handler should have been called
      expect(clickCount.textContent).toBe('1')
      // Outer should NOT have received the event (stopPropagation)
      expect(outerCount.textContent).toBe('0')
    })
  })

  describe('data-event-delay', () => {
    it('should delay event execution by specified milliseconds', async () => {
      testContainer.innerHTML = `
        <div data-component="delay-test">
          <button id="delayed-btn" data-action="handleClick" data-event-delay="100">
            Delayed Click
          </button>
          <div id="click-count" data-bind="clickCount"></div>
          <div id="click-time" data-bind="clickTime"></div>
        </div>
      `

      let clickTimestamp = 0
      wildflower.component('delay-test', {
        state: {
          clickCount: 0,
          clickTime: 0
        },
        handleClick() {
          this.state.clickCount++
          this.state.clickTime = Date.now() - clickTimestamp
        }
      })

      await waitForUpdate()

      const btn = testContainer.querySelector('#delayed-btn')
      const clickCount = testContainer.querySelector('#click-count')

      // Record click time and click the button
      clickTimestamp = Date.now()
      btn.click()

      // Immediately after click, handler should NOT have been called yet
      await waitForUpdate(20)
      expect(clickCount.textContent).toBe('0')

      // After delay completes (100ms + buffer)
      await waitForUpdate(150)
      expect(clickCount.textContent).toBe('1')
    })

    it('should delay multiple events independently', async () => {
      testContainer.innerHTML = `
        <div data-component="delay-multi-test">
          <button id="btn1" data-action="handleClick1" data-event-delay="50">Button 1</button>
          <button id="btn2" data-action="handleClick2" data-event-delay="150">Button 2</button>
          <div id="order" data-bind="clickOrder"></div>
        </div>
      `

      wildflower.component('delay-multi-test', {
        state: {
          clickOrder: ''
        },
        handleClick1() {
          this.state.clickOrder += '1'
        },
        handleClick2() {
          this.state.clickOrder += '2'
        }
      })

      await waitForUpdate()

      const btn1 = testContainer.querySelector('#btn1')
      const btn2 = testContainer.querySelector('#btn2')
      const order = testContainer.querySelector('#order')

      // Click btn2 first, then btn1
      btn2.click()
      await waitForUpdate(10)
      btn1.click()

      // After 80ms, only btn1's handler should have fired (50ms delay)
      await waitForUpdate(80)
      expect(order.textContent).toBe('1')

      // After 180ms total, btn2's handler should also have fired (150ms delay)
      await waitForUpdate(120)
      expect(order.textContent).toBe('12')
    })

    it('should default to 0 delay if invalid value', async () => {
      testContainer.innerHTML = `
        <div data-component="delay-invalid-test">
          <button id="btn" data-action="handleClick" data-event-delay="invalid">Click</button>
          <div id="count" data-bind="count"></div>
        </div>
      `

      wildflower.component('delay-invalid-test', {
        state: { count: 0 },
        handleClick() {
          this.state.count++
        }
      })

      await waitForUpdate()

      const btn = testContainer.querySelector('#btn')
      const count = testContainer.querySelector('#count')

      btn.click()
      await waitForUpdate(20)

      // Should fire immediately (0 delay)
      expect(count.textContent).toBe('1')
    })
  })

  describe('data-event-if', () => {
    it('should only fire event when condition is truthy', async () => {
      testContainer.innerHTML = `
        <div data-component="event-if-test">
          <button id="conditional-btn" data-action="handleClick" data-event-if="isEnabled">
            Conditional Click
          </button>
          <div id="click-count" data-bind="clickCount"></div>
        </div>
      `

      wildflower.component('event-if-test', {
        state: {
          isEnabled: false,
          clickCount: 0
        },
        handleClick() {
          this.state.clickCount++
        }
      })

      await waitForUpdate()

      const btn = testContainer.querySelector('#conditional-btn')
      const clickCount = testContainer.querySelector('#click-count')
      const component = testContainer.querySelector('[data-component="event-if-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Click when disabled - should NOT fire
      btn.click()
      await waitForUpdate()
      expect(clickCount.textContent).toBe('0')

      // Enable the condition
      instance.state.isEnabled = true
      await waitForUpdate()

      // Click when enabled - should fire
      btn.click()
      await waitForUpdate()
      expect(clickCount.textContent).toBe('1')

      // Click again - should fire
      btn.click()
      await waitForUpdate()
      expect(clickCount.textContent).toBe('2')

      // Disable again
      instance.state.isEnabled = false
      await waitForUpdate()

      // Click when disabled - should NOT fire
      btn.click()
      await waitForUpdate()
      expect(clickCount.textContent).toBe('2')
    })

    it('should evaluate expression conditions', async () => {
      testContainer.innerHTML = `
        <div data-component="event-if-expr-test">
          <button id="expr-btn" data-action="handleClick" data-event-if="count < 3">
            Limited Click
          </button>
          <div id="click-count" data-bind="count"></div>
        </div>
      `

      wildflower.component('event-if-expr-test', {
        state: {
          count: 0
        },
        handleClick() {
          this.state.count++
        }
      })

      await waitForUpdate()

      const btn = testContainer.querySelector('#expr-btn')
      const clickCount = testContainer.querySelector('#click-count')

      // Should work for first 3 clicks (count < 3 means 0, 1, 2)
      btn.click()
      await waitForUpdate()
      expect(clickCount.textContent).toBe('1')

      btn.click()
      await waitForUpdate()
      expect(clickCount.textContent).toBe('2')

      btn.click()
      await waitForUpdate()
      expect(clickCount.textContent).toBe('3')

      // Fourth click - condition is now false (3 < 3 is false)
      btn.click()
      await waitForUpdate()
      expect(clickCount.textContent).toBe('3') // Should NOT increment
    })

    it('should work with negated conditions', async () => {
      testContainer.innerHTML = `
        <div data-component="event-if-negated-test">
          <button id="negated-btn" data-action="handleClick" data-event-if="!isLocked">
            Negated Condition
          </button>
          <div id="count" data-bind="count"></div>
        </div>
      `

      wildflower.component('event-if-negated-test', {
        state: {
          isLocked: true,
          count: 0
        },
        handleClick() {
          this.state.count++
        }
      })

      await waitForUpdate()

      const btn = testContainer.querySelector('#negated-btn')
      const count = testContainer.querySelector('#count')
      const component = testContainer.querySelector('[data-component="event-if-negated-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      // Click when locked (condition !isLocked is false) - should NOT fire
      btn.click()
      await waitForUpdate()
      expect(count.textContent).toBe('0')

      // Unlock (condition !isLocked is now true)
      instance.state.isLocked = false
      await waitForUpdate()

      // Click when unlocked - should fire
      btn.click()
      await waitForUpdate()
      expect(count.textContent).toBe('1')
    })
  })

  describe('data-event-outside', () => {
    it('should fire when clicking outside the element', async () => {
      testContainer.innerHTML = `
        <div data-component="outside-test">
          <div id="dropdown" data-action="closeDropdown" data-event-outside style="padding: 20px; background: #eee;">
            Dropdown Content
            <button id="inside-btn">Inside Button</button>
          </div>
          <button id="outside-btn">Outside Button</button>
          <div id="close-count" data-bind="closeCount"></div>
        </div>
      `

      wildflower.component('outside-test', {
        state: {
          closeCount: 0
        },
        closeDropdown() {
          this.state.closeCount++
        }
      })

      await waitForUpdate()

      const dropdown = testContainer.querySelector('#dropdown')
      const insideBtn = testContainer.querySelector('#inside-btn')
      const outsideBtn = testContainer.querySelector('#outside-btn')
      const closeCount = testContainer.querySelector('#close-count')

      // Click inside the dropdown - should NOT trigger outside handler
      insideBtn.click()
      await waitForUpdate()
      expect(closeCount.textContent).toBe('0')

      // Click the dropdown itself - should NOT trigger outside handler
      dropdown.click()
      await waitForUpdate()
      expect(closeCount.textContent).toBe('0')

      // Click outside the dropdown - SHOULD trigger outside handler
      outsideBtn.click()
      await waitForUpdate()
      expect(closeCount.textContent).toBe('1')

      // Click outside again
      outsideBtn.click()
      await waitForUpdate()
      expect(closeCount.textContent).toBe('2')
    })

    it('should fire when clicking on document body', async () => {
      testContainer.innerHTML = `
        <div data-component="outside-body-test">
          <div id="modal" data-action="closeModal" data-event-outside style="padding: 10px;">
            Modal Content
          </div>
          <div id="close-count" data-bind="closeCount"></div>
        </div>
      `

      wildflower.component('outside-body-test', {
        state: {
          closeCount: 0
        },
        closeModal() {
          this.state.closeCount++
        }
      })

      await waitForUpdate()

      const closeCount = testContainer.querySelector('#close-count')

      // Click on the test container (outside the modal)
      testContainer.click()
      await waitForUpdate()
      expect(closeCount.textContent).toBe('1')
    })
  })

  describe('data-event-passive', () => {
    it('should add event listener with passive option', async () => {
      // We can't directly test if passive is set, but we can verify the handler still fires
      // Passive listeners are used for scroll/touch performance optimization
      testContainer.innerHTML = `
        <div data-component="passive-test">
          <div id="scroll-area"
               style="height: 100px; overflow: auto;"
               data-action="scroll:handleScroll"
               data-event-passive>
            <div style="height: 500px;">Scrollable content</div>
          </div>
          <div id="scroll-count" data-bind="scrollCount"></div>
        </div>
      `

      wildflower.component('passive-test', {
        state: {
          scrollCount: 0
        },
        handleScroll() {
          this.state.scrollCount++
        }
      })

      await waitForUpdate()

      const scrollArea = testContainer.querySelector('#scroll-area')
      const scrollCount = testContainer.querySelector('#scroll-count')

      // Dispatch scroll event - handler should still fire with passive listener
      scrollArea.dispatchEvent(new Event('scroll'))
      await waitForUpdate()

      expect(scrollCount.textContent).toBe('1')

      // Multiple scrolls should work
      scrollArea.dispatchEvent(new Event('scroll'))
      scrollArea.dispatchEvent(new Event('scroll'))
      await waitForUpdate()

      expect(scrollCount.textContent).toBe('3')
    })

    it('should work with touch events', async () => {
      testContainer.innerHTML = `
        <div data-component="passive-touch-test">
          <div id="touch-area"
               style="width: 100px; height: 100px;"
               data-action="touchstart:handleTouch"
               data-event-passive>
            Touch Area
          </div>
          <div id="touch-count" data-bind="touchCount"></div>
        </div>
      `

      wildflower.component('passive-touch-test', {
        state: {
          touchCount: 0
        },
        handleTouch() {
          this.state.touchCount++
        }
      })

      await waitForUpdate()

      const touchArea = testContainer.querySelector('#touch-area')
      const touchCount = testContainer.querySelector('#touch-count')

      // Dispatch touchstart event
      touchArea.dispatchEvent(new Event('touchstart'))
      await waitForUpdate()

      expect(touchCount.textContent).toBe('1')
    })
  })

  describe('data-event-capture', () => {
    it('should fire handler during capture phase (intercepts before target)', async () => {
      // With capture, the parent intercepts the event BEFORE it reaches the child
      // Framework stops propagation after handling, so only the capture handler fires
      testContainer.innerHTML = `
        <div data-component="capture-test">
          <div id="parent" data-action="parentHandler" data-event-capture>
            <button id="child">Click Child</button>
          </div>
          <div id="parent-fired" data-bind="parentFired"></div>
        </div>
      `

      wildflower.component('capture-test', {
        state: {
          parentFired: 'no'
        },
        parentHandler(event) {
          this.state.parentFired = 'yes'
        }
      })

      await waitForUpdate()

      const child = testContainer.querySelector('#child')
      const parentFired = testContainer.querySelector('#parent-fired')

      // Click the child button - parent should intercept during capture phase
      child.click()
      await waitForUpdate()

      // Parent handler should fire even though we clicked the child
      // (because capture phase intercepts before target)
      expect(parentFired.textContent).toBe('yes')
    })

    it('should intercept events from deeply nested children', async () => {
      testContainer.innerHTML = `
        <div data-component="capture-deep-test">
          <div id="interceptor" data-action="intercept" data-event-capture>
            <div class="level1">
              <div class="level2">
                <div class="level3">
                  <button id="deep-child">Deep Child</button>
                </div>
              </div>
            </div>
          </div>
          <div id="intercepted" data-bind="intercepted"></div>
        </div>
      `

      wildflower.component('capture-deep-test', {
        state: {
          intercepted: 'no'
        },
        intercept() {
          this.state.intercepted = 'yes'
        }
      })

      await waitForUpdate()

      const deepChild = testContainer.querySelector('#deep-child')
      const intercepted = testContainer.querySelector('#intercepted')

      // Click deeply nested child - interceptor should catch it during capture
      deepChild.click()
      await waitForUpdate()

      expect(intercepted.textContent).toBe('yes')
    })

    it('should work with native event listeners to verify capture phase', async () => {
      // Use native listeners to verify capture fires before bubble
      testContainer.innerHTML = `
        <div data-component="capture-native-test">
          <div id="wrapper">
            <button id="btn" data-action="handleClick" data-event-capture>Click</button>
          </div>
          <div id="order" data-bind="order"></div>
        </div>
      `

      let nativeOrder = ''

      wildflower.component('capture-native-test', {
        state: {
          order: ''
        },
        handleClick() {
          this.state.order += 'F' // Framework handler
          nativeOrder += 'F'
        }
      })

      await waitForUpdate()

      const wrapper = testContainer.querySelector('#wrapper')
      const btn = testContainer.querySelector('#btn')
      const order = testContainer.querySelector('#order')

      // Add native listeners to track event phases
      wrapper.addEventListener('click', () => {
        nativeOrder += 'B' // Bubble phase
      }, { capture: false })

      wrapper.addEventListener('click', () => {
        nativeOrder += 'C' // Capture phase
      }, { capture: true })

      btn.click()
      await waitForUpdate()

      // With capture on the framework handler:
      // Native capture (C) fires first, then framework capture (F), then propagation stops
      // The bubble listener (B) won't fire because framework stops propagation
      expect(nativeOrder).toBe('CF')
      expect(order.textContent).toBe('F')
    })
  })

  describe('wf- prefix support', () => {
    it('should work with data-wf-event-* prefix', async () => {
      testContainer.innerHTML = `
        <div data-component="wf-prefix-test">
          <div id="parent" data-action="parentClicked">
            <button id="child" data-action="childClicked" data-wf-event-stop>
              Click Child
            </button>
          </div>
          <div id="parent-count" data-bind="parentClicks"></div>
          <div id="child-count" data-bind="childClicks"></div>
        </div>
      `

      wildflower.component('wf-prefix-test', {
        state: {
          parentClicks: 0,
          childClicks: 0
        },
        parentClicked() {
          this.state.parentClicks++
        },
        childClicked() {
          this.state.childClicks++
        }
      })

      await waitForUpdate()

      const child = testContainer.querySelector('#child')
      const parentCount = testContainer.querySelector('#parent-count')
      const childCount = testContainer.querySelector('#child-count')

      child.click()
      await waitForUpdate()

      // Child handler should have been called
      expect(childCount.textContent).toBe('1')
      // Parent handler should NOT have been called
      expect(parentCount.textContent).toBe('0')
    })
  })
})
