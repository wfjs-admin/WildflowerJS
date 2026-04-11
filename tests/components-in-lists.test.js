/**
 * Components in Lists Test Suite
 *
 * Tests that components inside data-list templates correctly own their internal bindings.
 * The list renderer should process bindings ON the component root element (for passing data),
 * but SKIP bindings INSIDE the component (those belong to the component's context).
 *
 * Related: docs/future/COMPONENT_IN_LIST_BOUNDARY_FIX_2026-01-17.md
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework } from './helpers/load-framework.js';

describe('Components in Lists', () => {
    let container;
    let wf;

    beforeAll(async () => {
        await loadFramework();
    });

    beforeEach(() => {
        wf = window.wildflower;
        resetFramework();

        if (wf._initContextSystem) {
            wf._contextSystemInitialized = false;
            wf._initContextSystem();
        }

        container = document.createElement('div');
        container.id = 'test-container';
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
    });

    const waitForUpdate = () => new Promise(resolve => setTimeout(resolve, 50));

    describe('Core Functionality', () => {
        it('component internal data-show binds to component state, not list context', async () => {
            wf.component('list-host-1', {
                state: {
                    items: [
                        { id: 'a', isOpen: true },  // List item has isOpen: true
                        { id: 'b', isOpen: true }
                    ]
                }
            });

            wf.component('item-card-1', {
                state: {
                    isOpen: false  // Component state has isOpen: false
                }
            });

            container.innerHTML = `
                <div data-component="list-host-1">
                    <div data-list="items" data-key="id">
                        <template>
                            <div data-component="item-card-1" data-bind-attr="({ 'data-item-id': id })">
                                <div class="details" data-show="isOpen">Details content</div>
                            </div>
                        </template>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            // The data-show should bind to component's isOpen (false), not list item's isOpen (true)
            const details = container.querySelectorAll('.details');
            expect(details.length).toBe(2);

            // Both should be hidden because component state.isOpen is false
            details.forEach(el => {
                expect(el.classList.contains('wf-show')).toBe(false);
            });
        });

        it('component internal data-bind binds to component state', async () => {
            wf.component('list-host-2', {
                state: {
                    items: [
                        { id: 'x', label: 'List Label X' },
                        { id: 'y', label: 'List Label Y' }
                    ]
                }
            });

            wf.component('item-card-2', {
                state: {
                    label: 'Component Label'
                }
            });

            container.innerHTML = `
                <div data-component="list-host-2">
                    <div data-list="items" data-key="id">
                        <template>
                            <div data-component="item-card-2">
                                <span class="internal-label" data-bind="label"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            // The data-bind should show component's label, not list item's label
            const labels = container.querySelectorAll('.internal-label');
            expect(labels.length).toBe(2);

            labels.forEach(el => {
                expect(el.textContent).toBe('Component Label');
            });
        });

        it('component internal data-action calls component method', async () => {
            let hostActionCalled = false;
            let componentActionCalled = false;
            let calledComponentId = null;

            wf.component('list-host-3', {
                state: {
                    items: [{ id: 'item1' }, { id: 'item2' }]
                },
                toggle() {
                    hostActionCalled = true;
                }
            });

            wf.component('item-card-3', {
                state: {
                    toggleCount: 0
                },
                toggle() {
                    componentActionCalled = true;
                    calledComponentId = this.element.dataset.itemId;
                    this.state.toggleCount++;
                },
                init() {
                    // Store item ID from DOM attribute
                    this._itemId = this.element.dataset.itemId;
                }
            });

            container.innerHTML = `
                <div data-component="list-host-3">
                    <div data-list="items" data-key="id">
                        <template>
                            <div data-component="item-card-3" data-bind-attr="({ 'data-item-id': id })">
                                <button class="toggle-btn" data-action="toggle">Toggle</button>
                            </div>
                        </template>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            // Click the first toggle button
            const buttons = container.querySelectorAll('.toggle-btn');
            expect(buttons.length).toBe(2);

            buttons[0].click();
            await waitForUpdate();

            // Should call component's toggle, not host's
            expect(componentActionCalled).toBe(true);
            expect(hostActionCalled).toBe(false);
            expect(calledComponentId).toBe('item1');
        });

        it('component computed properties work inside list', async () => {
            wf.component('list-host-4', {
                state: {
                    items: [{ id: 'c1' }, { id: 'c2' }]
                }
            });

            wf.component('item-card-4', {
                state: {
                    count: 5
                },
                computed: {
                    doubled() {
                        return this.state.count * 2;
                    },
                    isHighCount() {
                        return this.state.count > 3;
                    }
                }
            });

            container.innerHTML = `
                <div data-component="list-host-4">
                    <div data-list="items" data-key="id">
                        <template>
                            <div data-component="item-card-4">
                                <span class="doubled" data-bind="computed:doubled"></span>
                                <div class="high-indicator" data-show="computed:isHighCount">High!</div>
                            </div>
                        </template>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            const doubled = container.querySelectorAll('.doubled');
            const indicators = container.querySelectorAll('.high-indicator');

            expect(doubled.length).toBe(2);
            expect(indicators.length).toBe(2);

            doubled.forEach(el => {
                expect(el.textContent).toBe('10');
            });

            indicators.forEach(el => {
                expect(el.classList.contains('wf-show')).toBe(true);
            });
        });

        it('component root element bindings still use list context', async () => {
            wf.component('list-host-5', {
                state: {
                    items: [
                        { id: 'r1', bgColor: '#ff0000' },
                        { id: 'r2', bgColor: '#00ff00' }
                    ]
                }
            });

            wf.component('item-card-5', {
                state: {}
            });

            container.innerHTML = `
                <div data-component="list-host-5">
                    <div data-list="items" data-key="id">
                        <template>
                            <div data-component="item-card-5"
                                 data-bind-attr="({ 'data-item-id': id })"
                                 data-bind-style="({ backgroundColor: bgColor })">
                                <span>Content</span>
                            </div>
                        </template>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            const cards = container.querySelectorAll('[data-component="item-card-5"]');
            expect(cards.length).toBe(2);

            // Root element bindings should use list context
            expect(cards[0].dataset.itemId).toBe('r1');
            expect(cards[0].style.backgroundColor).toBe('rgb(255, 0, 0)');

            expect(cards[1].dataset.itemId).toBe('r2');
            expect(cards[1].style.backgroundColor).toBe('rgb(0, 255, 0)');
        });
    });

    describe('Edge Cases', () => {
        it('nested components in list - each owns its bindings', async () => {
            wf.component('list-host-nested', {
                state: {
                    items: [{ id: 'n1' }]
                }
            });

            wf.component('outer-comp', {
                state: {
                    outerValue: 'OUTER'
                }
            });

            wf.component('inner-comp', {
                state: {
                    innerValue: 'INNER'
                }
            });

            container.innerHTML = `
                <div data-component="list-host-nested">
                    <div data-list="items" data-key="id">
                        <template>
                            <div data-component="outer-comp">
                                <span class="outer-bind" data-bind="outerValue"></span>
                                <div data-component="inner-comp">
                                    <span class="inner-bind" data-bind="innerValue"></span>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            const outerBind = container.querySelector('.outer-bind');
            const innerBind = container.querySelector('.inner-bind');

            expect(outerBind.textContent).toBe('OUTER');
            expect(innerBind.textContent).toBe('INNER');
        });

        it('multiple components in same list item', async () => {
            wf.component('list-host-multi', {
                state: {
                    items: [{ id: 'm1' }]
                }
            });

            wf.component('comp-a', {
                state: { value: 'Value A' }
            });

            wf.component('comp-b', {
                state: { value: 'Value B' }
            });

            container.innerHTML = `
                <div data-component="list-host-multi">
                    <div data-list="items" data-key="id">
                        <template>
                            <div class="item-wrapper">
                                <div data-component="comp-a">
                                    <span class="a-value" data-bind="value"></span>
                                </div>
                                <div data-component="comp-b">
                                    <span class="b-value" data-bind="value"></span>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            expect(container.querySelector('.a-value').textContent).toBe('Value A');
            expect(container.querySelector('.b-value').textContent).toBe('Value B');
        });

        it('data-model inside component in list binds to component state', async () => {
            wf.component('list-host-model', {
                state: {
                    items: [{ id: 'dm1', inputValue: 'list-value' }]
                }
            });

            wf.component('input-comp', {
                state: {
                    inputValue: 'component-value'
                }
            });

            container.innerHTML = `
                <div data-component="list-host-model">
                    <div data-list="items" data-key="id">
                        <template>
                            <div data-component="input-comp">
                                <input type="text" class="comp-input" data-model="inputValue">
                            </div>
                        </template>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            const input = container.querySelector('.comp-input');

            // Should show component's inputValue, not list item's
            expect(input.value).toBe('component-value');

            // Simulate typing
            input.value = 'new-value';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await waitForUpdate();

            // Get component instance and verify state changed
            const compEl = container.querySelector('[data-component="input-comp"]');
            const compId = compEl.dataset.componentId;
            const compInstance = wf.componentInstances.get(compId);

            expect(compInstance.state.inputValue).toBe('new-value');
        });

        it('nested list inside component inside list', async () => {
            wf.component('outer-list-host', {
                state: {
                    categories: [
                        { id: 'cat1', name: 'Category 1' }
                    ]
                }
            });

            wf.component('category-comp', {
                state: {
                    subItems: [
                        { id: 'sub1', label: 'Sub Item 1' },
                        { id: 'sub2', label: 'Sub Item 2' }
                    ]
                }
            });

            container.innerHTML = `
                <div data-component="outer-list-host">
                    <div data-list="categories" data-key="id">
                        <template>
                            <div data-component="category-comp" data-bind-attr="({ 'data-cat-id': id })">
                                <h3 class="cat-name" data-bind="name">Should NOT show</h3>
                                <div data-list="subItems" data-key="id">
                                    <template>
                                        <div class="sub-item" data-bind="label"></div>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            // The inner list should bind to component's subItems
            const subItems = container.querySelectorAll('.sub-item');
            expect(subItems.length).toBe(2);
            expect(subItems[0].textContent).toBe('Sub Item 1');
            expect(subItems[1].textContent).toBe('Sub Item 2');

            // The h3 should NOT show category name (it's inside component, bound to component context)
            // Since component doesn't have 'name' in state, it should be empty or unchanged
            const catName = container.querySelector('.cat-name');
            expect(catName.textContent).not.toBe('Category 1');
        });

        it('component state preserved on list re-render with data-key', async () => {
            wf.component('list-host-rerender', {
                state: {
                    items: [
                        { id: 'p1', name: 'Item 1' },
                        { id: 'p2', name: 'Item 2' }
                    ]
                },
                addItem() {
                    this.state.items = [...this.state.items, { id: 'p3', name: 'Item 3' }];
                }
            });

            wf.component('stateful-comp', {
                state: {
                    clickCount: 0
                },
                increment() {
                    this.state.clickCount++;
                }
            });

            container.innerHTML = `
                <div data-component="list-host-rerender">
                    <button class="add-btn" data-action="addItem">Add</button>
                    <div data-list="items" data-key="id">
                        <template>
                            <div data-component="stateful-comp" data-bind-attr="({ 'data-item-id': id })">
                                <span class="count" data-bind="clickCount"></span>
                                <button class="inc-btn" data-action="increment">+</button>
                            </div>
                        </template>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            // Click increment on first item twice
            const incButtons = container.querySelectorAll('.inc-btn');
            incButtons[0].click();
            await waitForUpdate();
            incButtons[0].click();
            await waitForUpdate();

            // Verify count is 2
            let counts = container.querySelectorAll('.count');
            expect(counts[0].textContent).toBe('2');
            expect(counts[1].textContent).toBe('0');

            // Add new item (triggers re-render)
            container.querySelector('.add-btn').click();
            await waitForUpdate();

            // First item should still have count 2 (state preserved)
            counts = container.querySelectorAll('.count');
            expect(counts.length).toBe(3);
            expect(counts[0].textContent).toBe('2');
            expect(counts[1].textContent).toBe('0');
            expect(counts[2].textContent).toBe('0');
        });

        it('component with no internal bindings still works', async () => {
            let initCalled = false;
            let elementAvailable = false;

            wf.component('list-host-simple', {
                state: {
                    items: [{ id: 's1' }]
                }
            });

            wf.component('simple-comp', {
                state: {},
                init() {
                    initCalled = true;
                    elementAvailable = !!this.element;
                }
            });

            container.innerHTML = `
                <div data-component="list-host-simple">
                    <div data-list="items" data-key="id">
                        <template>
                            <div data-component="simple-comp">
                                <span>Static content</span>
                            </div>
                        </template>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            expect(initCalled).toBe(true);
            expect(elementAvailable).toBe(true);
        });
    });

    describe('Regression Tests', () => {
        it('lists without components work as before', async () => {
            wf.component('plain-list-host', {
                state: {
                    items: [
                        { id: 'pl1', name: 'Plain 1' },
                        { id: 'pl2', name: 'Plain 2' }
                    ]
                }
            });

            container.innerHTML = `
                <div data-component="plain-list-host">
                    <div data-list="items" data-key="id">
                        <template>
                            <div class="plain-item">
                                <span class="plain-name" data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            const names = container.querySelectorAll('.plain-name');
            expect(names.length).toBe(2);
            expect(names[0].textContent).toBe('Plain 1');
            expect(names[1].textContent).toBe('Plain 2');
        });

        it('components outside lists work as before', async () => {
            wf.component('standalone-parent', {
                state: {
                    parentValue: 'from parent'
                }
            });

            wf.component('standalone-child', {
                state: {
                    childValue: 'from child'
                }
            });

            container.innerHTML = `
                <div data-component="standalone-parent">
                    <span class="parent-val" data-bind="parentValue"></span>
                    <div data-component="standalone-child">
                        <span class="child-val" data-bind="childValue"></span>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            expect(container.querySelector('.parent-val').textContent).toBe('from parent');
            expect(container.querySelector('.child-val').textContent).toBe('from child');
        });
    });
});
