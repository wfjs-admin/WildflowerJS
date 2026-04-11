/**
 * Keyed Diff Scenarios Tests
 *
 * These tests cover complex list reconciliation scenarios that require
 * a keyed diff algorithm to handle efficiently. They are designed to:
 *
 * 1. FAIL or fall back to full rebuild BEFORE _tryKeyedDiff is implemented
 * 2. PASS with DOM node preservation AFTER _tryKeyedDiff is implemented
 *
 * Success criteria:
 * - DOM nodes are MOVED, not recreated (verified via reference equality)
 * - Element state (focus, selection, scroll) is preserved
 * - _listIndex and _itemData are correctly updated on moved nodes
 *
 * @see docs/future/HYBRID_LIST_RECONCILIATION_PLAN.md
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework } from './helpers/load-framework.js';

async function waitForCompleteRender() {
    if (window.wildflower?._forceCompleteRender) {
        await window.wildflower._forceCompleteRender();
    }
    await new Promise(resolve => setTimeout(resolve, 50));
}

describe('Keyed Diff Scenarios', () => {
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
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer);
        }
        testContainer = null;
    });

    describe('Reverse Operation', () => {
        it('handles pure reverse without DOM pre-move', async () => {
            // This tests reversing the data array directly (not via computed sort)
            // Current behavior: likely falls back to full rebuild
            // Expected after _tryKeyedDiff: DOM nodes are moved, not recreated

            wildflower.component('reverse-test', {
                state: {
                    items: [
                        { id: 1, name: 'First' },
                        { id: 2, name: 'Second' },
                        { id: 3, name: 'Third' },
                        { id: 4, name: 'Fourth' }
                    ]
                },
                reverseItems() {
                    this.state.items = [...this.state.items].reverse();
                }
            });

            testContainer.innerHTML = `
                <div data-component="reverse-test">
                    <ul data-list="items" data-key="id">
                        <template>
                            <li class="item" data-bind="name"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForCompleteRender();

            const ul = testContainer.querySelector('ul');
            const originalItems = Array.from(ul.querySelectorAll('li'));

            // Store references to original DOM nodes
            const originalRefs = originalItems.map(el => el);
            expect(originalItems[0].textContent).toBe('First');
            expect(originalItems[3].textContent).toBe('Fourth');

            // Reverse the array
            const component = wildflower.getComponentsByType('reverse-test')[0];
            component.context.reverseItems();
            await waitForCompleteRender();

            const newItems = ul.querySelectorAll('li');

            // Verify order is reversed
            expect(newItems[0].textContent).toBe('Fourth');
            expect(newItems[1].textContent).toBe('Third');
            expect(newItems[2].textContent).toBe('Second');
            expect(newItems[3].textContent).toBe('First');

            // Verify DOM nodes were MOVED, not recreated
            // (This is the key assertion - if _tryKeyedDiff works, same DOM nodes)
            expect(newItems[0]).toBe(originalRefs[3]); // Fourth was at index 3
            expect(newItems[1]).toBe(originalRefs[2]); // Third was at index 2
            expect(newItems[2]).toBe(originalRefs[1]); // Second was at index 1
            expect(newItems[3]).toBe(originalRefs[0]); // First was at index 0

            // Verify _listIndex is updated correctly
            expect(newItems[0]._listIndex).toBe(0);
            expect(newItems[1]._listIndex).toBe(1);
            expect(newItems[2]._listIndex).toBe(2);
            expect(newItems[3]._listIndex).toBe(3);
        });

        it('handles reverse with binding updates', async () => {
            wildflower.component('reverse-update-test', {
                state: {
                    items: [
                        { id: 'a', value: 10 },
                        { id: 'b', value: 20 },
                        { id: 'c', value: 30 }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="reverse-update-test">
                    <div data-list="items" data-key="id">
                        <template>
                            <span class="value" data-bind="value"></span>
                        </template>
                    </div>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForCompleteRender();

            const container = testContainer.querySelector('[data-list]');
            const originalSpans = Array.from(container.querySelectorAll('span'));
            const originalRefs = originalSpans.map(el => el);

            // Reverse AND update values
            const component = wildflower.getComponentsByType('reverse-update-test')[0];
            component.context.state.items = [
                { id: 'c', value: 300 },  // was 30
                { id: 'b', value: 200 },  // was 20
                { id: 'a', value: 100 }   // was 10
            ];
            await waitForCompleteRender();

            const newSpans = container.querySelectorAll('span');

            // Verify values are updated
            expect(newSpans[0].textContent).toBe('300');
            expect(newSpans[1].textContent).toBe('200');
            expect(newSpans[2].textContent).toBe('100');

            // Verify DOM nodes were moved (same references)
            expect(newSpans[0]).toBe(originalRefs[2]); // id:c was at index 2
            expect(newSpans[1]).toBe(originalRefs[1]); // id:b was at index 1
            expect(newSpans[2]).toBe(originalRefs[0]); // id:a was at index 0
        });
    });

    describe('Multi-Insert Operations', () => {
        it('handles multi-insert at non-contiguous positions', async () => {
            // Insert items at positions 1 and 3 simultaneously
            // Current behavior: likely falls back to full rebuild
            // Expected: existing nodes preserved, new nodes inserted

            wildflower.component('multi-insert-test', {
                state: {
                    items: [
                        { id: 1, name: 'A' },
                        { id: 2, name: 'B' },
                        { id: 3, name: 'C' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="multi-insert-test">
                    <ul data-list="items" data-key="id">
                        <template>
                            <li class="item" data-bind="name"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForCompleteRender();

            const ul = testContainer.querySelector('ul');
            const originalItems = Array.from(ul.querySelectorAll('li'));
            const originalRefs = originalItems.map(el => el);

            expect(originalItems.length).toBe(3);

            // Insert at positions 1 and 3: A, NEW1, B, NEW2, C
            const component = wildflower.getComponentsByType('multi-insert-test')[0];
            component.context.state.items = [
                { id: 1, name: 'A' },
                { id: 10, name: 'NEW1' },  // inserted
                { id: 2, name: 'B' },
                { id: 11, name: 'NEW2' },  // inserted
                { id: 3, name: 'C' }
            ];
            await waitForCompleteRender();

            const newItems = ul.querySelectorAll('li');
            expect(newItems.length).toBe(5);

            // Verify order
            expect(newItems[0].textContent).toBe('A');
            expect(newItems[1].textContent).toBe('NEW1');
            expect(newItems[2].textContent).toBe('B');
            expect(newItems[3].textContent).toBe('NEW2');
            expect(newItems[4].textContent).toBe('C');

            // Verify original nodes were preserved (not recreated)
            expect(newItems[0]).toBe(originalRefs[0]); // A
            expect(newItems[2]).toBe(originalRefs[1]); // B
            expect(newItems[4]).toBe(originalRefs[2]); // C

            // Verify _listIndex is correct for all items
            expect(newItems[0]._listIndex).toBe(0);
            expect(newItems[1]._listIndex).toBe(1);
            expect(newItems[2]._listIndex).toBe(2);
            expect(newItems[3]._listIndex).toBe(3);
            expect(newItems[4]._listIndex).toBe(4);
        });

        it('handles prepend (insert at beginning)', async () => {
            wildflower.component('prepend-test', {
                state: {
                    items: [
                        { id: 1, name: 'First' },
                        { id: 2, name: 'Second' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="prepend-test">
                    <ul data-list="items" data-key="id">
                        <template>
                            <li class="item" data-bind="name"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForCompleteRender();

            const ul = testContainer.querySelector('ul');
            const originalItems = Array.from(ul.querySelectorAll('li'));
            const originalRefs = originalItems.map(el => el);

            // Prepend new item
            const component = wildflower.getComponentsByType('prepend-test')[0];
            component.context.state.items = [
                { id: 0, name: 'Prepended' },
                { id: 1, name: 'First' },
                { id: 2, name: 'Second' }
            ];
            await waitForCompleteRender();

            const newItems = ul.querySelectorAll('li');
            expect(newItems.length).toBe(3);

            expect(newItems[0].textContent).toBe('Prepended');
            expect(newItems[1].textContent).toBe('First');
            expect(newItems[2].textContent).toBe('Second');

            // Original nodes should be preserved
            expect(newItems[1]).toBe(originalRefs[0]); // First
            expect(newItems[2]).toBe(originalRefs[1]); // Second
        });
    });

    describe('Multi-Remove Operations', () => {
        it('handles multi-remove at non-contiguous positions', async () => {
            // Remove items at positions 1 and 3 simultaneously
            // Current behavior: may work via multiple single removals or rebuild
            // Expected: efficient batch removal

            wildflower.component('multi-remove-test', {
                state: {
                    items: [
                        { id: 1, name: 'A' },
                        { id: 2, name: 'B' },  // will be removed
                        { id: 3, name: 'C' },
                        { id: 4, name: 'D' },  // will be removed
                        { id: 5, name: 'E' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="multi-remove-test">
                    <ul data-list="items" data-key="id">
                        <template>
                            <li class="item" data-bind="name"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForCompleteRender();

            const ul = testContainer.querySelector('ul');
            const originalItems = Array.from(ul.querySelectorAll('li'));
            const originalRefs = originalItems.map(el => el);

            expect(originalItems.length).toBe(5);

            // Remove B (id:2) and D (id:4)
            const component = wildflower.getComponentsByType('multi-remove-test')[0];
            component.context.state.items = [
                { id: 1, name: 'A' },
                { id: 3, name: 'C' },
                { id: 5, name: 'E' }
            ];
            await waitForCompleteRender();

            const newItems = ul.querySelectorAll('li');
            expect(newItems.length).toBe(3);

            // Verify remaining items
            expect(newItems[0].textContent).toBe('A');
            expect(newItems[1].textContent).toBe('C');
            expect(newItems[2].textContent).toBe('E');

            // Verify remaining nodes are the originals (not recreated)
            expect(newItems[0]).toBe(originalRefs[0]); // A was at 0
            expect(newItems[1]).toBe(originalRefs[2]); // C was at 2
            expect(newItems[2]).toBe(originalRefs[4]); // E was at 4

            // Verify _listIndex is updated
            expect(newItems[0]._listIndex).toBe(0);
            expect(newItems[1]._listIndex).toBe(1);
            expect(newItems[2]._listIndex).toBe(2);
        });
    });

    describe('Shuffle Operation', () => {
        it('handles shuffle (random permutation)', async () => {
            // Fisher-Yates shuffle - complete random reordering
            // This is the worst case for two-ended diff but should still work

            wildflower.component('shuffle-test', {
                state: {
                    items: [
                        { id: 1, name: 'One' },
                        { id: 2, name: 'Two' },
                        { id: 3, name: 'Three' },
                        { id: 4, name: 'Four' },
                        { id: 5, name: 'Five' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="shuffle-test">
                    <ul data-list="items" data-key="id">
                        <template>
                            <li class="item" data-bind="name"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForCompleteRender();

            const ul = testContainer.querySelector('ul');
            const originalItems = Array.from(ul.querySelectorAll('li'));

            // Create a map of id -> original DOM node
            const idToOriginalNode = new Map();
            originalItems.forEach((el, i) => {
                idToOriginalNode.set(i + 1, el); // id is 1-indexed
            });

            // Shuffle to: [3, 5, 1, 4, 2]
            const component = wildflower.getComponentsByType('shuffle-test')[0];
            component.context.state.items = [
                { id: 3, name: 'Three' },
                { id: 5, name: 'Five' },
                { id: 1, name: 'One' },
                { id: 4, name: 'Four' },
                { id: 2, name: 'Two' }
            ];
            await waitForCompleteRender();

            const newItems = ul.querySelectorAll('li');

            // Verify order
            expect(newItems[0].textContent).toBe('Three');
            expect(newItems[1].textContent).toBe('Five');
            expect(newItems[2].textContent).toBe('One');
            expect(newItems[3].textContent).toBe('Four');
            expect(newItems[4].textContent).toBe('Two');

            // Verify DOM nodes were moved, not recreated
            expect(newItems[0]).toBe(idToOriginalNode.get(3));
            expect(newItems[1]).toBe(idToOriginalNode.get(5));
            expect(newItems[2]).toBe(idToOriginalNode.get(1));
            expect(newItems[3]).toBe(idToOriginalNode.get(4));
            expect(newItems[4]).toBe(idToOriginalNode.get(2));

            // Verify all _listIndex values are correct
            for (let i = 0; i < newItems.length; i++) {
                expect(newItems[i]._listIndex).toBe(i);
            }
        });
    });

    describe('Combined Operations', () => {
        it('handles swap + add combination', async () => {
            // Swap two items AND add a new one in a single update
            // This is a compound operation that no single heuristic handles

            wildflower.component('swap-add-test', {
                state: {
                    items: [
                        { id: 1, name: 'A' },
                        { id: 2, name: 'B' },
                        { id: 3, name: 'C' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="swap-add-test">
                    <ul data-list="items" data-key="id">
                        <template>
                            <li class="item" data-bind="name"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForCompleteRender();

            const ul = testContainer.querySelector('ul');
            const originalItems = Array.from(ul.querySelectorAll('li'));
            const originalRefs = originalItems.map(el => el);

            // Swap A and C, add NEW between them
            const component = wildflower.getComponentsByType('swap-add-test')[0];
            component.context.state.items = [
                { id: 3, name: 'C' },      // was at index 2
                { id: 10, name: 'NEW' },   // new item
                { id: 2, name: 'B' },      // unchanged position
                { id: 1, name: 'A' }       // was at index 0
            ];
            await waitForCompleteRender();

            const newItems = ul.querySelectorAll('li');
            expect(newItems.length).toBe(4);

            // Verify order
            expect(newItems[0].textContent).toBe('C');
            expect(newItems[1].textContent).toBe('NEW');
            expect(newItems[2].textContent).toBe('B');
            expect(newItems[3].textContent).toBe('A');

            // Verify original nodes were preserved
            expect(newItems[0]).toBe(originalRefs[2]); // C was at 2
            expect(newItems[2]).toBe(originalRefs[1]); // B was at 1
            expect(newItems[3]).toBe(originalRefs[0]); // A was at 0
        });

        it('handles remove + reorder combination', async () => {
            wildflower.component('remove-reorder-test', {
                state: {
                    items: [
                        { id: 1, name: 'A' },
                        { id: 2, name: 'B' },
                        { id: 3, name: 'C' },
                        { id: 4, name: 'D' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="remove-reorder-test">
                    <ul data-list="items" data-key="id">
                        <template>
                            <li class="item" data-bind="name"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForCompleteRender();

            const ul = testContainer.querySelector('ul');
            const originalItems = Array.from(ul.querySelectorAll('li'));
            const originalRefs = originalItems.map(el => el);

            // Remove B (id:2) and reverse remaining: D, C, A
            const component = wildflower.getComponentsByType('remove-reorder-test')[0];
            component.context.state.items = [
                { id: 4, name: 'D' },
                { id: 3, name: 'C' },
                { id: 1, name: 'A' }
            ];
            await waitForCompleteRender();

            const newItems = ul.querySelectorAll('li');
            expect(newItems.length).toBe(3);

            expect(newItems[0].textContent).toBe('D');
            expect(newItems[1].textContent).toBe('C');
            expect(newItems[2].textContent).toBe('A');

            // Verify nodes were preserved
            expect(newItems[0]).toBe(originalRefs[3]); // D was at 3
            expect(newItems[1]).toBe(originalRefs[2]); // C was at 2
            expect(newItems[2]).toBe(originalRefs[0]); // A was at 0
        });
    });

    describe('State Preservation', () => {
        it('preserves input focus during reorder', async () => {
            wildflower.component('focus-preserve-test', {
                state: {
                    items: [
                        { id: 1, value: 'first' },
                        { id: 2, value: 'second' },
                        { id: 3, value: 'third' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="focus-preserve-test">
                    <div data-list="items" data-key="id">
                        <template>
                            <div class="row">
                                <input type="text" class="input" data-model="value">
                            </div>
                        </template>
                    </div>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForCompleteRender();

            const inputs = testContainer.querySelectorAll('input');

            // Focus the second input and type something
            inputs[1].focus();
            inputs[1].setSelectionRange(2, 5); // Select "con" in "second"

            expect(document.activeElement).toBe(inputs[1]);
            const selectionStart = inputs[1].selectionStart;
            const selectionEnd = inputs[1].selectionEnd;

            // Reverse the order
            const component = wildflower.getComponentsByType('focus-preserve-test')[0];
            component.context.state.items = [
                { id: 3, value: 'third' },
                { id: 2, value: 'second' },
                { id: 1, value: 'first' }
            ];
            await waitForCompleteRender();

            const newInputs = testContainer.querySelectorAll('input');

            // The input with id:2 should still be focused (now at index 1)
            // If DOM nodes were moved (not recreated), focus is preserved
            expect(document.activeElement).toBe(newInputs[1]);
            expect(newInputs[1].selectionStart).toBe(selectionStart);
            expect(newInputs[1].selectionEnd).toBe(selectionEnd);
        });

        it('preserves checkbox state during reorder when bound to state', async () => {
            // For data-model bound checkboxes, state is source of truth.
            // DOM is moved (not recreated), and checkbox reflects data value.
            // This tests that state-bound checkbox values are correctly updated after move.

            wildflower.component('checkbox-preserve-test', {
                state: {
                    items: [
                        { id: 1, label: 'A', checked: false },
                        { id: 2, label: 'B', checked: true },  // id:2 is checked
                        { id: 3, label: 'C', checked: false }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="checkbox-preserve-test">
                    <div data-list="items" data-key="id">
                        <template>
                            <label class="item">
                                <input type="checkbox" class="checkbox" data-model="checked">
                                <span data-bind="label"></span>
                            </label>
                        </template>
                    </div>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForCompleteRender();

            const checkboxes = testContainer.querySelectorAll('.checkbox');
            const originalRefs = Array.from(checkboxes);

            // Verify initial state
            expect(checkboxes[1].checked).toBe(true); // id:2 at index 1 is checked

            // Reverse order - id:2 should end up at index 1 (middle stays middle in odd-length reverse)
            const component = wildflower.getComponentsByType('checkbox-preserve-test')[0];
            component.context.state.items = [
                { id: 3, label: 'C', checked: false },
                { id: 2, label: 'B', checked: true },  // id:2 still checked
                { id: 1, label: 'A', checked: false }
            ];
            await waitForCompleteRender();

            const newCheckboxes = testContainer.querySelectorAll('.checkbox');

            // Verify DOM nodes were moved, not recreated
            expect(newCheckboxes[0]).toBe(originalRefs[2]); // id:3 was at index 2
            expect(newCheckboxes[1]).toBe(originalRefs[1]); // id:2 stays at index 1
            expect(newCheckboxes[2]).toBe(originalRefs[0]); // id:1 was at index 0

            // Verify checkbox state reflects data after move
            expect(newCheckboxes[0].checked).toBe(false); // id:3
            expect(newCheckboxes[1].checked).toBe(true);  // id:2 is still checked
            expect(newCheckboxes[2].checked).toBe(false); // id:1
        });
    });

    describe('Edge Cases', () => {
        it('handles empty to non-empty transition', async () => {
            wildflower.component('empty-to-full-test', {
                state: {
                    items: []
                }
            });

            testContainer.innerHTML = `
                <div data-component="empty-to-full-test">
                    <ul data-list="items" data-key="id">
                        <template>
                            <li data-bind="name"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForCompleteRender();

            const ul = testContainer.querySelector('ul');
            expect(ul.querySelectorAll('li').length).toBe(0);

            // Add items
            const component = wildflower.getComponentsByType('empty-to-full-test')[0];
            component.context.state.items = [
                { id: 1, name: 'First' },
                { id: 2, name: 'Second' }
            ];
            await waitForCompleteRender();

            const items = ul.querySelectorAll('li');
            expect(items.length).toBe(2);
            expect(items[0].textContent).toBe('First');
            expect(items[1].textContent).toBe('Second');
        });

        it('handles complete replacement (all new keys)', async () => {
            wildflower.component('complete-replace-test', {
                state: {
                    items: [
                        { id: 1, name: 'Old1' },
                        { id: 2, name: 'Old2' }
                    ]
                }
            });

            testContainer.innerHTML = `
                <div data-component="complete-replace-test">
                    <ul data-list="items" data-key="id">
                        <template>
                            <li data-bind="name"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForCompleteRender();

            const ul = testContainer.querySelector('ul');
            const originalItems = Array.from(ul.querySelectorAll('li'));

            // Complete replacement with all new IDs
            const component = wildflower.getComponentsByType('complete-replace-test')[0];
            component.context.state.items = [
                { id: 100, name: 'New1' },
                { id: 200, name: 'New2' },
                { id: 300, name: 'New3' }
            ];
            await waitForCompleteRender();

            const newItems = ul.querySelectorAll('li');
            expect(newItems.length).toBe(3);
            expect(newItems[0].textContent).toBe('New1');
            expect(newItems[1].textContent).toBe('New2');
            expect(newItems[2].textContent).toBe('New3');

            // All nodes should be NEW (none of the original refs)
            expect(newItems[0]).not.toBe(originalItems[0]);
            expect(newItems[0]).not.toBe(originalItems[1]);
        });

        it('handles single item list operations', async () => {
            wildflower.component('single-item-test', {
                state: {
                    items: [{ id: 1, name: 'Only' }]
                }
            });

            testContainer.innerHTML = `
                <div data-component="single-item-test">
                    <ul data-list="items" data-key="id">
                        <template>
                            <li data-bind="name"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await waitForCompleteRender();

            const ul = testContainer.querySelector('ul');
            const component = wildflower.getComponentsByType('single-item-test')[0];

            // Replace single item
            component.context.state.items = [{ id: 2, name: 'Replaced' }];
            await waitForCompleteRender();

            let items = ul.querySelectorAll('li');
            expect(items.length).toBe(1);
            expect(items[0].textContent).toBe('Replaced');

            // Add to single
            component.context.state.items = [
                { id: 2, name: 'Replaced' },
                { id: 3, name: 'Added' }
            ];
            await waitForCompleteRender();

            items = ul.querySelectorAll('li');
            expect(items.length).toBe(2);

            // Back to single
            component.context.state.items = [{ id: 3, name: 'Added' }];
            await waitForCompleteRender();

            items = ul.querySelectorAll('li');
            expect(items.length).toBe(1);
            expect(items[0].textContent).toBe('Added');
        });
    });
});
