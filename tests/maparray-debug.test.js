/**
 * Debug test for mapArray dependency tracking
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework, waitForUpdate, isMinifiedBuild } from './helpers/load-framework.js';

describe('mapArray Debug', () => {
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
        document.body.appendChild(testContainer);
    });

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer);
        }
    });

    function getStateManager() {
        storeCounter++;
        const store = wildflower.storeManager.createStoreComponent(`debug-test-${storeCounter}`, {
            state: { value: 'test' }
        });
        return store.stateManager;
    }

    it('should verify proxy identity', async () => {
        const sm = getStateManager();

        const state = sm._createObjectProxy({
            items: [
                { id: 1, name: 'Item 1' },
                { id: 2, name: 'Item 2' }
            ]
        }, 'state');

        // Get item proxy directly
        const itemProxy1 = state.items[1];
        const itemProxy2 = state.items[1];

        console.log('=== Proxy identity check ===');
        console.log('itemProxy1 === itemProxy2:', itemProxy1 === itemProxy2);
        console.log('typeof itemProxy1:', typeof itemProxy1);

        // Check if it's actually a proxy by looking for RSM methods
        const rawTarget = sm._proxyTargets?.get(itemProxy1);
        console.log('Is proxy (has target):', rawTarget !== undefined);
        console.log('Raw target:', rawTarget);

        // Try setting directly on itemProxy1
        console.log('=== Setting name on itemProxy1 ===');
        console.log('Before:', itemProxy1.name);
        itemProxy1.name = 'Direct Modification';
        console.log('After:', itemProxy1.name);
        console.log('Raw target name:', rawTarget?.name);

        // Verify the modification went through the proxy
        expect(itemProxy1.name).toBe('Direct Modification');
        expect(rawTarget?.name).toBe('Direct Modification');
    });

    it.skipIf(isMinifiedBuild())('should check state.items[1] proxy', async () => {
        const sm = getStateManager();

        const state = sm._createObjectProxy({
            items: [
                { id: 1, name: 'Item 1' },
                { id: 2, name: 'Item 2' }
            ]
        }, 'state');

        // Track all proxy creations
        const proxyCreations = [];
        const originalCreateReactive = sm._createReactiveProxy.bind(sm);
        sm._createReactiveProxy = function(target, path) {
            proxyCreations.push({ target: target?.id || 'unknown', path });
            return originalCreateReactive(target, path);
        };

        console.log('=== First access to state.items ===');
        const items = state.items;
        console.log('Proxy creations:', JSON.stringify(proxyCreations));

        proxyCreations.length = 0;
        console.log('=== First access to state.items[1] ===');
        const item1First = state.items[1];
        console.log('Proxy creations:', JSON.stringify(proxyCreations));

        proxyCreations.length = 0;
        console.log('=== Second access to state.items[1] ===');
        const item1Second = state.items[1];
        console.log('Proxy creations:', JSON.stringify(proxyCreations));
        console.log('Same proxy?', item1First === item1Second);

        // Now try modification
        console.log('=== Modifying state.items[1].name ===');
        
        // Track set trap
        const setTrapCalls = [];
        const handler = sm._objectHandler;
        const originalSet = handler.set;
        handler.set = function(target, prop, value, receiver) {
            setTrapCalls.push({ target: target?.id || 'unknown', prop, value });
            return originalSet.call(this, target, prop, value, receiver);
        };

        state.items[1].name = 'Modified';
        
        console.log('Set trap calls:', JSON.stringify(setTrapCalls));
        
        expect(setTrapCalls.length).toBeGreaterThan(0);
    });
});
