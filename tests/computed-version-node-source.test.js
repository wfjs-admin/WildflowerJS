/**
 * Targeted regression tests for the version-of-record of computed properties.
 *
 * The node-centric computed migration makes `node.version` the single
 * version-of-record for every computed (retiring the parallel
 * `_stateVersions[computed:*]` entries). The risky regime is an UNPROMOTED
 * computed->computed chain: a computed evaluated via the full path (not yet
 * promoted to the node fast path) whose value-change must still propagate to
 * its dependents. If computed-version tracking regresses, the failure mode is a
 * SILENT stale read, so these tests assert the chain tip after each mutation to
 * turn that into a hard failure.
 *
 * Black-box on purpose (value assertions only) so it runs unchanged across all
 * build variants including the minified ones.
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework } from './helpers/load-framework.js';

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

describe('Computed version-of-record (node-centric)', () => {
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

  it('propagates through a same-store computed->computed chain across repeated mutations', async () => {
    const s = wildflower.storeManager.createStoreComponent('cv-chain', {
      state: { n: 1 },
      computed: {
        c1() { return this.state.n * 2; },
        c2() { return this.computed.c1 + 10; },
        c3() { return this.computed.c2 * 3; },
      },
    });
    await waitForUpdate();

    // First read = unpromoted full-path eval of the whole chain.
    expect(s.stateManager.evaluateComputed('c3')).toBe((1 * 2 + 10) * 3); // 36

    // Each mutation+read must reflect the new base value. The early cycles run
    // before the chain promotes to the node fast path (the regime under test);
    // the repeated value (5,5) also exercises a no-change re-eval.
    for (const n of [2, 5, 5, 9, 0, 7]) {
      s.state.n = n;
      await waitForUpdate();
      expect(s.stateManager.evaluateComputed('c3')).toBe((n * 2 + 10) * 3);
    }
  });

  it('propagates through a DYNAMIC (never-stably-promoting) intermediate computed', async () => {
    // `mid` reads a different NUMBER of deps depending on useExtra, so its dep
    // count changes whenever useExtra toggles -> it does not stably promote to
    // the node fast path, keeping it on the full path for the toggling cycles.
    const s = wildflower.storeManager.createStoreComponent('cv-dyn', {
      state: { n: 0, useExtra: false, extra: 100 },
      computed: {
        mid() {
          let v = this.state.n;
          if (this.state.useExtra) v += this.state.extra;
          return v;
        },
        tip() { return this.computed.mid * 10; },
      },
    });
    await waitForUpdate();
    expect(s.stateManager.evaluateComputed('tip')).toBe(0);

    const cases = [
      { n: 3, useExtra: false }, // 30
      { n: 3, useExtra: true },  // (3+100)*10 = 1030  (dep-count change)
      { n: 4, useExtra: true },  // 1040               (stable count -> may promote)
      { n: 4, useExtra: false }, // 40                 (dep-count change back)
      { n: 7, useExtra: true },  // 1070
      { n: 7, useExtra: false }, // 70
    ];
    for (const c of cases) {
      s.state.n = c.n;
      s.state.useExtra = c.useExtra;
      await waitForUpdate();
      const expected = (c.useExtra ? c.n + 100 : c.n) * 10;
      expect(s.stateManager.evaluateComputed('tip')).toBe(expected);
    }
  });

  it('propagates a cross-store computed->computed chain across mutations', async () => {
    wildflower.storeManager.createStoreComponent('cv-base', {
      state: { value: 1 },
      computed: { doubled() { return this.state.value * 2; } },
    });
    wildflower.storeManager.createStoreComponent('cv-mid', {
      state: {},
      subscribe: { 'cv-base': ['doubled'] },
      computed: { plusTen() { return this.stores['cv-base'].doubled + 10; } },
    });
    const top = wildflower.storeManager.createStoreComponent('cv-top', {
      state: {},
      subscribe: { 'cv-mid': ['plusTen'] },
      computed: { tripled() { return this.stores['cv-mid'].plusTen * 3; } },
    });
    await waitForUpdate();

    const base = wildflower.getStore('cv-base');
    expect(top.stateManager.evaluateComputed('tripled')).toBe((1 * 2 + 10) * 3); // 36
    for (const v of [2, 2, 6, 0, 11]) {
      base.value = v;
      await waitForUpdate();
      expect(top.stateManager.evaluateComputed('tripled')).toBe((v * 2 + 10) * 3);
    }
  });

  it('reflects base changes when only the dependent is ever read (intermediate never read directly)', async () => {
    const s = wildflower.storeManager.createStoreComponent('cv-readfirst', {
      state: { n: 1 },
      computed: {
        a() { return this.state.n + 1; },
        b() { return this.computed.a * 2; }, // only `b` is ever read
      },
    });
    await waitForUpdate();
    expect(s.stateManager.evaluateComputed('b')).toBe((1 + 1) * 2); // 4
    for (const n of [10, 10, 3, 8]) {
      s.state.n = n;
      await waitForUpdate();
      expect(s.stateManager.evaluateComputed('b')).toBe((n + 1) * 2);
    }
  });
});
