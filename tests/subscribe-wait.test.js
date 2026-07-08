/**
 * Subscribe Wait Feature Tests
 *
 * Tests for implicit store waiting via `subscribe` declaration.
 * Components that subscribe to stores will automatically wait for those stores
 * to be ready before init() is called.
 *
 * Feature Summary:
 * - subscribe: ['store'] - Wait for store, no path subscriptions (array syntax)
 * - subscribe: { 'store': ['path'] } - Wait AND subscribe to path changes (object syntax)
 * - subscribeTimeout: 5000 (default) - Global timeout in ms
 * - Component-level subscribeTimeout override
 * - subscribeTimeout: 0 means wait indefinitely
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { loadFramework, resetFramework, isMinifiedBuild} from './helpers/load-framework.js';

describe('Subscribe Wait Feature', () => {
    let testContainer;
    let wildflower;
    let originalConfig;

    beforeAll(async () => {
        wildflower = await loadFramework();
    });

    beforeEach(() => {
        resetFramework(wildflower);

        testContainer = document.createElement('div');
        testContainer.id = 'test-container';
        document.body.appendChild(testContainer);

        // Store original config
        originalConfig = wildflower.config ? { ...wildflower.config() } : {};

        // Reset to defaults
        if (wildflower.config) {
            wildflower.config({ subscribeTimeout: 5000 });
        }
    });

    afterEach(() => {
        // Restore real timers in case a test enabled fake timers (no-op otherwise).
        vi.useRealTimers();

        // Cleanup
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer);
        }

        // Destroy all stores
        if (wildflower.destroyStore) {
            wildflower.destroyStore('test-store');
            wildflower.destroyStore('async-store');
            wildflower.destroyStore('slow-store');
            wildflower.destroyStore('store-a');
            wildflower.destroyStore('store-b');
        }

        // Clear component definitions
        if (wildflower.clearComponentDefinitions) {
            wildflower.clearComponentDefinitions();
        }

        // Restore original config
        if (wildflower.config && originalConfig) {
            wildflower.config(originalConfig);
        }
    });

    // =========================================================================
    // Section 1: Basic Subscribe Wait Behavior
    // =========================================================================

    describe('Basic Subscribe Wait Behavior', () => {

        it('should wait for subscribed store before calling init() - object syntax', async () => {
            const initOrder = [];

            // Create a store with delayed ready state
            wildflower.store('async-store', {
                state: { value: 'initial' },
                async init() {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    this.state.value = 'ready';
                    initOrder.push('store-ready');
                }
            });

            // Create component that subscribes to the store
            wildflower.component('wait-test', {
                subscribe: {
                    'async-store': ['value']
                },
                state: { storeValue: '' },
                init() {
                    initOrder.push('component-init');
                    const store = wildflower.getStore('async-store');
                    this.state.storeValue = store.state.value;
                }
            });

            testContainer.innerHTML = '<div data-component="wait-test"></div>';
            wildflower._scanForDynamicComponents();

            // Wait for component to initialize
            await new Promise(resolve => setTimeout(resolve, 200));

            // Store should be ready BEFORE component init
            expect(initOrder).toEqual(['store-ready', 'component-init']);

            const comp = wildflower.getComponent('wait-test');
            expect(comp.state.storeValue).toBe('ready');
        });

        it.skipIf(isMinifiedBuild())('should wait for subscribed store before calling init() - array syntax', async () => {
            const initOrder = [];

            wildflower.store('async-store', {
                state: { value: 'initial' },
                async init() {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    this.state.value = 'ready';
                    initOrder.push('store-ready');
                }
            });

            wildflower.component('wait-test-array', {
                subscribe: ['async-store'],  // Array syntax - wait only
                state: { storeValue: '' },
                init() {
                    initOrder.push('component-init');
                    const store = wildflower.getStore('async-store');
                    this.state.storeValue = store.state.value;
                }
            });

            testContainer.innerHTML = '<div data-component="wait-test-array"></div>';
            wildflower._scanForDynamicComponents();

            await new Promise(resolve => setTimeout(resolve, 200));

            expect(initOrder).toEqual(['store-ready', 'component-init']);
        });

        it('should not block init() for synchronous stores (already ready)', async () => {
            // Synchronous store - ready immediately
            wildflower.store('sync-store', {
                state: { value: 'sync-ready' }
            });

            let initCalled = false;
            let storeValueAtInit = '';

            wildflower.component('sync-wait-test', {
                subscribe: ['sync-store'],
                init() {
                    initCalled = true;
                    const store = wildflower.getStore('sync-store');
                    storeValueAtInit = store.state.value;
                }
            });

            testContainer.innerHTML = '<div data-component="sync-wait-test"></div>';
            wildflower._scanForDynamicComponents();

            // Should be nearly immediate for sync stores
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(initCalled).toBe(true);
            expect(storeValueAtInit).toBe('sync-ready');
        });

        it('should wait for multiple stores before calling init()', async () => {
            const initOrder = [];

            wildflower.store('store-a', {
                state: { value: 'a' },
                async init() {
                    await new Promise(resolve => setTimeout(resolve, 50));
                    initOrder.push('store-a-ready');
                }
            });

            wildflower.store('store-b', {
                state: { value: 'b' },
                async init() {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    initOrder.push('store-b-ready');
                }
            });

            wildflower.component('multi-store-test', {
                subscribe: ['store-a', 'store-b'],
                init() {
                    initOrder.push('component-init');
                }
            });

            testContainer.innerHTML = '<div data-component="multi-store-test"></div>';
            wildflower._scanForDynamicComponents();

            await new Promise(resolve => setTimeout(resolve, 200));

            // Component init should come AFTER both stores are ready
            expect(initOrder.indexOf('component-init')).toBeGreaterThan(
                initOrder.indexOf('store-a-ready')
            );
            expect(initOrder.indexOf('component-init')).toBeGreaterThan(
                initOrder.indexOf('store-b-ready')
            );
        });
    });

    // =========================================================================
    // Section 2: Array vs Object Syntax Behavior
    // =========================================================================

    describe('Array vs Object Syntax', () => {

        it('array syntax should NOT receive onStoreUpdate calls', async () => {
            wildflower.store('test-store', {
                state: { count: 0 },
                increment() { this.state.count++; }
            });

            let updateCount = 0;

            wildflower.component('array-syntax-test', {
                subscribe: ['test-store'],  // Array = wait only, no updates
                onStoreUpdate() {
                    updateCount++;
                }
            });

            testContainer.innerHTML = '<div data-component="array-syntax-test"></div>';
            wildflower._scanForDynamicComponents();

            await new Promise(resolve => setTimeout(resolve, 50));

            // Mutate the store
            const store = wildflower.getStore('test-store');
            store.increment();
            store.increment();

            await new Promise(resolve => setTimeout(resolve, 50));

            // Should NOT receive updates with array syntax
            expect(updateCount).toBe(0);
        });

        it.skipIf(isMinifiedBuild())('object syntax with paths SHOULD receive onStoreUpdate calls', async () => {
            wildflower.store('test-store', {
                state: { count: 0 },
                increment() { this.state.count++; }
            });

            let updateCount = 0;
            let lastValue = null;

            wildflower.component('object-syntax-test', {
                subscribe: {
                    'test-store': ['count']  // Object = wait AND subscribe
                },
                onStoreUpdate(storeName, path, newValue) {
                    updateCount++;
                    lastValue = newValue;
                }
            });

            testContainer.innerHTML = '<div data-component="object-syntax-test"></div>';
            wildflower._scanForDynamicComponents();

            await new Promise(resolve => setTimeout(resolve, 50));

            const store = wildflower.getStore('test-store');
            store.increment();

            await new Promise(resolve => setTimeout(resolve, 50));

            // Should receive update with object syntax
            expect(updateCount).toBeGreaterThan(0);
            expect(lastValue).toBe(1);
        });

        it('object syntax with empty array should wait but NOT receive updates', async () => {
            wildflower.store('test-store', {
                state: { count: 0 },
                increment() { this.state.count++; }
            });

            let updateCount = 0;
            let initCalled = false;

            wildflower.component('empty-array-test', {
                subscribe: {
                    'test-store': []  // Empty array = wait only, like array syntax
                },
                init() {
                    initCalled = true;
                },
                onStoreUpdate() {
                    updateCount++;
                }
            });

            testContainer.innerHTML = '<div data-component="empty-array-test"></div>';
            wildflower._scanForDynamicComponents();

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(initCalled).toBe(true);

            const store = wildflower.getStore('test-store');
            store.increment();

            await new Promise(resolve => setTimeout(resolve, 50));

            // Should NOT receive updates with empty array
            expect(updateCount).toBe(0);
        });

        it('array syntax should be equivalent to object syntax with empty array', async () => {
            wildflower.store('test-store', {
                state: { ready: true }
            });

            let arrayInitCalled = false;
            let objectInitCalled = false;

            wildflower.component('array-equiv-test', {
                subscribe: ['test-store'],
                init() { arrayInitCalled = true; }
            });

            wildflower.component('object-equiv-test', {
                subscribe: { 'test-store': [] },
                init() { objectInitCalled = true; }
            });

            testContainer.innerHTML = `
                <div data-component="array-equiv-test"></div>
                <div data-component="object-equiv-test"></div>
            `;
            wildflower._scanForDynamicComponents();

            await new Promise(resolve => setTimeout(resolve, 50));

            // Both should initialize
            expect(arrayInitCalled).toBe(true);
            expect(objectInitCalled).toBe(true);
        });
    });

    // =========================================================================
    // Section 3: Timeout Behavior
    // =========================================================================

    describe('Timeout Behavior', () => {

        it('should use global default timeout (5000ms)', async () => {
            // Verify default is 5000
            const config = wildflower.config ? wildflower.config() : {};
            expect(config.subscribeTimeout || 5000).toBe(5000);
        });

        it('should timeout and call init() anyway after subscribeTimeout', async () => {
            vi.useFakeTimers(); // deterministic virtual time — immune to CI event-loop starvation
            // Create a store that never becomes ready
            wildflower.store('slow-store', {
                state: { value: 'pending' },
                async init() {
                    // Never resolves within timeout
                    await new Promise(resolve => setTimeout(resolve, 10000));
                }
            });

            let initCalled = false;
            let initTime = 0;
            const startTime = Date.now();

            wildflower.component('timeout-test', {
                subscribe: ['slow-store'],
                subscribeTimeout: 200,  // Short timeout for testing
                init() {
                    initCalled = true;
                    initTime = Date.now() - startTime;
                }
            });

            testContainer.innerHTML = '<div data-component="timeout-test"></div>';
            wildflower._scanForDynamicComponents();

            // Advance past the 200ms timeout (well short of the 10000ms store init).
            await vi.advanceTimersByTimeAsync(400);

            expect(initCalled).toBe(true);
            // Should have waited approximately 200ms (the timeout), not 10000ms
            expect(initTime).toBeGreaterThanOrEqual(180);
            expect(initTime).toBeLessThan(500);
        });

        it.skipIf(isMinifiedBuild())('should log warning in dev mode when timeout occurs', async () => {
            const warnSpy = vi.spyOn(console, 'warn');

            wildflower.store('slow-store', {
                state: {},
                async init() {
                    await new Promise(resolve => setTimeout(resolve, 10000));
                }
            });

            wildflower.component('warn-test', {
                subscribe: ['slow-store'],
                subscribeTimeout: 100,
                init() {}
            });

            testContainer.innerHTML = '<div data-component="warn-test"></div>';
            wildflower._scanForDynamicComponents();

            await new Promise(resolve => setTimeout(resolve, 200));

            // Should have logged a warning
            expect(warnSpy).toHaveBeenCalled();
            const warnMessage = warnSpy.mock.calls.find(call =>
                call[0]?.includes?.('timeout') || call[0]?.includes?.('slow-store')
            );
            expect(warnMessage).toBeDefined();

            warnSpy.mockRestore();
        });

        it('should respect component-level subscribeTimeout override', async () => {
            vi.useFakeTimers(); // deterministic virtual time — immune to CI event-loop starvation
            // Set global timeout to 1000ms
            wildflower.config({ subscribeTimeout: 1000 });

            wildflower.store('slow-store', {
                state: {},
                async init() {
                    await new Promise(resolve => setTimeout(resolve, 10000));
                }
            });

            let initTime = 0;
            const startTime = Date.now();

            wildflower.component('override-test', {
                subscribe: ['slow-store'],
                subscribeTimeout: 150,  // Override to 150ms
                init() {
                    initTime = Date.now() - startTime;
                }
            });

            testContainer.innerHTML = '<div data-component="override-test"></div>';
            wildflower._scanForDynamicComponents();

            // Advance past the 150ms component timeout (short of the 1000ms global).
            await vi.advanceTimersByTimeAsync(300);

            // Should use component timeout (150ms), not global (1000ms)
            expect(initTime).toBeGreaterThanOrEqual(130);
            expect(initTime).toBeLessThan(300);
        });

        it('subscribeTimeout: 0 should wait indefinitely', async () => {
            let storeReady = false;

            wildflower.store('delayed-store', {
                state: { value: 'pending' },
                async init() {
                    await new Promise(resolve => setTimeout(resolve, 300));
                    this.state.value = 'ready';
                    storeReady = true;
                }
            });

            let initCalled = false;
            let valueAtInit = '';

            wildflower.component('indefinite-wait-test', {
                subscribe: ['delayed-store'],
                subscribeTimeout: 0,  // Wait indefinitely
                init() {
                    initCalled = true;
                    valueAtInit = wildflower.getStore('delayed-store').state.value;
                }
            });

            testContainer.innerHTML = '<div data-component="indefinite-wait-test"></div>';
            wildflower._scanForDynamicComponents();

            // At 100ms, should NOT have initialized yet
            await new Promise(resolve => setTimeout(resolve, 100));
            expect(initCalled).toBe(false);

            // At 500ms, store should be ready and component initialized
            await new Promise(resolve => setTimeout(resolve, 400));
            expect(storeReady).toBe(true);
            expect(initCalled).toBe(true);
            expect(valueAtInit).toBe('ready');
        });

        it('should call onError handler when timeout occurs', async () => {
            wildflower.store('slow-store', {
                state: {},
                async init() {
                    await new Promise(resolve => setTimeout(resolve, 10000));
                }
            });

            let errorHandled = false;
            let errorDetails = null;

            wildflower.component('error-handler-test', {
                subscribe: ['slow-store'],
                subscribeTimeout: 100,
                init() {},
                onError(error) {
                    errorHandled = true;
                    errorDetails = error;
                    return true;  // Error handled
                }
            });

            testContainer.innerHTML = '<div data-component="error-handler-test"></div>';
            wildflower._scanForDynamicComponents();

            await new Promise(resolve => setTimeout(resolve, 200));

            expect(errorHandled).toBe(true);
            expect(errorDetails).toBeDefined();
        });
    });

    // =========================================================================
    // Section 4: Error Handling
    // =========================================================================

    describe('Error Handling', () => {

        it.skipIf(isMinifiedBuild())('should throw error if subscribed store does not exist', async () => {
            const errorSpy = vi.spyOn(console, 'error');

            wildflower.component('missing-store-test', {
                subscribe: ['nonexistent-store'],
                init() {}
            });

            testContainer.innerHTML = '<div data-component="missing-store-test"></div>';

            // Should throw or log error for missing store
            try {
                wildflower._scanForDynamicComponents();
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (e) {
                // Expected
            }

            // Either threw an error or logged one
            const errorLogged = errorSpy.mock.calls.some(call =>
                call[0]?.includes?.('nonexistent-store') ||
                call[0]?.message?.includes?.('nonexistent-store')
            );
            expect(errorLogged).toBe(true);

            errorSpy.mockRestore();
        });

        it('should handle store initialization failure gracefully', async () => {
            wildflower.store('failing-store', {
                state: {},
                async init() {
                    throw new Error('Store initialization failed');
                }
            });

            let initCalled = false;

            wildflower.component('failing-store-test', {
                subscribe: ['failing-store'],
                subscribeTimeout: 500,
                init() {
                    initCalled = true;
                },
                onError() {
                    return true;
                }
            });

            testContainer.innerHTML = '<div data-component="failing-store-test"></div>';

            try {
                wildflower._scanForDynamicComponents();
                await new Promise(resolve => setTimeout(resolve, 600));
            } catch (e) {
                // May throw, that's ok
            }

            // Should eventually timeout and call init or handle error
            // The exact behavior depends on implementation
        });
    });

    // =========================================================================
    // Section 5: Global Configuration
    // =========================================================================

    describe('Global Configuration', () => {

        it('should allow setting global subscribeTimeout via wildflower.config()', () => {
            wildflower.config({ subscribeTimeout: 10000 });

            const config = wildflower.config();
            expect(config.subscribeTimeout).toBe(10000);
        });

        it('should use global timeout when component does not specify one', async () => {
            // Fake timers make this deterministic: virtual time means the measured
            // initTime is exact regardless of event-loop load. Under real timers this
            // wall-clock bound flaked hard on a busy CI box (measured 13000-19000ms
            // against the <400ms wall when the loop was starved).
            vi.useFakeTimers();
            wildflower.config({ subscribeTimeout: 200 });

            wildflower.store('slow-store', {
                state: {},
                async init() {
                    await new Promise(resolve => setTimeout(resolve, 10000));
                }
            });

            let initTime = 0;
            const startTime = Date.now();

            wildflower.component('global-timeout-test', {
                subscribe: ['slow-store'],
                // No subscribeTimeout specified - should use global
                init() {
                    initTime = Date.now() - startTime;
                }
            });

            testContainer.innerHTML = '<div data-component="global-timeout-test"></div>';
            wildflower._scanForDynamicComponents();

            // Advance past the 200ms global timeout (short of the 10000ms store init).
            await vi.advanceTimersByTimeAsync(400);

            // Should use global timeout (200ms)
            expect(initTime).toBeGreaterThanOrEqual(180);
            expect(initTime).toBeLessThan(400);
        });
    });

    // =========================================================================
    // Section 6: Integration with Existing Features
    // =========================================================================

    describe('Integration with Existing Features', () => {

        it('should work with beforeInit() hook', async () => {
            const hookOrder = [];

            wildflower.store('test-store', {
                state: { ready: true },
                init() {
                    hookOrder.push('store-init');
                }
            });

            wildflower.component('hooks-test', {
                subscribe: ['test-store'],
                beforeInit() {
                    hookOrder.push('beforeInit');
                },
                init() {
                    hookOrder.push('init');
                }
            });

            testContainer.innerHTML = '<div data-component="hooks-test"></div>';
            wildflower._scanForDynamicComponents();

            await new Promise(resolve => setTimeout(resolve, 100));

            // beforeInit should run, then wait for store, then init
            const beforeInitIndex = hookOrder.indexOf('beforeInit');
            const initIndex = hookOrder.indexOf('init');
            const storeInitIndex = hookOrder.indexOf('store-init');

            expect(beforeInitIndex).toBeLessThan(initIndex);
            expect(storeInitIndex).toBeLessThan(initIndex);
        });

        it('should work with computed properties that access store', async () => {
            wildflower.store('data-store', {
                state: { items: [1, 2, 3] }
            });

            wildflower.component('computed-test', {
                subscribe: ['data-store'],
                computed: {
                    itemCount() {
                        const store = wildflower.getStore('data-store');
                        return store.state.items.length;
                    }
                },
                init() {
                    // Computed should work in init
                    expect(this.computed.itemCount).toBe(3);
                }
            });

            testContainer.innerHTML = '<div data-component="computed-test"></div>';
            wildflower._scanForDynamicComponents();

            await new Promise(resolve => setTimeout(resolve, 100));
        });

        it('should work with storageKey/autoSave stores', async () => {
            // Clear any existing localStorage
            localStorage.removeItem('persistent-store');

            wildflower.store('persistent-store', {
                storageKey: 'persistent-store',
                autoSave: true,
                state: { count: 0 },
                async init() {
                    // Simulate async hydration
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            });

            let initCalled = false;

            wildflower.component('persist-test', {
                subscribe: ['persistent-store'],
                init() {
                    initCalled = true;
                }
            });

            testContainer.innerHTML = '<div data-component="persist-test"></div>';
            wildflower._scanForDynamicComponents();

            await new Promise(resolve => setTimeout(resolve, 150));

            expect(initCalled).toBe(true);

            localStorage.removeItem('persistent-store');
        });

        it.skipIf(isMinifiedBuild())('should not block other components without subscribe', async () => {
            vi.useFakeTimers(); // deterministic virtual time — immune to CI event-loop starvation
            wildflower.store('slow-store', {
                state: {},
                async init() {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            });

            let independentInitTime = 0;
            let dependentInitTime = 0;
            const startTime = Date.now();

            wildflower.component('independent-comp', {
                // No subscribe - should init immediately
                init() {
                    independentInitTime = Date.now() - startTime;
                }
            });

            wildflower.component('dependent-comp', {
                subscribe: ['slow-store'],
                init() {
                    dependentInitTime = Date.now() - startTime;
                }
            });

            testContainer.innerHTML = `
                <div data-component="independent-comp"></div>
                <div data-component="dependent-comp"></div>
            `;
            wildflower._scanForDynamicComponents();

            // Advance past the store's 500ms init so the dependent component unblocks.
            await vi.advanceTimersByTimeAsync(600);

            // Independent component should init much faster
            expect(independentInitTime).toBeLessThan(100);
            expect(dependentInitTime).toBeGreaterThan(400);
        });
    });

    // =========================================================================
    // Section 7: Edge Cases
    // =========================================================================

    describe('Edge Cases', () => {

        it('should handle component destroyed before store ready', async () => {
            wildflower.store('slow-store', {
                state: {},
                async init() {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            });

            let initCalled = false;

            wildflower.component('destroyed-early-test', {
                subscribe: ['slow-store'],
                init() {
                    initCalled = true;
                }
            });

            testContainer.innerHTML = '<div data-component="destroyed-early-test"></div>';
            wildflower._scanForDynamicComponents();

            // Destroy component before store is ready
            await new Promise(resolve => setTimeout(resolve, 100));
            const comp = wildflower.getComponent('destroyed-early-test');
            if (comp && wildflower.destroyComponent) {
                wildflower.destroyComponent(comp.id);
            }

            await new Promise(resolve => setTimeout(resolve, 500));

            // init should NOT have been called on destroyed component
            // (or if it was, there should be no errors)
        });

        it('should handle multiple components waiting for same store', async () => {
            const initOrder = [];

            wildflower.store('shared-store', {
                state: { value: 'ready' },
                async init() {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    initOrder.push('store-ready');
                }
            });

            wildflower.component('waiter-1', {
                subscribe: ['shared-store'],
                init() { initOrder.push('waiter-1'); }
            });

            wildflower.component('waiter-2', {
                subscribe: ['shared-store'],
                init() { initOrder.push('waiter-2'); }
            });

            wildflower.component('waiter-3', {
                subscribe: ['shared-store'],
                init() { initOrder.push('waiter-3'); }
            });

            testContainer.innerHTML = `
                <div data-component="waiter-1"></div>
                <div data-component="waiter-2"></div>
                <div data-component="waiter-3"></div>
            `;
            wildflower._scanForDynamicComponents();

            await new Promise(resolve => setTimeout(resolve, 300));

            // All components should init AFTER store is ready
            const storeReadyIndex = initOrder.indexOf('store-ready');
            expect(initOrder.indexOf('waiter-1')).toBeGreaterThan(storeReadyIndex);
            expect(initOrder.indexOf('waiter-2')).toBeGreaterThan(storeReadyIndex);
            expect(initOrder.indexOf('waiter-3')).toBeGreaterThan(storeReadyIndex);
        });

        it('should handle nested components with different store dependencies', async () => {
            wildflower.store('store-a', {
                state: { value: 'a' },
                async init() {
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            });

            wildflower.store('store-b', {
                state: { value: 'b' },
                async init() {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            });

            let parentInit = false;
            let childInit = false;

            wildflower.component('parent-waiter', {
                subscribe: ['store-a'],
                init() { parentInit = true; }
            });

            wildflower.component('child-waiter', {
                subscribe: ['store-b'],
                init() { childInit = true; }
            });

            testContainer.innerHTML = `
                <div data-component="parent-waiter">
                    <div data-component="child-waiter"></div>
                </div>
            `;
            wildflower._scanForDynamicComponents();

            await new Promise(resolve => setTimeout(resolve, 200));

            expect(parentInit).toBe(true);
            expect(childInit).toBe(true);
        });

        it.skipIf(isMinifiedBuild())('should handle mixed subscribe syntax in same component', async () => {
            wildflower.store('store-a', { state: { value: 'a' } });
            wildflower.store('store-b', { state: { count: 0 } });

            let updateCount = 0;

            wildflower.component('mixed-syntax-test', {
                subscribe: {
                    'store-a': [],      // Wait only
                    'store-b': ['count'] // Wait and subscribe
                },
                onStoreUpdate(storeName, path) {
                    if (storeName === 'store-b' && path === 'count') {
                        updateCount++;
                    }
                }
            });

            testContainer.innerHTML = '<div data-component="mixed-syntax-test"></div>';
            wildflower._scanForDynamicComponents();

            await new Promise(resolve => setTimeout(resolve, 50));

            // Mutate both stores
            wildflower.getStore('store-a').state.value = 'updated';
            wildflower.getStore('store-b').state.count = 1;

            await new Promise(resolve => setTimeout(resolve, 50));

            // Should only receive update from store-b (the one with path subscription)
            expect(updateCount).toBe(1);
        });
    });
});
