/**
 * Entity Parity Tests
 *
 * These tests verify that components, stores, and plugins behave IDENTICALLY
 * for equivalent operations. Any behavioral difference indicates a bug in the
 * unified entity system.
 *
 * Key principle: If a test passes for components, it MUST pass for stores and plugins.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework, isMinifiedBuild} from './helpers/load-framework.js';

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms));
}

describe('Entity Parity', () => {
    let testContainer;
    let wildflower;

    beforeAll(async () => {
        await loadFramework();
    });

    beforeEach(() => {
        wildflower = window.wildflower;
        resetFramework();

        // Re-initialize the context system (required after resetFramework)
        if (wildflower._initContextSystem) {
            wildflower._contextSystemInitialized = false;
            wildflower._initContextSystem();
        }

        testContainer = document.createElement('div');
        testContainer.id = 'test-container';
        testContainer.style.position = 'absolute';
        testContainer.style.left = '-9999px';
        testContainer.style.opacity = '0';
        document.body.appendChild(testContainer);
    });

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer);
        }
    });

    describe('Nested Computed Properties', () => {
        /**
         * Test: When state changes, nested computed properties should cascade.
         */

        it('component: nested computed cascade works', async () => {
            wildflower.component('cascade-comp', {
                state: { name: 'World' },
                computed: {
                    greeting() {
                        return `Hello, ${this.state.name}`;
                    },
                    formalGreeting() {
                        return `${this.computed.greeting}!`;
                    }
                }
            });

            testContainer.innerHTML = `
                <div data-component="cascade-comp">
                    <span class="greeting" data-bind="computed:greeting"></span>
                    <span class="formal" data-bind="computed:formalGreeting"></span>
                </div>
            `;

            wildflower.scan();
            await waitForUpdate();

            const el = testContainer.querySelector('[data-component="cascade-comp"]');
            const instance = wildflower.componentInstances.get(el.dataset.componentId);

            // Verify initial values
            expect(instance.stateManager.evaluateComputed('greeting')).toBe('Hello, World');
            expect(instance.stateManager.evaluateComputed('formalGreeting')).toBe('Hello, World!');

            // Change state
            instance.state.name = 'Universe';
            await waitForUpdate(50);

            // Verify nested computed cascaded
            expect(instance.stateManager.evaluateComputed('greeting')).toBe('Hello, Universe');
            expect(instance.stateManager.evaluateComputed('formalGreeting')).toBe('Hello, Universe!');

            // Verify DOM updated
            expect(testContainer.querySelector('.greeting').textContent).toBe('Hello, Universe');
            expect(testContainer.querySelector('.formal').textContent).toBe('Hello, Universe!');
        });

        it.skipIf(isMinifiedBuild())('store: nested computed cascade works (MUST MATCH COMPONENT)', async () => {
            wildflower.store('cascade-store', {
                state: { name: 'World' },
                computed: {
                    greeting() {
                        return `Hello, ${this.state.name}`;
                    },
                    formalGreeting() {
                        return `${this.computed.greeting}!`;
                    }
                }
            });

            wildflower.component('cascade-consumer', {
                state: {},
                subscribe: { 'cascade-store': ['name'] },
                computed: {
                    storeGreeting() {
                        return this.stores['cascade-store'].greeting;
                    },
                    storeFormalGreeting() {
                        return this.stores['cascade-store'].formalGreeting;
                    }
                }
            });

            testContainer.innerHTML = `
                <div data-component="cascade-consumer">
                    <span class="greeting" data-bind="computed:storeGreeting"></span>
                    <span class="formal" data-bind="computed:storeFormalGreeting"></span>
                </div>
            `;

            wildflower.scan();
            await waitForUpdate();

            const el = testContainer.querySelector('[data-component="cascade-consumer"]');
            const consumer = wildflower.componentInstances.get(el.dataset.componentId);
            // getStore returns context, need full store for stateManager access
            const store = wildflower.storeManager._namedStores.get('cascade-store');

            // Verify initial values
            expect(store.stateManager.evaluateComputed('greeting')).toBe('Hello, World');
            expect(store.stateManager.evaluateComputed('formalGreeting')).toBe('Hello, World!');

            // Change store state
            store.state.name = 'Universe';
            await waitForUpdate(50);

            // Verify store's nested computed cascaded
            expect(store.stateManager.evaluateComputed('greeting')).toBe('Hello, Universe');
            expect(store.stateManager.evaluateComputed('formalGreeting')).toBe('Hello, Universe!');

            // Verify consumer sees updated values
            expect(consumer.stateManager.evaluateComputed('storeGreeting')).toBe('Hello, Universe');
            expect(consumer.stateManager.evaluateComputed('storeFormalGreeting')).toBe('Hello, Universe!');

            // Verify DOM updated
            expect(testContainer.querySelector('.greeting').textContent).toBe('Hello, Universe');
            expect(testContainer.querySelector('.formal').textContent).toBe('Hello, Universe!');
        });
    });

    describe('Methods Available in init()', () => {
        it('component: methods available in init()', async () => {
            let methodResult = null;

            wildflower.component('init-method-comp', {
                state: { initialized: false },
                _helperMethod() {
                    return 'helper-called';
                },
                init() {
                    methodResult = this._helperMethod();
                    this.state.initialized = true;
                }
            });

            testContainer.innerHTML = `<div data-component="init-method-comp"></div>`;
            wildflower.scan();
            await waitForUpdate();

            expect(methodResult).toBe('helper-called');
        });

        it('store: methods available in init() (MUST MATCH COMPONENT)', async () => {
            let methodResult = null;

            wildflower.store('init-method-store', {
                state: { initialized: false },
                _helperMethod() {
                    return 'helper-called';
                },
                init() {
                    methodResult = this._helperMethod();
                    this.state.initialized = true;
                }
            });

            // Stores init immediately on creation
            await waitForUpdate(10);

            expect(methodResult).toBe('helper-called');
        });
    });

    describe('Computed Property Reactivity', () => {
        it('component: computed reflects state changes', async () => {
            wildflower.component('reactive-comp', {
                state: { value: 'initial' },
                computed: {
                    derived() {
                        return `derived-${this.state.value}`;
                    }
                }
            });

            testContainer.innerHTML = `
                <div data-component="reactive-comp">
                    <span class="derived" data-bind="computed:derived"></span>
                </div>
            `;

            wildflower.scan();
            await waitForUpdate();

            const el = testContainer.querySelector('[data-component="reactive-comp"]');
            const instance = wildflower.componentInstances.get(el.dataset.componentId);

            expect(instance.stateManager.evaluateComputed('derived')).toBe('derived-initial');

            instance.state.value = 'changed';
            await waitForUpdate(50);

            expect(instance.stateManager.evaluateComputed('derived')).toBe('derived-changed');
            expect(testContainer.querySelector('.derived').textContent).toBe('derived-changed');
        });

        it.skipIf(isMinifiedBuild())('store: computed reflects state changes (MUST MATCH COMPONENT)', async () => {
            wildflower.store('reactive-store', {
                state: { value: 'initial' },
                computed: {
                    derived() {
                        return `derived-${this.state.value}`;
                    }
                }
            });

            wildflower.component('reactive-consumer', {
                state: {},
                subscribe: { 'reactive-store': ['value'] },
                computed: {
                    storeDerived() {
                        return this.stores['reactive-store'].derived;
                    }
                }
            });

            testContainer.innerHTML = `
                <div data-component="reactive-consumer">
                    <span class="derived" data-bind="computed:storeDerived"></span>
                </div>
            `;

            wildflower.scan();
            await waitForUpdate();

            const el = testContainer.querySelector('[data-component="reactive-consumer"]');
            const consumer = wildflower.componentInstances.get(el.dataset.componentId);
            // getStore returns context, need full store for stateManager access
            const store = wildflower.storeManager._namedStores.get('reactive-store');

            expect(store.stateManager.evaluateComputed('derived')).toBe('derived-initial');

            store.state.value = 'changed';
            await waitForUpdate(50);

            expect(store.stateManager.evaluateComputed('derived')).toBe('derived-changed');
            expect(consumer.stateManager.evaluateComputed('storeDerived')).toBe('derived-changed');
            expect(testContainer.querySelector('.derived').textContent).toBe('derived-changed');
        });
    });

    describe('Watch Triggers', () => {
        it('component: watch on computed fires', async () => {
            let watchCount = 0;
            let lastValue = null;

            wildflower.component('watch-comp', {
                state: { value: 'initial' },
                computed: {
                    derived() {
                        return `derived-${this.state.value}`;
                    }
                },
                watch: {
                    'computed:derived': function(newVal) {
                        watchCount++;
                        lastValue = newVal;
                    }
                }
            });

            testContainer.innerHTML = `<div data-component="watch-comp"></div>`;
            wildflower.scan();
            await waitForUpdate();

            const el = testContainer.querySelector('[data-component="watch-comp"]');
            const instance = wildflower.componentInstances.get(el.dataset.componentId);

            const initialWatchCount = watchCount;
            instance.state.value = 'changed';
            await waitForUpdate(50);

            expect(watchCount).toBeGreaterThan(initialWatchCount);
            expect(lastValue).toBe('derived-changed');
        });

        it.skipIf(isMinifiedBuild())('store: watch on computed fires (MUST MATCH COMPONENT)', async () => {
            let watchCount = 0;
            let lastValue = null;

            wildflower.store('watch-store', {
                state: { value: 'initial' },
                computed: {
                    derived() {
                        return `derived-${this.state.value}`;
                    }
                }
            });

            wildflower.component('watch-consumer', {
                state: {},
                subscribe: { 'watch-store': ['value'] },
                computed: {
                    storeDerived() {
                        return this.stores['watch-store'].derived;
                    }
                },
                watch: {
                    'computed:storeDerived': function(newVal) {
                        watchCount++;
                        lastValue = newVal;
                    }
                }
            });

            testContainer.innerHTML = `<div data-component="watch-consumer"></div>`;
            wildflower.scan();
            await waitForUpdate();

            // getStore returns context, need full store for state access
            const store = wildflower.storeManager._namedStores.get('watch-store');

            const initialWatchCount = watchCount;
            store.state.value = 'changed';
            await waitForUpdate(50);

            expect(watchCount).toBeGreaterThan(initialWatchCount);
            expect(lastValue).toBe('derived-changed');
        });
    });
});
