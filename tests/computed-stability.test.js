/**
 * Tests for Computed Stability Promotion
 *
 * Issue 2.2: Stability promotion uses dep COUNT not IDENTITY.
 * If deps change but count stays the same (conditional dependencies),
 * wrong deps get baked into the STABLE node, returning stale values.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework, waitForUpdate, waitForCompleteRender, initContextSystem } from './helpers/load-framework.js';

describe('Computed Stability Promotion', () => {
    let testContainer;
    let wildflower;

    beforeAll(async () => {
        await loadFramework();
    });

    beforeEach(() => {
        wildflower = window.wildflower;
        resetFramework();
        initContextSystem();

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

    it('should return correct value when conditional deps switch after promotion', async () => {
        // The bug scenario:
        // 1. Computed starts with useB=true, so deps are {useB, a, b} — c is NEVER accessed
        // 2. After promotion, node.deps = [useB, a, b]
        // 3. Switch useB=false → _updateNode runs fn() reading c, returns correct value
        //    BUT node.deps stays [useB, a, b] — c not tracked
        // 4. Direct evaluateComputed('result') after changing c:
        //    stale check sees [useB, a, b] — none changed → returns cached value (WRONG!)
        testContainer.innerHTML = `
            <div data-component="cond-dep-test">
                <span class="result" data-bind="result"></span>
            </div>
        `;

        wildflower.component('cond-dep-test', {
            state: {
                useB: true,
                a: 10,
                b: 20,
                c: 100
            },
            computed: {
                result() {
                    if (this.state.useB) {
                        return this.state.a + this.state.b;
                    } else {
                        return this.state.a + this.state.c;
                    }
                }
            }
        });

        await waitForCompleteRender();

        const component = testContainer.querySelector('[data-component="cond-dep-test"]');
        const componentId = component.dataset.componentId;
        const instance = wildflower.componentInstances.get(componentId);
        const rsm = instance.stateManager;

        // Initial: useB=true, a=10, b=20 → result=30
        expect(rsm.evaluateComputed('result')).toBe(30);

        // Force stability promotion via multiple evaluations
        instance.state.a = 11;
        await waitForCompleteRender();
        instance.state.a = 12;
        await waitForCompleteRender();
        instance.state.a = 10;
        await waitForCompleteRender();

        // Meadow has no STATIC/STABLE/DYNAMIC tier ladder and no _computedNodes;
        // it retracks deps on every evaluation, so the stale-baked-deps bug this
        // test guards against cannot occur. The behavioral assertions below (the
        // computed returns the correct value after the conditional branch + its
        // newly-relevant dep change) are what matter.

        // Switch useB=false → recompute calculates correct result with fresh deps
        instance.state.useB = false;
        await waitForCompleteRender();

        // After render, evaluateComputed works via cacheGen bypass
        expect(rsm.evaluateComputed('result')).toBe(110);

        // Now change c and call evaluateComputed DIRECTLY (bypass render cycle)
        // The proxy set trap handles state change synchronously
        instance.state.c = 200;

        // Call evaluateComputed synchronously BEFORE any render/cache clearing
        // The node fast path stale check uses wrong deps [useB, a, b]
        // and won't see c changed → returns stale 110
        const directResult = rsm.evaluateComputed('result');

        // BUG: returns 110 (stale) instead of 210 (correct)
        expect(directResult).toBe(210);
    });

    it('DYNAMIC computed reacts to new dep changes after condition stabilizes', async () => {
        // Edge case for DYNAMIC flag optimization:
        // 1. Computed reads cond ? a : b — gets promoted to STABLE with deps {cond, a}
        // 2. cond flips → _updateNode detects dep change, demotes to DYNAMIC
        // 3. cond stays false (stabilized) — computed now always reads b
        // 4. ONLY b changes (cond and a unchanged)
        // 5. Verify the computed returns the updated value
        //
        // This would fail if DYNAMIC demotion didn't work and the node
        // stayed STABLE with baked deps {cond, a} — it wouldn't see b change.
        testContainer.innerHTML = `
            <div data-component="dynamic-edge-test">
                <span class="result" data-bind="muxResult"></span>
            </div>
        `;

        wildflower.component('dynamic-edge-test', {
            state: {
                cond: true,
                a: 10,
                b: 20
            },
            computed: {
                muxResult() {
                    if (this.state.cond) {
                        return this.state.a * 2;
                    } else {
                        return this.state.b * 3;
                    }
                }
            }
        });

        await waitForCompleteRender();

        const component = testContainer.querySelector('[data-component="dynamic-edge-test"]');
        const componentId = component.dataset.componentId;
        const instance = wildflower.componentInstances.get(componentId);
        const rsm = instance.stateManager;

        // Initial: cond=true, a=10 → 20
        expect(rsm.evaluateComputed('muxResult')).toBe(20);

        // Force stability promotion: multiple evals with same dep shape
        instance.state.a = 11;
        await waitForCompleteRender();
        instance.state.a = 12;
        await waitForCompleteRender();
        instance.state.a = 10;
        await waitForCompleteRender();

        // (RSM promoted this computed to STABLE here; Meadow has no tier ladder.
        // What matters behaviorally is that flipping the condition re-tracks the
        // newly-relevant dependency, asserted below.)

        // Flip condition — deps change from {cond, a} to {cond, b}; the recompute
        // must re-track so the computed reacts to b.
        instance.state.cond = false;
        await waitForCompleteRender();
        expect(rsm.evaluateComputed('muxResult')).toBe(60); // b=20 * 3

        // NOW: condition stays false, only change b
        // This is the critical test — if dep tracking failed, the computed
        // would have baked deps {cond, a} and wouldn't see b changing
        instance.state.b = 30;
        const result = rsm.evaluateComputed('muxResult');
        expect(result).toBe(90); // b=30 * 3

        // Change b again to confirm ongoing reactivity
        instance.state.b = 50;
        await waitForCompleteRender();
        expect(rsm.evaluateComputed('muxResult')).toBe(150); // b=50 * 3
    });

    it('DYNAMIC computed handles repeated condition toggles correctly', async () => {
        // Stress test: toggle condition many times, verify correctness throughout
        testContainer.innerHTML = `
            <div data-component="toggle-stress-test">
                <span class="result" data-bind="muxResult"></span>
            </div>
        `;

        wildflower.component('toggle-stress-test', {
            state: {
                cond: true,
                a: 1,
                b: 100
            },
            computed: {
                muxResult() {
                    return this.state.cond ? this.state.a : this.state.b;
                }
            }
        });

        await waitForCompleteRender();

        const component = testContainer.querySelector('[data-component="toggle-stress-test"]');
        const componentId = component.dataset.componentId;
        const instance = wildflower.componentInstances.get(componentId);
        const rsm = instance.stateManager;

        // Force promotion + demotion cycle
        instance.state.a = 2;
        await waitForCompleteRender();
        instance.state.a = 3;
        await waitForCompleteRender();

        // Now toggle repeatedly and verify correctness at each step
        for (let i = 0; i < 10; i++) {
            instance.state.cond = !instance.state.cond;
            instance.state.a = i + 10;
            instance.state.b = (i + 1) * 100;

            const expected = instance.state.cond ? instance.state.a : instance.state.b;
            const actual = rsm.evaluateComputed('muxResult');
            expect(actual).toBe(expected);
        }

        // Final: change only the active dep (whichever branch is selected)
        const finalCond = instance.state.cond;
        if (finalCond) {
            instance.state.a = 999;
            expect(rsm.evaluateComputed('muxResult')).toBe(999);
        } else {
            instance.state.b = 999;
            expect(rsm.evaluateComputed('muxResult')).toBe(999);
        }
    });
});
