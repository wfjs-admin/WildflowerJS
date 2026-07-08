/**
 * Subscribe-wait on the page-load batch scan path
 *
 * The dynamic component path routes init() through _initWithStoreWait
 * (ComponentLifecycle), which awaits waitForStoreReady for every store in
 * the component's `subscribe` declaration. The page-load batch path
 * (_scanForComponents / _scanForComponentsAsync → _executeDeferredInits)
 * defers init() to a macrotask. This suite pins down whether that batch
 * path honors subscribe-wait the same way the dynamic path does.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework } from './helpers/load-framework.js';

describe('Subscribe Wait on batch scan path', () => {
    let testContainer;
    let wildflower;

    beforeAll(async () => {
        wildflower = await loadFramework();
    });

    beforeEach(() => {
        resetFramework(wildflower);

        testContainer = document.createElement('div');
        testContainer.id = 'test-container';
        document.body.appendChild(testContainer);
    });

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer);
        }
        if (wildflower.destroyStore) {
            wildflower.destroyStore('batch-async-store');
        }
        if (wildflower.clearComponentDefinitions) {
            wildflower.clearComponentDefinitions();
        }
    });

    it('batch-scanned component waits for async store init before its init() runs', async () => {
        const initOrder = [];

        wildflower.store('batch-async-store', {
            state: { value: 'initial' },
            async init() {
                await new Promise(resolve => setTimeout(resolve, 100));
                this.state.value = 'ready';
                initOrder.push('store-ready');
            }
        });

        let valueAtInit = null;

        wildflower.component('batch-wait-test', {
            subscribe: { 'batch-async-store': ['value'] },
            state: {},
            init() {
                initOrder.push('component-init');
                valueAtInit = wildflower.getStore('batch-async-store').state.value;
            }
        });

        // Element present in DOM BEFORE the scan → page-load batch path
        // (_executeDeferredInits), NOT the dynamic per-component path.
        testContainer.innerHTML = '<div data-component="batch-wait-test"></div>';
        wildflower._scanForComponents();

        await new Promise(resolve => setTimeout(resolve, 300));

        expect(initOrder).toEqual(['store-ready', 'component-init']);
        expect(valueAtInit).toBe('ready');
    });
});
