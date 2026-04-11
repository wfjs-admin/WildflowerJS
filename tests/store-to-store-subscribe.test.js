/**
 * Tests for store-to-store subscribe: {} and this.stores support
 *
 * Stores should support the same declarative subscription pattern as components:
 * - subscribe: { 'otherStore': ['path1', 'path2'] }
 * - this.stores.otherStore auto-injection
 * - onStoreUpdate(storeName, path, newValue, oldValue) lifecycle hook
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework, isMinifiedBuild} from './helpers/load-framework.js';

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms));
}

describe('Store-to-Store Subscribe', () => {
    let testContainer;
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

        // Create test container
        testContainer = document.createElement('div');
        testContainer.id = 'test-container';
        document.body.appendChild(testContainer);
    });

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer);
        }
    });

    describe('this.stores auto-injection', () => {
        it('should inject subscribed stores into this.stores', async () => {
            // Create a source store
            wildflower.store('inventory', {
                state: {
                    stockLevels: { widget: 100, gadget: 50 }
                }
            });

            // Create a store that subscribes to inventory
            let capturedStores = null;
            wildflower.store('cart', {
                state: { items: [] },
                subscribe: {
                    'inventory': []
                },
                init() {
                    capturedStores = this.stores;
                }
            });

            await new Promise(resolve => setTimeout(resolve, 100));

            const cartStore = wildflower.getStore('cart');
            expect(cartStore).toBeTruthy();
            expect(capturedStores).toBeTruthy();
            expect(capturedStores.inventory).toBeTruthy();
            expect(capturedStores.inventory.state.stockLevels.widget).toBe(100);
        });

        it('should support multiple store subscriptions', async () => {
            wildflower.store('users', {
                state: { count: 10 }
            });

            wildflower.store('products', {
                state: { count: 50 }
            });

            let capturedStores = null;
            wildflower.store('dashboard', {
                state: {},
                subscribe: {
                    'users': [],
                    'products': []
                },
                init() {
                    capturedStores = this.stores;
                }
            });

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(capturedStores.users).toBeTruthy();
            expect(capturedStores.users.state.count).toBe(10);
            expect(capturedStores.products).toBeTruthy();
            expect(capturedStores.products.state.count).toBe(50);
        });

        it('should allow accessing store methods via this.stores', async () => {
            wildflower.store('counter', {
                state: { value: 0 },
                increment() {
                    this.state.value++;
                }
            });

            let incrementCalled = false;
            wildflower.store('controller', {
                state: {},
                subscribe: {
                    'counter': []
                },
                init() {
                    // Call method on subscribed store
                    this.stores.counter.increment();
                    incrementCalled = true;
                }
            });

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(incrementCalled).toBe(true);
            const counterStore = wildflower.getStore('counter');
            expect(counterStore.state.value).toBe(1);
        });

        it('should support array syntax for subscribe (wait only, no paths)', async () => {
            wildflower.store('config', {
                state: { apiUrl: 'https://api.example.com' }
            });

            let configAvailable = false;
            wildflower.store('api', {
                state: {},
                subscribe: ['config'],  // Array syntax
                init() {
                    configAvailable = !!this.stores.config;
                }
            });

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(configAvailable).toBe(true);
        });
    });

    describe('onStoreUpdate lifecycle hook', () => {
        it('should call onStoreUpdate when subscribed path changes', async () => {
            wildflower.store('source', {
                state: { value: 1 }
            });

            const updates = [];
            wildflower.store('listener', {
                state: {},
                subscribe: {
                    'source': ['value']
                },
                onStoreUpdate(storeName, path, newValue, oldValue) {
                    updates.push({ storeName, path, newValue, oldValue });
                }
            });

            await new Promise(resolve => setTimeout(resolve, 100));

            // Modify the source store
            const sourceStore = wildflower.getStore('source');
            sourceStore.state.value = 42;

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(updates.length).toBeGreaterThan(0);
            const lastUpdate = updates[updates.length - 1];
            expect(lastUpdate.storeName).toBe('source');
            expect(lastUpdate.path).toBe('value');
            expect(lastUpdate.newValue).toBe(42);
            expect(lastUpdate.oldValue).toBe(1);
        });

        it('should only notify for subscribed paths', async () => {
            wildflower.store('multi', {
                state: {
                    watched: 'initial',
                    unwatched: 'initial'
                }
            });

            const updates = [];
            wildflower.store('selective', {
                state: {},
                subscribe: {
                    'multi': ['watched']  // Only watch 'watched' path
                },
                onStoreUpdate(storeName, path, newValue, oldValue) {
                    updates.push({ path, newValue });
                }
            });

            await new Promise(resolve => setTimeout(resolve, 100));

            const multiStore = wildflower.getStore('multi');

            // Change unwatched - should NOT trigger
            multiStore.state.unwatched = 'changed';
            await new Promise(resolve => setTimeout(resolve, 50));

            const countAfterUnwatched = updates.length;

            // Change watched - SHOULD trigger
            multiStore.state.watched = 'changed';
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(updates.length).toBe(countAfterUnwatched + 1);
            expect(updates[updates.length - 1].path).toBe('watched');
        });

        it('should support multiple path subscriptions', async () => {
            wildflower.store('data', {
                state: {
                    name: 'initial',
                    count: 0
                }
            });

            const updates = [];
            wildflower.store('observer', {
                state: {},
                subscribe: {
                    'data': ['name', 'count']
                },
                onStoreUpdate(storeName, path, newValue, oldValue) {
                    updates.push({ path, newValue });
                }
            });

            await new Promise(resolve => setTimeout(resolve, 100));

            const dataStore = wildflower.getStore('data');
            dataStore.state.name = 'updated';
            await new Promise(resolve => setTimeout(resolve, 50));

            dataStore.state.count = 5;
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(updates.some(u => u.path === 'name' && u.newValue === 'updated')).toBe(true);
            expect(updates.some(u => u.path === 'count' && u.newValue === 5)).toBe(true);
        });
    });

    describe('store-to-store communication patterns', () => {
        it.skipIf(isMinifiedBuild())('should enable clean store-to-store method calls', async () => {
            wildflower.store('analytics', {
                state: { events: [] },
                trackEvent(eventName, data) {
                    this.state.events = [...this.state.events, { name: eventName, data }];
                }
            });

            wildflower.store('cart', {
                state: { items: [] },
                subscribe: {
                    'analytics': []
                },
                addItem(item) {
                    this.state.items = [...this.state.items, item];
                    this.stores.analytics.trackEvent('item_added', { itemId: item.id });
                }
            });

            await new Promise(resolve => setTimeout(resolve, 100));

            const cartStore = wildflower.getStore('cart');
            cartStore.addItem({ id: 'widget', name: 'Widget', price: 19.99 });

            await new Promise(resolve => setTimeout(resolve, 50));

            const analyticsStore = wildflower.getStore('analytics');
            expect(analyticsStore.state.events.length).toBe(1);
            expect(analyticsStore.state.events[0].name).toBe('item_added');
            expect(analyticsStore.state.events[0].data.itemId).toBe('widget');
        });

        it('should handle reactive updates from subscribed stores in computed', async () => {
            wildflower.store('pricing', {
                state: {
                    taxRate: 0.1,
                    discount: 0
                }
            });

            wildflower.store('order', {
                state: {
                    subtotal: 100
                },
                subscribe: {
                    'pricing': ['taxRate', 'discount']
                },
                computed: {
                    total() {
                        const pricing = this.stores.pricing;
                        if (!pricing) return this.state.subtotal;
                        const afterDiscount = this.state.subtotal * (1 - pricing.state.discount);
                        return afterDiscount * (1 + pricing.state.taxRate);
                    }
                }
            });

            await new Promise(resolve => setTimeout(resolve, 100));

            const orderStore = wildflower.getStore('order');

            // Initial: 100 * (1 - 0) * (1 + 0.1) = 110
            expect(orderStore.computed.total).toBeCloseTo(110, 5);

            // Change discount
            const pricingStore = wildflower.getStore('pricing');
            pricingStore.state.discount = 0.2;

            await new Promise(resolve => setTimeout(resolve, 50));

            // After discount: 100 * (1 - 0.2) * (1 + 0.1) = 80 * 1.1 = 88
            expect(orderStore.computed.total).toBe(88);
        });
    });

    describe('edge cases', () => {
        it('should handle subscribing to a store created later', async () => {
            // Create subscriber first
            let storeAvailable = false;
            wildflower.store('early', {
                state: {},
                subscribe: {
                    'late': []
                },
                init() {
                    // Store might not be available yet
                    storeAvailable = !!this.stores.late;
                }
            });

            await new Promise(resolve => setTimeout(resolve, 50));

            // Create the subscribed store later
            wildflower.store('late', {
                state: { value: 'created' }
            });

            await new Promise(resolve => setTimeout(resolve, 100));

            // Now it should be available via getter
            const earlyStore = wildflower.getStore('early');
            expect(earlyStore.stores.late).toBeTruthy();
            expect(earlyStore.stores.late.state.value).toBe('created');
        });

        it('should not break if subscribed store does not exist', async () => {
            // Should not throw
            let initCompleted = false;
            wildflower.store('orphan', {
                state: {},
                subscribe: {
                    'nonexistent': []
                },
                init() {
                    initCompleted = true;
                }
            });

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(initCompleted).toBe(true);
            const orphanStore = wildflower.getStore('orphan');
            expect(orphanStore.stores.nonexistent).toBeNull();
        });
    });
});
