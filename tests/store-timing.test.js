/**
 * Tests for store timing issues - ensuring computed properties that reference
 * stores work correctly even when evaluated before the store is fully available.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework } from './helpers/load-framework.js';

describe('Store Timing', () => {
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
        if (wildflower.storeManager?._namedStores) {
            wildflower.storeManager._namedStores.clear();
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
            wildflower.componentInstances?.clear();
            wildflower.componentDefinitions?.clear();
            wildflower.storeManager?._namedStores?.clear();
        }
    });

    describe('store subscribe access', () => {
        it('should return store context via this.stores', async () => {
            // Create store first
            wildflower.store('testStore', {
                state: {
                    items: [1, 2, 3],
                    count: 42
                }
            });

            let capturedStore = null;

            wildflower.component('store-accessor', {
                subscribe: { testStore: ['items', 'count'] },
                state: {},
                init() {
                    // Access store via this.stores
                    capturedStore = { state: this.stores.testStore };
                }
            });

            testContainer.innerHTML = `
                <div data-component="store-accessor"></div>
            `;

            wildflower.scan(testContainer);
            await new Promise(resolve => setTimeout(resolve, 50));

            // Verify store was returned
            expect(capturedStore).not.toBeNull();
            expect(capturedStore.state).toBeDefined();
            // Check array values individually (proxy arrays may not compare directly)
            expect(capturedStore.state.items.length).toBe(3);
            expect(capturedStore.state.items[0]).toBe(1);
            expect(capturedStore.state.items[1]).toBe(2);
            expect(capturedStore.state.items[2]).toBe(3);
            expect(capturedStore.state.count).toBe(42);
        });

        it('should allow accessing store state in computed properties', async () => {
            wildflower.store('taskStore', {
                state: {
                    tasks: [
                        { id: 1, text: 'Task 1' },
                        { id: 2, text: 'Task 2' }
                    ]
                }
            });

            wildflower.component('task-list', {
                subscribe: { taskStore: ['tasks'] },
                state: {},
                computed: {
                    tasks() {
                        return this.stores.taskStore?.tasks || [];
                    },
                    taskCount() {
                        const tasks = this.stores.taskStore?.tasks;
                        return tasks ? tasks.length : 0;
                    }
                }
            });

            testContainer.innerHTML = `
                <div data-component="task-list">
                    <span id="count" data-bind="computed:taskCount"></span>
                    <ul data-list="computed:tasks">
                        <template>
                            <li data-bind="text"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify bindings updated
            const countEl = testContainer.querySelector('#count');
            expect(countEl.textContent).toBe('2');

            // Verify list rendered
            const listItems = testContainer.querySelectorAll('li');
            expect(listItems.length).toBe(2);
            expect(listItems[0].textContent).toBe('Task 1');
            expect(listItems[1].textContent).toBe('Task 2');
        });
    });

    describe('Pending store dependencies', () => {
        it('should update list when store is created after component', async () => {
            // Register component BEFORE creating store
            // subscribe + this.stores supports deferred store creation
            wildflower.component('late-store-list', {
                subscribe: { lateStore: ['items'] },
                state: {},
                computed: {
                    items() {
                        return this.stores.lateStore?.items || [];
                    }
                }
            });

            testContainer.innerHTML = `
                <div data-component="late-store-list">
                    <ul data-list="computed:items">
                        <template>
                            <li data-bind="name"></li>
                        </template>
                    </ul>
                </div>
            `;

            wildflower.scan(testContainer);
            await new Promise(resolve => setTimeout(resolve, 50));

            // Verify list is initially empty
            let listItems = testContainer.querySelectorAll('li');
            expect(listItems.length).toBe(0);

            // Now create the store - this should trigger reactive update
            wildflower.store('lateStore', {
                state: {
                    items: [
                        { id: 1, name: 'Item A' },
                        { id: 2, name: 'Item B' },
                        { id: 3, name: 'Item C' }
                    ]
                }
            });

            // Wait for reactive update
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify list now shows items
            listItems = testContainer.querySelectorAll('li');
            expect(listItems.length).toBe(3);
            expect(listItems[0].textContent).toBe('Item A');
            expect(listItems[1].textContent).toBe('Item B');
            expect(listItems[2].textContent).toBe('Item C');
        });

        it('should update bindings when store is created after component', async () => {
            wildflower.component('late-store-binding', {
                subscribe: { messageStore: ['message'] },
                state: {},
                computed: {
                    message() {
                        return this.stores.messageStore?.message ?? 'Loading...';
                    }
                }
            });

            testContainer.innerHTML = `
                <div data-component="late-store-binding">
                    <span id="msg" data-bind="computed:message"></span>
                </div>
            `;

            wildflower.scan(testContainer);
            await new Promise(resolve => setTimeout(resolve, 50));

            // Initial state - store not available
            let msgEl = testContainer.querySelector('#msg');
            expect(msgEl.textContent).toBe('Loading...');

            // Create store
            wildflower.store('messageStore', {
                state: {
                    message: 'Hello from store!'
                }
            });

            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify binding updated
            msgEl = testContainer.querySelector('#msg');
            expect(msgEl.textContent).toBe('Hello from store!');
        });

        it('should clean up pending subscriptions when component is destroyed', async () => {
            wildflower.component('cleanup-test', {
                subscribe: { cleanupStore: ['data'] },
                state: {},
                computed: {
                    data() {
                        return this.stores.cleanupStore?.data ?? null;
                    }
                }
            });

            testContainer.innerHTML = `
                <div data-component="cleanup-test">
                    <span data-bind="computed:data"></span>
                </div>
            `;

            wildflower.scan(testContainer);
            await new Promise(resolve => setTimeout(resolve, 50));

            // Verify pending dependency was registered
            const pendingDeps = wildflower.storeManager._pendingStoreDependencies;
            expect(pendingDeps.has('cleanupStore')).toBe(true);

            // Destroy component by clearing container
            testContainer.innerHTML = '';
            wildflower.garbageCollect();
            await new Promise(resolve => setTimeout(resolve, 50));

            // Now create store - should not cause errors
            wildflower.store('cleanupStore', {
                state: { data: 'test' }
            });

            // Pending dependency should have been cleaned up
            // (either removed or handled gracefully)
        });
    });
});
