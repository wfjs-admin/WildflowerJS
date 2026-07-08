/**
 * ReactiveGraph live integration: boot the REAL framework from source under jsdom
 * with the EntityHandle facade as the component reactive core, then render and
 * interact with an actual component end to end.
 *
 *   npx vitest run --config www/js/src/state/reactive-graph/vitest.integration.config.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { wildflower } from '../../index.full.js';
import { setStateManagerImpl } from '../createStateManager.js';
import { EntityHandle } from './entity-handle.js';

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('ReactiveGraph live integration (EntityHandle as component core)', () => {
  beforeAll(() => {
    // jsdom lacks the CSS global (real browsers have CSS.escape); the framework
    // guards with a regex fallback but needs CSS to exist. Real Chromium (the
    // 15-variant suite) has it natively.
    if (typeof globalThis.CSS === 'undefined') globalThis.CSS = {};

    setStateManagerImpl(EntityHandle);
    // No-op the background GC: in this jsdom source-boot its timer fires after a
    // test and walks component teardown (core-agnostic; crashes on the
    // feature-gated _activePortals), producing an unhandled error unrelated to
    // the assertions. Each scan re-arms it, so neutralize the method outright.
    wildflower.garbageCollect = () => {};
  });
  afterAll(() => { setStateManagerImpl(null); });

  it('renders a data-bind value and updates it on a data-action click', async () => {
    document.body.innerHTML = `
      <div data-component="m-counter">
        <span id="out" data-bind="count"></span>
        <button id="inc" data-action="increment">+</button>
      </div>`;

    wildflower.component('m-counter', {
      state: { count: 5 },
      increment() { this.count++; },
    });

    if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection();
    if (wildflower.scan) wildflower.scan(document.body);
    await wait();

    const out = document.getElementById('out');
    expect(out.textContent).toBe('5');

    document.getElementById('inc').click();
    await wait();
    expect(out.textContent).toBe('6');
  });

  // Computed bindings: getValue resolves a bare computed name to evaluateComputed
  // (the state proxy resolves bare computed names), which also links the render
  // effect for reactive updates.
  it('renders a computed binding and updates it reactively', async () => {
    document.body.innerHTML = `
      <div data-component="m-greeter">
        <span id="greet" data-bind="greeting"></span>
        <button id="setname" data-action="rename">rename</button>
      </div>`;
    wildflower.component('m-greeter', {
      state: { name: 'Ada' },
      computed: { greeting() { return 'Hi ' + this.name; } },
      rename() { this.name = 'Grace'; },
    });
    if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection();
    if (wildflower.scan) wildflower.scan(document.body);
    await wait();
    const g = document.getElementById('greet');
    expect(g.textContent).toBe('Hi Ada');
    document.getElementById('setname').click();
    await wait();
    expect(g.textContent).toBe('Hi Grace');
  });

  // data-list runs through the real ListRenderer -> EntityHandle.mapArray (the
  // keyed reconciler on the per-item mapFn path), rendering and reacting to a
  // structural mutation.
  it('renders a data-list and reacts to an append', async () => {
    document.body.innerHTML = `
      <div data-component="m-list">
        <ul id="ul" data-list="items">
          <template><li data-bind="label"></li></template>
        </ul>
        <button id="add" data-action="add">add</button>
      </div>`;
    wildflower.component('m-list', {
      state: { items: [{ id: 1, label: 'a' }, { id: 2, label: 'b' }] },
      add() { this.items.push({ id: 3, label: 'c' }); },
    });
    if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection();
    if (wildflower.scan) wildflower.scan(document.body);
    await wait();
    expect(Array.from(document.querySelectorAll('#ul li')).map((l) => l.textContent)).toEqual(['a', 'b']);

    document.getElementById('add').click();
    await wait();
    expect(Array.from(document.querySelectorAll('#ul li')).map((l) => l.textContent)).toEqual(['a', 'b', 'c']);
  });

  it('runs init() and reflects init-set state', async () => {
    document.body.innerHTML = `<div data-component="m-init"><span id="x" data-bind="value"></span></div>`;
    wildflower.component('m-init', {
      state: { value: 0 },
      init() { this.value = 42; },
    });
    if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection();
    if (wildflower.scan) wildflower.scan(document.body);
    await wait();
    expect(document.getElementById('x').textContent).toBe('42');
  });

  it('toggles data-show', async () => {
    document.body.innerHTML = `
      <div data-component="m-show">
        <div id="box" data-show="visible">hi</div>
        <button id="t" data-action="toggle">t</button>
      </div>`;
    wildflower.component('m-show', {
      state: { visible: true },
      toggle() { this.visible = !this.visible; },
    });
    if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection();
    if (wildflower.scan) wildflower.scan(document.body);
    await wait();
    const box = document.getElementById('box');
    expect(box.style.display).not.toBe('none');
    document.getElementById('t').click();
    await wait();
    expect(box.style.display).toBe('none');
  });

  it('renders and updates an expression binding', async () => {
    document.body.innerHTML = `
      <div data-component="m-expr">
        <span id="full" data-bind="first + ' ' + last"></span>
        <button id="ch" data-action="change">c</button>
      </div>`;
    wildflower.component('m-expr', {
      state: { first: 'Ada', last: 'L' },
      change() { this.first = 'Grace'; },
    });
    if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection();
    if (wildflower.scan) wildflower.scan(document.body);
    await wait();
    expect(document.getElementById('full').textContent).toBe('Ada L');
    document.getElementById('ch').click();
    await wait();
    expect(document.getElementById('full').textContent).toBe('Grace L');
  });

  it('syncs data-model from state to input and back', async () => {
    document.body.innerHTML = `
      <div data-component="m-model">
        <input id="inp" data-model="name">
        <span id="echo" data-bind="name"></span>
      </div>`;
    wildflower.component('m-model', { state: { name: 'x' } });
    if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection();
    if (wildflower.scan) wildflower.scan(document.body);
    await wait();
    const inp = document.getElementById('inp');
    expect(inp.value).toBe('x');
    inp.value = 'y';
    inp.dispatchEvent(new window.Event('input', { bubbles: true }));
    await wait();
    expect(document.getElementById('echo').textContent).toBe('y');
  });

  it('renders a nested data-list', async () => {
    document.body.innerHTML = `
      <div data-component="m-nested">
        <div id="root" data-list="groups">
          <template>
            <section class="grp">
              <h3 data-bind="name"></h3>
              <ul data-list="items"><template><li data-bind="t"></li></template></ul>
            </section>
          </template>
        </div>
      </div>`;
    wildflower.component('m-nested', {
      state: {
        groups: [
          { id: 1, name: 'G1', items: [{ id: 11, t: 'a' }, { id: 12, t: 'b' }] },
          { id: 2, name: 'G2', items: [{ id: 21, t: 'c' }] },
        ],
      },
    });
    if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection();
    if (wildflower.scan) wildflower.scan(document.body);
    await wait();
    const sections = document.querySelectorAll('#root .grp');
    expect(Array.from(sections).map((s) => s.querySelector('h3').textContent)).toEqual(['G1', 'G2']);
    const allItems = Array.from(sections).map((s) =>
      Array.from(s.querySelectorAll('li')).map((l) => l.textContent));
    expect(allItems).toEqual([['a', 'b'], ['c']]);
  });

  // Regression (docs-site bug): a data-list / data-bind whose expression is a
  // NESTED PATH ROOTED AT A COMPUTED (e.g. data-list="menu.catA",
  // data-bind="links.docs.label" where `menu`/`links` are computeds returning
  // objects). The _state proxy holds only real state (a bare computed is resolved
  // by getValue, not stored), so a nested path rooted at a computed must evaluate
  // the computed head and walk the remainder — the data-list + data-bind case this
  // test covers.
  it('resolves a nested path rooted at a computed (data-list + data-bind)', async () => {
    document.body.innerHTML = `
      <div data-component="m-nested-computed">
        <span id="lbl" data-bind="links.docs.label"></span>
        <ul id="a" data-list="menu.catA"><template><li data-bind="label"></li></template></ul>
        <ul id="b" data-list="menu.catB"><template><li data-bind="label"></li></template></ul>
      </div>`;
    wildflower.component('m-nested-computed', {
      state: {
        groups: {
          catA: [{ id: 'a1', label: 'A-one' }, { id: 'a2', label: 'A-two' }],
          catB: [{ id: 'b1', label: 'B-one' }],
        },
        nav: { docs: { label: 'Documentation' } },
      },
      computed: {
        menu() { return this.state.groups; },
        links() { return this.state.nav; },
      },
    });
    if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection();
    if (wildflower.scan) wildflower.scan(document.body);
    await wait();
    expect(document.getElementById('lbl').textContent).toBe('Documentation');
    expect(Array.from(document.querySelectorAll('#a li')).map((l) => l.textContent)).toEqual(['A-one', 'A-two']);
    expect(Array.from(document.querySelectorAll('#b li')).map((l) => l.textContent)).toEqual(['B-one']);
  });

  // Structural list mutations beyond append (splice removal, reverse). The
  // earlier blocker was NOT a notification-channel conflict: splice/reverse read
  // elements THROUGH the reactiveTree proxy (get returns a wrapped child) and
  // re-store them, which nested proxies in the raw array and corrupted the
  // path/NODES lookup (threw on a Symbol-keyed internal read, swallowed by
  // runNode). Fixed by unwrapping proxies on write in both set traps
  // (core.js), the standard Vue-toRaw / Solid-unwrap stance.
  it('removes and reorders data-list items', async () => {
    document.body.innerHTML = `
      <div data-component="m-ops">
        <ul id="ul" data-list="items">
          <template><li data-bind="label"></li></template>
        </ul>
        <button id="del" data-action="del">del</button>
        <button id="rev" data-action="rev">rev</button>
      </div>`;
    wildflower.component('m-ops', {
      state: { items: [{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 3, label: 'c' }] },
      del() { this.items.splice(1, 1); },
      rev() { this.items.reverse(); },
    });
    if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection();
    if (wildflower.scan) wildflower.scan(document.body);
    await wait();
    const read = () => Array.from(document.querySelectorAll('#ul li')).map((l) => l.textContent);
    expect(read()).toEqual(['a', 'b', 'c']);
    document.getElementById('del').click(); await wait();
    expect(read()).toEqual(['a', 'c']);
    document.getElementById('rev').click(); await wait();
    expect(read()).toEqual(['c', 'a']);
  });

  it('binds data-bind-class reactively', async () => {
    document.body.innerHTML = `
      <div data-component="m-class">
        <div id="box" data-bind-class="cls">x</div>
        <button id="ch" data-action="change">c</button>
      </div>`;
    wildflower.component('m-class', {
      state: { cls: 'active' },
      change() { this.cls = 'done'; },
    });
    if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection();
    if (wildflower.scan) wildflower.scan(document.body);
    await wait();
    const box = document.getElementById('box');
    expect(box.classList.contains('active')).toBe(true);
    document.getElementById('ch').click(); await wait();
    expect(box.classList.contains('done')).toBe(true);
    expect(box.classList.contains('active')).toBe(false);
  });

  // Cross-entity on ONE graph: a component computed reads a store value. Because
  // ReactiveGraph is a single global node graph, the component's render effect links the
  // store's leaf node directly on read, so a store mutation wakes the component
  // with no external() dependency bookkeeping. This is the headline cross-store
  // case.
  it('a component reactively reads a store value (cross-entity)', async () => {
    document.body.innerHTML = `
      <div data-component="m-store-reader">
        <span id="sv" data-bind="storeCount"></span>
      </div>`;
    wildflower.store('m-counter-store', {
      state: { count: 10 },
      increment() { this.count++; },
    });
    wildflower.component('m-store-reader', {
      state: {},
      computed: { storeCount() { return wildflower.getStore('m-counter-store').count; } },
    });
    if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection();
    if (wildflower.scan) wildflower.scan(document.body);
    await wait();
    const sv = document.getElementById('sv');
    expect(sv.textContent).toBe('10');
    // Mutate the store from OUTSIDE the component (no component action/render),
    // so a DOM update can only come from store -> component propagation.
    wildflower.getStore('m-counter-store').increment();
    await wait();
    expect(sv.textContent).toBe('11');
  });

  // The declarative store-read idiom: a data-bind expression using the $store
  // shorthand (ExpressionEvaluator rewrites $counterstore.count ->
  // external('counterstore', 'count')). This routes through the framework's
  // external() resolution rather than a hand-written getStore() call, exercising
  // more of the store-read surface.
  it('reacts to a store value via the $store expression binding', async () => {
    document.body.innerHTML = `
      <div data-component="m-dollar-reader">
        <span id="dv" data-bind="$counterstore.count"></span>
      </div>`;
    wildflower.store('counterstore', {
      state: { count: 7 },
      increment() { this.count++; },
    });
    wildflower.component('m-dollar-reader', { state: {} });
    if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection();
    if (wildflower.scan) wildflower.scan(document.body);
    await wait();
    const dv = document.getElementById('dv');
    expect(dv.textContent).toBe('7');
    // Drive the change from the store directly (not a component action).
    wildflower.getStore('counterstore').increment();
    await wait();
    expect(dv.textContent).toBe('8');
  });

  // Store-to-store: store B's computed reads store A's state. Exercises the
  // store-init eager-computed evaluation path (getComputedPropertyNames +
  // evaluateComputed) and a chained graph edge A.count -> B.total -> component.
  it('propagates a store-to-store computed chain to a component', async () => {
    document.body.innerHTML = `
      <div data-component="m-chain-reader">
        <span id="cv" data-bind="$storeB.total"></span>
      </div>`;
    wildflower.store('storeA', {
      state: { count: 3 },
      increment() { this.count++; },
    });
    wildflower.store('storeB', {
      state: { bonus: 100 },
      computed: { total() { return wildflower.getStore('storeA').count + this.bonus; } },
    });
    wildflower.component('m-chain-reader', { state: {} });
    if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection();
    if (wildflower.scan) wildflower.scan(document.body);
    await wait();
    const cv = document.getElementById('cv');
    expect(cv.textContent).toBe('103');
    wildflower.getStore('storeA').increment();
    await wait();
    expect(cv.textContent).toBe('104');
  });

  it('adds/removes DOM via data-render', async () => {
    document.body.innerHTML = `
      <div data-component="m-render">
        <div id="wrap">
          <p id="msg" data-render="show">hello</p>
        </div>
        <button id="t" data-action="toggle">t</button>
      </div>`;
    wildflower.component('m-render', {
      state: { show: true },
      toggle() { this.show = !this.show; },
    });
    if (wildflower._setupDynamicComponentDetection) wildflower._setupDynamicComponentDetection();
    if (wildflower.scan) wildflower.scan(document.body);
    await wait();
    expect(document.querySelectorAll('#wrap #msg').length).toBe(1);
    document.getElementById('t').click(); await wait();
    expect(document.querySelectorAll('#wrap #msg').length).toBe(0);
    document.getElementById('t').click(); await wait();
    expect(document.querySelectorAll('#wrap #msg').length).toBe(1);
  });
});

// Facade-level regressions from the 2026-07-02 review (gold-dot-02). These
// drive EntityHandle directly (no framework boot) because both need precise
// same-tick / eval-order control.
describe('EntityHandle facade regressions (review 2026-07-02)', () => {
  // RG-3: the deferred computed-notifier install (queueMicrotask) must skip
  // when the entity was destroyed in the same tick; otherwise it creates an
  // effect AFTER the destroy sweep already ran, and that orphan observes the
  // computed (and, transitively, any external store it reads) and re-fires
  // onStateChange against the dead entity on every later store mutation.
  it('skips the deferred notifier install after a same-tick destroy (RG-3)', async () => {
    const { reactiveTree } = await import('./core.js');
    const store = reactiveTree({ x: 1 }, () => {});
    const fired = [];
    const h = new EntityHandle({ onStateChange: (p, nv) => fired.push([p, nv]) });
    h.createState({});
    h.addComputed({ double() { return store.x * 2; } });
    h._ensureComputedNotifier('double'); // schedules the deferred install
    h.destroy();                          // destroy in the SAME tick
    await wait(0);                        // let the microtask drain
    expect(h._effects.size).toBe(0);      // no effect born after destroy
    fired.length = 0;
    store.x = 5;                          // external store mutates post-destroy
    await wait(0);
    expect(fired).toEqual([]);            // no orphan onStateChange pulse
  });

  // RG-4: circular-dependency detection must not destroy the computeds'
  // ability to recover. A conditional cycle (A reads x, and B only while x>0)
  // loses its edge to x when the re-entrant inner run trims the outer run's
  // partially-tracked sources, after which fixing x can never wake A.
  it('recovers a conditional circular dependency once the gating state breaks the cycle (RG-4)', async () => {
    const h = new EntityHandle({ onStateChange: () => {} });
    const state = h.createState({ x: 1 });
    h.addComputed({
      A() { return this.state.x > 0 ? h.evaluateComputed('B') + 1 : 0; },
      B() { return h.evaluateComputed('A') + 1; },
    }, { state });

    expect(h.evaluateComputed('A')).toBeUndefined(); // cycle active -> undefined
    state.x = 0;                                     // break the cycle
    await wait(0);
    expect(h.evaluateComputed('A')).toBe(0);         // recovered

    state.x = 3;                                     // re-form the cycle
    await wait(0);
    expect(h.evaluateComputed('A')).toBeUndefined(); // detected again
  });
});
