/**
 * mapArray Primitives Unit Tests
 *
 * Tests for Phase 2.5a infrastructure:
 * - _getRawObject() - Extract underlying object from proxy
 * - _createPathlessProxy() - Create isolated proxy with unique namespace (legacy, kept for compatibility)
 * - mapArray() - Core reactive array mapping primitive with PatternTrie integration
 *
 * Phase 1 Implementation (Index-Based Paths):
 * - mapArray watches array structure via PatternTrie pattern "items.*"
 * - ItemEffects depend on specific index paths like "items.0.name", "items.1.name"
 * - When item 1's property changes, only ItemEffect[1] runs (path-based isolation)
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework, waitForUpdate } from './helpers/load-framework.js';

describe('mapArray Primitives', () => {
    let testContainer;
    let wildflower;
    let storeCounter = 0;

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
    });

    // Helper to get a fresh state manager via a store
    function getStateManager() {
        storeCounter++;
        const store = wildflower.storeManager.createStoreComponent(`maparray-test-${storeCounter}`, {
            state: { value: 'test' }
        });
        return store.stateManager;
    }

    // _getRawObject and _createPathlessProxy tests removed — dead code (Sprint 3)

    describe('mapArray - basic functionality', () => {
        it('should create mapped items for initial array', async () => {
            const sm = getStateManager();

            const sourceArray = [
                { id: 1, name: 'Item 1' },
                { id: 2, name: 'Item 2' },
                { id: 3, name: 'Item 3' }
            ];

            const mappedItems = [];

            const dispose = sm.mapArray(
                () => sourceArray,
                (itemProxy, index) => {
                    const element = document.createElement('div');
                    element.textContent = itemProxy.name;
                    element.dataset.index = index;
                    mappedItems.push({ element, itemProxy });
                    return { element, disposeEffect: () => {} };
                },
                {
                    key: 'id',
                    onInsert: (el, idx) => testContainer.appendChild(el),
                    onRemove: (el) => el.remove()
                }
            );

            // Should have created 3 items
            expect(mappedItems.length).toBe(3);
            expect(testContainer.children.length).toBe(3);
            expect(testContainer.children[0].textContent).toBe('Item 1');
            expect(testContainer.children[1].textContent).toBe('Item 2');
            expect(testContainer.children[2].textContent).toBe('Item 3');

            dispose();
        });

        it('should add elements when items are added to array', async () => {
            const sm = getStateManager();

            // Make array reactive
            let sourceArray = sm._createObjectProxy([
                { id: 1, name: 'Item 1' }
            ], 'items');

            const mappedItems = [];

            const dispose = sm.mapArray(
                () => sourceArray,
                (itemProxy, index) => {
                    const element = document.createElement('div');
                    element.textContent = itemProxy.name;
                    mappedItems.push(element);
                    return { element, disposeEffect: () => {} };
                },
                {
                    key: 'id',
                    onInsert: (el, idx) => testContainer.appendChild(el),
                    onRemove: (el) => el.remove()
                }
            );

            expect(testContainer.children.length).toBe(1);

            // Add a new item
            sourceArray.push({ id: 2, name: 'Item 2' });

            // Flush effects
            await waitForUpdate(100);

            expect(testContainer.children.length).toBe(2);
            expect(testContainer.children[1].textContent).toBe('Item 2');

            dispose();
        });

        it('should remove elements when items are removed from array', async () => {
            const sm = getStateManager();

            let sourceArray = sm._createObjectProxy([
                { id: 1, name: 'Item 1' },
                { id: 2, name: 'Item 2' },
                { id: 3, name: 'Item 3' }
            ], 'items');

            const dispose = sm.mapArray(
                () => sourceArray,
                (itemProxy, index) => {
                    const element = document.createElement('div');
                    element.textContent = itemProxy.name;
                    element.dataset.id = itemProxy.id;
                    return { element, disposeEffect: () => {} };
                },
                {
                    key: 'id',
                    onInsert: (el, idx) => testContainer.appendChild(el),
                    onRemove: (el) => el.remove()
                }
            );

            expect(testContainer.children.length).toBe(3);

            // Remove middle item
            sourceArray.splice(1, 1);

            // Flush effects
            await waitForUpdate(100);

            expect(testContainer.children.length).toBe(2);
            expect(testContainer.children[0].textContent).toBe('Item 1');
            expect(testContainer.children[1].textContent).toBe('Item 3');

            dispose();
        });

        it('should handle array replacement', async () => {
            const sm = getStateManager();

            // We need a wrapper object so we can replace the array
            const state = sm._createObjectProxy({
                items: [
                    { id: 1, name: 'Old 1' },
                    { id: 2, name: 'Old 2' }
                ]
            }, 'state');

            const dispose = sm.mapArray(
                () => state.items,
                (itemProxy, index) => {
                    const element = document.createElement('div');
                    element.textContent = itemProxy.name;
                    return { element, disposeEffect: () => {} };
                },
                {
                    key: 'id',
                    onInsert: (el, idx) => testContainer.appendChild(el),
                    onRemove: (el) => el.remove()
                }
            );

            expect(testContainer.children.length).toBe(2);
            expect(testContainer.children[0].textContent).toBe('Old 1');

            // Replace entire array
            state.items = [
                { id: 3, name: 'New 1' },
                { id: 4, name: 'New 2' },
                { id: 5, name: 'New 3' }
            ];

            // Flush effects
            await waitForUpdate(100);

            expect(testContainer.children.length).toBe(3);
            expect(testContainer.children[0].textContent).toBe('New 1');
            expect(testContainer.children[1].textContent).toBe('New 2');
            expect(testContainer.children[2].textContent).toBe('New 3');

            dispose();
        });

        it('should clear all on empty array', async () => {
            const sm = getStateManager();

            const state = sm._createObjectProxy({
                items: [
                    { id: 1, name: 'Item 1' },
                    { id: 2, name: 'Item 2' }
                ]
            }, 'state');

            const dispose = sm.mapArray(
                () => state.items,
                (itemProxy, index) => {
                    const element = document.createElement('div');
                    element.textContent = itemProxy.name;
                    return { element, disposeEffect: () => {} };
                },
                {
                    key: 'id',
                    onInsert: (el, idx) => testContainer.appendChild(el),
                    onRemove: (el) => el.remove()
                }
            );

            expect(testContainer.children.length).toBe(2);

            // Clear array
            state.items = [];

            // Flush effects
            await waitForUpdate(100);

            expect(testContainer.children.length).toBe(0);

            dispose();
        });
    });

    describe('mapArray - keyed reconciliation', () => {
        it('should reuse existing elements when items reorder', async () => {
            const sm = getStateManager();

            const state = sm._createObjectProxy({
                items: [
                    { id: 1, name: 'First' },
                    { id: 2, name: 'Second' },
                    { id: 3, name: 'Third' }
                ]
            }, 'state');

            const createdElements = new Map();

            const dispose = sm.mapArray(
                () => state.items,
                (itemProxy, index) => {
                    const element = document.createElement('div');
                    element.textContent = itemProxy.name;
                    element.dataset.id = itemProxy.id;
                    createdElements.set(itemProxy.id, element);
                    return { element, disposeEffect: () => {} };
                },
                {
                    key: 'id',
                    onInsert: (el, idx) => {
                        if (idx >= testContainer.children.length) {
                            testContainer.appendChild(el);
                        } else {
                            testContainer.insertBefore(el, testContainer.children[idx]);
                        }
                    },
                    onRemove: (el) => el.remove(),
                    onMove: (el, newIdx, oldIdx, refElement) => {
                        // Use refElement for stable positioning (avoids index-shift issues)
                        if (refElement) {
                            testContainer.insertBefore(el, refElement);
                        } else {
                            // No next sibling means this element should be last
                            testContainer.appendChild(el);
                        }
                    }
                }
            );

            // Store references to original elements
            const originalEl1 = createdElements.get(1);
            const originalEl2 = createdElements.get(2);
            const originalEl3 = createdElements.get(3);

            expect(testContainer.children.length).toBe(3);
            expect(createdElements.size).toBe(3);

            // Swap first and last
            const temp = state.items[0];
            state.items[0] = state.items[2];
            state.items[2] = temp;

            // Flush effects
            await waitForUpdate(100);

            // Should still have 3 elements (no new elements created)
            expect(testContainer.children.length).toBe(3);

            // The same DOM elements should be reused (not recreated)
            // Since we swapped, id=3 should now be first, id=1 should be last
            expect(testContainer.children[0].dataset.id).toBe('3');
            expect(testContainer.children[2].dataset.id).toBe('1');

            dispose();
        });

        it('should handle items with same key correctly', async () => {
            const sm = getStateManager();

            const state = sm._createObjectProxy({
                items: [
                    { id: 1, name: 'Keep' },
                    { id: 2, name: 'Remove' }
                ]
            }, 'state');

            let createCount = 0;

            const dispose = sm.mapArray(
                () => state.items,
                (itemProxy, index) => {
                    createCount++;
                    const element = document.createElement('div');
                    element.textContent = itemProxy.name;
                    return { element, disposeEffect: () => {} };
                },
                {
                    key: 'id',
                    onInsert: (el, idx) => testContainer.appendChild(el),
                    onRemove: (el) => el.remove()
                }
            );

            expect(createCount).toBe(2);

            // Remove id=2, add id=3 (id=1 should be reused)
            state.items = [
                { id: 1, name: 'Keep Updated' },
                { id: 3, name: 'New' }
            ];

            // Flush effects
            await waitForUpdate(100);

            // Should only create 1 new element (for id=3)
            expect(createCount).toBe(3);

            dispose();
        });
    });

    describe('Item Effect Isolation (Path-Based)', () => {
        it('should not trigger item effect when other items change', async () => {
            const sm = getStateManager();

            const state = sm._createObjectProxy({
                items: [
                    { id: 1, name: 'Item 1' },
                    { id: 2, name: 'Item 2' },
                    { id: 3, name: 'Item 3' }
                ]
            }, 'state');

            const effectRunCounts = { 1: 0, 2: 0, 3: 0 };

            const dispose = sm.mapArray(
                () => state.items,
                (itemProxy, index) => {
                    const element = document.createElement('div');
                    // Capture the id at creation time for tracking
                    const itemId = itemProxy.id;

                    // Create an effect for this item
                    // Effect depends on path like "state.items.0.name", "state.items.1.name", etc.
                    const disposeEffect = sm.createEffect(() => {
                        // Read from the original proxy (index-based path)
                        const name = itemProxy.name;
                        element.textContent = name;
                        effectRunCounts[itemId]++;
                    });

                    return { element, disposeEffect };
                },
                {
                    key: 'id',
                    onInsert: (el, idx) => testContainer.appendChild(el),
                    onRemove: (el) => el.remove()
                }
            );

            // Initial run - each effect runs once
            expect(effectRunCounts[1]).toBe(1);
            expect(effectRunCounts[2]).toBe(1);
            expect(effectRunCounts[3]).toBe(1);

            // Modify only item 2 (at index 1)
            // This notifies path "state.items.1.name"
            state.items[1].name = 'Item 2 Modified';

            // Flush effects
            await waitForUpdate(100);

            // Only item 2's effect should have run again
            // Items 1 and 3 depend on different paths (items.0.name, items.2.name)
            expect(effectRunCounts[1]).toBe(1); // Should still be 1 (depends on items.0.name)
            expect(effectRunCounts[2]).toBe(2); // Should be 2 (depends on items.1.name)
            expect(effectRunCounts[3]).toBe(1); // Should still be 1 (depends on items.2.name)

            dispose();
        });

        it('should not trigger item effects on array structural changes', async () => {
            const sm = getStateManager();

            const state = sm._createObjectProxy({
                items: [
                    { id: 1, name: 'Item 1' },
                    { id: 2, name: 'Item 2' }
                ]
            }, 'state');

            const effectRunCounts = { 1: 0, 2: 0 };

            const dispose = sm.mapArray(
                () => state.items,
                (itemProxy, index) => {
                    const element = document.createElement('div');
                    const itemId = itemProxy.id;

                    const disposeEffect = sm.createEffect(() => {
                        const name = itemProxy.name;
                        element.textContent = name;
                        effectRunCounts[itemId]++;
                    });

                    return { element, disposeEffect };
                },
                {
                    key: 'id',
                    onInsert: (el, idx) => testContainer.appendChild(el),
                    onRemove: (el) => el.remove()
                }
            );

            expect(effectRunCounts[1]).toBe(1);
            expect(effectRunCounts[2]).toBe(1);

            // Add a new item (structural change)
            // This notifies "state.items.length" and "state.items.2" (new index)
            // mapArray's pattern "state.items.*" catches this and re-runs
            // But ItemEffects depend on "state.items.0.name", "state.items.1.name" - unchanged
            state.items.push({ id: 3, name: 'Item 3' });

            // Flush effects
            await waitForUpdate(100);

            // Existing item effects should NOT have re-run (their paths didn't change)
            expect(effectRunCounts[1]).toBe(1);
            expect(effectRunCounts[2]).toBe(1);

            dispose();
        });
    });

    describe('mapArray - cleanup', () => {
        it('should dispose all item effects when disposed', async () => {
            const sm = getStateManager();

            const sourceArray = [
                { id: 1, name: 'Item 1' },
                { id: 2, name: 'Item 2' }
            ];

            let disposeCount = 0;

            const dispose = sm.mapArray(
                () => sourceArray,
                (itemProxy, index) => {
                    const element = document.createElement('div');
                    return {
                        element,
                        disposeEffect: () => { disposeCount++; }
                    };
                },
                {
                    key: 'id',
                    onInsert: (el, idx) => testContainer.appendChild(el),
                    onRemove: (el) => el.remove()
                }
            );

            expect(testContainer.children.length).toBe(2);

            // Dispose the mapping
            dispose();

            // All item dispose functions should have been called
            expect(disposeCount).toBe(2);
        });

        it('should call disposeEffect when items are removed', async () => {
            const sm = getStateManager();

            const state = sm._createObjectProxy({
                items: [
                    { id: 1, name: 'Item 1' },
                    { id: 2, name: 'Item 2' }
                ]
            }, 'state');

            let disposeCount = 0;

            const dispose = sm.mapArray(
                () => state.items,
                (itemProxy, index) => {
                    const element = document.createElement('div');
                    return {
                        element,
                        disposeEffect: () => { disposeCount++; }
                    };
                },
                {
                    key: 'id',
                    onInsert: (el, idx) => testContainer.appendChild(el),
                    onRemove: (el) => el.remove()
                }
            );

            expect(disposeCount).toBe(0);

            // Remove one item
            state.items.splice(0, 1);

            // Flush effects
            await waitForUpdate(100);

            // The removed item's dispose should have been called
            expect(disposeCount).toBe(1);

            dispose();
        });
    });
});
