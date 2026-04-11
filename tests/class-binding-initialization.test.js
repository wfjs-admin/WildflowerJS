/**
 * @vitest-environment browser
 *
 * Tests for class binding initialization - ensures _previousClass is set on initial render
 * Bug: Class bindings on initially hidden elements didn't properly track previous classes,
 * causing the first state change to not remove the old class (only add new one)
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('Class Binding Initialization', () => {
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

    describe('Initially hidden elements', () => {
        it('should properly toggle class bindings on first show', async () => {
            // Register component with hidden form containing class bindings
            wildflower.component('class-toggle-test', {
                state: {
                    formVisible: false,
                    selectedOption: 'medium'
                },
                showForm() {
                    this.state.formVisible = true
                },
                selectHigh() {
                    this.state.selectedOption = 'high'
                },
                selectMedium() {
                    this.state.selectedOption = 'medium'
                },
                selectLow() {
                    this.state.selectedOption = 'low'
                }
            })

            testContainer.innerHTML = `
                <div data-component="class-toggle-test">
                    <button data-action="showForm" class="show-btn">Show Form</button>
                    <div data-show="formVisible" class="form">
                        <div class="option"
                             data-action="selectHigh"
                             data-bind-class="selectedOption === 'high' ? 'selected' : ''">High</div>
                        <div class="option"
                             data-action="selectMedium"
                             data-bind-class="selectedOption === 'medium' ? 'selected' : ''">Medium</div>
                        <div class="option"
                             data-action="selectLow"
                             data-bind-class="selectedOption === 'low' ? 'selected' : ''">Low</div>
                    </div>
                </div>
            `

            await waitForUpdate()

            // Form should be hidden initially
            const form = testContainer.querySelector('.form')
            expect(form.style.display).toBe('none')

            // Show the form
            testContainer.querySelector('.show-btn').click()
            await waitForUpdate()

            // Form should be visible now
            expect(form.style.display).not.toBe('none')

            // Medium should be selected (default)
            const options = testContainer.querySelectorAll('.option')
            expect(options[1].classList.contains('selected')).toBe(true) // Medium
            expect(options[0].classList.contains('selected')).toBe(false) // High
            expect(options[2].classList.contains('selected')).toBe(false) // Low

            // Click High - this is where the bug manifested
            options[0].click()
            await waitForUpdate()

            // Only High should be selected now
            expect(options[0].classList.contains('selected')).toBe(true)  // High - should be selected
            expect(options[1].classList.contains('selected')).toBe(false) // Medium - should NOT be selected
            expect(options[2].classList.contains('selected')).toBe(false) // Low - should NOT be selected
        })

    })

    describe('Always visible elements', () => {
        it('should properly track class binding state from the start', async () => {
            wildflower.component('visible-class-test', {
                state: {
                    selected: 'b'
                },
                selectA() { this.state.selected = 'a' },
                selectB() { this.state.selected = 'b' },
                selectC() { this.state.selected = 'c' }
            })

            testContainer.innerHTML = `
                <div data-component="visible-class-test">
                    <div class="option" data-action="selectA" data-bind-class="selected === 'a' ? 'active' : ''">A</div>
                    <div class="option" data-action="selectB" data-bind-class="selected === 'b' ? 'active' : ''">B</div>
                    <div class="option" data-action="selectC" data-bind-class="selected === 'c' ? 'active' : ''">C</div>
                </div>
            `

            await waitForUpdate()

            const options = testContainer.querySelectorAll('.option')

            // B should be active initially
            expect(options[0].classList.contains('active')).toBe(false)
            expect(options[1].classList.contains('active')).toBe(true)
            expect(options[2].classList.contains('active')).toBe(false)

            // Click A
            options[0].click()
            await waitForUpdate()

            // Only A should be active
            expect(options[0].classList.contains('active')).toBe(true)
            expect(options[1].classList.contains('active')).toBe(false)
            expect(options[2].classList.contains('active')).toBe(false)

            // Click C
            options[2].click()
            await waitForUpdate()

            // Only C should be active
            expect(options[0].classList.contains('active')).toBe(false)
            expect(options[1].classList.contains('active')).toBe(false)
            expect(options[2].classList.contains('active')).toBe(true)
        })
    })

    describe('Stale class cleanup on re-show', () => {
        it('should clean up stale dynamic classes when element is hidden and re-shown', async () => {
            // This tests the exact bug pattern from the kanban edit modal:
            // 1. Form is hidden
            // 2. State is set (e.g., priority = 'medium')
            // 3. Form is shown - 'selected' class applied to medium
            // 4. Form is hidden again
            // 5. State changes while hidden (e.g., priority = 'high')
            // 6. Form is re-shown - should ONLY have 'selected' on high, NOT on medium

            wildflower.component('stale-class-test', {
                state: {
                    formVisible: false,
                    priority: 'medium'
                },
                showForm() {
                    this.state.formVisible = true
                },
                hideForm() {
                    this.state.formVisible = false
                },
                setPriority(value) {
                    this.state.priority = value
                }
            })

            testContainer.innerHTML = `
                <div data-component="stale-class-test">
                    <button data-action="showForm" class="show-btn">Show</button>
                    <button data-action="hideForm" class="hide-btn">Hide</button>
                    <div data-show="formVisible" class="form">
                        <div class="option high-opt"
                             data-bind-class="priority === 'high' ? 'selected' : ''">High</div>
                        <div class="option medium-opt"
                             data-bind-class="priority === 'medium' ? 'selected' : ''">Medium</div>
                        <div class="option low-opt"
                             data-bind-class="priority === 'low' ? 'selected' : ''">Low</div>
                    </div>
                </div>
            `

            await waitForUpdate()

            const form = testContainer.querySelector('.form')
            const highOpt = testContainer.querySelector('.high-opt')
            const mediumOpt = testContainer.querySelector('.medium-opt')
            const lowOpt = testContainer.querySelector('.low-opt')

            // Initially hidden
            expect(form.style.display).toBe('none')

            // Show the form - medium should be selected
            testContainer.querySelector('.show-btn').click()
            await waitForUpdate()

            expect(form.style.display).not.toBe('none')
            expect(mediumOpt.classList.contains('selected')).toBe(true)
            expect(highOpt.classList.contains('selected')).toBe(false)
            expect(lowOpt.classList.contains('selected')).toBe(false)

            // Hide the form
            testContainer.querySelector('.hide-btn').click()
            await waitForUpdate()

            expect(form.style.display).toBe('none')

            // Change priority while hidden
            const componentEl = testContainer.querySelector('[data-component]')
            const component = wildflower.componentInstances.get(componentEl.dataset.componentId)
            component.setPriority('high')
            await waitForUpdate()

            // Show the form again - this is where the bug manifested
            // The medium option would retain 'selected' class because
            // the class binding context was reinitialized without cleaning up stale classes
            testContainer.querySelector('.show-btn').click()
            await waitForUpdate()

            // CRITICAL: Only high should be selected, medium should NOT be selected
            expect(highOpt.classList.contains('selected')).toBe(true)
            expect(mediumOpt.classList.contains('selected')).toBe(false)
            expect(lowOpt.classList.contains('selected')).toBe(false)
        })

        it('should handle multiple show/hide cycles correctly', async () => {
            wildflower.component('multi-cycle-test', {
                state: {
                    visible: false,
                    status: 'a'
                },
                toggle() {
                    this.state.visible = !this.state.visible
                },
                setStatus(value) {
                    this.state.status = value
                }
            })

            testContainer.innerHTML = `
                <div data-component="multi-cycle-test">
                    <button data-action="toggle" class="toggle-btn">Toggle</button>
                    <div data-show="visible" class="panel">
                        <span class="indicator" data-bind-class="status === 'a' ? 'active' : status === 'b' ? 'pending' : 'inactive'"></span>
                    </div>
                </div>
            `

            await waitForUpdate()

            const panel = testContainer.querySelector('.panel')
            const indicator = testContainer.querySelector('.indicator')
            const toggleBtn = testContainer.querySelector('.toggle-btn')
            const componentEl = testContainer.querySelector('[data-component]')
            const component = wildflower.componentInstances.get(componentEl.dataset.componentId)

            // Cycle 1: Show with status 'a'
            toggleBtn.click()
            await waitForUpdate()
            expect(indicator.classList.contains('active')).toBe(true)
            expect(indicator.classList.contains('pending')).toBe(false)

            // Hide, change to 'b', show
            toggleBtn.click()
            await waitForUpdate()
            component.setStatus('b')
            await waitForUpdate()
            toggleBtn.click()
            await waitForUpdate()

            expect(indicator.classList.contains('pending')).toBe(true)
            expect(indicator.classList.contains('active')).toBe(false)

            // Hide, change to 'c', show
            toggleBtn.click()
            await waitForUpdate()
            component.setStatus('c')
            await waitForUpdate()
            toggleBtn.click()
            await waitForUpdate()

            expect(indicator.classList.contains('inactive')).toBe(true)
            expect(indicator.classList.contains('pending')).toBe(false)
            expect(indicator.classList.contains('active')).toBe(false)

            // Hide, change back to 'a', show
            toggleBtn.click()
            await waitForUpdate()
            component.setStatus('a')
            await waitForUpdate()
            toggleBtn.click()
            await waitForUpdate()

            expect(indicator.classList.contains('active')).toBe(true)
            expect(indicator.classList.contains('inactive')).toBe(false)
        })
    })

    describe('Computed properties in class expressions', () => {
        it('should resolve computed properties in data-bind-class expressions', async () => {
            // This tests the bug where computed properties weren't available
            // in class binding expressions (e.g., "'btn ' + sizeClass")
            wildflower.component('computed-class-test', {
                state: {
                    sizeLevel: 0
                },
                computed: {
                    sizeClass() {
                        const sizes = ['btn-sm', '', 'btn-lg']
                        return sizes[this.state.sizeLevel]
                    }
                },
                cycleSize() {
                    this.state.sizeLevel = (this.state.sizeLevel + 1) % 3
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-class-test">
                    <button class="target" data-bind-class="'btn btn-primary ' + sizeClass">Target</button>
                    <button data-action="cycleSize" class="cycle-btn">Cycle Size</button>
                </div>
            `

            await waitForUpdate()

            const target = testContainer.querySelector('.target')
            const cycleBtn = testContainer.querySelector('.cycle-btn')

            // Initial state: sizeLevel=0 → sizeClass='btn-sm'
            expect(target.classList.contains('btn')).toBe(true)
            expect(target.classList.contains('btn-primary')).toBe(true)
            expect(target.classList.contains('btn-sm')).toBe(true)

            // Cycle to sizeLevel=1 → sizeClass=''
            cycleBtn.click()
            await waitForUpdate()

            expect(target.classList.contains('btn')).toBe(true)
            expect(target.classList.contains('btn-primary')).toBe(true)
            expect(target.classList.contains('btn-sm')).toBe(false)
            expect(target.classList.contains('btn-lg')).toBe(false)

            // Cycle to sizeLevel=2 → sizeClass='btn-lg'
            cycleBtn.click()
            await waitForUpdate()

            expect(target.classList.contains('btn')).toBe(true)
            expect(target.classList.contains('btn-primary')).toBe(true)
            expect(target.classList.contains('btn-lg')).toBe(true)
            expect(target.classList.contains('btn-sm')).toBe(false)

            // Cycle back to sizeLevel=0 → sizeClass='btn-sm'
            cycleBtn.click()
            await waitForUpdate()

            expect(target.classList.contains('btn-sm')).toBe(true)
            expect(target.classList.contains('btn-lg')).toBe(false)
        })

        it('should resolve computed properties in ternary expressions', async () => {
            wildflower.component('computed-ternary-test', {
                state: {
                    isActive: false
                },
                computed: {
                    activeClass() {
                        return this.state.isActive ? 'active highlighted' : 'inactive'
                    }
                },
                toggle() {
                    this.state.isActive = !this.state.isActive
                }
            })

            testContainer.innerHTML = `
                <div data-component="computed-ternary-test">
                    <div class="indicator" data-bind-class="activeClass"></div>
                    <button data-action="toggle" class="toggle-btn">Toggle</button>
                </div>
            `

            await waitForUpdate()

            const indicator = testContainer.querySelector('.indicator')
            const toggleBtn = testContainer.querySelector('.toggle-btn')

            // Initial: isActive=false → activeClass='inactive'
            expect(indicator.classList.contains('inactive')).toBe(true)
            expect(indicator.classList.contains('active')).toBe(false)

            // Toggle to active
            toggleBtn.click()
            await waitForUpdate()

            expect(indicator.classList.contains('active')).toBe(true)
            expect(indicator.classList.contains('highlighted')).toBe(true)
            expect(indicator.classList.contains('inactive')).toBe(false)

            // Toggle back to inactive
            toggleBtn.click()
            await waitForUpdate()

            expect(indicator.classList.contains('inactive')).toBe(true)
            expect(indicator.classList.contains('active')).toBe(false)
            expect(indicator.classList.contains('highlighted')).toBe(false)
        })

        it('should handle computed properties combined with state in expressions', async () => {
            wildflower.component('computed-mixed-test', {
                state: {
                    size: 'md',
                    variant: 'primary'
                },
                computed: {
                    sizeClass() {
                        return 'size-' + this.state.size
                    }
                },
                setLarge() { this.state.size = 'lg' },
                setSecondary() { this.state.variant = 'secondary' }
            })

            testContainer.innerHTML = `
                <div data-component="computed-mixed-test">
                    <button class="target" data-bind-class="'btn btn-' + variant + ' ' + sizeClass">Target</button>
                    <button data-action="setLarge" class="large-btn">Large</button>
                    <button data-action="setSecondary" class="secondary-btn">Secondary</button>
                </div>
            `

            await waitForUpdate()

            const target = testContainer.querySelector('.target')

            // Initial: variant='primary', size='md' → sizeClass='size-md'
            expect(target.classList.contains('btn')).toBe(true)
            expect(target.classList.contains('btn-primary')).toBe(true)
            expect(target.classList.contains('size-md')).toBe(true)

            // Change size via state (computed depends on it)
            testContainer.querySelector('.large-btn').click()
            await waitForUpdate()

            expect(target.classList.contains('btn-primary')).toBe(true)
            expect(target.classList.contains('size-lg')).toBe(true)
            expect(target.classList.contains('size-md')).toBe(false)

            // Change variant (direct state)
            testContainer.querySelector('.secondary-btn').click()
            await waitForUpdate()

            expect(target.classList.contains('btn-secondary')).toBe(true)
            expect(target.classList.contains('btn-primary')).toBe(false)
            expect(target.classList.contains('size-lg')).toBe(true)
        })
    })

    describe('Multiple class names', () => {
        it('should handle space-separated class names', async () => {
            wildflower.component('multi-class-test', {
                state: {
                    status: 'success'
                },
                setError() { this.state.status = 'error' },
                setSuccess() { this.state.status = 'success' },
                setWarning() { this.state.status = 'warning' }
            })

            testContainer.innerHTML = `
                <div data-component="multi-class-test">
                    <div class="status-display"
                         data-bind-class="status === 'success' ? 'bg-green text-white' : status === 'error' ? 'bg-red text-white' : 'bg-yellow text-black'"></div>
                    <button data-action="setError" class="error-btn">Error</button>
                    <button data-action="setWarning" class="warning-btn">Warning</button>
                </div>
            `

            await waitForUpdate()

            const display = testContainer.querySelector('.status-display')

            // Should have success classes initially
            expect(display.classList.contains('bg-green')).toBe(true)
            expect(display.classList.contains('text-white')).toBe(true)

            // Switch to error
            testContainer.querySelector('.error-btn').click()
            await waitForUpdate()

            // Should have error classes, not success classes
            expect(display.classList.contains('bg-red')).toBe(true)
            expect(display.classList.contains('text-white')).toBe(true)
            expect(display.classList.contains('bg-green')).toBe(false)

            // Switch to warning
            testContainer.querySelector('.warning-btn').click()
            await waitForUpdate()

            // Should have warning classes, not error classes
            expect(display.classList.contains('bg-yellow')).toBe(true)
            expect(display.classList.contains('text-black')).toBe(true)
            expect(display.classList.contains('bg-red')).toBe(false)
            expect(display.classList.contains('text-white')).toBe(false)
        })
    })

    describe('Component root element bindings', () => {
        it('should apply data-bind-class on the component root element', async () => {
            wildflower.component('root-class-test', {
                state: {
                    mode: 'light'
                },
                computed: {
                    themeClass() {
                        return 'theme-' + this.state.mode
                    }
                },
                toggleMode() {
                    this.state.mode = this.state.mode === 'light' ? 'dark' : 'light'
                }
            })

            testContainer.innerHTML = `
                <div data-component="root-class-test" data-bind-class="themeClass" class="my-app">
                    <button data-action="toggleMode" class="toggle-btn">Toggle</button>
                    <span data-bind="mode" class="mode-display"></span>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForUpdate(100)

            const root = testContainer.querySelector('[data-component="root-class-test"]')

            // Initial state: should have theme-light class AND preserve existing class
            expect(root.classList.contains('theme-light')).toBe(true)
            expect(root.classList.contains('my-app')).toBe(true)

            // Toggle to dark
            testContainer.querySelector('.toggle-btn').click()
            await waitForUpdate()

            // Should swap to theme-dark, remove theme-light, keep my-app
            expect(root.classList.contains('theme-dark')).toBe(true)
            expect(root.classList.contains('theme-light')).toBe(false)
            expect(root.classList.contains('my-app')).toBe(true)

            // Toggle back to light
            testContainer.querySelector('.toggle-btn').click()
            await waitForUpdate()

            expect(root.classList.contains('theme-light')).toBe(true)
            expect(root.classList.contains('theme-dark')).toBe(false)
            expect(root.classList.contains('my-app')).toBe(true)
        })

        it('should apply data-bind on the component root element', async () => {
            wildflower.component('root-bind-test', {
                state: {
                    title: 'Hello'
                },
                changeTitle() {
                    this.state.title = 'Updated'
                }
            })

            testContainer.innerHTML = `
                <div data-component="root-bind-test" data-bind="title">
                    Initial content
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForUpdate(100)

            const root = testContainer.querySelector('[data-component="root-bind-test"]')
            expect(root.textContent.trim()).toBe('Hello')
        })

        it('should apply data-bind-class from store subscription on component root', async () => {
            wildflower.store('root-theme', {
                state: { theme: 'dark' },
                toggle() {
                    this.state.theme = this.state.theme === 'dark' ? 'light' : 'dark'
                }
            })

            wildflower.component('root-store-class-test', {
                subscribe: { 'root-theme': ['theme'] },
                computed: {
                    themeClass() {
                        return 'theme-' + (this.stores['root-theme'].theme || 'dark')
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="root-store-class-test" data-bind-class="themeClass">
                    <span>content</span>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForUpdate(100)

            const root = testContainer.querySelector('[data-component="root-store-class-test"]')
            expect(root.classList.contains('theme-dark')).toBe(true)

            // Toggle via store
            wildflower.getStore('root-theme').toggle()
            await waitForUpdate()

            expect(root.classList.contains('theme-light')).toBe(true)
            expect(root.classList.contains('theme-dark')).toBe(false)

            // Toggle back
            wildflower.getStore('root-theme').toggle()
            await waitForUpdate()

            expect(root.classList.contains('theme-dark')).toBe(true)
            expect(root.classList.contains('theme-light')).toBe(false)
        })

        it('should resolve data-bind-class on child component from parent scope', async () => {
            wildflower.component('parent-with-child', {
                state: {
                    highlight: false
                },
                computed: {
                    childClass() {
                        return this.state.highlight ? 'highlighted' : ''
                    }
                },
                toggleHighlight() {
                    this.state.highlight = !this.state.highlight
                }
            })

            wildflower.component('child-widget', {
                state: { label: 'widget' }
            })

            testContainer.innerHTML = `
                <div data-component="parent-with-child">
                    <button data-action="toggleHighlight" class="toggle-btn">Toggle</button>
                    <div data-component="child-widget" data-bind-class="childClass" class="widget">
                        <span data-bind="label"></span>
                    </div>
                </div>
            `

            wildflower._scanForDynamicComponents()
            await waitForUpdate(100)

            const child = testContainer.querySelector('[data-component="child-widget"]')

            // Initial: no highlight class
            expect(child.classList.contains('highlighted')).toBe(false)
            expect(child.classList.contains('widget')).toBe(true)

            // Parent toggles highlight
            testContainer.querySelector('.toggle-btn').click()
            await waitForUpdate()

            expect(child.classList.contains('highlighted')).toBe(true)
            expect(child.classList.contains('widget')).toBe(true)

            // Toggle back
            testContainer.querySelector('.toggle-btn').click()
            await waitForUpdate()

            expect(child.classList.contains('highlighted')).toBe(false)
            expect(child.classList.contains('widget')).toBe(true)
        })
    })
})
