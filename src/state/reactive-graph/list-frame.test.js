/**
 * List tracking frame (P4-S5b): reads under a frame's observer partition into
 * sink stamps (owned item leaves) vs graph edges (shared deps) on a STABLE
 * effect whose edges survive its frozen re-runs.
 *
 * Node-environment, no DOM:
 *   npx vitest run www/js/src/state/reactive-graph/list-frame.test.js
 */

import { describe, it, expect } from 'vitest';
import {
  reactive, computed, effect, flushSync, toRaw,
  runInListFrame,
} from './core.js';

function makeFrame(observerNode, rows) {
  const stamps = [];
  return {
    observer: observerNode,
    stamped: stamps,
    owns(raw) { return rows.has(raw); },
    stamp(raw, key) { stamps.push([raw, key]); },
  };
}

describe('ReactiveGraph list frame', () => {
  it('partitions owned-leaf reads to stamps and shared reads to effect edges', () => {
    const item = reactive({ label: 'a', done: false });
    const shared = reactive({ theme: 'light' });
    const rows = new Set([toRaw(item)]);

    let wakes = 0;
    let first = true;
    const dispose = effect(() => { if (first) { first = false; return; } wakes++; }, { stable: true });
    const node = dispose.__node;
    const frame = makeFrame(node, rows);

    runInListFrame(node, frame, () => {
      void item.label;        // owned -> stamp, NO edge
      void shared.theme;      // shared -> edge to the effect
    });

    expect(frame.stamped.map(([, k]) => k)).toEqual(['label']);
    expect(node.sources.length).toBe(1);

    // Owned-leaf write must NOT wake the effect (no edge).
    item.label = 'b';
    flushSync();
    expect(wakes).toBe(0);

    // Shared write wakes it — and being STABLE, its edges survive the run.
    shared.theme = 'dark';
    flushSync();
    expect(wakes).toBe(1);
    expect(node.sources.length).toBe(1);

    // Still wired after the frozen re-run.
    shared.theme = 'blue';
    flushSync();
    expect(wakes).toBe(2);
    dispose();
  });

  it('dedupes shared edges across many frame applies', () => {
    const shared = reactive({ mode: 'x' });
    const rows = new Set();
    const dispose = effect(() => {}, { stable: true });
    const node = dispose.__node;
    const frame = makeFrame(node, rows);

    for (let i = 0; i < 5; i++) {
      runInListFrame(node, frame, () => { void shared.mode; });
    }
    expect(node.sources.length).toBe(1);
    dispose();
  });

  it('keeps computed dependency graphs intact under the frame (observer-identity guard)', () => {
    const item = reactive({ n: 2 });
    const rows = new Set([toRaw(item)]);
    // A real computed node reading the OWNED item: its own edges must form
    // normally (to the computed), not be stolen by the frame.
    const doubled = computed(() => item.n * 2);

    let wakes = 0;
    let first = true;
    const dispose = effect(() => { if (first) { first = false; return; } wakes++; }, { stable: true });
    const node = dispose.__node;
    const frame = makeFrame(node, rows);

    let seen;
    runInListFrame(node, frame, () => { seen = doubled(); });
    expect(seen).toBe(4);
    // Reading the computed's value under the frame links computed -> effect.
    expect(node.sources.length).toBe(1);
    // The direct item read happened INSIDE the computed's run: no frame stamp.
    expect(frame.stamped.length).toBe(0);

    // Item write invalidates the computed, which wakes the effect through the chain.
    item.n = 5;
    flushSync();
    expect(wakes).toBe(1);
    expect(doubled()).toBe(10);
    dispose();
  });

  it('appends NEW shared deps discovered by later frame applies (dep drift)', () => {
    const a = reactive({ v: 1 });
    const b = reactive({ v: 10 });
    const rows = new Set();
    let wakes = 0;
    let first = true;
    const dispose = effect(() => { if (first) { first = false; return; } wakes++; }, { stable: true });
    const node = dispose.__node;
    const frame = makeFrame(node, rows);

    runInListFrame(node, frame, () => { void a.v; });
    expect(node.sources.length).toBe(1);

    // Drift: a later apply reads b too.
    runInListFrame(node, frame, () => { void a.v; void b.v; });
    expect(node.sources.length).toBe(2);

    b.v = 11;
    flushSync();
    expect(wakes).toBe(1);
    dispose();
  });

  it('restores the previous frame and observer on exit (nesting-safe)', () => {
    const outer = reactive({ x: 1 });
    const dispose = effect(() => {}, { stable: true });
    const node = dispose.__node;
    const frame = makeFrame(node, new Set());

    runInListFrame(node, frame, () => {
      runInListFrame(node, frame, () => { void outer.x; });
      void outer.x; // dedupe: still one edge
    });
    expect(node.sources.length).toBe(1);

    // Outside any frame: plain effects track normally.
    const seen = [];
    const d2 = effect(() => { seen.push(outer.x); });
    outer.x = 2;
    flushSync();
    expect(seen).toEqual([1, 2]);
    d2();
    dispose();
  });
});
