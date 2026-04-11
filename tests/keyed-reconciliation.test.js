/**
 * Tests for keyed reconciliation in data-list
 *
 * When external libraries (like SortableJS) physically reorder DOM nodes,
 * the framework should detect that DOM order matches data order and
 * skip unnecessary DOM operations.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework } from './helpers/load-framework.js';

describe('Keyed Reconciliation', () => {
    let testContainer;
    let wildflower;

    beforeAll(async () => {
        await loadFramework();
    });

    beforeEach(() => {
        wildflower = window.wildflower;

        if (wildflower.componentDefinitions) {
            wildflower.componentDefinitions.clear();
        }
        if (wildflower.componentInstances) {
            wildflower.componentInstances.clear();
        }

        testContainer = document.createElement('div');
        testContainer.id = 'test-container';
        document.body.appendChild(testContainer);
    });

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer);
        }
        if (wildflower) {
            wildflower.componentInstances.clear();
            wildflower.componentDefinitions.clear();
        }
    });

    describe('data-key attribute', () => {
        it('should use data-key attribute for keyed reconciliation', async () => {
            wildflower.component('keyed-list-test', {
                state: {
                    items: [
                        { id: 1, name: 'First' },
                        { id: 2, name: 'Second' },
                        { id: 3, name: 'Third' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="keyed-list-test">
                    <ul data-list="items" data-key="id">
                        <template>
                            <li data-bind="name"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await new Promise(resolve => setTimeout(resolve, 50));

            const items = testContainer.querySelectorAll('li');
            expect(items.length).toBe(3);
            expect(items[0].textContent).toBe('First');
            expect(items[1].textContent).toBe('Second');
            expect(items[2].textContent).toBe('Third');

            // Verify _itemData has key property
            expect(items[0]._itemData.id).toBe(1);
            expect(items[1]._itemData.id).toBe(2);
            expect(items[2]._itemData.id).toBe(3);
        });

        it('should default to id property when data-key not specified', async () => {
            wildflower.component('default-key-test', {
                state: {
                    items: [
                        { id: 'a', label: 'Alpha' },
                        { id: 'b', label: 'Beta' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="default-key-test">
                    <ul data-list="items">
                        <template>
                            <li data-bind="label"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await new Promise(resolve => setTimeout(resolve, 50));

            const items = testContainer.querySelectorAll('li');
            expect(items[0]._itemData.id).toBe('a');
            expect(items[1]._itemData.id).toBe('b');
        });
    });

    describe('DOM order matching', () => {
        it('should detect when DOM order matches data order after external reorder', async () => {
            let renderCount = 0;

            wildflower.component('sortable-sim-test', {
                state: {
                    tasks: [
                        { id: 1, text: 'Task 1' },
                        { id: 2, text: 'Task 2' },
                        { id: 3, text: 'Task 3' }
                    ]
                },
                onUpdate() {
                    renderCount++;
                }
            });

            testContainer.innerHTML = `
                <div data-component="sortable-sim-test">
                    <ul data-list="tasks" data-key="id">
                        <template>
                            <li data-bind="text"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await new Promise(resolve => setTimeout(resolve, 50));

            const ul = testContainer.querySelector('ul');
            const items = Array.from(ul.querySelectorAll('li'));
            const initialRenderCount = renderCount;

            // Simulate SortableJS reordering: move first item to end
            // This physically moves the DOM node
            ul.appendChild(items[0]);

            // Now update state to match the new DOM order
            const component = wildflower.getComponentsByType('sortable-sim-test')[0];
            component.context.state.tasks = [
                { id: 2, text: 'Task 2' },
                { id: 3, text: 'Task 3' },
                { id: 1, text: 'Task 1' }
            ];

            await new Promise(resolve => setTimeout(resolve, 50));

            // Verify DOM order is correct
            const newItems = ul.querySelectorAll('li');
            expect(newItems[0].textContent).toBe('Task 2');
            expect(newItems[1].textContent).toBe('Task 3');
            expect(newItems[2].textContent).toBe('Task 1');

            // Verify _itemData and _listIndex are updated
            expect(newItems[0]._itemData.id).toBe(2);
            expect(newItems[0]._listIndex).toBe(0);
            expect(newItems[1]._itemData.id).toBe(3);
            expect(newItems[1]._listIndex).toBe(1);
            expect(newItems[2]._itemData.id).toBe(1);
            expect(newItems[2]._listIndex).toBe(2);
        });

        it('should update bindings when DOM order matches data order', async () => {
            wildflower.component('binding-update-test', {
                state: {
                    items: [
                        { id: 'x', value: 10 },
                        { id: 'y', value: 20 }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="binding-update-test">
                    <div data-list="items" data-key="id">
                        <template>
                            <span data-bind="value"></span>
                        </template>
                    </div>
                </div>
            `;

            wildflower.scan(testContainer);
            await new Promise(resolve => setTimeout(resolve, 50));

            const container = testContainer.querySelector('[data-list]');
            const spans = Array.from(container.querySelectorAll('span'));

            // Physically reorder DOM
            container.appendChild(spans[0]);

            // Update state to match new order with changed values
            const component = wildflower.getComponentsByType('binding-update-test')[0];
            component.context.state.items = [
                { id: 'y', value: 200 }, // Updated value
                { id: 'x', value: 100 }  // Updated value
            ];

            await new Promise(resolve => setTimeout(resolve, 50));

            const newSpans = container.querySelectorAll('span');
            expect(newSpans[0].textContent).toBe('200');
            expect(newSpans[1].textContent).toBe('100');
        });

        it('should fall back to standard reconciliation when counts differ', async () => {
            wildflower.component('count-diff-test', {
                state: {
                    items: [
                        { id: 1, name: 'One' },
                        { id: 2, name: 'Two' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="count-diff-test">
                    <ul data-list="items" data-key="id">
                        <template>
                            <li data-bind="name"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await new Promise(resolve => setTimeout(resolve, 50));

            // Add a new item (count changes)
            const component = wildflower.getComponentsByType('count-diff-test')[0];
            component.context.state.items = [
                { id: 1, name: 'One' },
                { id: 2, name: 'Two' },
                { id: 3, name: 'Three' }
            ];

            await new Promise(resolve => setTimeout(resolve, 50));

            const items = testContainer.querySelectorAll('li');
            expect(items.length).toBe(3);
            expect(items[2].textContent).toBe('Three');
        });

        it('should fall back when keys do not match', async () => {
            wildflower.component('key-mismatch-test', {
                state: {
                    items: [
                        { id: 'a', text: 'Alpha' },
                        { id: 'b', text: 'Beta' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="key-mismatch-test">
                    <ul data-list="items" data-key="id">
                        <template>
                            <li data-bind="text"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await new Promise(resolve => setTimeout(resolve, 50));

            // Completely replace items (different keys)
            const component = wildflower.getComponentsByType('key-mismatch-test')[0];
            component.context.state.items = [
                { id: 'c', text: 'Charlie' },
                { id: 'd', text: 'Delta' }
            ];

            await new Promise(resolve => setTimeout(resolve, 50));

            const items = testContainer.querySelectorAll('li');
            expect(items.length).toBe(2);
            expect(items[0].textContent).toBe('Charlie');
            expect(items[1].textContent).toBe('Delta');
        });
    });

    describe('complex scenarios', () => {
        it('should handle multiple reorders correctly', async () => {
            wildflower.component('multi-reorder-test', {
                state: {
                    items: [
                        { id: 1, n: 'A' },
                        { id: 2, n: 'B' },
                        { id: 3, n: 'C' },
                        { id: 4, n: 'D' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="multi-reorder-test">
                    <ul data-list="items" data-key="id">
                        <template>
                            <li data-bind="n"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await new Promise(resolve => setTimeout(resolve, 50));

            const ul = testContainer.querySelector('ul');
            const component = wildflower.getComponentsByType('multi-reorder-test')[0];

            // First reorder: reverse order
            const items1 = Array.from(ul.querySelectorAll('li'));
            items1.forEach(item => ul.insertBefore(item, ul.firstChild));

            component.context.state.items = [
                { id: 4, n: 'D' },
                { id: 3, n: 'C' },
                { id: 2, n: 'B' },
                { id: 1, n: 'A' }
            ];

            await new Promise(resolve => setTimeout(resolve, 50));

            let currentItems = ul.querySelectorAll('li');
            expect(currentItems[0].textContent).toBe('D');
            expect(currentItems[3].textContent).toBe('A');

            // Second reorder: swap first and last
            const items2 = Array.from(ul.querySelectorAll('li'));
            ul.insertBefore(items2[3], items2[0]);
            ul.appendChild(items2[0]);

            component.context.state.items = [
                { id: 1, n: 'A' },
                { id: 3, n: 'C' },
                { id: 2, n: 'B' },
                { id: 4, n: 'D' }
            ];

            await new Promise(resolve => setTimeout(resolve, 50));

            currentItems = ul.querySelectorAll('li');
            expect(currentItems[0].textContent).toBe('A');
            expect(currentItems[1].textContent).toBe('C');
            expect(currentItems[2].textContent).toBe('B');
            expect(currentItems[3].textContent).toBe('D');
        });

        it('should work with custom key property', async () => {
            wildflower.component('custom-key-test', {
                state: {
                    users: [
                        { uniqueId: 'u1', name: 'Alice' },
                        { uniqueId: 'u2', name: 'Bob' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="custom-key-test">
                    <ul data-list="users" data-key="uniqueId">
                        <template>
                            <li data-bind="name"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await new Promise(resolve => setTimeout(resolve, 50));

            const ul = testContainer.querySelector('ul');
            const items = Array.from(ul.querySelectorAll('li'));

            // Physically reorder
            ul.appendChild(items[0]);

            // Update state to match
            const component = wildflower.getComponentsByType('custom-key-test')[0];
            component.context.state.users = [
                { uniqueId: 'u2', name: 'Bob' },
                { uniqueId: 'u1', name: 'Alice' }
            ];

            await new Promise(resolve => setTimeout(resolve, 50));

            const newItems = ul.querySelectorAll('li');
            expect(newItems[0].textContent).toBe('Bob');
            expect(newItems[1].textContent).toBe('Alice');
            expect(newItems[0]._itemData.uniqueId).toBe('u2');
            expect(newItems[1]._itemData.uniqueId).toBe('u1');
        });

        it('should preserve DOM references when order matches', async () => {
            wildflower.component('dom-preserve-test', {
                state: {
                    items: [
                        { id: 1, text: 'One' },
                        { id: 2, text: 'Two' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="dom-preserve-test">
                    <ul data-list="items" data-key="id">
                        <template>
                            <li data-bind="text"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await new Promise(resolve => setTimeout(resolve, 50));

            const ul = testContainer.querySelector('ul');
            const items = Array.from(ul.querySelectorAll('li'));

            // Store references
            const firstRef = items[0];
            const secondRef = items[1];

            // Physically reorder DOM
            ul.appendChild(items[0]);

            // Update state to match
            const component = wildflower.getComponentsByType('dom-preserve-test')[0];
            component.context.state.items = [
                { id: 2, text: 'Two Updated' },
                { id: 1, text: 'One Updated' }
            ];

            await new Promise(resolve => setTimeout(resolve, 50));

            // DOM nodes should be the same objects (not recreated)
            const newItems = ul.querySelectorAll('li');
            expect(newItems[0]).toBe(secondRef); // id:2 was second, now first
            expect(newItems[1]).toBe(firstRef);  // id:1 was first, now second

            // Content should be updated
            expect(newItems[0].textContent).toBe('Two Updated');
            expect(newItems[1].textContent).toBe('One Updated');
        });
    });
});
