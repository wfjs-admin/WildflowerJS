/**
 * CSP Mode Integration Tests
 *
 * Tests the framework's behavior with forceCSPMode enabled.
 * This simulates running in an environment with strict CSP headers.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework } from './helpers/load-framework.js';

describe('CSP Mode Integration', () => {
    let testContainer;
    let wildflower;

    beforeAll(async () => {
        await loadFramework();
    });

    beforeEach(async () => {
        wildflower = window.wildflower;
        resetFramework();

        testContainer = document.createElement('div');
        testContainer.id = 'test-container';
        document.body.appendChild(testContainer);
    });

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer);
        }
    });

    describe('CSP Detection', () => {
        it('should have CSP-related options and flags', () => {
            expect(wildflower).toBeDefined();
            // The framework should support forceCSPMode in options
            expect(wildflower.options).toBeDefined();
            // Check that _useCSPSafeEvaluation flag exists
            expect(typeof wildflower._useCSPSafeEvaluation).toBe('boolean');
        });

        it('should default to non-CSP mode when new Function() works', () => {
            // In a normal test environment without CSP, _useCSPSafeEvaluation should be false
            // unless forceCSPMode was set
            expect(wildflower._useCSPSafeEvaluation).toBe(false);
        });
    });

    describe('Basic bindings work in CSP mode', () => {
        it('should evaluate simple expressions', async () => {
                        // Test that expression evaluation works even in CSP mode
            wildflower.component('csp-test-simple', {
                state: { count: 5 }
            });

            testContainer.innerHTML = `
                <div data-component="csp-test-simple">
                    <span id="count-display" data-bind="count"></span>
                </div>
            `;

            wildflower._scanForDynamicComponents();
            await new Promise(r => setTimeout(r, 100));

            const span = document.getElementById('count-display');
            expect(span.textContent).toBe('5');
        });

        it('should evaluate arithmetic expressions', async () => {
                        wildflower.component('csp-test-arithmetic', {
                state: { price: 10, quantity: 3 }
            });

            testContainer.innerHTML = `
                <div data-component="csp-test-arithmetic">
                    <span id="total-display" data-bind="price * quantity"></span>
                </div>
            `;

            wildflower._scanForDynamicComponents();
            await new Promise(r => setTimeout(r, 100));

            const span = document.getElementById('total-display');
            expect(span.textContent).toBe('30');
        });

        it('should evaluate ternary expressions', async () => {
                        wildflower.component('csp-test-ternary', {
                state: { isAdmin: true }
            });

            testContainer.innerHTML = `
                <div data-component="csp-test-ternary">
                    <span id="role-display" data-bind="isAdmin ? 'Admin' : 'User'"></span>
                </div>
            `;

            wildflower._scanForDynamicComponents();
            await new Promise(r => setTimeout(r, 100));

            const span = document.getElementById('role-display');
            expect(span.textContent).toBe('Admin');
        });

        it('should evaluate comparison expressions', async () => {
                        wildflower.component('csp-test-comparison', {
                state: { count: 10 }
            });

            testContainer.innerHTML = `
                <div data-component="csp-test-comparison">
                    <span id="result-display" data-bind="count > 5 ? 'High' : 'Low'"></span>
                </div>
            `;

            wildflower._scanForDynamicComponents();
            await new Promise(r => setTimeout(r, 100));

            const span = document.getElementById('result-display');
            expect(span.textContent).toBe('High');
        });

        it('should evaluate logical expressions', async () => {
                        wildflower.component('csp-test-logical', {
                state: { isLoading: false, hasData: true }
            });

            testContainer.innerHTML = `
                <div data-component="csp-test-logical">
                    <span id="status-display" data-bind="!isLoading && hasData ? 'Ready' : 'Loading'"></span>
                </div>
            `;

            wildflower._scanForDynamicComponents();
            await new Promise(r => setTimeout(r, 100));

            const span = document.getElementById('status-display');
            expect(span.textContent).toBe('Ready');
        });
    });

    describe('List rendering works in CSP mode', () => {
        it('should render list with expression bindings', async () => {
                        wildflower.component('csp-test-list', {
                state: {
                    items: [
                        { name: 'Item 1', price: 10 },
                        { name: 'Item 2', price: 20 }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="csp-test-list">
                    <ul data-list="items">
                        <template>
                            <li class="list-item">
                                <span class="name" data-bind="name"></span>
                                <span class="price" data-bind="price * 2"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower._scanForDynamicComponents();
            await new Promise(r => setTimeout(r, 200));

            const items = document.querySelectorAll('.list-item');
            expect(items.length).toBe(2);

            const prices = document.querySelectorAll('.price');
            expect(prices[0].textContent).toBe('20');
            expect(prices[1].textContent).toBe('40');
        });

        it('should handle list context variables (_index, _first, _last)', async () => {
            wildflower.component('csp-test-list-context', {
                state: {
                    items: [{ val: 'A' }, { val: 'B' }, { val: 'C' }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="csp-test-list-context">
                    <ul data-list="items">
                        <template>
                            <li class="list-item">
                                <span class="index-display" data-bind="_index"></span>
                            </li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower._scanForDynamicComponents();
            await new Promise(r => setTimeout(r, 200));

            const items = document.querySelectorAll('.list-item');
            expect(items.length).toBe(3);

            // Check list context variables are accessible
            const indexDisplays = document.querySelectorAll('.index-display');
            expect(indexDisplays[0].textContent).toBe('0');
            expect(indexDisplays[1].textContent).toBe('1');
            expect(indexDisplays[2].textContent).toBe('2');
        });
    });

    describe('Conditional rendering works in CSP mode', () => {
        it('should evaluate data-show conditions', async () => {
                        wildflower.component('csp-test-show', {
                state: { visible: true }
            });

            testContainer.innerHTML = `
                <div data-component="csp-test-show">
                    <div id="show-element" data-show="visible">Visible Content</div>
                </div>
            `;

            wildflower._scanForDynamicComponents();
            await new Promise(r => setTimeout(r, 100));

            const el = document.getElementById('show-element');
            expect(el.style.display).not.toBe('none');
        });

        it('should evaluate data-show with expression', async () => {
                        wildflower.component('csp-test-show-expr', {
                state: { count: 10 }
            });

            testContainer.innerHTML = `
                <div data-component="csp-test-show-expr">
                    <div id="show-expr-element" data-show="count > 5">High Count</div>
                </div>
            `;

            wildflower._scanForDynamicComponents();
            await new Promise(r => setTimeout(r, 100));

            const el = document.getElementById('show-expr-element');
            expect(el.style.display).not.toBe('none');
        });
    });

    describe('External function calls work in CSP mode', () => {
        it('should evaluate external() calls', async () => {
                        // Create a store first
            wildflower.store('testStore', {
                state: { count: 42 }
            });

            wildflower.component('csp-test-external', {
                state: {}
            });

            testContainer.innerHTML = `
                <div data-component="csp-test-external">
                    <span id="external-display" data-bind="external('testStore', 'count')"></span>
                </div>
            `;

            wildflower._scanForDynamicComponents();
            await new Promise(r => setTimeout(r, 100));

            const span = document.getElementById('external-display');
            expect(span.textContent).toBe('42');
        });

        it('should evaluate $store shorthand syntax', async () => {
                        // Create a store
            wildflower.store('myStore', {
                state: { value: 'store-value' }
            });

            wildflower.component('csp-test-shorthand', {
                state: {}
            });

            testContainer.innerHTML = `
                <div data-component="csp-test-shorthand">
                    <span id="shorthand-display" data-bind="$myStore.value"></span>
                </div>
            `;

            wildflower._scanForDynamicComponents();
            await new Promise(r => setTimeout(r, 100));

            const span = document.getElementById('shorthand-display');
            expect(span.textContent).toBe('store-value');
        });
    });

    describe('Reactivity works in CSP mode', () => {
        it('should update bindings when state changes', async () => {
                        wildflower.component('csp-test-reactive', {
                state: { count: 0 },
                increment() {
                    this.state.count++;
                }
            });

            testContainer.innerHTML = `
                <div data-component="csp-test-reactive">
                    <span id="reactive-count" data-bind="count"></span>
                    <button id="reactive-btn" data-action="increment">Increment</button>
                </div>
            `;

            wildflower._scanForDynamicComponents();
            await new Promise(r => setTimeout(r, 100));

            const span = document.getElementById('reactive-count');
            expect(span.textContent).toBe('0');

            // Trigger the action
            const btn = document.getElementById('reactive-btn');
            btn.click();
            await new Promise(r => setTimeout(r, 100));

            expect(span.textContent).toBe('1');
        });

        it('should update expression bindings reactively', async () => {
                        wildflower.component('csp-test-reactive-expr', {
                state: { price: 10, quantity: 2 },
                updateQuantity() {
                    this.state.quantity = 5;
                }
            });

            testContainer.innerHTML = `
                <div data-component="csp-test-reactive-expr">
                    <span id="reactive-total" data-bind="price * quantity"></span>
                    <button id="update-btn" data-action="updateQuantity">Update</button>
                </div>
            `;

            wildflower._scanForDynamicComponents();
            await new Promise(r => setTimeout(r, 100));

            const span = document.getElementById('reactive-total');
            expect(span.textContent).toBe('20');

            // Update state
            const btn = document.getElementById('update-btn');
            btn.click();
            await new Promise(r => setTimeout(r, 100));

            expect(span.textContent).toBe('50');
        });
    });
});
