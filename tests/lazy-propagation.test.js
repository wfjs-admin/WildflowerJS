/**
 * Tests for Lazy Dirty Propagation (Version-based reactivity)
 *
 * These tests verify the infrastructure for O(1) invalidation:
 * - Version tracking for state paths
 * - Global epoch for short-circuit optimization
 * - Stale checking for computed properties
 * - Dependency version snapshots
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework, isMinifiedBuild} from './helpers/load-framework.js';

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms));
}

describe('Lazy Dirty Propagation', () => {
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

    describe('Version Tracking', () => {
        it('should increment _stateVersions on state change', async () => {
            testContainer.innerHTML = `
                <div data-component="version-test">
                    <span data-bind="count"></span>
                </div>
            `;

            wildflower.component('version-test', {
                state: { count: 0 }
            });

            await waitForUpdate();

            const component = testContainer.querySelector('[data-component="version-test"]');
            const componentId = component.dataset.componentId;
            const instance = wildflower.componentInstances.get(componentId);
            const rsm = instance.stateManager;

            // Initial version should be 0 or not set
            const initialVersion = rsm._stateVersions.get('count') || 0;

            // Change state
            instance.state.count = 1;
            await waitForUpdate();

            // Version should have incremented
            const newVersion = rsm._stateVersions.get('count');
            expect(newVersion).toBeGreaterThan(initialVersion);
        });

        it.skipIf(isMinifiedBuild())('should increment _globalEpoch on any state change', async () => {
            testContainer.innerHTML = `
                <div data-component="epoch-test">
                    <span data-bind="a"></span>
                    <span data-bind="b"></span>
                </div>
            `;

            wildflower.component('epoch-test', {
                state: { a: 0, b: 0 }
            });

            await waitForUpdate();

            const component = testContainer.querySelector('[data-component="epoch-test"]');
            const componentId = component.dataset.componentId;
            const instance = wildflower.componentInstances.get(componentId);
            const rsm = instance.stateManager;

            const initialEpoch = rsm._globalEpoch;

            // Change first property
            instance.state.a = 1;
            await waitForUpdate();
            const epochAfterA = rsm._globalEpoch;
            expect(epochAfterA).toBeGreaterThan(initialEpoch);

            // Change second property
            instance.state.b = 1;
            await waitForUpdate();
            const epochAfterB = rsm._globalEpoch;
            expect(epochAfterB).toBeGreaterThan(epochAfterA);
        });

        it('should track versions for nested paths', async () => {
            testContainer.innerHTML = `
                <div data-component="nested-version-test">
                    <span data-bind="user.name"></span>
                </div>
            `;

            wildflower.component('nested-version-test', {
                state: { user: { name: 'Alice' } }
            });

            await waitForUpdate();

            const component = testContainer.querySelector('[data-component="nested-version-test"]');
            const componentId = component.dataset.componentId;
            const instance = wildflower.componentInstances.get(componentId);
            const rsm = instance.stateManager;

            // Change nested property
            instance.state.user.name = 'Bob';
            await waitForUpdate();

            // Should have a version for the nested path
            const hasVersion = rsm._stateVersions.has('user.name') || rsm._stateVersions.has('user');
            expect(hasVersion).toBe(true);
        });
    });

    describe('Reverse Dependency Tracking (_computedDependsOn)', () => {
        it('should track state dependencies for computed properties', async () => {
            testContainer.innerHTML = `
                <div data-component="deps-test">
                    <span data-bind="doubled"></span>
                </div>
            `;

            wildflower.component('deps-test', {
                state: { count: 5 },
                computed: {
                    doubled() {
                        return this.state.count * 2;
                    }
                }
            });

            await waitForUpdate();

            const component = testContainer.querySelector('[data-component="deps-test"]');
            const componentId = component.dataset.componentId;
            const instance = wildflower.componentInstances.get(componentId);
            const rsm = instance.stateManager;

            // Evaluate computed to establish dependencies
            const value = rsm.evaluateComputed('doubled');
            expect(value).toBe(10);

            // Check reverse dependencies are tracked
            const deps = rsm._computedDependsOn.get('doubled');
            expect(deps).toBeDefined();
            expect(deps.has('count')).toBe(true);
        });

        it('should track computed-to-computed dependencies', async () => {
            testContainer.innerHTML = `
                <div data-component="chain-deps-test">
                    <span data-bind="quadrupled"></span>
                </div>
            `;

            wildflower.component('chain-deps-test', {
                state: { count: 2 },
                computed: {
                    doubled() {
                        return this.state.count * 2;
                    },
                    quadrupled() {
                        return this.computed.doubled * 2;
                    }
                }
            });

            await waitForUpdate();

            const component = testContainer.querySelector('[data-component="chain-deps-test"]');
            const componentId = component.dataset.componentId;
            const instance = wildflower.componentInstances.get(componentId);
            const rsm = instance.stateManager;

            // Evaluate to establish dependencies
            const value = rsm.evaluateComputed('quadrupled');
            expect(value).toBe(8);

            // Check quadrupled depends on computed:doubled
            const deps = rsm._computedDependsOn.get('quadrupled');
            expect(deps).toBeDefined();
            expect(deps.has('computed:doubled')).toBe(true);
        });
    });

    describe('Version Snapshots (_computedDepVersions)', () => {
        it('should save dependency versions after evaluation', async () => {
            testContainer.innerHTML = `
                <div data-component="snapshot-test">
                    <span data-bind="doubled"></span>
                </div>
            `;

            wildflower.component('snapshot-test', {
                state: { count: 3 },
                computed: {
                    doubled() {
                        return this.state.count * 2;
                    }
                }
            });

            await waitForUpdate();

            const component = testContainer.querySelector('[data-component="snapshot-test"]');
            const componentId = component.dataset.componentId;
            const instance = wildflower.componentInstances.get(componentId);
            const rsm = instance.stateManager;

            // Evaluate computed
            rsm.evaluateComputed('doubled');

            // Check version snapshot was saved — after stability promotion,
            // dep versions live on the node's parallel arrays (not the Map)
            const node = rsm._computedNodes.get('doubled');
            if (node && node.depVersions) {
                // Promoted: versions on node
                expect(node.depVersions).toBeDefined();
                expect(Array.isArray(node.depVersions)).toBe(true);
            } else {
                // Not yet promoted: versions in Map
                const savedVersions = rsm._computedDepVersions.get('doubled');
                expect(savedVersions).toBeDefined();
                expect(savedVersions instanceof Map).toBe(true);
            }
        });

        it.skipIf(isMinifiedBuild())('should update node.lastEpoch after evaluation', async () => {
            testContainer.innerHTML = `
                <div data-component="epoch-snapshot-test">
                    <span data-bind="doubled"></span>
                </div>
            `;

            wildflower.component('epoch-snapshot-test', {
                state: { count: 4 },
                computed: {
                    doubled() {
                        return this.state.count * 2;
                    }
                }
            });

            await waitForUpdate();

            const component = testContainer.querySelector('[data-component="epoch-snapshot-test"]');
            const componentId = component.dataset.componentId;
            const instance = wildflower.componentInstances.get(componentId);
            const rsm = instance.stateManager;

            // Evaluate computed
            rsm.evaluateComputed('doubled');

            // Check epoch was recorded on the node
            const node = rsm._computedNodes.get('doubled');
            expect(node).toBeDefined();
            expect(node.lastEpoch).toBe(rsm._globalEpoch);
        });
    });

    describe('Stale Checking (_isComputedStale)', () => {
        it.skipIf(isMinifiedBuild())('should return true for computed with no tracked dependencies yet', async () => {
            testContainer.innerHTML = `
                <div data-component="stale-new-test">
                    <span data-bind="count"></span>
                </div>
            `;

            wildflower.component('stale-new-test', {
                state: { count: 0 },
                computed: {
                    doubled() {
                        return this.state.count * 2;
                    }
                }
            });

            await waitForUpdate();

            const component = testContainer.querySelector('[data-component="stale-new-test"]');
            const componentId = component.dataset.componentId;
            const instance = wildflower.componentInstances.get(componentId);
            const rsm = instance.stateManager;

            // NOTE: The framework auto-evaluates computed properties during component init,
            // so 'doubled' is already evaluated with dependencies tracked and versions saved.
            // Test a computed that has no _computedDependsOn entry (simulating unevaluated state)

            // Clear the tracking for this computed to simulate "never evaluated"
            rsm._computedDependsOn.delete('doubled');
            rsm._computedDepVersions.delete('doubled');
            const node = rsm._computedNodes.get('doubled');
            if (node) {
                node.lastEpoch = -1;
                node.flags &= ~0x2; // ~STABLE
                node.deps = null;
                node.depVersions = null;
                node.depNodes = null;
            }

            // With no tracked dependencies, should be considered stale
            const isStale = rsm._isComputedStale('doubled');
            expect(isStale).toBe(true);
        });

        it('should return false immediately after evaluation (epoch short-circuit)', async () => {
            testContainer.innerHTML = `
                <div data-component="stale-fresh-test">
                    <span data-bind="doubled"></span>
                </div>
            `;

            wildflower.component('stale-fresh-test', {
                state: { count: 5 },
                computed: {
                    doubled() {
                        return this.state.count * 2;
                    }
                }
            });

            await waitForUpdate();

            const component = testContainer.querySelector('[data-component="stale-fresh-test"]');
            const componentId = component.dataset.componentId;
            const instance = wildflower.componentInstances.get(componentId);
            const rsm = instance.stateManager;

            // Evaluate computed
            rsm.evaluateComputed('doubled');

            // Immediately after, should not be stale
            const isStale = rsm._isComputedStale('doubled');
            expect(isStale).toBe(false);
        });

        it.skipIf(isMinifiedBuild())('should return true when dependency changes', async () => {
            testContainer.innerHTML = `
                <div data-component="stale-changed-test">
                    <span data-bind="doubled"></span>
                </div>
            `;

            wildflower.component('stale-changed-test', {
                state: { count: 5 },
                computed: {
                    doubled() {
                        return this.state.count * 2;
                    }
                }
            });

            await waitForUpdate();

            const component = testContainer.querySelector('[data-component="stale-changed-test"]');
            const componentId = component.dataset.componentId;
            const instance = wildflower.componentInstances.get(componentId);
            const rsm = instance.stateManager;

            // Ensure computed is evaluated and versions saved
            rsm.evaluateComputed('doubled');

            // Record the current state
            const node = rsm._computedNodes.get('doubled');
            const epochBefore = node ? node.lastEpoch : undefined;

            // Change the dependency - this increments _stateVersions synchronously
            instance.state.count = 10;

            // Check staleness SYNCHRONOUSLY - before microtask queue processes and re-evaluates
            // The state version should have incremented, making the computed stale
            const countVersionAfterChange = rsm._stateVersions.get('count');
            const globalEpochAfterChange = rsm._globalEpoch;

            // Verify the version was incremented
            expect(countVersionAfterChange).toBeGreaterThan(0);
            expect(globalEpochAfterChange).toBeGreaterThan(epochBefore);

            // The computed should be stale IMMEDIATELY after state change (before re-eval)
            const isStaleImmediately = rsm._isComputedStale('doubled');
            expect(isStaleImmediately).toBe(true);

            // After framework processes updates, it will re-evaluate and the computed
            // will no longer be stale (because _saveDepVersions updates the versions)
            await waitForUpdate();

            // After re-evaluation, should NOT be stale anymore
            const isStaleAfterReeval = rsm._isComputedStale('doubled');
            expect(isStaleAfterReeval).toBe(false);
        });

        it('should handle diamond pattern dependencies', async () => {
            testContainer.innerHTML = `
                <div data-component="diamond-stale-test">
                    <span data-bind="sum"></span>
                </div>
            `;

            wildflower.component('diamond-stale-test', {
                state: { source: 1 },
                computed: {
                    left() {
                        return this.state.source * 2;
                    },
                    right() {
                        return this.state.source * 3;
                    },
                    sum() {
                        return this.computed.left + this.computed.right;
                    }
                }
            });

            await waitForUpdate();

            const component = testContainer.querySelector('[data-component="diamond-stale-test"]');
            const componentId = component.dataset.componentId;
            const instance = wildflower.componentInstances.get(componentId);
            const rsm = instance.stateManager;

            // Evaluate all computed to establish dependency tracking
            expect(rsm.evaluateComputed('sum')).toBe(5);

            // Not stale immediately after evaluation
            expect(rsm._isComputedStale('sum')).toBe(false);
            expect(rsm._isComputedStale('left')).toBe(false);
            expect(rsm._isComputedStale('right')).toBe(false);

            // Change source - check staleness SYNCHRONOUSLY before re-evaluation
            instance.state.source = 2;

            // IMMEDIATELY after state change, all should be stale (before microtask re-eval)
            // left and right depend on source directly
            expect(rsm._isComputedStale('left')).toBe(true);
            expect(rsm._isComputedStale('right')).toBe(true);
            // sum depends on left and right (computed dependencies)
            expect(rsm._isComputedStale('sum')).toBe(true);

            // After framework processes updates and re-evaluates
            await waitForUpdate();

            // After re-evaluation, should NOT be stale anymore
            expect(rsm._isComputedStale('left')).toBe(false);
            expect(rsm._isComputedStale('right')).toBe(false);
            expect(rsm._isComputedStale('sum')).toBe(false);

            // Verify correctness of values
            expect(rsm.evaluateComputed('sum')).toBe(10);
        });

        it('should detect circular dependency and return false', async () => {
            testContainer.innerHTML = `
                <div data-component="circular-stale-test">
                    <span data-bind="x"></span>
                </div>
            `;

            wildflower.component('circular-stale-test', {
                state: { x: 1 }
            });

            await waitForUpdate();

            const component = testContainer.querySelector('[data-component="circular-stale-test"]');
            const componentId = component.dataset.componentId;
            const instance = wildflower.componentInstances.get(componentId);
            const rsm = instance.stateManager;

            // Simulate checking stale with a visited set that already contains the name
            const visited = new Set();
            visited.add('testComputed');
            const isStale = rsm._isComputedStale('testComputed', visited);
            // Should return false due to cycle detection
            expect(isStale).toBe(false);
        });
    });

    describe('Integration with Existing System', () => {
        it('should maintain correct computed values with version tracking active', async () => {
            testContainer.innerHTML = `
                <div data-component="integration-test">
                    <span id="result" data-bind="result"></span>
                </div>
            `;

            wildflower.component('integration-test', {
                state: { items: [1, 2, 3] },
                computed: {
                    result() {
                        return this.state.items.reduce((a, b) => a + b, 0);
                    }
                }
            });

            await waitForUpdate();

            const resultEl = testContainer.querySelector('#result');
            expect(resultEl.textContent).toBe('6');

            // Modify array
            const component = testContainer.querySelector('[data-component="integration-test"]');
            const componentId = component.dataset.componentId;
            const instance = wildflower.componentInstances.get(componentId);
            instance.state.items.push(4);
            await waitForUpdate();

            expect(resultEl.textContent).toBe('10');
        });

        it('should work with stores', async () => {
            testContainer.innerHTML = `
                <div data-component="store-version-test">
                    <span id="doubled" data-bind="doubled"></span>
                </div>
            `;

            wildflower.store('versionStore', {
                state: { value: 5 },
                computed: {
                    doubled() {
                        return this.state.value * 2;
                    }
                }
            });

            wildflower.component('store-version-test', {
                subscribe: {
                    versionStore: ['doubled']
                },
                state: {},
                computed: {
                    doubled() {
                        return wildflower.getStore('versionStore').computed.doubled;
                    }
                }
            });

            await waitForUpdate();

            const store = wildflower.getStore('versionStore');
            expect(store.computed.doubled).toBe(10);

            // Change store state
            store.state.value = 10;
            await waitForUpdate();

            expect(store.computed.doubled).toBe(20);
        });
    });
});
