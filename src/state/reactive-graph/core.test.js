/**
 * Correctness tests for the ReactiveGraph standalone core.
 *
 * Pure-logic (no DOM), so these run under the default node environment:
 *   npx vitest run www/js/src/state/reactive-graph/core.test.js
 *
 * The bar these encode: graph-coloring is correct under
 * diamonds, deep chains, and dynamic deps; computeds cache; version moves only
 * on a real value change; avoidable propagation holds; batching coalesces;
 * disposal unwires. If these pass, the engine is sound and the benches decide
 * whether it is also fast enough.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  reactive, reactiveTree, computed, effect, batch, untrack, flushSync, __nodeOf,
  setListSink, discardScheduled, beginBatchScope,
} from './core.js';

describe('ReactiveGraph core — sources and effects', () => {
  it('runs an effect on creation and re-runs on a tracked change', () => {
    const s = reactive({ n: 1 });
    const seen = [];
    const dispose = effect(() => { seen.push(s.n); });
    expect(seen).toEqual([1]);          // immediate first run
    s.n = 2;
    flushSync();
    expect(seen).toEqual([1, 2]);
    dispose();
    s.n = 3;
    flushSync();
    expect(seen).toEqual([1, 2]);       // disposed: no further runs
  });

  it('does not re-run on a no-op write (Object.is guard)', () => {
    const s = reactive({ n: 1 });
    let runs = 0;
    effect(() => { runs += s.n * 0 + 1; });
    expect(runs).toBe(1);
    s.n = 1;                            // same value
    flushSync();
    expect(runs).toBe(1);
  });

  it('does not track or wake an unobserved leaf (zero-cost write)', () => {
    const s = reactive({ a: 1, b: 1 });
    let runs = 0;
    effect(() => { runs++; void s.a; }); // observes a, not b
    expect(runs).toBe(1);
    s.b = 99;                           // nobody observes b
    flushSync();
    expect(runs).toBe(1);
  });
});

describe('ReactiveGraph core — computeds', () => {
  it('caches: reading twice without a change does not recompute', () => {
    const s = reactive({ n: 2 });
    let evals = 0;
    const double = computed(() => { evals++; return s.n * 2; });
    expect(double()).toBe(4);
    expect(double()).toBe(4);
    expect(evals).toBe(1);              // second read is cached
    s.n = 5;
    expect(double()).toBe(10);
    expect(evals).toBe(2);
  });

  it('version moves only on a real value change (avoidable propagation)', () => {
    const s = reactive({ n: 4 });
    let downstreamEvals = 0;
    const isEven = computed(() => s.n % 2 === 0);   // boolean: stable across 4->6
    const label = computed(() => { downstreamEvals++; return isEven() ? 'even' : 'odd'; });
    expect(label()).toBe('even');
    expect(downstreamEvals).toBe(1);
    s.n = 6;                            // still even -> isEven value unchanged
    expect(label()).toBe('even');
    expect(downstreamEvals).toBe(1);    // label NOT recomputed: upstream value held
    s.n = 7;                            // now odd -> isEven flips
    expect(label()).toBe('odd');
    expect(downstreamEvals).toBe(2);
  });

  it('diamond: one source change recomputes the sink exactly once', () => {
    const s = reactive({ a: 1 });
    let sinkEvals = 0;
    const b = computed(() => s.a + 1);
    const c = computed(() => s.a + 10);
    const d = computed(() => { sinkEvals++; return b() + c(); });
    expect(d()).toBe(13);              // (1+1)+(1+10)
    expect(sinkEvals).toBe(1);
    s.a = 2;
    expect(d()).toBe(15);              // (2+1)+(2+10)
    expect(sinkEvals).toBe(2);         // exactly one recompute, not two
  });
});

describe('ReactiveGraph core — deep chain (the headline case)', () => {
  it('a 10-link chain recomputes O(depth), and a clean re-read is O(1)', () => {
    const s = reactive({ n: 0 });
    const evals = [];
    let prev = computed(() => { evals[0] = (evals[0] || 0) + 1; return s.n + 1; });
    const links = [prev];
    for (let i = 1; i < 10; i++) {
      const upstream = links[i - 1];
      const idx = i;
      const c = computed(() => { evals[idx] = (evals[idx] || 0) + 1; return upstream() + 1; });
      links.push(c);
    }
    const tail = links[9];
    expect(tail()).toBe(10);                         // 0 +1 ten times
    const afterFirst = evals.reduce((a, b) => a + b, 0);
    expect(afterFirst).toBe(10);                     // each link evaluated once

    tail();                                          // clean re-read
    const afterCleanRead = evals.reduce((a, b) => a + b, 0);
    expect(afterCleanRead).toBe(10);                 // O(1): NO recomputation

    s.n = 100;
    expect(tail()).toBe(110);
    const afterChange = evals.reduce((a, b) => a + b, 0);
    expect(afterChange).toBe(20);                    // exactly 10 more: O(depth), not O(depth^2)
  });
});

describe('ReactiveGraph core — dynamic dependencies', () => {
  it('drops a dependency that was not read this run', () => {
    const s = reactive({ useA: true, a: 1, b: 2 });
    let evals = 0;
    const pick = computed(() => { evals++; return s.useA ? s.a : s.b; });
    expect(pick()).toBe(1);
    expect(evals).toBe(1);
    s.b = 99;                                        // b not currently a dep
    expect(pick()).toBe(1);
    expect(evals).toBe(1);                           // unchanged: b was not tracked
    s.useA = false;                                  // now switch to reading b
    expect(pick()).toBe(99);
    expect(evals).toBe(2);
    s.a = 1000;                                      // a no longer a dep
    expect(pick()).toBe(99);
    expect(evals).toBe(2);                           // a's change is ignored now
  });
});

describe('ReactiveGraph core — batching and untrack', () => {
  it('batch coalesces multiple writes into one effect run', () => {
    const s = reactive({ x: 1, y: 1 });
    let runs = 0;
    effect(() => { runs++; void s.x; void s.y; });
    expect(runs).toBe(1);
    batch(() => { s.x = 2; s.y = 2; });
    expect(runs).toBe(2);                            // one combined re-run, not two
  });

  it('untrack reads without creating a dependency', () => {
    const s = reactive({ tracked: 1, hidden: 1 });
    let runs = 0;
    effect(() => { runs++; void s.tracked; untrack(() => { void s.hidden; }); });
    expect(runs).toBe(1);
    s.hidden = 5;
    flushSync();
    expect(runs).toBe(1);                            // hidden read was untracked
    s.tracked = 5;
    flushSync();
    expect(runs).toBe(2);
  });
});

describe('ReactiveGraph core — nested objects', () => {
  it('tracks deep reads through nested reactive proxies', () => {
    const s = reactive({ user: { name: 'a', addr: { city: 'x' } } });
    const seen = [];
    effect(() => { seen.push(s.user.addr.city); });
    expect(seen).toEqual(['x']);
    s.user.addr.city = 'y';
    flushSync();
    expect(seen).toEqual(['x', 'y']);
  });
});

describe('ReactiveGraph core — array structural mutations (proxy unwrap on write)', () => {
  // Splice/reverse/sort read elements THROUGH the proxy (get returns a wrapped
  // child) and re-store them. Without unwrap-on-write the raw array ends up
  // holding nested proxies; a subsequent read that walks an element's NODES map
  // (e.g. a reader doing items.map(x => x.id)) then throws "Cannot convert a
  // Symbol value to a string" on the path concat. Unwrap-on-write keeps the raw
  // graph proxy-free so these operations re-run readers cleanly.
  it('splice re-runs a reader with the right elements (no nested proxies)', () => {
    const s = reactiveTree({ items: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    const seen = [];
    effect(() => { seen.push(s.items.map((x) => x.id).join(',')); });
    expect(seen).toEqual(['1,2,3']);
    // The element proxy is identity-stable (one proxy per raw object). After a
    // splice relocates it, reading its new slot must return the SAME proxy — if
    // a wrapped proxy had been stored back into the raw array, the relocated
    // slot would double-wrap and yield a different identity. This pins the
    // unwrap-on-write invariant specifically (not just the no-throw symptom).
    const pc = s.items[2];
    s.items.splice(1, 1);
    flushSync();
    expect(seen).toEqual(['1,2,3', '1,3']);
    expect(s.items[1]).toBe(pc);
  });

  it('reverse re-runs a reader in the new order', () => {
    const s = reactiveTree({ items: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    const seen = [];
    effect(() => { seen.push(s.items.map((x) => x.id).join(',')); });
    s.items.reverse();
    flushSync();
    expect(seen[seen.length - 1]).toBe('3,2,1');
  });

  it('unwrap-on-write also holds for the bench reactive() proxy', () => {
    const s = reactive({ items: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    const seen = [];
    effect(() => { seen.push(s.items.map((x) => x.id).join(',')); });
    s.items.splice(0, 1);
    flushSync();
    expect(seen[seen.length - 1]).toBe('2,3');
  });
});

describe('ReactiveGraph core — listSink throw resilience', () => {
  it('a throwing listSink still wakes observers', () => {
    const s = reactive({ n: 1 });
    let runs = 0;
    const c = computed(() => { runs++; return s.n * 2; });
    expect(c()).toBe(2);            // establish the leaf -> computed edge
    expect(runs).toBe(1);

    // A listSink that throws (e.g. a row class/style evaluator blowing up).
    setListSink(s, 'n', () => { throw new Error('boom'); });

    // The write applies the raw value, then notifyNode runs the sink which
    // throws. The throw must still propagate (the app is already erroring)...
    expect(() => { s.n = 5; }).toThrow('boom');

    // ...but the leaf's version/observer wake must NOT be skipped: a shared
    // computed must see the new value on its next pull, not a stale cache.
    expect(c()).toBe(10);
    expect(runs).toBe(2);
  });
});

describe('ReactiveGraph core — batch-scoped discard', () => {
  it('discardScheduled preserves effects queued before the batch scope', () => {
    const sA = reactive({ n: 1 });
    const sB = reactive({ n: 1 });
    let aRuns = 0, bRuns = 0;
    effect(() => { aRuns++; void sA.n; });
    effect(() => { bRuns++; void sB.n; });
    expect(aRuns).toBe(1);
    expect(bRuns).toBe(1);

    sA.n = 2;             // pre-batch work: schedules A
    beginBatchScope();    // batch opens here
    sB.n = 2;             // in-batch work: schedules B
    discardScheduled();   // cancelBatch: drop B, keep A
    flushSync();

    expect(aRuns).toBe(2); // pre-batch effect still ran
    expect(bRuns).toBe(1); // cancelled batch effect did not
  });

  it('discardScheduled with no open scope clears the whole queue (legacy)', () => {
    const s = reactive({ n: 1 });
    let runs = 0;
    effect(() => { runs++; void s.n; });
    expect(runs).toBe(1);
    s.n = 2;
    discardScheduled();   // no beginBatchScope -> global clear
    flushSync();
    expect(runs).toBe(1); // dropped
  });

  // RG-6 (review 2026-07-02, Chris decision: option 2, evaluate-then-quiesce):
  // cancelBatch keeps the batch's state writes but drops its renders. The
  // dropped effects' computeds must NOT be left CLEAN on their pre-batch
  // cached values; a post-cancel synchronous read has to be consistent with
  // the persisted state. The renders stay cancelled and future writes still
  // re-mark and re-schedule normally.
  it('discardScheduled leaves computeds fresh against persisted state (RG-6)', () => {
    const s = reactive({ n: 1 });
    const c = computed(() => s.n * 2);
    let runs = 0;
    effect(() => { runs++; void c(); });
    expect(runs).toBe(1);
    expect(c()).toBe(2);

    beginBatchScope();
    s.n = 5;              // batch write: persists per the cancelBatch contract
    discardScheduled();   // cancel: render dropped...
    flushSync();
    expect(runs).toBe(1); // ...so the effect did NOT run
    expect(c()).toBe(10); // but a sync read reflects the persisted state

    s.n = 6;              // future write still re-marks and re-schedules
    flushSync();
    expect(runs).toBe(2);
    expect(c()).toBe(12);
  });

  // RG-7 (review 2026-07-02): when the batch's writes hit only nodes whose
  // effects were ALREADY queued pre-batch (lever-1 dedup pushes nothing new),
  // the boundary equals queue.length. That must mean "keep everything, drop
  // the (empty) suffix", not collapse to a whole-queue clear that drops the
  // pre-batch renders.
  it('discardScheduled keeps pre-batch effects when the batch schedules nothing new (RG-7)', () => {
    const s = reactive({ n: 1 });
    let runs = 0;
    effect(() => { runs++; void s.n; });
    expect(runs).toBe(1);
    s.n = 2;              // pre-batch work: effect queued
    beginBatchScope();    // boundary === queue.length
    s.n = 3;              // in-batch write to the same node: dedup, nothing new queued
    discardScheduled();   // cancel must preserve the pre-batch render
    flushSync();
    expect(runs).toBe(2); // pre-batch effect still ran (sees persisted state)
  });
});

describe('ReactiveGraph core — frozen (stable) row effects', () => {
  it('a stable effect re-runs on first-run deps and freezes its edge set', () => {
    const s = reactive({ n: 1 });
    let runs = 0;
    const dispose = effect(() => { runs++; void s.n; }, { stable: true });
    const node = __nodeOf(dispose);
    const edgeCountAfterFirst = node.sources.length;
    expect(runs).toBe(1);
    s.n = 2;
    flushSync();
    expect(runs).toBe(2);                            // existing edge still wakes it
    expect(node.sources.length).toBe(edgeCountAfterFirst); // edges frozen, no churn
  });
});
