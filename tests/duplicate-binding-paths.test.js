/**
 * Tests for duplicate binding paths - multiple elements binding to the same path
 *
 * This covers the bug where multiple elements with the same binding path
 * (e.g., data-bind="computed:count") would share a single context,
 * causing only one element to update when state changed.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework, isMinifiedBuild} from './helpers/load-framework.js';

describe('Duplicate Binding Paths', () => {
    let container;
    let wildflower;

    beforeAll(async () => {
        await loadFramework();
    });

    beforeEach(() => {
        wildflower = window.wildflower;
        resetFramework();

        // Re-initialize the context system
        if (wildflower._initContextSystem) {
            wildflower._contextSystemInitialized = false;
            wildflower._initContextSystem();
        }

        container = document.createElement('div');
        container.id = 'test-container';
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
        resetFramework();
    });

    async function waitForUpdate(ms = 50) {
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    describe('Multiple Computed Bindings to Same Path', () => {
        it('should update all elements bound to the same computed property', async () => {
            container.innerHTML = `
                <div data-component="multi-computed">
                    <div class="toolbar">
                        <span class="stat-1" data-bind="computed:itemCount"></span>
                        <span class="stat-2" data-bind="computed:itemCount"></span>
                    </div>
                    <div class="main">
                        <span class="count-display" data-bind="computed:itemCount"></span>
                    </div>
                </div>
            `;

            wildflower.component('multi-computed', {
                state: {
                    items: ['a', 'b', 'c']
                },
                computed: {
                    itemCount() {
                        return this.state.items.length;
                    }
                },
                addItem() {
                    this.state.items.push('new');
                }
            });

            wildflower.scan();
            await waitForUpdate(100);

            // Initial state - all three should show 3
            const stat1 = container.querySelector('.stat-1');
            const stat2 = container.querySelector('.stat-2');
            const countDisplay = container.querySelector('.count-display');

            expect(stat1.textContent).toBe('3');
            expect(stat2.textContent).toBe('3');
            expect(countDisplay.textContent).toBe('3');

            // Get component and add an item
            const componentEl = container.querySelector('[data-component="multi-computed"]');
            const instance = wildflower.componentInstances.get(componentEl.dataset.componentId);
            instance.context.addItem();

            await waitForUpdate(100);

            // All three should update to 4
            expect(stat1.textContent).toBe('4');
            expect(stat2.textContent).toBe('4');
            expect(countDisplay.textContent).toBe('4');
        });

        it.skipIf(isMinifiedBuild())('renders the same computed to each element and updates both', async () => {
            container.innerHTML = `
                <div data-component="context-check">
                    <span class="first" data-bind="computed:value"></span>
                    <span class="second" data-bind="computed:value"></span>
                </div>
            `;

            wildflower.component('context-check', {
                state: { count: 5 },
                computed: {
                    value() {
                        return this.state.count * 2;
                    }
                }
            });

            wildflower.scan();
            await waitForUpdate(100);

            const first = container.querySelector('.first');
            const second = container.querySelector('.second');

            // Both elements bound to the same computed render its value independently
            expect(first.textContent).toBe('10');
            expect(second.textContent).toBe('10');

            // And both update when the computed's source state changes
            const componentEl = container.querySelector('[data-component="context-check"]');
            const instance = wildflower.componentInstances.get(componentEl.dataset.componentId);
            instance.state.count = 7;
            await waitForUpdate(100);

            expect(first.textContent).toBe('14');
            expect(second.textContent).toBe('14');
        });
    });

    describe('Multiple State Bindings to Same Path', () => {
        it('should update all elements bound to the same state property', async () => {
            container.innerHTML = `
                <div data-component="multi-state">
                    <h1 class="title-1" data-bind="title"></h1>
                    <h2 class="title-2" data-bind="title"></h2>
                    <span class="title-3" data-bind="title"></span>
                </div>
            `;

            wildflower.component('multi-state', {
                state: {
                    title: 'Initial Title'
                },
                setTitle(newTitle) {
                    this.state.title = newTitle;
                }
            });

            wildflower.scan();
            await waitForUpdate(100);

            const title1 = container.querySelector('.title-1');
            const title2 = container.querySelector('.title-2');
            const title3 = container.querySelector('.title-3');

            // Initial values
            expect(title1.textContent).toBe('Initial Title');
            expect(title2.textContent).toBe('Initial Title');
            expect(title3.textContent).toBe('Initial Title');

            // Update state
            const componentEl = container.querySelector('[data-component="multi-state"]');
            const instance = wildflower.componentInstances.get(componentEl.dataset.componentId);
            instance.context.setTitle('Updated Title');

            await waitForUpdate(100);

            // All should update
            expect(title1.textContent).toBe('Updated Title');
            expect(title2.textContent).toBe('Updated Title');
            expect(title3.textContent).toBe('Updated Title');
        });
    });

    describe('Mixed Computed and State Bindings', () => {
        it('should handle multiple bindings that depend on the same underlying data', async () => {
            container.innerHTML = `
                <div data-component="mixed-bindings">
                    <span class="raw-count" data-bind="items.length"></span>
                    <span class="computed-count" data-bind="computed:itemCount"></span>
                    <span class="computed-double" data-bind="computed:doubleCount"></span>
                    <span class="computed-count-2" data-bind="computed:itemCount"></span>
                </div>
            `;

            wildflower.component('mixed-bindings', {
                state: {
                    items: [1, 2, 3]
                },
                computed: {
                    itemCount() {
                        return this.state.items.length;
                    },
                    doubleCount() {
                        return this.state.items.length * 2;
                    }
                },
                addItem() {
                    this.state.items.push(this.state.items.length + 1);
                }
            });

            wildflower.scan();
            await waitForUpdate(100);

            const rawCount = container.querySelector('.raw-count');
            const computedCount = container.querySelector('.computed-count');
            const computedDouble = container.querySelector('.computed-double');
            const computedCount2 = container.querySelector('.computed-count-2');

            // Initial
            expect(rawCount.textContent).toBe('3');
            expect(computedCount.textContent).toBe('3');
            expect(computedDouble.textContent).toBe('6');
            expect(computedCount2.textContent).toBe('3');

            // Add item
            const componentEl = container.querySelector('[data-component="mixed-bindings"]');
            const instance = wildflower.componentInstances.get(componentEl.dataset.componentId);
            instance.context.addItem();

            await waitForUpdate(100);

            // All should update appropriately
            expect(rawCount.textContent).toBe('4');
            expect(computedCount.textContent).toBe('4');
            expect(computedDouble.textContent).toBe('8');
            expect(computedCount2.textContent).toBe('4');
        });
    });

    describe('Bindings in Different DOM Locations', () => {
        it('should update bindings in toolbar, sidebar, and main content areas', async () => {
            // This mimics the kanban scenario where toolbar stats and column headers
            // both display the same computed value
            container.innerHTML = `
                <div data-component="layout-test">
                    <header class="toolbar">
                        <div class="stats">
                            <span class="todo-stat" data-bind="computed:todoCount"></span>
                            <span class="done-stat" data-bind="computed:doneCount"></span>
                        </div>
                    </header>
                    <main class="board">
                        <section class="todo-column">
                            <h3>Todo (<span class="todo-header" data-bind="computed:todoCount"></span>)</h3>
                            <div data-list="todo">
                                <template>
                                    <div class="item" data-bind="name"></div>
                                </template>
                            </div>
                        </section>
                        <section class="done-column">
                            <h3>Done (<span class="done-header" data-bind="computed:doneCount"></span>)</h3>
                            <div data-list="done">
                                <template>
                                    <div class="item" data-bind="name"></div>
                                </template>
                            </div>
                        </section>
                    </main>
                </div>
            `;

            wildflower.component('layout-test', {
                state: {
                    todo: [{ name: 'Task 1' }, { name: 'Task 2' }],
                    done: [{ name: 'Task 3' }]
                },
                computed: {
                    todoCount() {
                        return this.state.todo.length;
                    },
                    doneCount() {
                        return this.state.done.length;
                    }
                },
                moveToDone() {
                    if (this.state.todo.length > 0) {
                        const item = this.state.todo.shift();
                        this.state.done.push(item);
                    }
                }
            });

            wildflower.scan();
            await waitForUpdate(150);

            const todoStat = container.querySelector('.todo-stat');
            const doneStat = container.querySelector('.done-stat');
            const todoHeader = container.querySelector('.todo-header');
            const doneHeader = container.querySelector('.done-header');

            // Initial values
            expect(todoStat.textContent).toBe('2');
            expect(doneStat.textContent).toBe('1');
            expect(todoHeader.textContent).toBe('2');
            expect(doneHeader.textContent).toBe('1');

            // Move an item to done
            const componentEl = container.querySelector('[data-component="layout-test"]');
            const instance = wildflower.componentInstances.get(componentEl.dataset.componentId);
            instance.context.moveToDone();

            await waitForUpdate(150);

            // BOTH the toolbar stat AND the column header should update
            expect(todoStat.textContent).toBe('1');
            expect(doneStat.textContent).toBe('2');
            expect(todoHeader.textContent).toBe('1');
            expect(doneHeader.textContent).toBe('2');
        });
    });

    describe('Multiple Expression Bindings', () => {
        it('should update all elements with identical expression bindings', async () => {
            container.innerHTML = `
                <div data-component="expr-test">
                    <span class="expr-1" data-bind="count > 5 ? 'High' : 'Low'"></span>
                    <span class="expr-2" data-bind="count > 5 ? 'High' : 'Low'"></span>
                </div>
            `;

            wildflower.component('expr-test', {
                state: { count: 3 },
                increment() {
                    this.state.count += 5;
                }
            });

            wildflower.scan();
            await waitForUpdate(100);

            const expr1 = container.querySelector('.expr-1');
            const expr2 = container.querySelector('.expr-2');

            expect(expr1.textContent).toBe('Low');
            expect(expr2.textContent).toBe('Low');

            // Increment to exceed threshold
            const componentEl = container.querySelector('[data-component="expr-test"]');
            const instance = wildflower.componentInstances.get(componentEl.dataset.componentId);
            instance.context.increment();

            await waitForUpdate(100);

            expect(expr1.textContent).toBe('High');
            expect(expr2.textContent).toBe('High');
        });
    });

    describe('Bindings Inside and Outside Lists', () => {
        it('should update computed bindings both inside list items and outside', async () => {
            container.innerHTML = `
                <div data-component="list-outside">
                    <div class="summary">
                        Total items: <span class="total" data-bind="computed:total"></span>
                    </div>
                    <div data-list="categories">
                        <template>
                            <div class="category">
                                <span class="name" data-bind="name"></span>
                                <span class="outside-total" data-bind="computed:total"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `;

            wildflower.component('list-outside', {
                state: {
                    categories: [
                        { name: 'Category A' },
                        { name: 'Category B' }
                    ],
                    itemCount: 10
                },
                computed: {
                    total() {
                        return this.state.itemCount;
                    }
                },
                addItems() {
                    this.state.itemCount += 5;
                }
            });

            wildflower.scan();
            await waitForUpdate(150);

            const summaryTotal = container.querySelector('.summary .total');

            // Initial value outside list
            expect(summaryTotal.textContent).toBe('10');

            // Update
            const componentEl = container.querySelector('[data-component="list-outside"]');
            const instance = wildflower.componentInstances.get(componentEl.dataset.componentId);
            instance.context.addItems();

            await waitForUpdate(150);

            // Summary should update
            expect(summaryTotal.textContent).toBe('15');
        });
    });

    describe('Rapid Updates with Multiple Bindings', () => {
        it('should handle rapid state changes with multiple bindings', async () => {
            container.innerHTML = `
                <div data-component="rapid-update">
                    <span class="a" data-bind="computed:value"></span>
                    <span class="b" data-bind="computed:value"></span>
                    <span class="c" data-bind="computed:value"></span>
                    <span class="d" data-bind="computed:value"></span>
                    <span class="e" data-bind="computed:value"></span>
                </div>
            `;

            wildflower.component('rapid-update', {
                state: { count: 0 },
                computed: {
                    value() {
                        return this.state.count;
                    }
                },
                increment() {
                    this.state.count++;
                }
            });

            wildflower.scan();
            await waitForUpdate(100);

            const spans = container.querySelectorAll('[data-bind="computed:value"]');
            expect(spans.length).toBe(5);

            // Rapid updates
            const componentEl = container.querySelector('[data-component="rapid-update"]');
            const instance = wildflower.componentInstances.get(componentEl.dataset.componentId);

            for (let i = 0; i < 10; i++) {
                instance.context.increment();
            }

            await waitForUpdate(150);

            // All five spans should show 10
            spans.forEach(span => {
                expect(span.textContent).toBe('10');
            });
        });
    });

    describe('Conditional Visibility with Duplicate Bindings', () => {
        it('should update visible bindings even when some are hidden', async () => {
            container.innerHTML = `
                <div data-component="visibility-test">
                    <span class="always-visible" data-bind="computed:count"></span>
                    <div data-show="showExtra">
                        <span class="sometimes-visible" data-bind="computed:count"></span>
                    </div>
                    <span class="also-visible" data-bind="computed:count"></span>
                </div>
            `;

            wildflower.component('visibility-test', {
                state: {
                    items: [1, 2, 3],
                    showExtra: false
                },
                computed: {
                    count() {
                        return this.state.items.length;
                    }
                },
                addItem() {
                    this.state.items.push(this.state.items.length + 1);
                },
                toggleExtra() {
                    this.state.showExtra = !this.state.showExtra;
                }
            });

            wildflower.scan();
            await waitForUpdate(100);

            const alwaysVisible = container.querySelector('.always-visible');
            const alsoVisible = container.querySelector('.also-visible');

            expect(alwaysVisible.textContent).toBe('3');
            expect(alsoVisible.textContent).toBe('3');

            // Add item while extra is hidden
            const componentEl = container.querySelector('[data-component="visibility-test"]');
            const instance = wildflower.componentInstances.get(componentEl.dataset.componentId);
            instance.context.addItem();

            await waitForUpdate(100);

            // Both visible bindings should update
            expect(alwaysVisible.textContent).toBe('4');
            expect(alsoVisible.textContent).toBe('4');

            // Show the extra binding
            instance.context.toggleExtra();
            await waitForUpdate(100);

            const sometimesVisible = container.querySelector('.sometimes-visible');
            expect(sometimesVisible.textContent).toBe('4');
        });
    });
});
