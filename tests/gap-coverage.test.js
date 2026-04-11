/**
 * Gap Coverage Tests
 *
 * Comprehensive tests for framework gaps discovered during Configurable Component Templates development.
 * These tests ensure the framework handles various edge cases in list item contexts.
 *
 * Gaps covered:
 * - Gap 1: Expression bindings in list items (ternary, math, string concat, comparisons)
 * - Gap 2: data-model to sibling data-bind reactivity in lists
 * - Gap 3: data-render directive in list items (simple, nested properties, negation)
 * - Gap 4: Computed properties interaction with lists
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework } from './helpers/load-framework.js';

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to wait for complete render cycle
async function waitForCompleteRender() {
    if (window.wildflower?._forceCompleteRender) {
        await window.wildflower._forceCompleteRender();
    }
    await new Promise(resolve => setTimeout(resolve, 50));
}

// Helper to simulate input event
function simulateInput(element, value) {
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
}

// Helper to simulate change event (for checkboxes, selects)
function simulateChange(element) {
    element.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Gap Coverage Tests', () => {
    let container;
    let wildflower;

    beforeAll(async () => {
        await loadFramework();
    });

    beforeEach(() => {
        wildflower = window.wildflower;
        resetFramework();

        // Clear the context registry
        if (wildflower._contextRegistry) {
            wildflower._contextRegistry.contexts?.clear();
            wildflower._contextRegistry.contextsByType?.clear();
            wildflower._contextRegistry.contextsByComponent?.clear();
            wildflower._contextRegistry.dependencies?.clear();
            wildflower._contextRegistry._contextTypeCache?.clear();
            wildflower._contextRegistry._contextModificationCounter = 0;
        }

        // Clear list relationships
        if (wildflower._listRelationships) {
            wildflower._listRelationships.clear();
        }

        // Create test container
        container = document.createElement('div');
        container.id = 'test-container';
        container.style.position = 'absolute';
        container.style.left = '-9999px';
        container.style.opacity = '0';
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
        resetFramework();
    });

    // ============================================================
    // GAP 1: Expression Bindings in List Items
    // ============================================================
    describe('Gap 1: Expression bindings in list items', () => {

        it('should evaluate ternary expressions in list items', async () => {
            wildflower.component('test-ternary', {
                state: {
                    items: [
                        { name: 'Item A', active: true },
                        { name: 'Item B', active: false },
                        { name: 'Item C', active: true }
                    ]
                }
            });

            container.innerHTML = `
                <div data-component="test-ternary">
                    <ul data-list="items">
                        <template>
                            <li class="item">
                                <span class="name" data-bind="name"></span>
                                <span class="status" data-bind="active ? 'Active' : 'Inactive'"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan();
            await waitForCompleteRender();
            await waitForUpdate(100);

            const statuses = Array.from(container.querySelectorAll('.status'))
                .filter(el => !el.closest('template'));

            expect(statuses.length).toBe(3);
            expect(statuses[0].textContent).toBe('Active');
            expect(statuses[1].textContent).toBe('Inactive');
            expect(statuses[2].textContent).toBe('Active');
        });

        it('should evaluate math expressions in list items', async () => {
            wildflower.component('test-math', {
                state: {
                    products: [
                        { name: 'Apple', price: 2, quantity: 5 },
                        { name: 'Banana', price: 1, quantity: 10 },
                        { name: 'Orange', price: 3, quantity: 4 }
                    ]
                }
            });

            container.innerHTML = `
                <div data-component="test-math">
                    <ul data-list="products">
                        <template>
                            <li class="item">
                                <span class="name" data-bind="name"></span>
                                <span class="total" data-bind="price * quantity"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan();
            await waitForCompleteRender();
            await waitForUpdate(100);

            const totals = Array.from(container.querySelectorAll('.total'))
                .filter(el => !el.closest('template'));

            expect(totals.length).toBe(3);
            expect(totals[0].textContent).toBe('10'); // 2 * 5
            expect(totals[1].textContent).toBe('10'); // 1 * 10
            expect(totals[2].textContent).toBe('12'); // 3 * 4
        });

        it('should evaluate string concatenation in list items', async () => {
            wildflower.component('test-concat', {
                state: {
                    users: [
                        { name: 'Alice' },
                        { name: 'Bob' },
                        { name: 'Carol' }
                    ]
                }
            });

            container.innerHTML = `
                <div data-component="test-concat">
                    <ul data-list="users">
                        <template>
                            <li class="item">
                                <span class="greeting" data-bind="'Hello, ' + name + '!'"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan();
            await waitForCompleteRender();
            await waitForUpdate(100);

            const greetings = Array.from(container.querySelectorAll('.greeting'))
                .filter(el => !el.closest('template'));

            expect(greetings.length).toBe(3);
            expect(greetings[0].textContent).toBe('Hello, Alice!');
            expect(greetings[1].textContent).toBe('Hello, Bob!');
            expect(greetings[2].textContent).toBe('Hello, Carol!');
        });

        it('should evaluate comparison expressions in list items', async () => {
            wildflower.component('test-comparison', {
                state: {
                    scores: [
                        { player: 'Player 1', score: 75 },
                        { player: 'Player 2', score: 30 },
                        { player: 'Player 3', score: 50 }
                    ]
                }
            });

            container.innerHTML = `
                <div data-component="test-comparison">
                    <ul data-list="scores">
                        <template>
                            <li class="item">
                                <span class="player" data-bind="player"></span>
                                <span class="level" data-bind="score > 50 ? 'High' : 'Low'"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan();
            await waitForCompleteRender();
            await waitForUpdate(100);

            const levels = Array.from(container.querySelectorAll('.level'))
                .filter(el => !el.closest('template'));

            expect(levels.length).toBe(3);
            expect(levels[0].textContent).toBe('High');  // 75 > 50
            expect(levels[1].textContent).toBe('Low');   // 30 > 50 = false
            expect(levels[2].textContent).toBe('Low');   // 50 > 50 = false
        });

        it('should evaluate expressions on root list item element', async () => {
            wildflower.component('test-root-expr', {
                state: {
                    items: [
                        { name: 'Item A', active: true },
                        { name: 'Item B', active: false },
                        { name: 'Item C', active: true }
                    ]
                }
            });

            container.innerHTML = `
                <div data-component="test-root-expr">
                    <ul data-list="items" style="list-style: none; padding: 0;">
                        <template>
                            <li class="item root-expr" data-bind="active ? name + ' (Active)' : name + ' (Inactive)'"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan();
            await waitForCompleteRender();
            await waitForUpdate(100);

            const items = Array.from(container.querySelectorAll('.root-expr'))
                .filter(el => !el.closest('template'));

            expect(items.length).toBe(3);
            expect(items[0].textContent).toBe('Item A (Active)');
            expect(items[1].textContent).toBe('Item B (Inactive)');
            expect(items[2].textContent).toBe('Item C (Active)');
        });
    });

    // ============================================================
    // GAP 2: data-model to Sibling data-bind Reactivity
    // ============================================================
    describe('Gap 2: data-model to sibling data-bind reactivity', () => {

        it('should update sibling data-bind when text input changes in list item', async () => {
            wildflower.component('test-text-model', {
                state: {
                    items: [
                        { name: 'Initial A' },
                        { name: 'Initial B' }
                    ]
                }
            });

            container.innerHTML = `
                <div data-component="test-text-model">
                    <ul data-list="items">
                        <template>
                            <li class="item">
                                <input type="text" data-model="name" class="name-input">
                                <span class="name-display" data-bind="name"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan();
            await waitForCompleteRender();
            await waitForUpdate(100);

            const items = Array.from(container.querySelectorAll('.item'))
                .filter(el => !el.closest('template'));
            const input = items[0].querySelector('.name-input');
            const display = items[0].querySelector('.name-display');

            // Initial state
            expect(display.textContent).toBe('Initial A');

            // Simulate typing
            simulateInput(input, 'Updated Value');
            await waitForUpdate(100);

            expect(display.textContent).toBe('Updated Value');
        });

        it('should update sibling data-bind when checkbox changes in list item', async () => {
            wildflower.component('test-checkbox-model', {
                state: {
                    todos: [
                        { task: 'Task A', completed: false },
                        { task: 'Task B', completed: true }
                    ]
                }
            });

            container.innerHTML = `
                <div data-component="test-checkbox-model">
                    <ul data-list="todos">
                        <template>
                            <li class="item">
                                <input type="checkbox" data-model="completed" class="checkbox">
                                <span class="status" data-bind="completed"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan();
            await waitForCompleteRender();
            await waitForUpdate(100);

            const items = Array.from(container.querySelectorAll('.item'))
                .filter(el => !el.closest('template'));
            const checkbox = items[0].querySelector('.checkbox');
            const status = items[0].querySelector('.status');

            // Initial state
            expect(status.textContent).toBe('false');

            // Toggle checkbox
            checkbox.checked = true;
            simulateChange(checkbox);
            await waitForUpdate(100);

            expect(status.textContent).toBe('true');
        });

        it('should update sibling data-bind when select changes in list item', async () => {
            wildflower.component('test-select-model', {
                state: {
                    items: [
                        { priority: 'low' },
                        { priority: 'medium' }
                    ]
                }
            });

            container.innerHTML = `
                <div data-component="test-select-model">
                    <ul data-list="items">
                        <template>
                            <li class="item">
                                <select data-model="priority" class="priority-select">
                                    <option value="low">Low</option>
                                    <option value="medium">Medium</option>
                                    <option value="high">High</option>
                                </select>
                                <span class="priority-display" data-bind="priority"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan();
            await waitForCompleteRender();
            await waitForUpdate(100);

            const items = Array.from(container.querySelectorAll('.item'))
                .filter(el => !el.closest('template'));
            const select = items[0].querySelector('.priority-select');
            const display = items[0].querySelector('.priority-display');

            // Initial state
            expect(display.textContent).toBe('low');

            // Change selection
            select.value = 'high';
            simulateChange(select);
            await waitForUpdate(100);

            expect(display.textContent).toBe('high');
        });
    });

    // ============================================================
    // GAP 3: data-render in List Items
    // ============================================================
    describe('Gap 3: data-render in list items', () => {

        it('should render data-render elements based on simple boolean property', async () => {
            wildflower.component('test-simple-render', {
                state: {
                    items: [
                        { name: 'Item A', expanded: true },
                        { name: 'Item B', expanded: false },
                        { name: 'Item C', expanded: true }
                    ]
                }
            });

            container.innerHTML = `
                <div data-component="test-simple-render">
                    <ul data-list="items">
                        <template>
                            <li class="item">
                                <span class="name" data-bind="name"></span>
                                <div class="details" data-render="expanded">Details content</div>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan();
            await waitForCompleteRender();
            await waitForUpdate(100);

            const items = Array.from(container.querySelectorAll('.item'))
                .filter(el => !el.closest('template'));

            expect(items.length).toBe(3);
            expect(items[0].querySelector('.details')).not.toBeNull();
            expect(items[1].querySelector('.details')).toBeNull();
            expect(items[2].querySelector('.details')).not.toBeNull();
        });

        it('should render data-render elements based on nested property path', async () => {
            wildflower.component('test-nested-render', {
                state: {
                    items: [
                        { name: 'Item A', settings: { showDetails: false } },
                        { name: 'Item B', settings: { showDetails: true } }
                    ]
                }
            });

            container.innerHTML = `
                <div data-component="test-nested-render">
                    <ul data-list="items">
                        <template>
                            <li class="item">
                                <span class="name" data-bind="name"></span>
                                <div class="nested-content" data-render="settings.showDetails">Nested details</div>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan();
            await waitForCompleteRender();
            await waitForUpdate(100);

            const items = Array.from(container.querySelectorAll('.item'))
                .filter(el => !el.closest('template'));

            expect(items.length).toBe(2);
            expect(items[0].querySelector('.nested-content')).toBeNull();
            expect(items[1].querySelector('.nested-content')).not.toBeNull();
        });

        it('should handle data-render with negation in list items', async () => {
            wildflower.component('test-negated-render', {
                state: {
                    items: [
                        { name: 'Item A', hidden: true },
                        { name: 'Item B', hidden: false }
                    ]
                }
            });

            container.innerHTML = `
                <div data-component="test-negated-render">
                    <ul data-list="items">
                        <template>
                            <li class="item">
                                <span class="name" data-bind="name"></span>
                                <div class="content" data-render="!hidden">Visible when not hidden</div>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan();
            await waitForCompleteRender();
            await waitForUpdate(100);

            const items = Array.from(container.querySelectorAll('.item'))
                .filter(el => !el.closest('template'));

            expect(items[0].querySelector('.content')).toBeNull();     // hidden: true -> !hidden = false
            expect(items[1].querySelector('.content')).not.toBeNull(); // hidden: false -> !hidden = true
        });

        it('should not affect data-render outside of lists (control)', async () => {
            wildflower.component('test-control-render', {
                state: {
                    showContent: true,
                    hideContent: false
                }
            });

            container.innerHTML = `
                <div data-component="test-control-render">
                    <div class="shown" data-render="showContent">Shown content</div>
                    <div class="hidden" data-render="hideContent">Hidden content</div>
                </div>
            `;

            wildflower.scan();
            await waitForCompleteRender();
            await waitForUpdate(100);

            expect(container.querySelector('.shown')).not.toBeNull();
            expect(container.querySelector('.hidden')).toBeNull();
        });
    });

    // ============================================================
    // GAP 4: Computed Properties with Lists
    // ============================================================
    describe('Gap 4: Computed properties with lists', () => {

        it('should evaluate component-level computed that counts list items', async () => {
            wildflower.component('test-array-computed', {
                state: {
                    items: [
                        { name: 'Item A', active: true },
                        { name: 'Item B', active: false },
                        { name: 'Item C', active: true }
                    ]
                },
                computed: {
                    totalCount() {
                        return this.state.items.length;
                    },
                    activeCount() {
                        return this.state.items.filter(i => i.active).length;
                    }
                }
            });

            container.innerHTML = `
                <div data-component="test-array-computed">
                    <p>Total: <span class="total-count" data-bind="computed:totalCount"></span></p>
                    <p>Active: <span class="active-count" data-bind="computed:activeCount"></span></p>
                    <ul data-list="items">
                        <template>
                            <li class="item" data-bind="name"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan();
            await waitForCompleteRender();
            await waitForUpdate(100);

            expect(container.querySelector('.total-count').textContent).toBe('3');
            expect(container.querySelector('.active-count').textContent).toBe('2');
        });

        it('should display pre-computed values stored in list item data', async () => {
            wildflower.component('test-precomputed', {
                state: {
                    users: [
                        { firstName: 'John', lastName: 'Doe', fullName: 'John Doe' },
                        { firstName: 'Jane', lastName: 'Smith', fullName: 'Jane Smith' }
                    ]
                }
            });

            container.innerHTML = `
                <div data-component="test-precomputed">
                    <ul data-list="users">
                        <template>
                            <li class="item">
                                <span class="first" data-bind="firstName"></span>
                                <span class="last" data-bind="lastName"></span>
                                <span class="full" data-bind="fullName"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan();
            await waitForCompleteRender();
            await waitForUpdate(100);

            const fullNames = Array.from(container.querySelectorAll('.full'))
                .filter(el => !el.closest('template'));

            expect(fullNames[0].textContent).toBe('John Doe');
            expect(fullNames[1].textContent).toBe('Jane Smith');
        });

        it('should handle workaround pattern: calculate in action and store in item', async () => {
            let componentInstance;

            wildflower.component('test-workaround', {
                state: {
                    orders: [
                        { product: 'Widget', price: 10, qty: 2, total: 20 },
                        { product: 'Gadget', price: 25, qty: 1, total: 25 }
                    ]
                },
                init() {
                    componentInstance = this;
                },
                increaseQty(event, element, { index }) {
                    const order = this.state.orders[index];
                    order.qty++;
                    order.total = order.price * order.qty; // Recalculate
                }
            });

            container.innerHTML = `
                <div data-component="test-workaround">
                    <ul data-list="orders">
                        <template>
                            <li class="item">
                                <span class="product" data-bind="product"></span>:
                                <span class="total" data-bind="total"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan();
            await waitForCompleteRender();
            await waitForUpdate(100);

            const totals = Array.from(container.querySelectorAll('.total'))
                .filter(el => !el.closest('template'));

            // Initial state
            expect(totals[0].textContent).toBe('20');
            expect(totals[1].textContent).toBe('25');

            // Manually update via the workaround pattern
            componentInstance.state.orders[0].qty = 5;
            componentInstance.state.orders[0].total = componentInstance.state.orders[0].price * componentInstance.state.orders[0].qty;

            await waitForCompleteRender();
            await waitForUpdate(100);

            // Re-query after update
            const updatedTotals = Array.from(container.querySelectorAll('.total'))
                .filter(el => !el.closest('template'));

            expect(updatedTotals[0].textContent).toBe('50'); // 10 * 5
        });
    });
});
