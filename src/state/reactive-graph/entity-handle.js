/**
 * EntityHandle: the state-manager implementation, backing every entity
 * (component, store, plugin) with the ReactiveGraph core.
 *
 * It exposes the state-manager surface the framework binds against: createState,
 * getValue, setValue, addComputed, evaluateComputed, the `computed` map,
 * computedCache, createEffect (+ dispose._effect), untrack, batch coalescing,
 * onStateChange for scalar + nested-scalar leaf paths, mapArray (the keyed list
 * diff), the direct-writer / single-text fast paths, item-effect index wake, the
 * array operation-hint channel, computed:NAME + array-length onStateChange
 * pulses, and the cross-entity dependency wake paths.
 */

import {
  reactiveTree, computed as mComputed, effect as mEffect,
  refresh as mRefresh, setDirectWriter as mSetDirectWriter,
  setListSink as mSetListSink,
  setListOwner as mSetListOwner,
  runInListFrame as mRunInListFrame,
  toRaw as mToRaw, runEffect as mRunEffect,
  reactive as mReactive,
  untrack as mUntrack,
  setFlushObserver as mSetFlushObserver,
  __setDevHotReadReporter as mSetDevHotReadReporter,
  COMPUTED_MISS,
  F_REENTERED,
} from './core.js';
import { wfError, WF_ERRORS, COMPUTED_EVAL } from '../../core/wfUtils.js';
import { recording as __tlOn, timelineNoteFlush as __tlFlush } from '../TimelineRecorder.js';
import { reconcile } from './list-reconciler.js';

// DevTools timeline wiring (dev-only). The core is clean-room, so the facade is
// where the engine's per-drain flush count meets the timeline recorder: feed
// every drain's node count through when recording is engaged. In production
// __DEV__ folds false, this registration strips, and the TimelineRecorder import
// goes unused and tree-shakes out.
if (__DEV__) {
  mSetFlushObserver((n) => { if (__tlOn) __tlFlush(n); });
  // WF-216 (sealing row 6): the core detects sustained hot-loop facade reads
  // but is clean-room, so the structured warning is emitted from here.
  mSetDevHotReadReporter((key, perFrame) => {
    wfError(WF_ERRORS.HOT_LOOP_FACADE_READS, {
      warn: true,
      context: `state '${key}' is being read ~${perFrame} times per frame through the reactive facade, sustained across frames`,
      suggestion: `A facade read costs ~100x a plain property read (proxy physics; every fine-grained framework pays it). In per-frame loops, hoist the value to a local before the loop (const ${key} = this.state.${key}) and read the local; for per-entity hot data, use pool entities (plain objects, zero proxy cost).`
    });
  });
}

const NO_VALUE = Symbol('no-value');

// Sentinel VALUE for a computed whose body threw. An errored computed caches
// this sentinel as the node's value and returns undefined to readers (never
// re-throws out of evaluateComputed): the throw is caught at the computed-fn
// boundary and this sentinel becomes the node's value. Because it is a stable
// identity, a valid->ERRORED transition is a real value
// change that wakes observers (so a binding re-renders off its stale value),
// while staying ERRORED is a no-op (Object.is). Every read path translates it
// back to undefined at the facade boundary, so the sentinel never leaks.
const COMPUTED_ERROR = Symbol('reactive-graph.computed.error');

