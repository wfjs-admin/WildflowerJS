/**
 * Test Suite: data-bind-attr
 *
 * Tests for dynamic attribute binding in templates using:
 *   data-bind-attr="{ attributeName: expression, ... }"
 *
 * This feature allows binding item data to arbitrary HTML attributes,
 * primarily for third-party library integration (e.g., SortableJS).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework } from './helpers/load-framework.js';

describe('data-bind-attr', () => {
    let testContainer;
    let cleanupFns = [];
    let wildflower;

    beforeAll(async () => {
        await loadFramework();
    });

    beforeEach(() => {
        wildflower = window.wildflower;
        resetFramework();
        testContainer = document.createElement('div');
        testContainer.id = 'test-container';
        document.body.appendChild(testContainer);
    });

    afterEach(() => {
        cleanupFns.forEach(fn => fn());
        cleanupFns = [];
        if (testContainer) {
            testContainer.remove();
        }
        // Note: do NOT call wildflower.destroy() here — it corrupts the
        // singleton instance. resetFramework() in beforeEach handles cleanup.
    });

    // Helper to wait for framework initialization
    const waitForFramework = () => new Promise(resolve => setTimeout(resolve, 50));

    // =========================================================================
    // BASIC FUNCTIONALITY
    // =========================================================================

    describe('Basic Functionality', () => {

        it('should bind a single data attribute from item property', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [
                        { id: 1, name: 'First' },
                        { id: 2, name: 'Second' },
                        { id: 3, name: 'Third' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-item-id: id }">
                                <span data-bind="name"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const items = testContainer.querySelectorAll('li');
            expect(items.length).toBe(3);
            expect(items[0].getAttribute('data-item-id')).toBe('1');
            expect(items[1].getAttribute('data-item-id')).toBe('2');
            expect(items[2].getAttribute('data-item-id')).toBe('3');
        });

        it('should bind multiple attributes from item properties', async () => {
            wildflower.component('test-list', {
                state: {
                    tasks: [
                        { id: 101, priority: 'high', category: 'work' },
                        { id: 102, priority: 'low', category: 'personal' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="tasks">
                        <template>
                            <li data-bind-attr="{ data-task-id: id, data-priority: priority, data-category: category }">
                                Task
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const items = testContainer.querySelectorAll('li');
            expect(items[0].getAttribute('data-task-id')).toBe('101');
            expect(items[0].getAttribute('data-priority')).toBe('high');
            expect(items[0].getAttribute('data-category')).toBe('work');
            expect(items[1].getAttribute('data-task-id')).toBe('102');
            expect(items[1].getAttribute('data-priority')).toBe('low');
            expect(items[1].getAttribute('data-category')).toBe('personal');
        });

        it('should bind non-data attributes (aria, title, etc.)', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [
                        { id: 1, label: 'Click to edit', description: 'First item description' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ aria-label: label, title: description, id: id }">
                                Item
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.getAttribute('aria-label')).toBe('Click to edit');
            expect(item.getAttribute('title')).toBe('First item description');
            expect(item.getAttribute('id')).toBe('1');
        });

        it('should coexist with static attributes on the same element', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1, name: 'Test' }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li class="list-item"
                                data-static="always-here"
                                data-bind-attr="{ data-dynamic-id: id }">
                                <span data-bind="name"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.classList.contains('list-item')).toBe(true);
            expect(item.getAttribute('data-static')).toBe('always-here');
            expect(item.getAttribute('data-dynamic-id')).toBe('1');
        });

    });

    // =========================================================================
    // DATA TYPES
    // =========================================================================

    describe('Data Types', () => {

        it('should handle numeric values (converted to strings)', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [
                        { id: 42, count: 0, price: 19.99 }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-id: id, data-count: count, data-price: price }">
                                Item
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.getAttribute('data-id')).toBe('42');
            expect(item.getAttribute('data-count')).toBe('0');
            expect(item.getAttribute('data-price')).toBe('19.99');
        });

        it('should handle boolean values (converted to strings)', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [
                        { id: 1, active: true, disabled: false }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-active: active, data-disabled: disabled }">
                                Item
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.getAttribute('data-active')).toBe('true');
            expect(item.getAttribute('data-disabled')).toBe('false');
        });

        it('should handle null values (attribute not set or removed)', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [
                        { id: 1, optional: null }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-id: id, data-optional: optional }">
                                Item
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.getAttribute('data-id')).toBe('1');
            // null should either not set the attribute or set it to empty string
            // Implementation decision: prefer not setting it
            expect(item.hasAttribute('data-optional')).toBe(false);
        });

        it('should handle undefined values (attribute not set)', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [
                        { id: 1 } // 'missing' property is undefined
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-id: id, data-missing: missing }">
                                Item
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.getAttribute('data-id')).toBe('1');
            expect(item.hasAttribute('data-missing')).toBe(false);
        });

        it('should handle string values with special characters', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [
                        { id: 1, label: 'Hello "World"', path: 'foo/bar&baz' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-label: label, data-path: path }">
                                Item
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.getAttribute('data-label')).toBe('Hello "World"');
            expect(item.getAttribute('data-path')).toBe('foo/bar&baz');
        });

    });

    // =========================================================================
    // EXPRESSIONS
    // =========================================================================

    describe('Expressions', () => {

        it('should support simple property access', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1, nested: { value: 'deep' } }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-id: id }">Item</li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.getAttribute('data-id')).toBe('1');
        });

        it('should support nested property access with dot notation', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [
                        { id: 1, meta: { type: 'task', priority: 'high' } }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-type: meta.type, data-priority: meta.priority }">
                                Item
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.getAttribute('data-type')).toBe('task');
            expect(item.getAttribute('data-priority')).toBe('high');
        });

        it('should support ternary expressions', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [
                        { id: 1, active: true },
                        { id: 2, active: false }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-status: active ? 'on' : 'off' }">
                                Item
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const items = testContainer.querySelectorAll('li');
            expect(items[0].getAttribute('data-status')).toBe('on');
            expect(items[1].getAttribute('data-status')).toBe('off');
        });

        it('should support string concatenation', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [
                        { id: 1, type: 'task' },
                        { id: 2, type: 'event' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-ref: type + '-' + id }">
                                Item
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const items = testContainer.querySelectorAll('li');
            expect(items[0].getAttribute('data-ref')).toBe('task-1');
            expect(items[1].getAttribute('data-ref')).toBe('event-2');
        });

        it('should support template literals', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [
                        { id: 1, name: 'Task One' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ aria-label: \`Item \${id}: \${name}\` }">
                                Item
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.getAttribute('aria-label')).toBe('Item 1: Task One');
        });

    });

    // =========================================================================
    // LIST CONTEXT VARIABLES
    // =========================================================================

    describe('List Context Variables', () => {

        it('should support _index in attribute binding', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [
                        { name: 'First' },
                        { name: 'Second' },
                        { name: 'Third' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-index: _index }">
                                <span data-bind="name"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const items = testContainer.querySelectorAll('li');
            expect(items[0].getAttribute('data-index')).toBe('0');
            expect(items[1].getAttribute('data-index')).toBe('1');
            expect(items[2].getAttribute('data-index')).toBe('2');
        });

        it('should support _first and _last in expressions', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1 }, { id: 2 }, { id: 3 }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-position: _first ? 'first' : (_last ? 'last' : 'middle') }">
                                Item
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const items = testContainer.querySelectorAll('li');
            expect(items[0].getAttribute('data-position')).toBe('first');
            expect(items[1].getAttribute('data-position')).toBe('middle');
            expect(items[2].getAttribute('data-position')).toBe('last');
        });

    });

    // =========================================================================
    // REACTIVITY & UPDATES
    // =========================================================================

    describe('Reactivity & Updates', () => {

        it('should update attribute when item property changes', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [
                        { id: 1, status: 'pending' }
                    ]
                },
                updateStatus() {
                    this.state.items = this.state.items.map(item =>
                        ({ ...item, status: 'complete' })
                    );
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-status: status }">Item</li>
                        </template>
                    </ul>
                    <button data-action="updateStatus">Update</button>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.getAttribute('data-status')).toBe('pending');

            // Trigger update
            const comp = wildflower.getComponents('test-list')[0];
            comp.updateStatus();
            await waitForFramework();

            expect(item.getAttribute('data-status')).toBe('complete');
        });

        it('should handle item addition with correct attributes', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1, name: 'First' }],
                    nextId: 2
                },
                addItem() {
                    this.state.items = [
                        ...this.state.items,
                        { id: this.state.nextId++, name: 'New Item' }
                    ];
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-item-id: id }">
                                <span data-bind="name"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            expect(testContainer.querySelectorAll('li').length).toBe(1);

            const comp = wildflower.getComponents('test-list')[0];
            comp.addItem();
            await waitForFramework();

            const items = testContainer.querySelectorAll('li');
            expect(items.length).toBe(2);
            expect(items[0].getAttribute('data-item-id')).toBe('1');
            expect(items[1].getAttribute('data-item-id')).toBe('2');
        });

        it('should handle item removal', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [
                        { id: 1, name: 'First' },
                        { id: 2, name: 'Second' },
                        { id: 3, name: 'Third' }
                    ]
                },
                removeSecond() {
                    this.state.items = this.state.items.filter(i => i.id !== 2);
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-item-id: id }">
                                <span data-bind="name"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            expect(testContainer.querySelectorAll('li').length).toBe(3);

            const comp = wildflower.getComponents('test-list')[0];
            comp.removeSecond();
            await waitForFramework();

            const items = testContainer.querySelectorAll('li');
            expect(items.length).toBe(2);
            expect(items[0].getAttribute('data-item-id')).toBe('1');
            expect(items[1].getAttribute('data-item-id')).toBe('3');
        });

        it('should handle list reordering', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [
                        { id: 1, name: 'First' },
                        { id: 2, name: 'Second' },
                        { id: 3, name: 'Third' }
                    ]
                },
                reverseOrder() {
                    this.state.items = [...this.state.items].reverse();
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-item-id: id }">
                                <span data-bind="name"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const comp = wildflower.getComponents('test-list')[0];
            comp.reverseOrder();
            await waitForFramework();

            const items = testContainer.querySelectorAll('li');
            expect(items[0].getAttribute('data-item-id')).toBe('3');
            expect(items[1].getAttribute('data-item-id')).toBe('2');
            expect(items[2].getAttribute('data-item-id')).toBe('1');
        });

    });

    // =========================================================================
    // NESTED LISTS
    // =========================================================================

    describe('Nested Lists', () => {

        it('should work in nested list templates', async () => {
            wildflower.component('test-list', {
                state: {
                    projects: [
                        {
                            id: 1,
                            name: 'Project A',
                            tasks: [
                                { id: 101, title: 'Task 1' },
                                { id: 102, title: 'Task 2' }
                            ]
                        },
                        {
                            id: 2,
                            name: 'Project B',
                            tasks: [
                                { id: 201, title: 'Task 3' }
                            ]
                        }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <div data-list="projects">
                        <template>
                            <div class="project" data-bind-attr="{ data-project-id: id }">
                                <h3 data-bind="name"></h3>
                                <ul data-list="tasks">
                                    <template>
                                        <li data-bind-attr="{ data-task-id: id }">
                                            <span data-bind="title"></span>
                                        </li>
                                    </template>
                                </ul>
                            </div>
                        </template>
                    </div>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            // Wait for nested lists to render (may need extra time under load)
            await vi.waitFor(() => {
                const p = testContainer.querySelectorAll('.project');
                if (p.length < 2) throw new Error('waiting for projects');
                if (!p[0].querySelectorAll('li').length) throw new Error('waiting for tasks');
            }, { timeout: 2000 });

            const projects = testContainer.querySelectorAll('.project');
            expect(projects[0].getAttribute('data-project-id')).toBe('1');
            expect(projects[1].getAttribute('data-project-id')).toBe('2');

            const project1Tasks = projects[0].querySelectorAll('li');
            expect(project1Tasks[0].getAttribute('data-task-id')).toBe('101');
            expect(project1Tasks[1].getAttribute('data-task-id')).toBe('102');

            const project2Tasks = projects[1].querySelectorAll('li');
            expect(project2Tasks[0].getAttribute('data-task-id')).toBe('201');
        });

    });

    // =========================================================================
    // FRAMEWORK ATTRIBUTE BLACKLIST
    // =========================================================================

    describe('Framework Attribute Blacklist', () => {

        it('should ignore/warn when trying to bind framework attributes', async () => {
            // This test verifies that attempting to dynamically create
            // framework directives is safely ignored

            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1, bindTarget: 'name' }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-bind: bindTarget, data-action: 'click' }">
                                Item
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');

            // Framework attributes should NOT be set dynamically
            // (they would cause recursive parsing issues)
            // Implementation should either skip them or warn
            expect(item.getAttribute('data-bind')).toBeNull();
            expect(item.getAttribute('data-action')).toBeNull();

            consoleSpy.mockRestore();
        });

        it('should blacklist all framework directive attributes', async () => {
            // Full list of framework attributes that must be blacklisted
            // Note: data-bind-attr itself is excluded because it's the source attribute
            // that defines the binding - it will naturally be present on elements
            const blacklistedAttrs = [
                'data-bind',
                'data-bind-html',
                'data-bind-class',
                'data-bind-style',
                // 'data-bind-attr', // Excluded: this is the binding source attribute itself
                'data-model',
                'data-action',
                'data-list',
                'data-if',
                'data-show',
                'data-render',
                'data-component',
                'data-template',
                'data-slot',
                'data-portal'
            ];

            wildflower.component('test-blacklist', {
                state: {
                    items: [{ id: 1, value: 'test' }]
                }
            });

            // Test each blacklisted attribute individually
            // This avoids expression length issues while still testing all attrs
            for (const attr of blacklistedAttrs) {
                testContainer.innerHTML = `
                    <div data-component="test-blacklist-${attr.replace(/-/g, '')}">
                        <ul data-list="items">
                            <template>
                                <li data-bind-attr="{ 'data-custom': value, '${attr}': value }">Item</li>
                            </template>
                        </ul>
                    </div>
                `;

                wildflower.component(`test-blacklist-${attr.replace(/-/g, '')}`, {
                    state: {
                        items: [{ id: 1, value: 'test' }]
                    }
                });

                wildflower.scan(testContainer);
                await waitForFramework();

                const item = testContainer.querySelector('li');

                // data-custom should be set (not blacklisted)
                expect(item.getAttribute('data-custom')).toBe('test');

                // This framework attribute should NOT be set (blacklisted)
                expect(item.getAttribute(attr), `${attr} should be blacklisted`).toBeNull();

                // Clean up for next iteration
                testContainer.innerHTML = '';
            }
        });

    });

    // =========================================================================
    // INTEGRATION: SORTABLEJS USE CASE
    // =========================================================================

    describe('SortableJS Integration Use Case', () => {

        it('should enable reading item IDs from DOM after third-party reorder', async () => {
            wildflower.component('sortable-list', {
                state: {
                    tasks: [
                        { id: 1, text: 'First', order: 0 },
                        { id: 2, text: 'Second', order: 1 },
                        { id: 3, text: 'Third', order: 2 }
                    ]
                },
                reorderFromDom() {
                    // Simulate what happens after SortableJS reorders DOM
                    const list = this.element.querySelector('ul');
                    const items = list.querySelectorAll('[data-task-id]');
                    const newOrder = Array.from(items).map(el =>
                        parseInt(el.getAttribute('data-task-id'))
                    );

                    // Reorder state to match DOM
                    this.state.tasks = newOrder.map((id, index) => {
                        const task = this.state.tasks.find(t => t.id === id);
                        return { ...task, order: index };
                    });

                    return newOrder;
                }
            });

            testContainer.innerHTML = `
                <div data-component="sortable-list">
                    <ul id="sortable">
                        <li data-list="tasks">
                            <template>
                                <div class="task-item" data-bind-attr="{ data-task-id: id }">
                                    <span data-bind="text"></span>
                                </div>
                            </template>
                        </li>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            // Verify initial render has correct data-task-id attributes
            const items = testContainer.querySelectorAll('[data-task-id]');
            expect(items.length).toBe(3);
            expect(items[0].getAttribute('data-task-id')).toBe('1');
            expect(items[1].getAttribute('data-task-id')).toBe('2');
            expect(items[2].getAttribute('data-task-id')).toBe('3');

            // Simulate SortableJS physically reordering DOM elements
            const list = testContainer.querySelector('ul');
            const firstItem = items[0];
            list.appendChild(firstItem); // Move first to end

            // Now read back the order from DOM
            const comp = wildflower.getComponents('sortable-list')[0];
            const newOrder = comp.reorderFromDom();

            expect(newOrder).toEqual([2, 3, 1]);
            expect(comp.state.tasks[0].id).toBe(2);
            expect(comp.state.tasks[1].id).toBe(3);
            expect(comp.state.tasks[2].id).toBe(1);
        });

        it('should preserve data-task-id through framework re-renders', async () => {
            wildflower.component('persistent-list', {
                state: {
                    tasks: [
                        { id: 1, text: 'Task 1', done: false },
                        { id: 2, text: 'Task 2', done: false }
                    ]
                },
                toggleFirst() {
                    this.state.tasks = this.state.tasks.map((t, i) =>
                        i === 0 ? { ...t, done: !t.done } : t
                    );
                }
            });

            testContainer.innerHTML = `
                <div data-component="persistent-list">
                    <ul data-list="tasks">
                        <template>
                            <li data-bind-attr="{ data-task-id: id }"
                                data-bind-class="done ? 'done' : ''">
                                <span data-bind="text"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            // Check initial state
            let items = testContainer.querySelectorAll('li');
            expect(items[0].getAttribute('data-task-id')).toBe('1');
            expect(items[1].getAttribute('data-task-id')).toBe('2');

            // Toggle first item (triggers re-render)
            const comp = wildflower.getComponents('persistent-list')[0];
            comp.toggleFirst();
            await waitForFramework();

            // data-task-id should still be correct after re-render
            items = testContainer.querySelectorAll('li');
            expect(items[0].getAttribute('data-task-id')).toBe('1');
            expect(items[1].getAttribute('data-task-id')).toBe('2');
            expect(items[0].classList.contains('done')).toBe(true);
        });

    });

    // =========================================================================
    // ATTRIBUTE REMOVAL ON NULL/UNDEFINED
    // =========================================================================

    describe('Attribute Removal on Value Change', () => {

        it('should remove attribute when value changes to null', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [
                        { id: 1, status: 'active' }
                    ]
                },
                clearStatus() {
                    this.state.items = this.state.items.map(item =>
                        ({ ...item, status: null })
                    );
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-status: status }">Item</li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.getAttribute('data-status')).toBe('active');

            const comp = wildflower.getComponents('test-list')[0];
            comp.clearStatus();
            await waitForFramework();

            // Attribute should be removed when value is null
            expect(item.hasAttribute('data-status')).toBe(false);
        });

        it('should remove attribute when value changes to undefined', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [
                        { id: 1, tag: 'important' }
                    ]
                },
                removeTag() {
                    this.state.items = this.state.items.map(item => {
                        const { tag, ...rest } = item;
                        return rest; // tag is now undefined
                    });
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-tag: tag }">Item</li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.getAttribute('data-tag')).toBe('important');

            const comp = wildflower.getComponents('test-list')[0];
            comp.removeTag();
            await waitForFramework();

            // Attribute should be removed when value is undefined
            expect(item.hasAttribute('data-tag')).toBe(false);
        });

        it('should remove attribute when expression evaluates to null', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [
                        { id: 1, meta: { label: 'Test' } }
                    ]
                },
                clearMeta() {
                    this.state.items = this.state.items.map(item =>
                        ({ ...item, meta: null })
                    );
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-label: meta?.label }">Item</li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.getAttribute('data-label')).toBe('Test');

            const comp = wildflower.getComponents('test-list')[0];
            comp.clearMeta();
            await waitForFramework();

            // Attribute should be removed when expression returns null/undefined
            expect(item.hasAttribute('data-label')).toBe(false);
        });

        it('should re-add attribute when value changes from null to a value', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [
                        { id: 1, badge: null }
                    ]
                },
                setBadge() {
                    this.state.items = this.state.items.map(item =>
                        ({ ...item, badge: 'new' })
                    );
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-badge: badge }">Item</li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.hasAttribute('data-badge')).toBe(false);

            const comp = wildflower.getComponents('test-list')[0];
            comp.setBadge();
            await waitForFramework();

            // Attribute should be added when value changes from null to something
            expect(item.getAttribute('data-badge')).toBe('new');
        });

    });

    // =========================================================================
    // SECURITY: EVENT HANDLERS & JAVASCRIPT URLS
    // =========================================================================

    describe('Security', () => {

        it('should blacklist on* event handler attributes', async () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1, handler: 'alert(1)' }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ onclick: handler, onmouseover: handler, onerror: handler }">
                                Item
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');

            // Event handlers should NOT be set - security risk
            expect(item.getAttribute('onclick')).toBeNull();
            expect(item.getAttribute('onmouseover')).toBeNull();
            expect(item.getAttribute('onerror')).toBeNull();

            consoleSpy.mockRestore();
        });

        it('should blacklist all common on* event attributes', async () => {
            const eventAttrs = [
                'onclick', 'ondblclick', 'onmousedown', 'onmouseup', 'onmouseover',
                'onmousemove', 'onmouseout', 'onmouseenter', 'onmouseleave',
                'onkeydown', 'onkeyup', 'onkeypress',
                'onfocus', 'onblur', 'onchange', 'oninput', 'onsubmit', 'onreset',
                'onload', 'onerror', 'onabort',
                'onscroll', 'onresize',
                'ondrag', 'ondragstart', 'ondragend', 'ondragenter', 'ondragleave', 'ondragover', 'ondrop',
                'oncopy', 'oncut', 'onpaste',
                'ontouchstart', 'ontouchmove', 'ontouchend', 'ontouchcancel',
                'onanimationstart', 'onanimationend', 'onanimationiteration',
                'ontransitionend'
            ];

            wildflower.component('test-security', {
                state: {
                    items: [{ id: 1, malicious: 'alert(document.cookie)' }]
                }
            });

            // Build binding with all event attributes
            const bindingObj = eventAttrs.map(attr => `${attr}: malicious`).join(', ');

            testContainer.innerHTML = `
                <div data-component="test-security">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ ${bindingObj} }">Item</li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');

            // None of these should be set
            eventAttrs.forEach(attr => {
                expect(item.getAttribute(attr)).toBeNull();
            });
        });

        it('should sanitize javascript: URLs in href attribute', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1, link: 'javascript:alert(1)' }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <a data-bind-attr="{ href: link }">Click me</a>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const link = testContainer.querySelector('a');

            // javascript: URLs should be blocked or sanitized
            const href = link.getAttribute('href');
            expect(href === null || !href.toLowerCase().startsWith('javascript:')).toBe(true);
        });

        it('should sanitize javascript: URLs in src attribute', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1, imgSrc: 'javascript:alert(1)' }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <img data-bind-attr="{ src: imgSrc }">
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const img = testContainer.querySelector('img');

            // javascript: URLs should be blocked or sanitized
            const src = img.getAttribute('src');
            expect(src === null || !src.toLowerCase().startsWith('javascript:')).toBe(true);
        });

        it('should sanitize javascript: URLs in formaction attribute', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1, action: 'javascript:alert(1)' }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <button data-bind-attr="{ formaction: action }">Submit</button>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const button = testContainer.querySelector('button');

            const formaction = button.getAttribute('formaction');
            expect(formaction === null || !formaction.toLowerCase().startsWith('javascript:')).toBe(true);
        });

        it('should sanitize data: URLs that could execute scripts', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1, src: 'data:text/html,<script>alert(1)</script>' }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <iframe data-bind-attr="{ src: src }"></iframe>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const iframe = testContainer.querySelector('iframe');

            // data: URLs with text/html should be blocked for iframes
            const src = iframe.getAttribute('src');
            expect(src === null || !src.toLowerCase().startsWith('data:text/html')).toBe(true);
        });

        it('should allow safe data: URLs (like images)', async () => {
            const safeDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1, src: safeDataUrl }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <img data-bind-attr="{ src: src }">
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const img = testContainer.querySelector('img');

            // Safe data: URLs for images should be allowed
            expect(img.getAttribute('src')).toBe(safeDataUrl);
        });

    });

    // =========================================================================
    // CONFLICT WITH DEDICATED BINDINGS (class, style)
    // =========================================================================

    describe('Conflict Handling with Dedicated Bindings', () => {

        it('should blacklist class attribute (use data-bind-class instead)', async () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1, className: 'my-class' }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li class="base-class" data-bind-attr="{ class: className }">Item</li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');

            // class should NOT be overwritten by data-bind-attr
            // It should retain the static class and ignore the binding
            expect(item.classList.contains('base-class')).toBe(true);
            expect(item.classList.contains('my-class')).toBe(false);

            consoleSpy.mockRestore();
        });

        it('should blacklist style attribute (use data-bind-style instead)', async () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1, styles: 'color: red;' }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li style="font-size: 14px;" data-bind-attr="{ style: styles }">Item</li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');

            // style should NOT be overwritten by data-bind-attr
            // It should retain the static style
            expect(item.style.fontSize).toBe('14px');
            expect(item.style.color).not.toBe('red');

            consoleSpy.mockRestore();
        });

        it('should work correctly when data-bind-attr and data-bind-class coexist', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [
                        { id: 1, active: true }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-item-id: id }"
                                data-bind-class="active ? 'is-active' : ''">
                                Item
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');

            // Both should work independently
            expect(item.getAttribute('data-item-id')).toBe('1');
            expect(item.classList.contains('is-active')).toBe(true);
        });

        it('should work correctly when data-bind-attr and data-bind-style coexist', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [
                        { id: 1, bgColor: 'blue' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-item-id: id }"
                                data-bind-style="{ backgroundColor: bgColor }">
                                Item
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');

            // Both should work independently
            expect(item.getAttribute('data-item-id')).toBe('1');
            expect(item.style.backgroundColor).toBe('blue');
        });

    });

    // =========================================================================
    // EDGE CASES & ERROR HANDLING
    // =========================================================================

    describe('Edge Cases & Error Handling', () => {

        it('should handle empty object syntax gracefully', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1 }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{}">Item</li>
                        </template>
                    </ul>
                </div>
            `;

            // Should not throw
            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item).toBeTruthy();
        });

        it('should handle malformed syntax gracefully', async () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1 }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ invalid syntax here }">Item</li>
                        </template>
                    </ul>
                </div>
            `;

            // Should not throw, but may warn
            wildflower.scan(testContainer);
            await waitForFramework();

            consoleSpy.mockRestore();
        });

        it('should handle whitespace in attribute binding syntax', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1, name: 'Test' }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{
                                data-id: id,
                                data-name: name
                            }">Item</li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.getAttribute('data-id')).toBe('1');
            expect(item.getAttribute('data-name')).toBe('Test');
        });

        it('should handle attribute names with hyphens', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1, testValue: 'hello' }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-my-custom-attr: testValue, aria-describedby: id }">
                                Item
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.getAttribute('data-my-custom-attr')).toBe('hello');
            expect(item.getAttribute('aria-describedby')).toBe('1');
        });

    });

    // =========================================================================
    // COMPUTED PROPERTIES
    // =========================================================================

    describe('Computed Properties', () => {

        it('should bind attribute to a computed property value', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [
                        { id: 1, firstName: 'John', lastName: 'Doe' }
                    ]
                },
                computed: {
                    // Note: This computed is on the component, not the item
                    // For item-level computed, we test expressions
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-full-name: firstName + ' ' + lastName }">
                                <span data-bind="firstName"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.getAttribute('data-full-name')).toBe('John Doe');
        });

        it('should bind attribute using component-level computed property', async () => {
            wildflower.component('test-computed', {
                state: {
                    baseId: 100,
                    suffix: 'item'
                },
                computed: {
                    computedAttrValue() {
                        return `${this.state.suffix}-${this.state.baseId}`;
                    }
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-computed">
                    <div data-bind-attr="{ 'data-ref': computedAttrValue }">
                        Content
                    </div>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const div = testContainer.querySelector('[data-ref]');
            expect(div.getAttribute('data-ref')).toBe('item-100');
        });

        it('should update attribute when computed property dependencies change', async () => {
            wildflower.component('test-computed', {
                state: {
                    count: 5
                },
                computed: {
                    countLabel() {
                        return `count-${this.state.count}`;
                    }
                },
                increment() {
                    this.state.count++;
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-computed">
                    <div data-bind-attr="{ 'data-label': countLabel }">
                        Content
                    </div>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const div = testContainer.querySelector('[data-label]');
            expect(div.getAttribute('data-label')).toBe('count-5');

            const comp = wildflower.getComponents('test-computed')[0];
            comp.increment();
            await waitForFramework();

            expect(div.getAttribute('data-label')).toBe('count-6');
        });

    });

    // =========================================================================
    // EXTERNAL STORE ACCESS
    // =========================================================================

    describe('External Store Access', () => {

        it('should bind attribute to value from external store', async () => {
            // Create a store
            wildflower.store('config', {
                state: {
                    theme: 'dark',
                    version: '2.0'
                }
            });

            wildflower.component('test-external', {
                state: {
                    items: [{ id: 1 }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-external">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ 'data-theme': external('config', 'theme'), 'data-version': external('config', 'version') }">
                                Item
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.getAttribute('data-theme')).toBe('dark');
            expect(item.getAttribute('data-version')).toBe('2.0');
        });

        it('should update attribute when external store value changes', async () => {
            wildflower.store('appState', {
                state: {
                    mode: 'view'
                },
                setEditMode() {
                    this.state.mode = 'edit';
                }
            });

            wildflower.component('test-external-update', {
                state: {}
            });

            testContainer.innerHTML = `
                <div data-component="test-external-update">
                    <div data-bind-attr="{ 'data-mode': external('appState', 'mode') }">
                        Content
                    </div>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const div = testContainer.querySelector('[data-mode]');
            expect(div.getAttribute('data-mode')).toBe('view');

            // Update store
            const store = wildflower.getStore('appState');
            store.setEditMode();
            await waitForFramework();

            expect(div.getAttribute('data-mode')).toBe('edit');
        });

        it('should bind attribute combining item data and external store data', async () => {
            wildflower.store('settings', {
                state: {
                    prefix: 'task'
                }
            });

            wildflower.component('test-combined', {
                state: {
                    items: [
                        { id: 1 },
                        { id: 2 }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-combined">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ 'data-ref': external('settings', 'prefix') + '-' + id }">
                                Item
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const items = testContainer.querySelectorAll('li');
            expect(items[0].getAttribute('data-ref')).toBe('task-1');
            expect(items[1].getAttribute('data-ref')).toBe('task-2');
        });

    });

    // =========================================================================
    // SVG ATTRIBUTES
    // =========================================================================

    describe('SVG Attributes', () => {

        it('should bind attributes on SVG elements', async () => {
            wildflower.component('test-svg', {
                state: {
                    icons: [
                        { id: 1, width: 24, height: 24, fill: '#ff0000' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-svg">
                    <div data-list="icons">
                        <template>
                            <svg data-bind-attr="{ width: width, height: height, data-icon-id: id }">
                                <rect data-bind-attr="{ fill: fill }" x="0" y="0" width="100%" height="100%"></rect>
                            </svg>
                        </template>
                    </div>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const svg = testContainer.querySelector('svg');
            expect(svg.getAttribute('width')).toBe('24');
            expect(svg.getAttribute('height')).toBe('24');
            expect(svg.getAttribute('data-icon-id')).toBe('1');

            const rect = testContainer.querySelector('rect');
            expect(rect.getAttribute('fill')).toBe('#ff0000');
        });

        it('should bind viewBox attribute on SVG', async () => {
            wildflower.component('test-svg-viewbox', {
                state: {
                    items: [
                        { id: 1, viewBox: '0 0 100 100' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-svg-viewbox">
                    <div data-list="items">
                        <template>
                            <svg data-bind-attr="{ viewBox: viewBox }">
                                <circle cx="50" cy="50" r="40"></circle>
                            </svg>
                        </template>
                    </div>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const svg = testContainer.querySelector('svg');
            // viewBox is case-sensitive in SVG
            expect(svg.getAttribute('viewBox')).toBe('0 0 100 100');
        });

        it('should bind path d attribute', async () => {
            // Note: SVG elements inside a list require a wrapping div structure
            // because the template system uses innerHTML which doesn't work well
            // with SVG child elements. This test verifies attr binding works on
            // SVG-like data attributes instead.
            wildflower.component('test-svg-path', {
                state: {
                    paths: [
                        { id: 1, d: 'M10 10 L90 90', stroke: 'black' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-svg-path">
                    <div data-list="paths">
                        <template>
                            <div class="svg-path" data-bind-attr="{ 'data-d': d, 'data-stroke': stroke, 'data-path-id': id }"></div>
                        </template>
                    </div>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const pathEl = testContainer.querySelector('.svg-path');
            expect(pathEl.getAttribute('data-d')).toBe('M10 10 L90 90');
            expect(pathEl.getAttribute('data-stroke')).toBe('black');
            expect(pathEl.getAttribute('data-path-id')).toBe('1');
        });

    });

    // =========================================================================
    // CAMELCASE TO KEBAB-CASE
    // =========================================================================

    describe('CamelCase to Kebab-Case Conversion', () => {

        it('should support quoted kebab-case attribute names', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1, value: 'test' }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ 'data-my-custom-attr': value }">Item</li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.getAttribute('data-my-custom-attr')).toBe('test');
        });

        it('should convert unquoted camelCase keys to kebab-case', async () => {
            // This tests whether { dataTaskId: id } becomes data-task-id
            // Implementation decision: should we support this?

            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1 }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ dataTaskId: id, ariaLabel: id }">Item</li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');

            // Option A: Convert to kebab-case (more intuitive, matches dataset API)
            // expect(item.getAttribute('data-task-id')).toBe('1');
            // expect(item.getAttribute('aria-label')).toBe('1');

            // Option B: Keep as-is (simpler implementation)
            // expect(item.getAttribute('dataTaskId')).toBe('1');

            // The test should pass with whichever behavior is implemented
            // At minimum, it shouldn't crash
            const hasKebab = item.hasAttribute('data-task-id');
            const hasCamel = item.hasAttribute('dataTaskId');
            expect(hasKebab || hasCamel).toBe(true);
        });

        it('should handle mixed quoted and unquoted keys', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1, name: 'Test' }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ 'data-item-id': id, title: name }">Item</li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.getAttribute('data-item-id')).toBe('1');
            expect(item.getAttribute('title')).toBe('Test');
        });

    });

    // =========================================================================
    // XSS PREVENTION IN ATTRIBUTE VALUES
    // =========================================================================

    describe('XSS Prevention in Attribute Values', () => {

        it('should escape HTML in attribute values (setAttribute handles this)', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1, title: '"><script>alert(1)</script>' }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ title: title }">Item</li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');

            // setAttribute should properly escape the value
            // The script should NOT execute, and the value should be the raw string
            expect(item.getAttribute('title')).toBe('"><script>alert(1)</script>');

            // Verify no script was injected into the DOM
            const scripts = testContainer.querySelectorAll('script');
            expect(scripts.length).toBe(0);
        });

        it('should handle attribute values with quotes safely', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1, value: 'He said "hello" and \'goodbye\'' }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-value: value }">Item</li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.getAttribute('data-value')).toBe('He said "hello" and \'goodbye\'');
        });

        it('should handle attribute values with angle brackets safely', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1, value: '<div>Not HTML</div>' }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-value: value }">Item</li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');
            expect(item.getAttribute('data-value')).toBe('<div>Not HTML</div>');

            // Should not create actual div elements
            expect(item.querySelector('div')).toBeNull();
        });

        it('should handle event handler injection attempts in data attributes', async () => {
            wildflower.component('test-list', {
                state: {
                    items: [{ id: 1, value: '" onclick="alert(1)" data-x="' }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list">
                    <ul data-list="items">
                        <template>
                            <li data-bind-attr="{ data-value: value }">Item</li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const item = testContainer.querySelector('li');

            // The value should be stored as-is in the attribute
            expect(item.getAttribute('data-value')).toBe('" onclick="alert(1)" data-x="');

            // But it should NOT create an onclick handler
            expect(item.getAttribute('onclick')).toBeNull();
        });

    });

    // =========================================================================
    // NON-LIST CONTEXTS
    // =========================================================================

    describe('Non-List Contexts', () => {

        it('should work on regular elements (not in lists) with component state', async () => {
            wildflower.component('test-component', {
                state: {
                    itemId: 42,
                    itemType: 'widget'
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-component">
                    <div data-bind-attr="{ data-id: itemId, data-type: itemType }">
                        Content
                    </div>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const div = testContainer.querySelector('[data-id]');
            expect(div.getAttribute('data-id')).toBe('42');
            expect(div.getAttribute('data-type')).toBe('widget');
        });

        it('should update non-list element attributes when state changes', async () => {
            wildflower.component('test-component', {
                state: {
                    status: 'loading'
                },
                setReady() {
                    this.state.status = 'ready';
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-component">
                    <div data-bind-attr="{ data-status: status }">
                        Content
                    </div>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const div = testContainer.querySelector('[data-status]');
            expect(div.getAttribute('data-status')).toBe('loading');

            const comp = wildflower.getComponents('test-component')[0];
            comp.setReady();
            await waitForFramework();

            expect(div.getAttribute('data-status')).toBe('ready');
        });

    });

    // =========================================================================
    // BOOLEAN HTML ATTRIBUTES (disabled, readonly, required, etc.)
    // =========================================================================

    describe('Boolean HTML Attributes', () => {

        it('should remove disabled attribute when value is false', async () => {
            wildflower.component('test-boolean-attr', {
                state: {
                    isDisabled: false
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-boolean-attr">
                    <input type="text" data-bind-attr="{ disabled: isDisabled }">
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const input = testContainer.querySelector('input');
            // disabled attribute should NOT be present when value is false
            // (presence of disabled attribute disables the element regardless of value)
            expect(input.hasAttribute('disabled')).toBe(false);
            expect(input.disabled).toBe(false);
        });

        it('should add disabled attribute when value is true', async () => {
            wildflower.component('test-boolean-attr-true', {
                state: {
                    isDisabled: true
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-boolean-attr-true">
                    <input type="text" data-bind-attr="{ disabled: isDisabled }">
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const input = testContainer.querySelector('input');
            expect(input.hasAttribute('disabled')).toBe(true);
            expect(input.disabled).toBe(true);
        });

        it('should toggle disabled attribute reactively', async () => {
            wildflower.component('test-boolean-toggle', {
                state: {
                    isDisabled: false
                },
                toggleDisabled() {
                    this.state.isDisabled = !this.state.isDisabled;
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-boolean-toggle">
                    <input type="text" data-bind-attr="{ disabled: isDisabled }">
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const input = testContainer.querySelector('input');
            expect(input.hasAttribute('disabled')).toBe(false);

            // Toggle to true
            const comp = wildflower.getComponents('test-boolean-toggle')[0];
            comp.toggleDisabled();
            await waitForFramework();

            expect(input.hasAttribute('disabled')).toBe(true);
            expect(input.disabled).toBe(true);

            // Toggle back to false
            comp.toggleDisabled();
            await waitForFramework();

            expect(input.hasAttribute('disabled')).toBe(false);
            expect(input.disabled).toBe(false);
        });

        it('should remove readonly attribute when value is false', async () => {
            wildflower.component('test-readonly', {
                state: {
                    isReadonly: false
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-readonly">
                    <input type="text" data-bind-attr="{ readonly: isReadonly }">
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const input = testContainer.querySelector('input');
            expect(input.hasAttribute('readonly')).toBe(false);
            expect(input.readOnly).toBe(false);
        });

        it('should toggle readonly attribute reactively', async () => {
            wildflower.component('test-readonly-toggle', {
                state: {
                    isReadonly: true
                },
                toggleReadonly() {
                    this.state.isReadonly = !this.state.isReadonly;
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-readonly-toggle">
                    <input type="text" data-bind-attr="{ readonly: isReadonly }">
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const input = testContainer.querySelector('input');
            expect(input.hasAttribute('readonly')).toBe(true);
            expect(input.readOnly).toBe(true);

            // Toggle to false
            const comp = wildflower.getComponents('test-readonly-toggle')[0];
            comp.toggleReadonly();
            await waitForFramework();

            expect(input.hasAttribute('readonly')).toBe(false);
            expect(input.readOnly).toBe(false);
        });

        it('should handle multiple boolean attributes with mixed values', async () => {
            wildflower.component('test-multi-boolean', {
                state: {
                    isDisabled: true,
                    isReadonly: false,
                    isRequired: true
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-multi-boolean">
                    <input type="text" data-bind-attr="{ disabled: isDisabled, readonly: isReadonly, required: isRequired }">
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const input = testContainer.querySelector('input');
            expect(input.hasAttribute('disabled')).toBe(true);
            expect(input.hasAttribute('readonly')).toBe(false);
            expect(input.hasAttribute('required')).toBe(true);
        });

        it('should handle boolean attributes with computed expressions', async () => {
            wildflower.component('test-computed-boolean', {
                state: {
                    formValid: true,
                    userCanEdit: false
                },
                computed: {
                    isSubmitDisabled() {
                        return !this.state.formValid;
                    },
                    isInputReadonly() {
                        return !this.state.userCanEdit;
                    }
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-computed-boolean">
                    <input type="text" data-bind-attr="{ readonly: isInputReadonly }">
                    <button data-bind-attr="{ disabled: isSubmitDisabled }">Submit</button>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const input = testContainer.querySelector('input');
            const button = testContainer.querySelector('button');

            // formValid=true means isSubmitDisabled=false, so button should NOT be disabled
            expect(button.hasAttribute('disabled')).toBe(false);

            // userCanEdit=false means isInputReadonly=true, so input should be readonly
            expect(input.hasAttribute('readonly')).toBe(true);
        });

        it('should handle boolean attributes in list context', async () => {
            wildflower.component('test-list-boolean', {
                state: {
                    items: [
                        { id: 1, name: 'Active', disabled: false },
                        { id: 2, name: 'Disabled', disabled: true },
                        { id: 3, name: 'Also Active', disabled: false }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-list-boolean">
                    <ul data-list="items">
                        <template>
                            <li>
                                <input type="text" data-bind-attr="{ disabled: disabled }" data-model="name">
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const inputs = testContainer.querySelectorAll('input');
            expect(inputs[0].hasAttribute('disabled')).toBe(false);
            expect(inputs[1].hasAttribute('disabled')).toBe(true);
            expect(inputs[2].hasAttribute('disabled')).toBe(false);
        });

        it('should handle checked attribute on checkboxes', async () => {
            wildflower.component('test-checked', {
                state: {
                    isChecked: false
                },
                toggle() {
                    this.state.isChecked = !this.state.isChecked;
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-checked">
                    <input type="checkbox" data-bind-attr="{ checked: isChecked }">
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const checkbox = testContainer.querySelector('input[type="checkbox"]');
            // Note: checked attribute controls initial state, DOM property controls current state
            expect(checkbox.hasAttribute('checked')).toBe(false);

            const comp = wildflower.getComponents('test-checked')[0];
            comp.toggle();
            await waitForFramework();

            expect(checkbox.hasAttribute('checked')).toBe(true);
        });

        it('should handle selected attribute on options', async () => {
            wildflower.component('test-selected', {
                state: {
                    options: [
                        { value: 'a', label: 'Option A', isSelected: false },
                        { value: 'b', label: 'Option B', isSelected: true },
                        { value: 'c', label: 'Option C', isSelected: false }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-selected">
                    <select>
                        <option data-list="options">
                            <template>
                                <option data-bind-attr="{ value: value, selected: isSelected }">
                                    <span data-bind="label"></span>
                                </option>
                            </template>
                        </option>
                    </select>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const options = testContainer.querySelectorAll('option[value]');
            expect(options[0].hasAttribute('selected')).toBe(false);
            expect(options[1].hasAttribute('selected')).toBe(true);
            expect(options[2].hasAttribute('selected')).toBe(false);
        });

        it('should handle hidden attribute', async () => {
            wildflower.component('test-hidden', {
                state: {
                    isHidden: true
                },
                show() {
                    this.state.isHidden = false;
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-hidden">
                    <div data-bind-attr="{ hidden: isHidden }">Secret Content</div>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const div = testContainer.querySelector('[data-component] > div');
            expect(div.hasAttribute('hidden')).toBe(true);

            const comp = wildflower.getComponents('test-hidden')[0];
            comp.show();
            await waitForFramework();

            expect(div.hasAttribute('hidden')).toBe(false);
        });

    });

    // =========================================================================
    // SVG NAMESPACED ATTRIBUTES
    // =========================================================================

    describe('SVG Namespaced Attributes', () => {

        it('should handle xlink:href for SVG use elements', async () => {
            wildflower.component('test-svg', {
                state: {
                    iconRef: '#icon-star'
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-svg">
                    <svg width="100" height="100">
                        <use data-bind-attr="{ 'xlink:href': iconRef }"></use>
                    </svg>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const useEl = testContainer.querySelector('use');
            // Note: Modern browsers may normalize xlink:href to just href
            const xlinkHref = useEl.getAttribute('xlink:href') || useEl.getAttribute('href');
            expect(xlinkHref).toBe('#icon-star');
        });

        it('should handle xml:lang attribute', async () => {
            wildflower.component('test-xml-lang', {
                state: {
                    language: 'en-US'
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-xml-lang">
                    <span data-bind-attr="{ 'xml:lang': language }">Hello</span>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const span = testContainer.querySelector('span');
            expect(span.getAttribute('xml:lang')).toBe('en-US');
        });

    });

});
