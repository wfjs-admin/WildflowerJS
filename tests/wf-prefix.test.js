/**
 * Tests for data-wf-* prefix support
 *
 * WildflowerJS should support both data-* and data-wf-* prefixes for all attributes.
 * This allows users to avoid conflicts with third-party libraries that may use
 * the same data-* attributes.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode } from './helpers/load-framework.js';

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms));
}

describe('data-wf-* prefix support', () => {
    let testContainer;
    let wildflower;

    beforeAll(async () => {
        await loadFramework();
    });

    beforeEach(() => {
        wildflower = window.wildflower;

        // Comprehensive framework reset
        if (wildflower.componentDefinitions) {
            wildflower.componentDefinitions.clear();
        }
        if (wildflower.componentInstances) {
            wildflower.componentInstances.clear();
        }
        if (wildflower.storeManager && wildflower.storeManager._namedStores) {
            wildflower.storeManager._namedStores.clear();
        }

        // Clear template cache
        if (wildflower._templateCache) {
            if (wildflower._templateCache.general) wildflower._templateCache.general.clear();
            if (wildflower._templateCache.lists) wildflower._templateCache.lists.clear();
            if (wildflower._templateCache.compiled) wildflower._templateCache.compiled.clear();
            if (wildflower._templateCache.extracted) wildflower._templateCache.extracted.clear();
            if (wildflower._templateCache.fragmentPools) wildflower._templateCache.fragmentPools.clear();
            if (wildflower._templateCache.stats) wildflower._templateCache.stats.clear();
        }

        // Clear additional framework state
        if (wildflower.componentParents) wildflower.componentParents.clear();
        if (wildflower.componentChildren) wildflower.componentChildren.clear();
        if (wildflower.eventHandlers) wildflower.eventHandlers.clear();

        // Reset domElements arrays
        if (wildflower.domElements) {
            wildflower.domElements.bindings = [];
            wildflower.domElements.conditionals = [];
            wildflower.domElements.lists = [];
            wildflower.domElements.models = [];
            wildflower.domElements.slots = [];
        }

        // Re-initialize the context system
        if (wildflower._initContextSystem) {
            wildflower._contextSystemInitialized = false;
            wildflower._initContextSystem();
        }

        testContainer = document.createElement('div');
        testContainer.id = 'test-container';
        testContainer.style.position = 'absolute';
        testContainer.style.left = '-9999px';
        testContainer.style.opacity = '0';
        document.body.appendChild(testContainer);
    });

    afterEach(() => {
        // Cleanup components
        if (wildflower) {
            wildflower.componentInstances.forEach((instance, id) => {
                try {
                    wildflower.destroyComponent(id);
                } catch (e) {}
            });
            wildflower.componentDefinitions.clear();
        }
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer);
        }
    });

    describe('data-wf-bind', () => {
        it('should bind text content using data-wf-bind', async () => {
            wildflower.component('wf-bind-test', {
                state: { message: 'Hello WF Prefix' }
            });

            testContainer.innerHTML = `
                <div data-component="wf-bind-test">
                    <span data-wf-bind="message"></span>
                </div>
            `;

            wildflower.scan();
            await waitForUpdate(100);

            const span = testContainer.querySelector('span');
            expect(span.textContent).toBe('Hello WF Prefix');
        });

        it('should update when state changes using data-wf-bind', async () => {
            wildflower.component('wf-bind-update-test', {
                state: { count: 0 }
            });

            testContainer.innerHTML = `
                <div data-component="wf-bind-update-test">
                    <span data-wf-bind="count"></span>
                </div>
            `;

            wildflower.scan();
            await waitForUpdate(100);

            const componentEl = testContainer.querySelector('[data-component]');
            const component = wildflower.componentInstances.get(componentEl.dataset.componentId);

            component.state.count = 42;
            await waitForUpdate(100);

            const span = testContainer.querySelector('span');
            expect(span.textContent).toBe('42');
        });
    });

    describe('data-wf-show', () => {
        it('should show/hide elements using data-wf-show', async () => {
            wildflower.component('wf-show-test', {
                state: { visible: false }
            });

            testContainer.innerHTML = `
                <div data-component="wf-show-test">
                    <div data-wf-show="visible" class="target">Content</div>
                </div>
            `;

            wildflower.scan();
            await waitForUpdate(100);

            const target = testContainer.querySelector('.target');
            expect(target.style.display).toBe('none');

            const componentEl = testContainer.querySelector('[data-component]');
            const component = wildflower.componentInstances.get(componentEl.dataset.componentId);

            component.state.visible = true;
            await waitForUpdate(100);

            expect(target.style.display).toBe('');
        });
    });

    describe('data-wf-model', () => {
        it('should two-way bind using data-wf-model', async () => {
            wildflower.component('wf-model-test', {
                state: { inputValue: 'initial' }
            });

            testContainer.innerHTML = `
                <div data-component="wf-model-test">
                    <input type="text" data-wf-model="inputValue">
                    <span data-wf-bind="inputValue"></span>
                </div>
            `;

            wildflower.scan();
            await waitForUpdate(100);

            const input = testContainer.querySelector('input');
            expect(input.value).toBe('initial');

            const componentEl = testContainer.querySelector('[data-component]');
            const component = wildflower.componentInstances.get(componentEl.dataset.componentId);

            // Simulate user input
            input.value = 'changed';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await waitForUpdate(100);

            expect(component.state.inputValue).toBe('changed');
        });
    });

    describe('data-wf-action', () => {
        it('should handle click events using data-wf-action', async () => {
            let clicked = false;
            wildflower.component('wf-action-test', {
                state: {},
                handleClick() {
                    clicked = true;
                }
            });

            testContainer.innerHTML = `
                <div data-component="wf-action-test">
                    <button data-wf-action="handleClick">Click Me</button>
                </div>
            `;

            wildflower.scan();
            await waitForUpdate(100);

            const button = testContainer.querySelector('button');
            button.click();
            await waitForUpdate(50);

            expect(clicked).toBe(true);
        });

        it('should handle custom events using data-wf-action with event type', async () => {
            let inputValue = '';
            wildflower.component('wf-action-input-test', {
                state: {},
                handleInput(e) {
                    inputValue = e.target.value;
                }
            });

            testContainer.innerHTML = `
                <div data-component="wf-action-input-test">
                    <input type="text" data-wf-action="input:handleInput">
                </div>
            `;

            wildflower.scan();
            await waitForUpdate(100);

            const input = testContainer.querySelector('input');
            input.value = 'test value';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await waitForUpdate(50);

            expect(inputValue).toBe('test value');
        });
    });

    describe('data-wf-list', () => {
        it('should render lists using data-wf-list', async () => {
            wildflower.component('wf-list-test', {
                state: {
                    items: [
                        { name: 'Item 1' },
                        { name: 'Item 2' },
                        { name: 'Item 3' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="wf-list-test">
                    <ul data-wf-list="items">
                        <template>
                            <li data-wf-bind="name"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan();
            await waitForUpdate(150);

            const items = testContainer.querySelectorAll('li');
            expect(items.length).toBe(3);
            expect(items[0].textContent).toBe('Item 1');
            expect(items[1].textContent).toBe('Item 2');
            expect(items[2].textContent).toBe('Item 3');
        });
    });

    describe('data-wf-bind-class', () => {
        it('should conditionally apply classes using data-wf-bind-class', async () => {
            wildflower.component('wf-bind-class-test', {
                state: { isActive: false }
            });

            testContainer.innerHTML = `
                <div data-component="wf-bind-class-test">
                    <div data-wf-bind-class="isActive ? 'active' : ''" class="target">Content</div>
                </div>
            `;

            wildflower.scan();
            await waitForUpdate(100);

            const target = testContainer.querySelector('.target');
            expect(target.classList.contains('active')).toBe(false);

            const componentEl = testContainer.querySelector('[data-component]');
            const component = wildflower.componentInstances.get(componentEl.dataset.componentId);

            component.state.isActive = true;
            await waitForUpdate(100);

            expect(target.classList.contains('active')).toBe(true);
        });
    });

    describe('data-wf-bind-html', () => {
        it('should bind HTML content using data-wf-bind-html', async () => {
            wildflower.component('wf-bind-html-test', {
                state: { htmlContent: '<strong>Bold</strong> text' }
            });

            testContainer.innerHTML = `
                <div data-component="wf-bind-html-test">
                    <div data-wf-bind-html="htmlContent"></div>
                </div>
            `;

            wildflower.scan();
            await waitForUpdate(100);

            const div = testContainer.querySelector('[data-wf-bind-html]');
            expect(div.innerHTML).toBe('<strong>Bold</strong> text');
        });
    });

    describe('data-wf-render', () => {
        it('should conditionally render elements using data-wf-render', async () => {
            wildflower.component('wf-render-test', {
                state: { showElement: false }
            });

            testContainer.innerHTML = `
                <div data-component="wf-render-test">
                    <div data-wf-render="showElement" class="conditional">Conditional Content</div>
                </div>
            `;

            wildflower.scan();
            await waitForUpdate(100);

            // Element should not be visible when false
            let conditional = testContainer.querySelector('.conditional');
            const isHidden = conditional === null ||
                             conditional.style.display === 'none' ||
                             !document.body.contains(conditional);
            expect(isHidden).toBe(true);

            const componentEl = testContainer.querySelector('[data-component]');
            const component = wildflower.componentInstances.get(componentEl.dataset.componentId);

            component.state.showElement = true;
            await waitForUpdate(100);

            // Element should be visible when true
            conditional = testContainer.querySelector('.conditional');
            expect(conditional).not.toBeNull();
        });
    });

    describe('mixed prefix usage', () => {
        it('should work with mixed data-* and data-wf-* attributes in same component', async () => {
            wildflower.component('mixed-prefix-test', {
                state: {
                    message: 'Hello',
                    count: 42,
                    visible: true
                }
            });

            testContainer.innerHTML = `
                <div data-component="mixed-prefix-test">
                    <span class="standard-bind" data-bind="message"></span>
                    <span class="wf-bind" data-wf-bind="count"></span>
                    <div data-show="visible" class="standard-show">Standard</div>
                    <div data-wf-show="visible" class="wf-show">Prefixed</div>
                </div>
            `;

            wildflower.scan();
            await waitForUpdate(100);

            // Both binding styles should work
            const standardBind = testContainer.querySelector('.standard-bind');
            const wfBind = testContainer.querySelector('.wf-bind');
            expect(standardBind.textContent).toBe('Hello');
            expect(wfBind.textContent).toBe('42');

            // Both show styles should work
            const standardShow = testContainer.querySelector('.standard-show');
            const wfShow = testContainer.querySelector('.wf-show');
            expect(standardShow.style.display).toBe('');
            expect(wfShow.style.display).toBe('');
        });

        it('should work with data-wf-* in list templates', async () => {
            wildflower.component('wf-list-mixed-test', {
                state: {
                    items: [
                        { name: 'First', active: true },
                        { name: 'Second', active: false }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="wf-list-mixed-test">
                    <ul data-wf-list="items">
                        <template>
                            <li data-wf-bind="name"
                                data-wf-bind-class="active ? 'active' : ''"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan();
            await waitForUpdate(150);

            const items = testContainer.querySelectorAll('li');
            expect(items.length).toBe(2);
            expect(items[0].textContent).toBe('First');
            expect(items[0].classList.contains('active')).toBe(true);
            expect(items[1].textContent).toBe('Second');
            expect(items[1].classList.contains('active')).toBe(false);
        });
    });

    describe('data-wf-component', () => {
        it('should support data-wf-component for component declaration', async () => {
            wildflower.component('wf-component-test', {
                state: { value: 'Component Works' }
            });

            testContainer.innerHTML = `
                <div data-wf-component="wf-component-test">
                    <span data-wf-bind="value"></span>
                </div>
            `;

            wildflower.scan();
            await waitForUpdate(100);

            const span = testContainer.querySelector('span');
            expect(span.textContent).toBe('Component Works');
        });
    });

    describe('data-wf-event-* modifiers', () => {
        it('should support data-wf-event-debounce', async () => {
            let callCount = 0;
            wildflower.component('wf-event-debounce-test', {
                state: {},
                handleInput() {
                    callCount++;
                }
            });

            testContainer.innerHTML = `
                <div data-component="wf-event-debounce-test">
                    <input type="text"
                           data-wf-action="input:handleInput"
                           data-wf-event-debounce="50">
                </div>
            `;

            wildflower.scan();
            await waitForUpdate(100);

            const input = testContainer.querySelector('input');

            // Fire multiple rapid inputs
            for (let i = 0; i < 5; i++) {
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }

            // Wait for debounce
            await waitForUpdate(150);

            // Should only have been called once due to debounce
            expect(callCount).toBe(1);
        });
    });

    // =============================================================================
    // SAMPLED TESTS FROM OTHER TEST FILES - Converted to use data-wf-* prefixes
    // These tests verify that the wf prefix works identically to the standard prefix
    // =============================================================================

    describe('Sampled from lists.test.js - using data-wf-* prefixes', () => {
        it('list push operation updates DOM correctly', async () => {
            testContainer.innerHTML = `
                <div data-wf-component="wf-list-push-test">
                    <ul data-wf-list="items">
                        <template>
                            <li>
                                <span class="name" data-wf-bind="name"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.component('wf-list-push-test', {
                state: {
                    items: [
                        { id: 1, name: 'Item 1' },
                        { id: 2, name: 'Item 2' }
                    ]
                }
            });

            wildflower.scan();
            await waitForUpdate(150);

            let listItems = testContainer.querySelectorAll('li:not(template)');
            expect(listItems.length).toBe(2);

            // Push a new item
            const componentEl = testContainer.querySelector('[data-wf-component]');
            const component = wildflower.componentInstances.get(componentEl.dataset.componentId);
            component.state.items.push({ id: 3, name: 'Item 3' });
            await waitForUpdate(150);

            listItems = testContainer.querySelectorAll('li:not(template)');
            expect(listItems.length).toBe(3);
            expect(listItems[2].querySelector('.name').textContent).toBe('Item 3');
        });

        it('list splice removes items correctly', async () => {
            testContainer.innerHTML = `
                <div data-wf-component="wf-list-splice-test">
                    <ul data-wf-list="items">
                        <template>
                            <li data-wf-bind="name"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.component('wf-list-splice-test', {
                state: {
                    items: [
                        { name: 'First' },
                        { name: 'Second' },
                        { name: 'Third' }
                    ]
                }
            });

            wildflower.scan();
            await waitForUpdate(150);

            let listItems = testContainer.querySelectorAll('li:not(template)');
            expect(listItems.length).toBe(3);

            // Remove middle item
            const componentEl = testContainer.querySelector('[data-wf-component]');
            const component = wildflower.componentInstances.get(componentEl.dataset.componentId);
            component.state.items.splice(1, 1);
            await waitForUpdate(150);

            listItems = testContainer.querySelectorAll('li:not(template)');
            expect(listItems.length).toBe(2);
            expect(listItems[0].textContent).toBe('First');
            expect(listItems[1].textContent).toBe('Third');
        });

        it('list with action buttons in items', async () => {
            let removedIndex = -1;

            testContainer.innerHTML = `
                <div data-wf-component="wf-list-action-test">
                    <ul data-wf-list="items">
                        <template>
                            <li>
                                <span data-wf-bind="name"></span>
                                <button data-wf-action="removeItem">Remove</button>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.component('wf-list-action-test', {
                state: {
                    items: [
                        { name: 'Item A' },
                        { name: 'Item B' },
                        { name: 'Item C' }
                    ]
                },
                removeItem(event, element, detail) {
                    removedIndex = detail.index;
                    this.state.items.splice(detail.index, 1);
                }
            });

            wildflower.scan();
            await waitForUpdate(150);

            const buttons = testContainer.querySelectorAll('button');
            expect(buttons.length).toBe(3);

            // Click middle remove button
            buttons[1].click();
            await waitForUpdate(150);

            expect(removedIndex).toBe(1);
            const listItems = testContainer.querySelectorAll('li:not(template)');
            expect(listItems.length).toBe(2);
        });
    });

    describe('Sampled from conditionals.test.js - using data-wf-* prefixes', () => {
        it('negated conditions show when false', async () => {
            testContainer.innerHTML = `
                <div data-wf-component="wf-negation-test">
                    <div id="loading-indicator" data-wf-show="isLoading">Loading...</div>
                    <div id="content-area" data-wf-show="!isLoading">Content is ready!</div>
                </div>
            `;

            wildflower.component('wf-negation-test', {
                state: {
                    isLoading: true
                }
            });

            wildflower.scan();
            await waitForUpdate(100);

            const componentEl = testContainer.querySelector('[data-wf-component]');
            const component = wildflower.componentInstances.get(componentEl.dataset.componentId);
            const loadingElement = testContainer.querySelector('#loading-indicator');
            const contentElement = testContainer.querySelector('#content-area');

            // Initial state: loading is true
            expect(loadingElement.style.display).not.toBe('none');
            expect(contentElement.style.display).toBe('none');

            // Toggle loading
            component.state.isLoading = false;
            await waitForUpdate(100);

            // After toggle
            expect(loadingElement.style.display).toBe('none');
            expect(contentElement.style.display).not.toBe('none');
        });

        it('conditional inside list items', async () => {
            testContainer.innerHTML = `
                <div data-wf-component="wf-list-conditional-test">
                    <ul data-wf-list="items">
                        <template>
                            <li>
                                <span data-wf-bind="name"></span>
                                <span class="badge" data-wf-show="featured">★</span>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.component('wf-list-conditional-test', {
                state: {
                    items: [
                        { name: 'Item 1', featured: true },
                        { name: 'Item 2', featured: false },
                        { name: 'Item 3', featured: true }
                    ]
                }
            });

            wildflower.scan();
            await waitForUpdate(150);

            const badges = testContainer.querySelectorAll('.badge');
            expect(badges.length).toBe(3);

            // Check visibility based on featured flag
            expect(badges[0].style.display).not.toBe('none'); // featured: true
            expect(badges[1].style.display).toBe('none');     // featured: false
            expect(badges[2].style.display).not.toBe('none'); // featured: true
        });
    });

    describe('Sampled from bindings.test.js - using data-wf-* prefixes', () => {
        it('binding context creation and reactive updates', async () => {
            testContainer.innerHTML = `
                <div data-wf-component="wf-reactive-binding-test">
                    <span data-wf-bind="message"></span>
                    <div data-wf-bind="count"></div>
                </div>
            `;

            wildflower.component('wf-reactive-binding-test', {
                state: {
                    message: 'Hello World',
                    count: 42
                }
            });

            wildflower.scan();
            await waitForUpdate(100);

            const componentEl = testContainer.querySelector('[data-wf-component]');
            const component = wildflower.componentInstances.get(componentEl.dataset.componentId);
            const messageElement = testContainer.querySelector('[data-wf-bind="message"]');
            const countElement = testContainer.querySelector('[data-wf-bind="count"]');

            // Check initial values
            expect(messageElement.textContent).toBe('Hello World');
            expect(countElement.textContent).toBe('42');

            // Update state and verify reactive update
            component.state.message = 'Updated Message';
            component.state.count = 100;
            await waitForUpdate(100);

            expect(messageElement.textContent).toBe('Updated Message');
            expect(countElement.textContent).toBe('100');
        });

        it('nested property binding', async () => {
            testContainer.innerHTML = `
                <div data-wf-component="wf-nested-binding-test">
                    <span data-wf-bind="user.name"></span>
                    <span data-wf-bind="user.email"></span>
                </div>
            `;

            wildflower.component('wf-nested-binding-test', {
                state: {
                    user: {
                        name: 'John Doe',
                        email: 'john@example.com'
                    }
                }
            });

            wildflower.scan();
            await waitForUpdate(100);

            const nameEl = testContainer.querySelector('[data-wf-bind="user.name"]');
            const emailEl = testContainer.querySelector('[data-wf-bind="user.email"]');

            expect(nameEl.textContent).toBe('John Doe');
            expect(emailEl.textContent).toBe('john@example.com');

            // Update nested property
            const componentEl = testContainer.querySelector('[data-wf-component]');
            const component = wildflower.componentInstances.get(componentEl.dataset.componentId);
            component.state.user.name = 'Jane Doe';
            await waitForUpdate(100);

            expect(nameEl.textContent).toBe('Jane Doe');
        });

        it('falsy values display correctly (0, empty string)', async () => {
            testContainer.innerHTML = `
                <div data-wf-component="wf-falsy-test">
                    <span class="zero" data-wf-bind="zeroValue"></span>
                    <span class="empty" data-wf-bind="emptyString"></span>
                </div>
            `;

            wildflower.component('wf-falsy-test', {
                state: {
                    zeroValue: 0,
                    emptyString: ''
                }
            });

            wildflower.scan();
            await waitForUpdate(100);

            const zeroEl = testContainer.querySelector('.zero');
            const emptyEl = testContainer.querySelector('.empty');

            // 0 should display as "0", not be empty
            expect(zeroEl.textContent).toBe('0');
            expect(emptyEl.textContent).toBe('');
        });
    });

    describe('Sampled from actions.test.js - using data-wf-* prefixes', () => {
        it('action with state modification and UI update', async () => {
            let actionCallCount = 0;

            testContainer.innerHTML = `
                <div data-wf-component="wf-counter-action-test">
                    <button id="increment-button" data-wf-action="incrementCount">Increment</button>
                    <div id="count-display" data-wf-bind="count"></div>
                </div>
            `;

            wildflower.component('wf-counter-action-test', {
                state: {
                    count: 0
                },
                incrementCount(event, element) {
                    this.state.count++;
                    actionCallCount++;
                }
            });

            wildflower.scan();
            await waitForUpdate(100);

            const button = testContainer.querySelector('#increment-button');
            const display = testContainer.querySelector('#count-display');

            // Test initial state
            expect(display.textContent).toBe('0');
            expect(actionCallCount).toBe(0);

            // Click multiple times
            button.click();
            await waitForUpdate(50);
            expect(display.textContent).toBe('1');

            button.click();
            await waitForUpdate(50);
            expect(display.textContent).toBe('2');

            expect(actionCallCount).toBe(2);
        });

        it('multiple event types on different elements', async () => {
            let eventLog = [];

            testContainer.innerHTML = `
                <div data-wf-component="wf-multi-event-test">
                    <input id="name-input" data-wf-action="input:updateName" value="">
                    <button id="reset-button" data-wf-action="click:resetName">Reset</button>
                    <div id="name-display" data-wf-bind="name"></div>
                </div>
            `;

            wildflower.component('wf-multi-event-test', {
                state: {
                    name: ''
                },
                updateName(event) {
                    this.state.name = event.target.value;
                    eventLog.push('input');
                },
                resetName() {
                    this.state.name = '';
                    eventLog.push('reset');
                }
            });

            wildflower.scan();
            await waitForUpdate(100);

            const input = testContainer.querySelector('#name-input');
            const resetButton = testContainer.querySelector('#reset-button');
            const display = testContainer.querySelector('#name-display');

            // Input event
            input.value = 'Test Name';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await waitForUpdate(50);

            expect(display.textContent).toBe('Test Name');
            expect(eventLog).toContain('input');

            // Click reset
            resetButton.click();
            await waitForUpdate(50);

            expect(display.textContent).toBe('');
            expect(eventLog).toContain('reset');
        });
    });

    describe('Complex scenarios - all wf-prefixed', () => {
        it('complete CRUD-like component using all wf prefixes', async () => {
            testContainer.innerHTML = `
                <div data-wf-component="wf-crud-test">
                    <input type="text" data-wf-model="newItemName" placeholder="New item name">
                    <button data-wf-action="addItem">Add</button>

                    <div data-wf-show="items.length === 0" class="empty-state">No items yet</div>

                    <ul data-wf-list="items">
                        <template>
                            <li data-wf-bind-class="completed ? 'done' : ''">
                                <span data-wf-bind="name"></span>
                                <button class="toggle-btn" data-wf-action="toggleComplete">Toggle</button>
                                <button class="delete-btn" data-wf-action="deleteItem">Delete</button>
                            </li>
                        </template>
                    </ul>

                    <div class="count" data-wf-bind="itemCount"></div>
                </div>
            `;

            wildflower.component('wf-crud-test', {
                state: {
                    newItemName: '',
                    items: [],
                    itemCount: 0
                },
                addItem() {
                    if (this.state.newItemName.trim()) {
                        this.state.items.push({
                            name: this.state.newItemName,
                            completed: false
                        });
                        this.state.itemCount = this.state.items.length;
                        this.state.newItemName = '';
                    }
                },
                toggleComplete(event, element, detail) {
                    this.state.items[detail.index].completed = !this.state.items[detail.index].completed;
                },
                deleteItem(event, element, detail) {
                    this.state.items.splice(detail.index, 1);
                    this.state.itemCount = this.state.items.length;
                }
            });

            wildflower.scan();
            await waitForUpdate(100);

            const input = testContainer.querySelector('input');
            const addButton = testContainer.querySelector('button');
            const emptyState = testContainer.querySelector('.empty-state');
            const countDisplay = testContainer.querySelector('.count');

            // Initial: empty state shown
            expect(emptyState.style.display).not.toBe('none');
            expect(countDisplay.textContent).toBe('0');

            // Add items
            input.value = 'First Task';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await waitForUpdate(50);
            addButton.click();
            await waitForUpdate(150);

            input.value = 'Second Task';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await waitForUpdate(50);
            addButton.click();
            await waitForUpdate(150);

            // Verify list rendered
            let listItems = testContainer.querySelectorAll('li:not(template)');
            expect(listItems.length).toBe(2);
            expect(countDisplay.textContent).toBe('2');

            // Toggle completion on first item
            const toggleBtns = testContainer.querySelectorAll('.toggle-btn');
            toggleBtns[0].click();
            await waitForUpdate(100);

            listItems = testContainer.querySelectorAll('li:not(template)');
            expect(listItems[0].classList.contains('done')).toBe(true);

            // Delete second item
            const deleteBtns = testContainer.querySelectorAll('.delete-btn');
            deleteBtns[1].click();
            await waitForUpdate(150);

            listItems = testContainer.querySelectorAll('li:not(template)');
            expect(listItems.length).toBe(1);
            expect(countDisplay.textContent).toBe('1');
        });
    });
});
