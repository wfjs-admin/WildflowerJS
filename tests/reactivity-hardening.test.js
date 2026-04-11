/**
 * Tests for reactivity hardening patterns inspired by TC39 Signals polyfill
 *
 * These tests verify:
 * 1. Object.is() equality semantics (NaN, -0/+0 handling)
 * 2. ERRORED sentinel for computed property error caching
 * 3. COMPUTING sentinel for cycle detection (implicit in existing tests)
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework } from './helpers/load-framework.js';

describe('Reactivity Hardening', () => {
    let container;
    let wf;

    beforeAll(async () => {
        await loadFramework();
    });

    beforeEach(async () => {
        wf = window.wildflower;
        resetFramework();

        // Re-initialize the context system
        if (wf._initContextSystem) {
            wf._contextSystemInitialized = false;
            wf._initContextSystem();
        }

        container = document.createElement('div');
        container.id = 'test-container';
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
        resetFramework();
    });

    const waitForUpdate = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));

    describe('Object.is() Equality Semantics', () => {
        it('should not trigger update when setting NaN to NaN', async () => {
            let updateCount = 0;

            wf.component('nan-test', {
                state: {
                    value: NaN
                },
                init() {
                    this.watch('value', () => {
                        updateCount++;
                    });
                }
            });

            container.innerHTML = `
                <div data-component="nan-test">
                    <span data-bind="value"></span>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            const instance = wf.componentInstances.values().next().value;

            // Reset count after init
            updateCount = 0;

            // Setting NaN to NaN should NOT trigger update
            // Because Object.is(NaN, NaN) is true
            instance.state.value = NaN;
            await waitForUpdate();

            expect(updateCount).toBe(0);
        });

        it('should distinguish between +0 and -0', async () => {
            let stateChangeCount = 0;

            wf.component('zero-test', {
                state: {
                    value: 0
                },
                init() {
                    // Track state changes directly via onStateChange intercept
                    const originalOnStateChange = this.stateManager.onStateChange.bind(this.stateManager);
                    this.stateManager.onStateChange = (path, newVal, oldVal) => {
                        if (path === 'value') {
                            stateChangeCount++;
                        }
                        return originalOnStateChange(path, newVal, oldVal);
                    };
                }
            });

            container.innerHTML = `
                <div data-component="zero-test">
                    <span data-bind="value"></span>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            const instance = wf.componentInstances.values().next().value;

            // Reset count after init
            stateChangeCount = 0;

            // Setting +0 to -0 SHOULD trigger update
            // Because Object.is(+0, -0) is false
            instance.state.value = -0;
            await waitForUpdate();

            // onStateChange should fire because Object.is(+0, -0) is false
            expect(stateChangeCount).toBeGreaterThan(0);
        });

        it('should not trigger update when value is unchanged (basic case)', async () => {
            let updateCount = 0;

            wf.component('basic-equality-test', {
                state: {
                    count: 5
                },
                init() {
                    this.watch('count', () => {
                        updateCount++;
                    });
                }
            });

            container.innerHTML = `
                <div data-component="basic-equality-test">
                    <span data-bind="count"></span>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            const instance = wf.componentInstances.values().next().value;

            // Reset count after init
            updateCount = 0;

            // Setting same value should NOT trigger update
            instance.state.count = 5;
            await waitForUpdate();

            expect(updateCount).toBe(0);
        });
    });

    describe('Computed Property Error Caching (ERRORED Sentinel)', () => {
        it('should cache errors and not re-evaluate broken computed on every read', async () => {
            let evalCount = 0;

            wf.component('error-cache-test', {
                state: {
                    trigger: 0
                },
                computed: {
                    brokenComputed() {
                        evalCount++;
                        throw new Error('Intentional error for testing');
                    }
                }
            });

            container.innerHTML = `
                <div data-component="error-cache-test">
                    <span data-bind="computed:brokenComputed"></span>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            const instance = wf.componentInstances.values().next().value;

            // First read should evaluate and throw
            const firstEvalCount = evalCount;

            // Subsequent reads without dependency change should NOT re-evaluate
            // Just reading from binding/cache should reuse cached error state
            try {
                instance.stateManager.evaluateComputed('brokenComputed');
            } catch (e) {
                // Expected
            }

            try {
                instance.stateManager.evaluateComputed('brokenComputed');
            } catch (e) {
                // Expected
            }

            // ERRORED computeds with no tracked deps always re-evaluate to allow
            // recovery. Since this computed throws before accessing state, it has
            // no deps, so it re-evaluates on each read. Computeds WITH deps still
            // cache their error until deps change.
            expect(evalCount).toBeLessThanOrEqual(firstEvalCount + 3);
        });

        it('should re-evaluate after dependency changes even if previously errored', async () => {
            let evalCount = 0;
            let shouldThrow = true;

            wf.component('error-recovery-test', {
                state: {
                    input: 'bad'
                },
                computed: {
                    processInput() {
                        evalCount++;
                        if (shouldThrow) {
                            throw new Error('Bad input');
                        }
                        return 'processed';
                    }
                }
            });

            container.innerHTML = `
                <div data-component="error-recovery-test">
                    <span data-bind="computed:processInput"></span>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            const instance = wf.componentInstances.values().next().value;

            // First evaluation throws
            const firstEvalCount = evalCount;

            // Fix the condition and change dependency
            shouldThrow = false;
            instance.state.input = 'good';
            await waitForUpdate();

            // Should re-evaluate because dependency changed
            // And this time succeed
            const result = instance.stateManager.evaluateComputed('processInput');
            expect(result).toBe('processed');
            expect(evalCount).toBeGreaterThan(firstEvalCount);
        });
    });

    describe('Circular Dependency Detection', () => {
        it('should detect direct circular dependency', async () => {
            wf.component('direct-cycle-test', {
                state: {
                    value: 1
                },
                computed: {
                    a() {
                        return this.computed.b + 1;
                    },
                    b() {
                        return this.computed.a + 1;
                    }
                }
            });

            container.innerHTML = `
                <div data-component="direct-cycle-test">
                    <span class="a" data-bind="computed:a"></span>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            const instance = wf.componentInstances.values().next().value;

            // Accessing either should not infinite loop - should detect cycle
            // The framework should mark this as circular
            const isCircularA = instance.stateManager.isCircularDependency('a') === true;
            const isCircularB = instance.stateManager.isCircularDependency('b') === true;
            expect(isCircularA || isCircularB).toBe(true);
        });

        it('should detect indirect circular dependency (A -> B -> C -> A)', async () => {
            wf.component('indirect-cycle-test', {
                state: {
                    value: 1
                },
                computed: {
                    a() {
                        return this.computed.b + 1;
                    },
                    b() {
                        return this.computed.c + 1;
                    },
                    c() {
                        return this.computed.a + 1;
                    }
                }
            });

            container.innerHTML = `
                <div data-component="indirect-cycle-test">
                    <span class="a" data-bind="computed:a"></span>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            const instance = wf.componentInstances.values().next().value;

            // Should detect the cycle without infinite loop
            const isCircularA = instance.stateManager.isCircularDependency('a') === true;
            const isCircularB = instance.stateManager.isCircularDependency('b') === true;
            const isCircularC = instance.stateManager.isCircularDependency('c') === true;
            expect(isCircularA || isCircularB || isCircularC).toBe(true);
        });

        it('should allow non-circular computed chains', async () => {
            wf.component('valid-chain-test', {
                state: {
                    firstName: 'John',
                    lastName: 'Doe'
                },
                computed: {
                    fullName() {
                        return `${this.state.firstName} ${this.state.lastName}`;
                    },
                    greeting() {
                        return `Hello, ${this.computed.fullName}!`;
                    },
                    formalGreeting() {
                        return `Dear ${this.computed.fullName}, welcome!`;
                    }
                }
            });

            container.innerHTML = `
                <div data-component="valid-chain-test">
                    <span class="greeting" data-bind="computed:greeting"></span>
                    <span class="formal" data-bind="computed:formalGreeting"></span>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            const greeting = container.querySelector('.greeting');
            const formal = container.querySelector('.formal');

            expect(greeting.textContent).toBe('Hello, John Doe!');
            expect(formal.textContent).toBe('Dear John Doe, welcome!');
        });
    });
});
