/**
 * Tripwire for EXTERNAL computed-cache invalidation — the contract that Step 3's
 * storage-less `computedCache` facade must preserve.
 *
 * `stateManager.computedCache.clear()` and `.delete(name)` are called by the
 * entity / list-rendering / error / store systems to force a cached computed to
 * re-evaluate when its value changed through a path the normal reactive version
 * tracking can't see (e.g. a raw, non-proxied mutation). After Step 3 there is no
 * backing Map — `.clear()` bumps the generation counter and `.delete()` marks the
 * node dirty — so this asserts the observable contract survives that change.
 *
 * Pokes the internal `computedCache` handle (a mangled property), so it skips on
 * minified builds; the facade's behavior on min builds is exercised by the
 * entity/list/store suites that trigger the real invalidators with consistent
 * mangling.
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js';

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

describe('External computed-cache invalidation (facade contract)', () => {
  let wildflower;

  beforeAll(async () => {
    await loadFramework();
  });

  beforeEach(() => {
    wildflower = window.wildflower;
    resetFramework();
    if (wildflower._initContextSystem) {
      wildflower._contextSystemInitialized = false;
      wildflower._initContextSystem();
    }
  });

  it.skipIf(isMinifiedBuild())('clear() forces re-eval of a cached computed reading non-reactive data', async () => {
    // `ext` is plain (non-reactive). The computed also reads state.tick so it has
    // a real dependency and therefore caches (a dep-less computed is always stale).
    const ext = { v: 1 };
    const s = wildflower.storeManager.createStoreComponent('inv-clear', {
      state: { tick: 0 },
      computed: { reads() { return ext.v + this.state.tick; } },
    });
    await waitForUpdate();
    const sm = s.stateManager;

    expect(sm.evaluateComputed('reads')).toBe(1);   // evaluated + cached
    ext.v = 2;                                       // non-reactive change -> no version bump
    expect(sm.evaluateComputed('reads')).toBe(1);    // correctly still cached
    sm.computedCache.clear();                         // external invalidation (all)
    expect(sm.evaluateComputed('reads')).toBe(2);    // must re-evaluate
  });

  it.skipIf(isMinifiedBuild())('delete(name) forces re-eval of that computed (after promotion to the node fast path)', async () => {
    const ext = { v: 10 };
    const s = wildflower.storeManager.createStoreComponent('inv-del', {
      state: { tick: 0 },
      computed: { reads() { return ext.v + this.state.tick; } },
    });
    await waitForUpdate();
    const sm = s.stateManager;

    // Repeated reads promote the computed to the STABLE node fast path.
    for (let i = 0; i < 5; i++) expect(sm.evaluateComputed('reads')).toBe(10);
    ext.v = 20;                                       // non-reactive change
    expect(sm.evaluateComputed('reads')).toBe(10);    // still cached
    sm.computedCache.delete('reads');                 // external invalidation (targeted)
    expect(sm.evaluateComputed('reads')).toBe(20);    // must re-evaluate
  });

  it.skipIf(isMinifiedBuild())('normal reactive updates still work alongside external invalidation', async () => {
    const ext = { v: 100 };
    const s = wildflower.storeManager.createStoreComponent('inv-mixed', {
      state: { tick: 0 },
      computed: { reads() { return ext.v + this.state.tick; } },
    });
    await waitForUpdate();
    const sm = s.stateManager;

    expect(sm.evaluateComputed('reads')).toBe(100);
    s.state.tick = 5;                                 // reactive change -> normal re-eval
    await waitForUpdate();
    expect(sm.evaluateComputed('reads')).toBe(105);
    ext.v = 200;                                      // non-reactive
    sm.computedCache.clear();                          // explicit invalidation
    expect(sm.evaluateComputed('reads')).toBe(205);   // sees both
  });
});
