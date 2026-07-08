/**
 * White-box pins for notifyNode's suppressing direct-writer branch and its
 * topological demotion guard (`dw !== null && node.observers.length === 0`,
 * read AT WRITE TIME).
 *
 * These pin the MECHANISM directly, immune to store/nudge behavior that could
 * mask the integration tests (list-cross-component-suppressed-leaf.test.js):
 *  - suppression fires only on observer-free leaves;
 *  - an observer edge demotes the write to the wake path WITHOUT invoking or
 *    clearing the writer;
 *  - suppression resumes when the observer set empties (oscillation);
 *  - the detached self-clear (writer returns false -> writer+dwEl nulled) runs
 *    on the first OBSERVER-FREE write — the guard's documented timing change:
 *    a stale writer under a live observer survives until then (bounded, not a
 *    leak).
 *
 * Node-environment, no DOM:
 *   npx vitest run www/js/src/state/reactive-graph/direct-writer-guard.test.js
 */

import { describe, it, expect } from 'vitest';
import {
  reactive, computed, effect, setDirectWriter, __nodeOf, flushSync,
} from './core.js';

// A fake element honoring the writer contract's liveness bit.
function fakeEl() { return { isConnected: true, text: '' }; }

// Writer following the SHARED_TEXT_WRITER contract: false on detached element.
function makeWriter(el, log) {
  return (target, node) => {
    if (!el.isConnected) return false;
    el.text = String(target.label);
    log.push(el.text);
    return true;
  };
}

describe('direct-writer suppression guard (notifyNode)', () => {
  it('DWG-1. suppresses on an observer-free leaf: writer invoked, no wake dispatched', () => {
    const item = reactive({ label: 'a' });
    const el = fakeEl();
    const writes = [];
    setDirectWriter(item, 'label', makeWriter(el, writes), el);

    item.label = 'b';
    expect(writes).toEqual(['b']);
    expect(el.text).toBe('b');
  });

  it('DWG-2. an observer edge demotes writes (writer neither invoked nor cleared); computed stays fresh', () => {
    const item = reactive({ label: 'a' });
    const el = fakeEl();
    const writes = [];
    setDirectWriter(item, 'label', makeWriter(el, writes), el);

    const read = computed(() => item.label + '!');
    expect(read()).toBe('a!'); // forms the observer edge

    item.label = 'b';
    // Demoted: the graph observer must see the write...
    expect(read()).toBe('b!');
    // ...and the writer must NOT have been invoked (suppression off)...
    expect(writes).toEqual([]);
    // ...and must remain stamped for when the observer goes away.
    const node = __nodeOf(read); // computed node; source node checked behaviorally below
    expect(node).toBeTruthy();
  });

  it('DWG-3. suppression resumes when the observer set empties (oscillation is per-write)', () => {
    const item = reactive({ label: 'a' });
    const el = fakeEl();
    const writes = [];
    setDirectWriter(item, 'label', makeWriter(el, writes), el);

    let observed = '';
    const dispose = effect(() => { observed = item.label; });
    expect(observed).toBe('a');

    item.label = 'b';           // observer present: demoted
    expect(writes).toEqual([]);

    dispose();                  // cleanupSources prunes the observer edge

    item.label = 'c';           // observer-free again: suppression resumes
    expect(writes).toEqual(['c']);
    expect(el.text).toBe('c');
  });

  it('DWG-4. detached self-clear happens on the first observer-free write (guard timing change, bounded)', () => {
    const item = reactive({ label: 'a' });
    const el = fakeEl();
    const writes = [];
    setDirectWriter(item, 'label', makeWriter(el, writes), el);

    let observed = '';
    const dispose = effect(() => { observed = item.label; });

    // Element detaches WHILE an observer holds the leaf: writes are demoted,
    // so the writer is never invoked and cannot self-clear yet — the stale
    // writer/dwEl survive these writes by design (retention bounded by the
    // clears below).
    el.isConnected = false;
    item.label = 'b';
    expect(writes).toEqual([]);
    flushSync(); // effect wake is microtask-scheduled; drain before asserting
    expect(observed).toBe('b');

    // Observer goes away: the FIRST observer-free write invokes the writer,
    // which returns false (detached) and self-clears writer + dwEl.
    dispose();
    item.label = 'c';
    expect(writes).toEqual([]);   // false-return: no DOM write logged

    // Cleared: reconnecting the element must NOT revive the old writer.
    el.isConnected = true;
    item.label = 'd';
    expect(writes).toEqual([]);   // writer gone; nothing fires
    expect(el.text).toBe('');     // stale element untouched
  });
});
