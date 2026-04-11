/**
 * Test Suite: data-bind-attr with nested data-bind
 *
 * Tests for the bug where data-bind elements nested inside elements
 * with data-bind-attr show [object Object] instead of the actual value.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework } from './helpers/load-framework.js';

describe('data-bind-attr with nested data-bind', () => {
    let testContainer;
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
        if (testContainer) {
            testContainer.remove();
        }
        // Note: do NOT call wildflower.destroy() — it corrupts the singleton
        // instance on builds that lack the method. resetFramework() handles cleanup.
    });

    const waitForFramework = () => new Promise(resolve => setTimeout(resolve, 50));

    describe('Bug reproduction: nested data-bind inside data-bind-attr', () => {

        it('should correctly display data-bind value when parent has data-bind-attr (initial render)', async () => {
            wildflower.component('test-comp', {
                state: {
                    status: 'pending'
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-comp">
                    <div data-bind-attr="{ 'data-status': status }">
                        Status: <span data-bind="status"></span>
                    </div>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            // The span should show 'pending', not '[object Object]'
            const span = testContainer.querySelector('span[data-bind="status"]');
            expect(span.textContent).toBe('pending');

            // The parent div should have the data-status attribute
            const parentDiv = testContainer.querySelector('[data-bind-attr]');
            expect(parentDiv.getAttribute('data-status')).toBe('pending');
        });

        it('should correctly update data-bind value when state changes (reactive update)', async () => {
            wildflower.component('test-comp', {
                state: {
                    status: 'pending'
                },
                changeStatus() {
                    this.state.status = 'complete';
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-comp">
                    <div data-bind-attr="{ 'data-status': status }">
                        Status: <span data-bind="status"></span>
                    </div>
                    <button data-action="changeStatus">Change</button>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            // Initial render should show 'pending'
            const span = testContainer.querySelector('span[data-bind="status"]');
            expect(span.textContent).toBe('pending');

            // Click the button to change status
            const button = testContainer.querySelector('button');
            button.click();
            await waitForFramework();

            // After update, should show 'complete', not '[object Object]'
            expect(span.textContent).toBe('complete');

            // The parent div should also update
            const parentDiv = testContainer.querySelector('[data-bind-attr]');
            expect(parentDiv.getAttribute('data-status')).toBe('complete');
        });

        it('should work correctly when data-bind is NOT inside data-bind-attr (control test)', async () => {
            wildflower.component('test-comp', {
                state: {
                    status: 'pending'
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-comp">
                    <div>
                        Status: <span data-bind="status"></span>
                    </div>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            // This should definitely work - no data-bind-attr parent
            const span = testContainer.querySelector('span[data-bind="status"]');
            expect(span.textContent).toBe('pending');
        });

        it('should handle multiple data-bind elements inside data-bind-attr', async () => {
            wildflower.component('test-comp', {
                state: {
                    title: 'Hello',
                    count: 42
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-comp">
                    <div data-bind-attr="{ 'data-title': title, 'data-count': count }">
                        <span data-bind="title"></span>: <span data-bind="count"></span>
                    </div>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const titleSpan = testContainer.querySelectorAll('span')[0];
            const countSpan = testContainer.querySelectorAll('span')[1];

            expect(titleSpan.textContent).toBe('Hello');
            expect(countSpan.textContent).toBe('42');

            const parentDiv = testContainer.querySelector('[data-bind-attr]');
            expect(parentDiv.getAttribute('data-title')).toBe('Hello');
            expect(parentDiv.getAttribute('data-count')).toBe('42');
        });

        it('should handle deeply nested data-bind inside data-bind-attr', async () => {
            wildflower.component('test-comp', {
                state: {
                    value: 'test-value'
                }
            });

            testContainer.innerHTML = `
                <div data-component="test-comp">
                    <div data-bind-attr="{ 'data-value': value }">
                        <div class="wrapper">
                            <div class="inner">
                                <span data-bind="value"></span>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForFramework();

            const span = testContainer.querySelector('span[data-bind="value"]');
            expect(span.textContent).toBe('test-value');
        });

    });
});