// Minimal dot-path resolver (mirrors pathResolver.get semantics for reads).
function getPath(root, path) {
  if (!path) return root;
  // Fast path: a flat identifier (no nesting, no index), the overwhelmingly
  // common case (e.g. 'rows', 'selectedId'). Skips the regex + split + array
  // allocation that the general path below pays on every call.
  if (path.indexOf('.') === -1 && path.indexOf('[') === -1) {
    return root == null ? undefined : root[path];
  }
  const parts = path.replace(/\[(\d+)]/g, '.$1').split('.');
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

class EntityHandle {
  constructor(options = {}) {
    this.onStateChange = options.onStateChange || (() => {});
    this.component = options.component || null;
    this._wf = options.wf || null;

    // Persistence (storageKey/autoSave): same surface the framework exposes. Load
    // happens in createState (before init); autoSave fires from the notify path
    // so it covers nested + array mutations through the single central point.
    this.storageKey = options.storageKey || null;
    this.autoSave = options.autoSave || false;

    this.computed = {};            // name -> bound fn (enumerable map; contract)
    this._getters = {};            // name -> ReactiveGraph computed getter
    this._effects = new Set();
    // Set by destroy() when the owning component is torn down. Guards the
    // deferred computed-notifier install (a queueMicrotask) against firing after
    // the destroy sweep has already run, which would otherwise create a fresh,
    // untracked effect that outlives the entity.
    this._destroyed = false;
    // Per-computed notifier gating. The notifier mEffect (installed in
    // _installComputedNotifier) only exists to feed the `computed:NAME`
    // onStateChange pulse, which is consumed solely by local `watch:` handlers
    // (_executeWatchers) and imperative `context.subscribe('computed:NAME')`
    // subscriptions. It is also an OBSERVER of the computed, so installing it
    // forces that computed to recompute eagerly on every flush even when no
    // binding reads it: pure overhead for unobserved computeds. So install it
    // lazily: only for computeds whose name was recorded via
    // _ensureComputedNotifier (a watcher/subscription on that name) or when
    // _observeAllComputeds is set (a `*` wildcard watcher / subscribe-all).
    // _notifierInstalled dedupes the install so each notifier exists once.
    this._observedComputeds = new Set();
    this._observeAllComputeds = false;
    this._notifierInstalled = new Set();
    // Circular-dependency detection (state-manager surface). the core has no
    // re-entrancy guard: a true computed cycle would recurse to a stack
    // overflow, so the addComputed wrapper tracks the active evaluation chain
    // in _evalStack and records any re-entered name here. isCircularDependency()
    // reads this; _warnedCircular dedupes the one-per-cycle warning.
    this._circularDependencies = new Set();
    this._evalStack = [];
    this._warnedCircular = new Set();
    // Cycle-poison marker for the CURRENT computed evaluation frame: set by
    // evaluateComputed when this frame consumes a cycle-flagged computed's
    // sentinel (cached or fresh). The wrapper saves/restores it per frame and
    // its post-eval check converts a poisoned result to the sentinel, keeping
    // cycle members stable even when they no longer nest (cached partners).
    this._cyclePoisoned = false;
    // State-version counter (state-manager surface). ListRenderer's buildComponentState()
    // caches the per-item component-state snapshot keyed on this; bumped on every
    // state write in createState's notify so the cache invalidates.
    this._globalEpoch = 0;
    // Async computeds (v1.5): name -> per-computed async control record,
    // created lazily on the first thenable return (see _createAsyncComputed).
    // null for entities that never go async, so they pay nothing.
    this._asyncComputeds = null;
    this._raw = {};
    this._state = null;

    // computedCache facade: clear()/delete() match the framework's storage-less facade.
    const self = this;
    this.computedCache = {
      clear() { for (const k in self._getters) self._invalidate(k); },
      delete(name) { self._invalidate(name); },
    };
  }

  createState(initialState = {}) {
    this._raw = this._clone(initialState);
    // Root-level computed bridge resolver (framework parity): a read of a key that is
    // not a state property but IS a registered computed resolves the computed,
    // so `this.state.<computedName>` works (the state proxy resolves absent keys
    // to computeds).
    // Returns the COMPUTED_MISS sentinel for non-computed keys so the tree falls
    // through to normal state resolution.
    const computedResolver = (key) =>
      this._getters[key] ? this.evaluateComputed(key) : COMPUTED_MISS;
    this._state = reactiveTree(this._raw, (path, nv, ov) => {
      this.onStateChange(path, nv, ov);
      if (this.autoSave && this.storageKey) this._saveToStorage();
      // Bump the state-version counter. ListRenderer's buildComponentState()
      // caches the merged per-item component-state snapshot keyed on
      // sm._globalEpoch and only rebuilds when it changes. Without the bump it
      // stays 0, so a woken row effect re-runs but re-reads the STALE snapshot
      // (the old component-state value) and a style/class never updates.
      this._globalEpoch++;
      // NB: no broadcast to per-item effects on an own-state write. A row binding
      // that reads component state already forms a real graph edge to it:
      //   - class bindings → the component refresh effect (ListRenderer reads
      //     instance.state[dep] under the effect; O(2) key-matched class refresh);
      //   - style/attr/show/text bindings → the per-item effect's
      //     touchComponentLevel (reads instance.state[v] under the effect on first
      //     run, registering the edge);
      //   - item-data writes (items.5.label) → the per-item effect's own
      //     itemProxy read.
      // So the changed node's graph observers ARE the exact effects that must
      // re-run; an unconditional _dirtyAllItemEffects() here re-ran ALL N rows on
      // every write (the whole cost of select, and the collateral tax on update)
      // for zero correctness benefit. Cross-entity wakes (a row's item-level
      // computed reading an EXTERNAL store, which the graph can't see) still
      // broadcast via EntitySystem._handleEntityStateChange (that path is real).
      // DEV-only runtime type-mismatch warning (framework parity). _checkTypeMatch and
      // the per-instance _types map are SHARED framework code; the framework calls it
      // from its proxy SET trap (ProxyHandlers ~:523), but ReactiveGraph's reactiveTree
      // SET didn't, so the warning never fired on ReactiveGraph. Top-level props only
      // (mirrors the framework's `!path` gate: a single-segment ReactiveGraph path). __DEV__-
      // gated so it's stripped from production exactly like the framework call site.
      if (__DEV__ && this._wf && this._wf._checkTypeMatch && this.component && this.component.id
          && typeof path === 'string' && path.indexOf('.') === -1) {
        const fullInstance = this._wf.componentInstances && this._wf.componentInstances.get(this.component.id);
        if (fullInstance) this._wf._checkTypeMatch(fullInstance, path, nv);
      }
    }, computedResolver);
    if (this.storageKey) this._loadFromStorage();
    return this._state;
  }

  // Hydrate state from localStorage over the initial state. Called in
  // createState so stored values are present before init() runs.
  _loadFromStorage() {
    if (!this.storageKey || typeof localStorage === 'undefined') return;
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) this.updateState(JSON.parse(stored));
    } catch (_) { /* corrupt/unreadable storage: keep initial state */ }
  }

  // Serialize the raw state tree (plain values: the set traps unwrap proxies
  // on write, so _raw never holds a proxy) to localStorage.
  _saveToStorage() {
    if (!this.storageKey || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this._raw));
    } catch (_) { /* quota or unserializable value: drop the save */ }
  }

  // Cycle-safe deep clone (matches the framework's objectUtils.deepClone). DOM nodes
  // pass by reference; a `seen` map records each clone BEFORE recursing so a
  // self- or back-reference resolves to the in-progress clone instead of
  // recursing forever (self-referential state, parent-pointing list items, etc.).
  _clone(v, seen) {
    if (v === null || typeof v !== 'object') return v;
    if (typeof Node !== 'undefined' && v instanceof Node) return v;
    if (!seen) seen = new WeakMap();
    if (seen.has(v)) return seen.get(v);
    const out = Array.isArray(v) ? [] : {};
    seen.set(v, out);
    for (const k in v) {
      if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = this._clone(v[k], seen);
    }
    return out;
  }

  // White-box helper the test suite uses to wrap an arbitrary array/object in a
  // reactive proxy and then drive mapArray over it (the framework exposes the same
  // entry). On ReactiveGraph this is just a notify-free reactiveTree: mapArray reacts
  // through graph edges, not the onStateChange pulse, so a standalone proxy that
  // is not the entity's main state needs no pulse channel. `path` is accepted
  // for signature compatibility but unused: ReactiveGraph builds paths from the
  // tree root, not a caller-supplied prefix.
  _createObjectProxy(target, _path) {
    return reactiveTree(target, () => {});
  }

  getValue(path) {
    if (!path) return this._clone(this._raw);
    if (path.startsWith('computed:')) {
      const sub = path.slice(9);
      const v = this._readComputedRooted(sub);
      return v === NO_VALUE ? this.evaluateComputed(sub) : v;
    }
    if (path.startsWith('props.')) {
      const id = this.component && this.component.id;
      if (id && this._wf) {
        const inst = this._wf.componentInstances.get(id);
        if (inst && inst.props) return getPath(inst.props, path.slice(6));
      }
      return undefined;
    }
    // A bare computed name OR a nested path whose head segment is a computed
    // (e.g. data-list="menuItems.advanced") resolves through evaluateComputed,
    // matching the framework state proxy (whose get trap returns the computed value
    // for a computed key). Routing through evaluateComputed also links the
    // reading effect to the computed node so the binding updates reactively.
    // ReactiveGraph's _state proxy holds only real state, so the computed head must be
    // resolved here rather than falling through to a plain getPath that misses.
    const v = this._readComputedRooted(path);
    if (v !== NO_VALUE) return v;
    // Read through the reactive proxy so reads inside effects/computeds track.
    return getPath(this._state, path);
  }

  // Resolve a path rooted at a registered computed: evaluate the computed head
  // (linking the reading effect), then walk any remaining segments. Returns the
  // NO_VALUE sentinel when the head segment is not a computed, so callers fall
  // back to a plain state read.
  _readComputedRooted(path) {
    const dot = path.indexOf('.');
    const head = dot > 0 ? path.slice(0, dot) : path;
    if (!this._getters[head]) return NO_VALUE;
    const base = this.evaluateComputed(head);
    if (dot < 0) return base;
    return base == null ? undefined : getPath(base, path.slice(dot + 1));
  }

  setValue(path, value) {
    const normalized = path.replace(/\[(\d+)]/g, '.$1');
    const parts = normalized.split('.');
    const last = parts.pop();
    let cur = this._state;
    for (const part of parts) {
      if (part === '') return false;
      if (cur[part] === undefined || cur[part] === null) cur[part] = {};
      cur = cur[part];
      if (typeof cur !== 'object' || cur === null) return false;
    }
    if (!Object.is(cur[last], value)) {
      cur[last] = value; // routes through the reactiveTree SET trap -> onStateChange
      return true;
    }
    return false;
  }

  updateState(newState) {
    if (!newState || typeof newState !== 'object') return;
    for (const k in newState) this.setValue(k, newState[k]);
  }

  addComputed(computedProps, componentContext = null) {
    if (!computedProps || typeof computedProps !== 'object') return this;
    const self = this;
    const ctx = componentContext || {
      state: this._state,
      computed: new Proxy({}, {
        get: (_t, prop) => (typeof prop === 'string' ? self.evaluateComputed(prop) : undefined),
      }),
    };

    for (const name in computedProps) {
      const fn = computedProps[name];
      if (typeof fn !== 'function') continue;
      const bound = fn.bind(ctx);
      this.computed[name] = bound;
      // Assigned right after mComputed returns; the wrapper body only runs on
      // evaluation (computeds are lazy), by which time it is set.
      let selfNode = null;
      // Async control record for this computed (v1.5). Stays null until the
      // body first returns a thenable, so sync computeds pay one null check.
      let asyncCtl = null;
      const getter = mComputed(() => {
        // Circular-dependency guard. The core has no throwing re-entrancy guard,
        // so a computed that (directly or transitively) reads itself would
        // recurse until the JS stack overflows. Detection: a cycle necessarily
        // re-enters runNode for a node that is still F_RUNNING; the core marks
        // that node F_REENTERED (rare path), and this wrapper's entry tests one
        // bit instead of scanning the eval stack on every evaluation. The
        // O(depth) indexOf moves INSIDE the detection branch, where it recovers
        // the full chain for member flagging and the WF-202 message — identical
        // semantics to the legacy scan, paid once per bug instead of per eval.
        if (selfNode !== null && (selfNode.flags & F_REENTERED) !== 0) {
          selfNode.flags &= ~F_REENTERED;
          const stackHit = this._evalStack.indexOf(name);
          // Flag EVERY member of the active cycle, not just the re-entered
          // name: the frames from the first occurrence of `name` to the top of
          // the stack are exactly the loop (A -> B -> A flags both A and B).
          // The cycle-poison propagation in evaluateComputed relies on every
          // member being flagged, so a member whose partner is merely CACHED
          // on the sentinel still detects that it is consuming a cycle.
          // stackHit is always >= 0 here in practice (the outer frame of the
          // re-entered computed pushed `name` before recursing); guard anyway so
          // a defensive flag-only detection still flags the entry point.
          for (let i = (stackHit === -1 ? this._evalStack.length : stackHit); i < this._evalStack.length; i++) {
            this._circularDependencies.add(this._evalStack[i]);
          }
          this._circularDependencies.add(name);
          if (!this._warnedCircular.has(name)) {
            this._warnedCircular.add(name);
            wfError(WF_ERRORS.CIRCULAR_DEPENDENCY, {
              context: [...this._evalStack, name].join(' → '),
              suggestion: 'Refactor computed properties to break the circular chain'
            });
          }
          // THROW (don't return a sentinel) so the cycle aborts the enclosing
          // computed's body BEFORE its arithmetic runs: the parent's wrapper
          // catch converts this to COMPUTED_ERROR, which surfaces as undefined
          // (framework parity: a circular read yields undefined, not NaN). The throw
          // is raised outside the try below so this frame doesn't catch its own
          // cycle signal; the core's runNode stores it as node.error and the
          // getter re-throws it to the parent body.
          const err = new Error('Circular dependency detected: ' + name);
          err.isCircularDependency = true;
          throw err;
        }
        // Async computed fast branches (v1.5). Placed AFTER the cycle guard (a
        // cycle throw wins over any pending async state) and BEFORE the
        // eval-stack / tracking-context bookkeeping, which exists only for runs
        // that invoke user code — these branches never do.
        if (asyncCtl !== null && asyncCtl.state !== 0) {
          if (asyncCtl.relaunch) {
            // A KNOWN input-value change (the props refresh path)
            // arrived while a request was in flight or settled-unconsumed.
            // The in-flight/settled value was computed from superseded
            // inputs: discard it and fall through to re-run the body against
            // the new values. The new run's generation bump discards any
            // continuation still in flight (last call wins). Checked BEFORE
            // the consume branch on purpose: a settled-but-unconsumed result
            // must not beat the newer input.
            asyncCtl.relaunch = false;
            asyncCtl.forced = false;
            asyncCtl.state = 0;
            asyncCtl.value = undefined;
          } else if (asyncCtl.state === 2) {
            // A settled result is waiting: consume it exactly once, WITHOUT
            // re-invoking the body (resolution must not re-fire the request).
            // Fast-forward the edge-reuse cursor so runNode's post-run trim
            // keeps every edge the launch run tracked (body deps + cell) — a
            // later real-dependency change must still wake this computed.
            const settled = asyncCtl.value;
            asyncCtl.state = 0;
            asyncCtl.value = undefined;
            selfNode._depIndex = selfNode.sources.length;
            return settled;
          } else if (asyncCtl.forced) {
            // state === 1: a request is in flight. A recompute forced from
            // OUTSIDE the graph (scheduleComputedEvaluation store nudges,
            // computedCache clears — flagged by _invalidate) must not re-fire
            // the body: hold the previous value. A recompute from a real
            // dependency change falls through and re-runs the body (last
            // call wins; the new run bumps the generation, so the superseded
            // continuation discards on resolve).
            asyncCtl.forced = false;
            selfNode._depIndex = selfNode.sources.length;
            return selfNode.value;
          }
        }
        // The framework's computed wrapper (ComponentLifecycle._setupComputedProperties)
        // handles the error (onError / logging) and then RE-THROWS so the state
        // manager can cache the ERRORED state. We catch here and surface the
        // errored state as a sentinel value instead of letting the throw escape
        // through evaluateComputed/scheduleComputedEvaluation: the framework contract
        // is that those never throw (callers include non-effect framework paths
        // that don't catch, e.g. the cross-store/prop nudge after a mutation).
        // DEV-only: mark "currently evaluating a computed" so a pool aggregate
        // read (PoolHandle.length/.size) inside the body can emit WF-212. The
        // framework sets _framework._computedTrackingContext around each computed eval; ReactiveGraph
        // doesn't carry that bookkeeping, so the shared warning never fired. This
        // is a transient dev-only marker (NOT the dependency machinery a later cleanup deletes);
        // __DEV__-gated so it's stripped from production.
        let prevTc;
        if (__DEV__ && this._wf) {
          prevTc = this._wf._computedTrackingContext;
          this._wf._computedTrackingContext = { computedName: name, componentId: this.component && this.component.id };
        }
        this._evalStack.push(name);
        // Fresh-run reset: `name` in _circularDependencies means a PRIOR
        // evaluation hit a cycle. Each evaluation decides for itself, via two
        // re-flag channels: the re-entrancy guard above re-adds the name if the
        // cycle re-forms as nested evaluation during THIS run, and the
        // cycle-poison marker below re-flags it if this run CONSUMED a
        // still-flagged member's cached sentinel (mutual cycles do not nest
        // once cached; they feed on each other's stale sentinels). Without the
        // reset the flag was sticky, so a conditional cycle stayed ERRORED
        // forever even after the gating state changed. isCircularDependency()
        // therefore reports the current cycle state, not "ever cycled".
        // Size-gated: the delete only matters when a prior eval flagged a cycle,
        // and the set is empty for every handle that never cycled (the common
        // case) — skip the per-eval Set.delete there.
        if (this._circularDependencies.size !== 0) this._circularDependencies.delete(name);
        const prevPoison = this._cyclePoisoned;
        this._cyclePoisoned = false;
        try {
          const v = bound();
          // framework parity: if the cycle re-entered THIS computed during its own
          // evaluation (nested detection re-added the name), or this run
          // consumed a cycle-flagged computed's sentinel (poison), the body
          // finished on a partial value (the cycle point yielded undefined, so
          // arithmetic over it produced NaN). Surface undefined instead of
          // that NaN, and keep the name flagged so consumers of THIS computed
          // poison in turn. ComputedPropertyManager applies the same post-eval
          // guard. (A direct self-cycle throws and is handled by the catch.)
          if (this._circularDependencies.has(name) || this._cyclePoisoned) {
            this._circularDependencies.add(name);
            // Newest evaluation wins: a cycle-poisoned run
            // supersedes any in-flight request exactly as a sync return
            // does — bump the generation so the pending continuation
            // discards instead of parking a stale result that the next
            // dependency change would consume in place of a fresh run.
            if (asyncCtl !== null && asyncCtl.state !== 0) {
              asyncCtl.gen++;
              asyncCtl.state = 0;
              asyncCtl.value = undefined;
              asyncCtl.forced = false;
              asyncCtl.relaunch = false;
            }
            return COMPUTED_ERROR;
          }
          // Async computeds (v1.5): a thenable return routes through the launch
          // path (the check sits after the cycle guards above, so a cycle still
          // wins over a returned promise). A SYNC return with async machinery
          // already present must also pass through: it supersedes any in-flight
          // request (its generation bump discards their continuations).
          if (asyncCtl !== null
              || (v !== null && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function')) {
            if (asyncCtl === null) asyncCtl = self._createAsyncComputed(name);
            return self._settleAsyncRun(asyncCtl, selfNode, name, v);
          }
          // No per-eval side-map write: the last successful value already lives
          // on the graph node (node.value); cold-path consumers read it via
          // _cachedComputedValue.
          return v;
        } catch (_) {
          // Newest evaluation wins: a throwing re-run supersedes
          // any in-flight request, exactly as a sync return does. Without
          // the bump, the old continuation passed its generation check and
          // PARKED a stale result (its cell edge was trimmed by this run,
          // so nothing woke) — which the next genuine dependency change
          // then consumed instead of re-running the body.
          if (asyncCtl !== null && asyncCtl.state !== 0) {
            asyncCtl.gen++;
            asyncCtl.state = 0;
            asyncCtl.value = undefined;
            asyncCtl.forced = false;
            asyncCtl.relaunch = false;
          }
          return COMPUTED_ERROR;
        } finally {
          this._evalStack.pop();
          this._cyclePoisoned = prevPoison;
          if (__DEV__ && this._wf) this._wf._computedTrackingContext = prevTc;
        }
      });
      this._getters[name] = getter;
      selfNode = getter.__node;
      // Name the node after the computed: Node.key is the debug identity, and
      // the F5 write-during-evaluation warning names the offender through it
      // (mComputed creates nodes with key=null; sources derive keys elsewhere).
      selfNode.key = name;

      // Install the computed:NAME pulse notifier LAZILY: only when this computed
      // is observed (a watcher/subscription recorded its name via
      // _ensureComputedNotifier) or observe-all is set (a `*` wildcard watcher /
      // subscribe-all). For an unobserved computed the notifier is pure overhead:
      // it observes the computed, forcing an eager recompute every flush even
      // when nothing reads it. See the _observedComputeds note in the constructor.
      if (this._observeAllComputeds || this._observedComputeds.has(name)) {
        this._installComputedNotifier(name);
      }
    }
    return this;
  }

  // Install the per-computed notifier effect that emits the `computed:NAME`
  // onStateChange pulse on a real value change (subscriptions/watchers ride it;
  // an errored computed surfaces as undefined on this channel; framework parity).
  // Idempotent: each computed gets at most one notifier.
  //
  // DEFER the notifier's creation to a microtask. ReactiveGraph effects evaluate
  // immediately on creation, so installing it synchronously would run the FIRST
  // evaluation of the computed before the framework finishes wiring the entity
  // (the store-to-store `this.stores.X` getters are injected later, in
  // _setupStoreSubscriptions, and the signal-promotion / first-render evals run
  // after that). A store computed that reads `this.stores.other` would then
  // cache a value built against an empty `this.stores` (its early-return
  // branch), tracking no edge to the later-injected store, and never
  // re-evaluate. Deferring the notifier's first eval by one microtask lands it
  // after the entity is wired (whoever reads first: the promotion pass, a
  // binding, or this notifier).
  _installComputedNotifier(name) {
    if (this._notifierInstalled.has(name)) return;
    const getter = this._getters[name];
    if (!getter) return; // computed not registered yet; _ensureComputedNotifier retries on addComputed
    this._notifierInstalled.add(name);
    let lastNotified = NO_VALUE;
    queueMicrotask(() => {
      // The entity may have been destroyed between this notifier's scheduling
      // and the microtask draining (same-tick mount/unmount, a destroy inside
      // init). Installing now would create an effect the destroy sweep has
      // already passed, leaving an orphan that re-fires onStateChange against a
      // dead component on every later store mutation it observes.
      if (this._destroyed) return;
      // Create through createEffect (not a bare mEffect) so the handle lands in
      // this._effects and the component destroy sweep disposes it. The notifier
      // is an observer of the computed (and, transitively, of any external store
      // the computed reads), so without disposal the store node retains a back
      // edge into the destroyed entity.
      this.createEffect(() => {
        let v = getter();
        if (v === COMPUTED_ERROR) v = undefined;
        if (lastNotified !== NO_VALUE && !Object.is(v, lastNotified)) {
          this.onStateChange('computed:' + name, v, lastNotified);
        }
        lastNotified = v;
      }, { name: 'computedNotifier:' + name });
    });
  }

  // Record that `name` is observed by a watcher/subscription and install its
  // notifier if the computed already exists. Called from the registration sites
  // that create a `computed:NAME` listener (component watchers, ListRenderer's
  // template-key watcher, imperative context.subscribe). Recording a name that
  // is not a computed is harmless: the notifier only materializes once a getter
  // by that name exists (addComputed re-checks _observedComputeds), so callers
  // need not know whether the watched path is a computed.
  _ensureComputedNotifier(name) {
    if (!name) return;
    this._observedComputeds.add(name);
    this._installComputedNotifier(name);
  }

  // Observe every computed (a `*` wildcard watcher or subscribe-all `''` matches
  // all `computed:NAME` pulses). Installs notifiers for all existing computeds
  // and sets the flag so any later addComputed installs one too.
  _observeAllComputedNotifiers() {
    this._observeAllComputeds = true;
    for (const k in this._getters) this._installComputedNotifier(k);
  }

  // ---------------------------------------------------------------------------
  // Async computeds (v1.5): a computed may return a thenable. The graph never
  // learns async exists — each async computed owns a hidden reactive cell that
  // the launch run reads (forming a normal graph edge) and the continuation
  // bumps (a normal source write), so resolution wakes the computed exactly
  // like any dependency change. The wrapper's fast branches then consume the
  // settled value WITHOUT re-invoking the body. Per-computed state machine:
  //   state 0 (idle)      — no async activity; the body runs normally
  //   state 1 (in flight) — a request is running; reads serve the previous value
  //   state 2 (settled)   — a result waits; the next evaluation returns it once
  // gen is the generation counter: every completed body run bumps it, and a
  // continuation whose captured generation no longer matches discards silently
  // (last call wins). A rejection settles as COMPUTED_ERROR — readers see
  // undefined, matching a sync computed that threw — and routes through the
  // entity's onError path via _handleError.
  // ---------------------------------------------------------------------------

  _createAsyncComputed(name) {
    if (this._asyncComputeds === null) this._asyncComputeds = new Map();
    const ctl = { state: 0, gen: 0, value: undefined, forced: false, relaunch: false, cell: mReactive({ n: 0 }) };
    this._asyncComputeds.set(name, ctl);
    return ctl;
  }

  _settleAsyncRun(ctl, node, name, v) {
    const gen = ++ctl.gen; // this body run supersedes any in-flight continuation
    const thenable = v !== null && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';
    if (!thenable) {
      // Sync return while async machinery exists: the value stands, and the
      // generation bump above discards any continuation still in flight.
      ctl.state = 0;
      ctl.value = undefined;
      return v;
    }
    ctl.state = 1;
    ctl.value = undefined;
    ctl.forced = false;
    ctl.relaunch = false;
    // Read the cell UNDER THIS EVALUATION (runNode has this node as the active
    // observer): the edge-reuse cursor appends/reuses the cell edge after the
    // body's own deps, and this is the edge the continuation bumps.
    void ctl.cell.n;
    const self = this;
    // Promise.resolve normalizes foreign/synchronous thenables to real
    // microtask timing: a thenable that called back synchronously would run
    // the continuation inside runNode, and the DIRTY its cell bump sets would
    // be wiped by updateIfNecessary's trailing CLEAN. Native promises pass
    // through by identity.
    // Staleness gate shared by both continuation arms: if the
    // node is DIRTY at settle time, a REAL dependency changed after this run
    // launched (the graph marks direct observers DIRTY on a leaf write; a
    // mere nudge flags itself via ctl.forced, and a props change via
    // ctl.relaunch — relaunch IS a real change, so it discards too). The
    // settled value was computed from superseded inputs: discard it and let
    // the already-scheduled re-evaluation run the body against the new
    // values. Without this, the consume branch served the stale result and
    // the change was lost until the dependency moved AGAIN. (A node at CHECK
    // is a maybe — an upstream computed may re-settle to the same value —
    // and is deliberately not treated as stale; that window matches the
    // pre-fix behavior.)
    const staleAtSettle = () =>
      node.color === 2 /* DIRTY */ && (!ctl.forced || ctl.relaunch);
    Promise.resolve(v).then(
      (result) => {
        if (ctl.gen !== gen || self._destroyed) return; // superseded: discard silently
        if (staleAtSettle()) { ctl.state = 0; ctl.value = undefined; return; }
        ctl.state = 2;
        ctl.value = result;
        ctl.cell.n++; // dirties the computed through the normal graph
      },
      (err) => {
        if (ctl.gen !== gen || self._destroyed) return;
        // A rejection for superseded inputs is discarded like a superseded
        // run's: the re-run in flight owns the outcome now.
        if (staleAtSettle()) { ctl.state = 0; ctl.value = undefined; return; }
        ctl.state = 2;
        ctl.value = COMPUTED_ERROR;
        // Visible on the node until the consuming run returns (the core then
        // resets it, exactly as it does after a recovered sync error).
        node.error = err;
        // Cell bump BEFORE the report: the report runs the
        // user's onError synchronously, and with the node still CLEAN and
        // node.error set, reading this same computed from inside the
        // handler re-threw the original error out of the evaluation. Dirty
        // first, and a read inside the handler consumes the errored state
        // and yields undefined like any other read of a failed computed.
        ctl.cell.n++;
        self._reportAsyncComputedError(name, err);
      }
    );
    // Serve the previous value while in flight (undefined on first load).
    return node.value;
  }

  // Route an async computed rejection to the entity's onError path. Components,
  // stores, and plugins all register their instance in wf.componentInstances,
  // so _handleError's boundary walk (context.onError -> global handlers ->
  // errorHandling option) covers all three. The sync-error equivalent lives in
  // the framework's computed wrapper (it catches the throw before this facade
  // sees it); a rejection happens after the body returned, so the facade is
  // the only place that can report it.
  _reportAsyncComputedError(name, err) {
    const wf = this._wf;
    const id = this.component && this.component.id;
    const instance = wf && id ? wf.componentInstances.get(id) : null;
    if (instance && typeof wf._handleError === 'function') {
      wf._handleError(`Error in async computed property '${name}'`, err, instance,
        { lifecycle: 'computed', computedName: name });
    } else if (__DEV__) {
      console.warn(`[WF] Async computed '${name}' rejected:`, err);
    }
  }

  evaluateComputed(name) {
    const getter = this._getters[name];
    if (!getter) return undefined;
    const node = getter.__node;
    // Zero-source cache distrust: a computed with NO tracked deps can never be
    // woken by the graph — nothing exists that could mark it dirty — so its
    // cache is untrustworthy however the last evaluation ended. Re-run on
    // every read. This generalizes the old ERRORED-only recovery: previously
    // a computed that THREW while source-less healed on the next read, but
    // one that RETURNED a value while source-less (e.g. eagerly evaluated
    // before init() set the `_` fields it reads) was cached forever —
    // succeeding with a wrong value was strictly worse than throwing.
    // Consequence: source-less computeds get METHOD semantics (fresh on every
    // pull read, no push), which matches the `_` non-reactive mental model.
    // Computeds WITH sources are untouched: cached until a dep wakes them.
    if (node && node.sources.length === 0) {
      node.color = 2; // DIRTY: force re-eval on the read below
    }
    // A method called from inside here must run NOW and hand its value back,
    // rather than being queued as a pre-init action and answering undefined.
    // Owner-scoped: the bypass is owed only to THIS entity's
    // instance — a cross-instance call still queues. See COMPUTED_EVAL in
    // wfUtils.
    COMPUTED_EVAL.depth++;
    // By id, not object: the handle's `component` is a light descriptor,
    // while _wrapMethod compares against the full registry instance.
    COMPUTED_EVAL.owners.push((this.component && this.component.id) || null);
    let v;
    try {
      v = getter();
    } finally {
      COMPUTED_EVAL.depth--;
      COMPUTED_EVAL.owners.pop();
    }
    if (v === COMPUTED_ERROR) {
      // Cycle-poison propagation: when a computed evaluation consumes a
      // sentinel from a computed that is currently cycle-flagged, taint the
      // consuming frame so its post-eval check yields the sentinel too (not
      // the NaN its arithmetic produced). Scoped to cycle-flagged computeds so
      // an ordinary ERRORED computed still surfaces as plain undefined, which
      // fallback-style consumers (`this.b || 'default'`) rely on.
      // Size-first: the Set.has only matters once a cycle has ever been
      // flagged on this handle; for cycle-free handles (the common case) the
      // integer check short-circuits the per-hop Set lookup.
      if (this._circularDependencies.size !== 0 && this._evalStack.length > 0 && this._circularDependencies.has(name)) {
        this._cyclePoisoned = true;
      }
      return undefined;
    }
    return v;
  }

  // state-manager surface: last successfully cached value of a computed, read
  // straight off its graph node — no per-eval side map. A never-evaluated or
  // errored/cycle-flagged computed surfaces as undefined. This replaces the
  // per-eval _lastEvalResult Map.set (hot-path cost serving only cold readers);
  // the sole live consumer is the deferred-dependency resolution's old-value
  // comparison in ComponentLifecycle.
  _cachedComputedValue(name) {
    const g = this._getters[name];
    const node = g && g.__node;
    if (!node) return undefined;
    const v = node.value;
    return v === COMPUTED_ERROR ? undefined : v;
  }

  // state-manager surface: has this computed been detected as part of a dependency cycle?
  // Recorded by the addComputed getter's re-entrancy guard.
  isCircularDependency(name) {
    return this._circularDependencies.has(name);
  }

  _invalidate(name, changed) {
    // Force a recompute on next read by rebinding the getter's node to dirty.
    const node = this._getters[name] && this._getters[name].__node;
    if (node) {
      // Async computeds: a forced invalidation while a request is in flight
      // must not re-fire the body (scheduleComputedEvaluation fires for every
      // computed on any subscribed store change; re-launching the request per
      // nudge would storm the endpoint). Flag the force ONLY when the node is
      // currently CLEAN — if the graph already marked it, a real dependency
      // changed and the body SHOULD re-run (last call wins). The wrapper's
      // in-flight branch consumes the flag and holds the previous value.
      //
      // `changed` is the stronger claim: the CALLER verified an
      // input value actually changed (the props refresh path — props have no
      // graph edge, so this flag is their only wake channel). That is a real
      // dependency change, not a nudge: flag a RELAUNCH so the wrapper
      // re-runs the body instead of holding, superseding the in-flight
      // continuation via the new run's generation bump.
      if (this._asyncComputeds !== null && (changed || node.color === 0)) {
        const ctl = this._asyncComputeds.get(name);
        if (ctl !== undefined && ctl.state !== 0) {
          if (changed) ctl.relaunch = true;
          else if (node.color === 0 && ctl.state === 1) ctl.forced = true;
        }
      }
      node.color = 2 /* DIRTY */;
    }
  }

  getComputedPropertyNames() { return Object.keys(this._getters); }

  // state-manager surface: invalidate one computed's cache so its next read recomputes.
  // Props don't flow through the reactive graph (they're plain objects on the
  // instance, refreshed by _updateComponentProps), so a computed that reads
  // `this.props.*` has no graph edge to a parent-state change. On a props
  // change the framework (ListNestedManager._updatePropsBindingsForComponent)
  // calls `_invalidateCachedComputed(name)` + `scheduleComputedEvaluation(name)`
  // for every computed; marking the node dirty forces the subsequent evaluate
  // to re-read the new props (and wake its observers if the value changed).
  _invalidateCachedComputed(name, changed) { this._invalidate(name, changed); }

  // state-manager surface: force (re-)evaluation of a named computed. The framework calls
  // this from its "a dependency may have changed, re-run this computed" paths:
  // EntitySystem._handleEntityStateChange (subscribe:{} store-path change),
  // context-system dependent notify, ListNestedManager props refresh.
  // On the framework each is preceded by a direct dirty-mark of the computed nodes
  // (the `sm._computedNodes` loop in EntitySystem:623). EntityHandle has no
  // `_computedNodes`, so that loop is a no-op on ReactiveGraph and the node stays
  // CLEAN: a bare evaluateComputed would return the cached value and the
  // computed would never re-run. This is load-bearing for subscribe:{} computeds
  // that read a structurally-mutated array via its reference (e.g. a push the
  // graph can't see as a change to the array slot). Force DIRTY first so the
  // read genuinely re-evaluates; the re-eval only wakes observers on a real
  // value change (Object.is), so over-invalidation is bounded.
  scheduleComputedEvaluation(name) { this._invalidate(name); return this.evaluateComputed(name); }

  createEffect(fn, options = {}) {
    const opts = { sync: !!options.sync, stable: !!options.stable };
    const name = options.name || null;
    const scope = options.scope || this.component;
    // An effect that throws is logged (with its debug name + scope) and the
    // throw is swallowed, so the scheduler/flush isn't aborted and the effect
    // keeps its place for the next run. Matches ReactiveStateManager._runEffect's
    // catch (same message shape, which the effect-system tests assert against).
    const wrapped = () => {
      try {
        return fn();
      } catch (error) {
        const scopeInfo = scope ? ` (Scope: ${scope.name || scope.componentName || scope.id || 'unknown'})` : '';
        console.error(`[Effect${name ? ` "${name}"` : ''}${scopeInfo}] Error:`, error);
      }
    };
    const dispose = mEffect(wrapped, opts);
    const node = dispose.__node;
    // Shape a state-manager-compatible effect handle: consumers read dispose._effect and
    // effect.dirty/disposed/_rsm.
    const effect = {
      fn,
      scope,
      sync: opts.sync,
      name,
      _rsm: this,
      _node: node,
      _dispose: dispose,
      get dirty() { return node.color !== 0; },
      // state-manager-contract: framework wake paths (EntitySystem child-effect refresh,
      // StoreManager cross-entity nudge) assign `effect.dirty = true` to force a
      // re-run. ReactiveGraph's equivalent is scheduling the node DIRTY for the next
      // flush; the getter then reflects it (node.color becomes non-zero). A
      // falsy assignment is a no-op: ReactiveGraph clears color when the node runs,
      // there is no external "un-dirty".
      set dirty(v) { if (v) mRefresh(node); },
      get disposed() { return (node.flags & 4) !== 0; },
    };
    this._effects.add(effect);
    if (effect.scope) {
      if (!effect.scope._effects) effect.scope._effects = new Set();
      effect.scope._effects.add(effect);
    }
    const stop = () => { this._disposeEffect(effect); };
    stop._effect = effect;
    return stop;
  }

  // state-manager-contract effect disposal. ComponentLifecycle's destroy path iterates
  // the tracked effect Sets and calls `effect._rsm._disposeEffect(effect)` on
  // each. ReactiveGraph's underlying disposal is `disposeNode(node)` (captured here as
  // the effect's `_dispose` closure): idempotent (short-circuits on F_DISPOSED)
  // and drops the node's source edges via cleanupSources. We also remove the
  // effect from its tracking Sets to match the framework's bookkeeping cleanup.
  _disposeEffect(effect) {
    if (!effect || effect.disposed) return;
    if (effect._dispose) effect._dispose();
    this._effects.delete(effect);
    if (effect.scope && effect.scope._effects) effect.scope._effects.delete(effect);
  }

  // Tear down this entity's reactive surface. Called from ComponentLifecycle's
  // destroy path. Sets _destroyed (so any still-pending deferred notifier install
  // skips) and disposes every tracked effect: the component destroy sweep also
  // iterates _effects, so this is belt-and-suspenders and idempotent
  // (_disposeEffect short-circuits on already-disposed handles).
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._effects && this._effects.size) {
      const remaining = Array.from(this._effects);
      for (let i = 0; i < remaining.length; i++) this._disposeEffect(remaining[i]);
    }
  }

  // state-manager-contract forced synchronous re-run. The prop-propagation path
  // (EntitySystem._handleEntityStateChange) and the cross-entity store nudge
  // (StoreManager) set `effect.dirty = true` then call `_runEffect(effect)` to
  // re-run a component's render effect immediately: props are plain objects the
  // graph doesn't track, so the effect must be pushed to re-read them within the
  // same turn (before onPropsChange / the computed flush). Routes to the
  // the core synchronous runner over the handle's underlying node.
  _runEffect(effect) {
    if (!effect || effect.disposed) return;
    if (effect._node) mRunEffect(effect._node);
  }


  // Stamp a direct text-writer on a row field's graph node so subsequent writes
  // to that field update its one bound text node WITHOUT waking the per-item
  // effect (no cleanupSources / re-touch / wrapper). This is the set-trap
  // direct-writer fast path. Called from ListRenderer's targeted text path
  // the first time a pure-single-text field changes (the effect wakes once to
  // bind, then this retires it for that field). The closure returns false when
  // its element is detached (a removed/reused row) so notifyNode clears the
  // stale writer and falls back to the normal effect wake, which re-stamps
  // against the live DOM. Gated to fields ListRenderer classified as
  // _reactiveGraphPureText (read by no computed or other binding), so bypassing the
  // graph's version/observer machinery for them is correctness-neutral.
  // Stamp a caller-supplied direct-writer closure on a row field's graph node.
  // Generic form of stampDirectText/StyleWriter for binding kinds whose write
  // closure must be built by the renderer (e.g. data-bind-attr needs the
  // renderer's attribute sanitizer/blocklist). `fn(rawTarget)` must apply the one
  // DOM write and return false when its element is detached (so notifyNode clears
  // the stale writer and falls back to the effect wake). Same DIRECT_HANDLED
  // suppression contract as the typed stampers.
  stampDirectWriter(itemProxy, key, fn, el) {
    mSetDirectWriter(itemProxy, key, fn, el);
  }

  // Compiled-row path: stamp/clear a per-list dispatch sink on an item
  // leaf (object, key). The sink is called as sink(rawTarget, key) inside
  // notifyNode, after which the normal wake still fires (no suppression), so any
  // computed/watcher reading the same leaf stays correct. Pass null to clear
  // (same-key replace, remove, clear).
  setListSink(itemProxy, key, sinkFn) {
    mSetListSink(itemProxy, key, sinkFn);
  }

  clearListSink(itemProxy, key) {
    mSetListSink(itemProxy, key, null);
  }

  // Uniform-stamp registration: one owner record `{ keys, sink }` per row
  // item in place of a node per stamped prop (see core setListOwner). Pass
  // null to release the item (remove, same-key replace).
  setListOwner(itemProxy, owner) {
    mSetListOwner(itemProxy, owner);
  }

  // Run `fn` under a list tracking frame (hybrid one-sink, computed/external
  // templates): reads of leaves the frame OWNS (this list's row items) register
  // on the per-list sink via frame.stamp; every other read forms a graph edge
  // to `effectHandle`'s node: the ONE stable per-list effect. `effectHandle`
  // is the dispose function createEffect returned (its _effect._node is the
  // observer). Frame shape: { observer, owns(raw), stamp(raw, key) }; set
  // frame.observer to runInListFrame's node (this method wires it).
  runInListFrame(effectHandle, frame, fn) {
    const node = effectHandle && effectHandle._effect && effectHandle._effect._node;
    if (!node) return fn();
    frame.observer = node;
    return mRunInListFrame(node, frame, fn);
  }

  // Clear a directWriter stamped via stampDirectWriter (same-key replace: the
  // old item's leaf must stop writing the reused row). Mirrors clearListSink.
  clearDirectWriter(itemProxy, key) {
    mSetDirectWriter(itemProxy, key, null);
  }

  // Unwrap a tree proxy to its raw target (the identity notifyNode passes to a
  // listSink). Returns the input unchanged when already raw.
  toRaw(objOrProxy) {
    return mToRaw(objOrProxy);
  }

  // Inverse of toRaw: the reactive proxy for a raw object (cache-hit when one
  // already exists — one proxy per raw object; identity-stable). Idempotent on
  // proxies. Consumers that need tracking or the set trap wrap on demand here;
  // the list create path stores raw items and never pays proxy allocation.
  reactive(objOrRaw) {
    return mReactive(objOrRaw);
  }

  // state-manager surface: register the active effect as a dependent of a component path
  // (ListRenderer calls this for per-item effects that read a component computed,
  // and seeds the framework's _itemReadComputeds item-wake backstop). ReactiveGraph forms that
  // edge directly when the effect reads the computed via evaluateComputed (the
  // graph edge IS the registration), so this is a no-op. (Previously absent, so
  // the ListRenderer call threw and was swallowed by the effect wrapper,
  // aborting the surrounding dep-read loop.)
  _registerComponentDep() { /* no-op: component-level deps are tracked via effect reads */ }

  // Keyed list reconciler matching the framework mapArray contract that ListRenderer
  // drives. The implementation is a free function (closes only over core
  // primitives, no facade state); this method is a one-line shim so sm.mapArray
  // stays the call surface.
  mapArray(arrayFn, mapFn, options = {}) {
    // __FEATURE_LISTS__ = false (nano) folds this out, dropping the reconcile
    // reference so the whole list-reconciler.js module tree-shakes away — its
    // only caller is ListRenderer, which is itself gated out of nano.
    if (!__FEATURE_LISTS__) return;
    return reconcile(arrayFn, mapFn, options);
  }

  untrack(fn) { return mUntrack(fn); }
}

export { EntityHandle };
