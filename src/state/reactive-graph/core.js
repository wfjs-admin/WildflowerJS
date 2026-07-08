/**
 * ReactiveGraph: the unified reactive graph core.
 *
 * This is a CLEAN-ROOM module: it imports nothing from the rest of the framework,
 * and only the EntityHandle facade imports from it.
 *
 * The model: reactivity is ONE global graph of nodes whose edges are object
 * references, whose freshness is decided by graph-coloring (CLEAN/CHECK/DIRTY)
 * plus value comparison: a push-pull validation engine under a proxy surface
 * with COARSE effect granularity (one effect per "component", one per "row")
 * instead of one effect per binding.
 *
 * Two invariants enforced throughout:
 *   1. Source VALUES live on the raw object; nodes are sidecars. Keeps
 *      JSON.stringify / spread / devtools key-iteration working, and makes
 *      unread/unbound state cost ZERO nodes (lazy materialization).
 *   2. Effect granularity stays coarse. Node count scales with BOUND LEAVES,
 *      like a dep-map's entries, not with bindings.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Node kinds.
const SOURCE = 0;
const COMPUTED = 1;
const EFFECT = 2;

// Colors (ordered: a higher color subsumes a lower one).
const CLEAN = 0;
const CHECK = 1;
const DIRTY = 2;

// Node flags.
const F_STABLE = 1; // freeze source edges after first run (hot row effects)
const F_SYNC = 2;   // run synchronously on mark instead of on the microtask
const F_DISPOSED = 4;
const F_RUNNING = 8; // node.fn is on the stack (re-entrancy = a computed cycle)
const F_REENTERED = 16; // set on a COMPUTED node when runNode re-enters it while
                        // F_RUNNING (i.e. mid-cycle). The entity-handle computed
                        // wrapper tests-and-clears this one bit at entry as its
                        // cycle detection, replacing a per-eval O(depth) stack
                        // scan; the bit is only ever set on the rare cycle path.

// Symbols stamped on raw targets. ONE nodes-map symbol carries all per-object
// node bookkeeping.
const NODES = Symbol('reactive-graph.nodes');
const RAW = Symbol('reactive-graph.raw');
// Iteration-dependency sentinel: ownKeys reads (Object.keys / for...in /
// spread / JSON.stringify) track this per-target node; key ADDs and DELETEs
// pulse it. Value updates to existing keys never touch it, so keys-only
// iterators stay quiet on hot-path field writes. Arrays alias to their
// 'length' node instead, which every structural path already pulses.
const ITERATE = Symbol('reactive-graph.iterate');
const hasOwnProp = Object.prototype.hasOwnProperty;
// Per-array operation log: stamped (non-enumerable) on a raw array that a
// mapArray manages, so the set trap records the exact index writes since the
// last reconcile. The structural effect's fastPath consumes them to classify a
// targeted operation (swap/move/...). Absent on unmanaged arrays → zero cost.
const ARR_OPS = Symbol('reactive-graph.arrOps');
// notifyNode return sentinel: a directWriter wrote the DOM and the set trap
// should skip its remaining work (length pulse + onStateChange dispatch).
const DIRECT_HANDLED = 2;

// ---------------------------------------------------------------------------
// Globals (module-level: the whole system shares ONE graph)
// ---------------------------------------------------------------------------

let RUN_ID = 0;          // monotonic; stamps edge links to dedupe within a run
let activeObserver = null; // the currently-evaluating computed/effect
let batchDepth = 0;        // >0 suppresses the auto microtask flush
let suppressTracking = false; // true while re-running a frozen (F_STABLE) node

// Effect scheduler: flag-deduped queue (node.queued), drained to fixpoint on a
// microtask. The per-node flag replaces a Set (no hashing per schedule/drain).
const queue = [];
// Boundary marker for batch-scoped discard. beginBatchScope() records the queue
// length when a framework batch opens; discardScheduled() then cancels only the
// effects scheduled DURING the batch (queue indices >= the boundary), leaving
// any work queued before the batch to flush normally. -1 means "no active
// scope" -> discardScheduled clears the whole queue (legacy behavior).
let batchScopeBoundary = -1;
let flushScheduled = false;

// Optional flush observer (DevTools timeline). this core stays clean-room (it
// imports nothing from the framework) so rather than reach into the timeline
// recorder here, the facade injects a callback in dev builds and flush() reports
// the per-drain node count to it. Null by default, so production pays nothing.
let _onFlush = null;
function setFlushObserver(fn) { _onFlush = fn; }

const proxyCache = new WeakMap(); // one proxy per raw object (identity)
// Per-object reactive-graph node maps, stored OFF the raw object (previously a
// defineProperty'd non-enumerable NODES symbol). A side-table avoids the
// per-object hidden-class transition Object.defineProperty forced on every item
// that ever gets a node; material on bulk create (10k rows each took a NODES
// slot + transition). The raw object's shape is now never touched; reads are a
// WeakMap.get in getNode/notifyNode/the traps.
const nodeTable = new WeakMap();

// ---------------------------------------------------------------------------
// Node: monomorphic, eagerly shaped for stable V8 hidden classes
// ---------------------------------------------------------------------------

class Node {
  constructor(kind, key, fn) {
    this.kind = kind;
    this.key = key;          // property name (for debugging / lazy path derivation)
    this.fn = fn || null;    // computed/effect body (null for sources)
    this.value = undefined;  // computed/effect result; SOURCES keep value on the raw object
    this.error = null;
    this.color = CLEAN;
    this.flags = 0;
    this.hasRun = false;
    // Edge bookkeeping (S.js-style index tracking: correct + O(deps)).
    this.sources = [];        // Node[] this node reads
    this.sourceSlots = [];    // index of THIS node within each source's observers
    this.observers = [];      // Node[] that read this node
    this.observerSlots = [];  // index of each observer within its own sources
    this._trackRun = -1;      // last RUN_ID that linked this node (dedupe)
    // Run id of this node's latest (re)tracking run; runNode assigns ++RUN_ID
    // per non-frozen run. Initialized here (0: RUN_ID starts at 1, and
    // _trackRun starts at -1, so no false dedupe match) to keep the hidden
    // class stable, since a fastPath can run before the first full run assigns it.
    this.__runId = 0;
    // Direct-writer hooks (list renderer fast paths).
    this.directWriter = null;
    // Element a shared directWriter writes to (text path): stored here instead of
    // captured in a per-row closure, so a single module-level writer serves all
    // rows. null for closure-style writers (attr/style) that capture their own el.
    this.dwEl = null;
    // Per-list dispatch sink (compiled row path). When set, notifyNode applies a
    // targeted row DOM update synchronously and then FALLS THROUGH to the normal
    // observer wake (it does not suppress, unlike directWriter).
    this.listSink = null;
    // Operation fast-path hook (structural list effects only). When set, runNode
    // calls it BEFORE cleanup/retrack: if it returns true the change was applied
    // targeted (O(k)) and the full body is skipped, leaving source edges intact.
    this.fastPath = null;
    // Scheduler membership flag: true while this effect sits in the flush queue.
    // Replaces a module-level Set (hash add/has/delete per schedule/drain) with an
    // O(1) field check; the scheduler was ~25% of reactive-graph self-time.
    this.queued = false;
    // Edge-reuse cursor: during a re-run, the position in `sources` being matched
    // against the deps the run re-reads (link reuse; see track). Invariant when
    // not mid-run: _depIndex === sources.length.
    this._depIndex = 0;
  }
}

// ---------------------------------------------------------------------------
// Edge management (link on read, unlink on retrack): the S.js algorithm
// ---------------------------------------------------------------------------

function track(source) {
  const o = activeObserver;
  if (!o || suppressTracking) return;
  // Dedupe: same source read twice in one run links once.
  if (source._trackRun === o.__runId) return;
  source._trackRun = o.__runId;
  // Edge reuse (lever 2): if the dep at the current cursor is already this exact
  // source, the edge formed last run is still valid: advance the cursor and
  // mutate NOTHING. A stable dep set (the common case: deep chains, broad fan-out,
  // diamonds) thus rebuilds zero edges per run. On divergence (a dynamic dep
  // changed), trim the now-stale tail [i..end] and fall through to append the new
  // edge. The array representation is unchanged, so mark/updateIfNecessary/
  // discardScheduled need no changes.
  const i = o._depIndex;
  if (i < o.sources.length) {
    if (o.sources[i] === source) { o._depIndex = i + 1; return; }
    trimSourcesFrom(o, i);
  }
  const sIdx = o.sources.length;          // where source lands in observer.sources
  const oIdx = source.observers.length;   // where observer lands in source.observers
  o.sources.push(source);
  o.sourceSlots.push(oIdx);
  source.observers.push(o);
  source.observerSlots.push(sIdx);
  o._depIndex = sIdx + 1;
}

// Remove `node`'s source edges from index `from` to the end (swap-remove each
// from its source's observer list). from=0 drops all edges; from>0 trims a tail
// the latest run no longer reads (edge reuse).
function trimSourcesFrom(node, from) {
  const srcs = node.sources;
  const slots = node.sourceSlots;
  while (srcs.length > from) {
    const source = srcs.pop();
    const sourceSlot = slots.pop();
    const obs = source.observers;
    const obsSlots = source.observerSlots;
    const lastObs = obs.pop();
    const lastSlot = obsSlots.pop();
    if (sourceSlot < obs.length) {
      // Move the popped tail into the hole and fix its back-pointer.
      obs[sourceSlot] = lastObs;
      obsSlots[sourceSlot] = lastSlot;
      lastObs.sourceSlots[lastSlot] = sourceSlot;
    }
  }
}

// Remove every source edge of `node` (dispose / full retrack).
function cleanupSources(node) { trimSourcesFrom(node, 0); }

// ---------------------------------------------------------------------------
// List tracking frame (hybrid one-sink, computed/external templates)
// ---------------------------------------------------------------------------
// While a frame is installed (runInListFrame), reads made DIRECTLY under the
// frame's observer are PARTITIONED: a leaf read on an object the frame owns
// (this list's row items, frame.owns) registers on the per-list dispatch sink
// (frame.stamp -> setListSink + bookkeeping) instead of forming a graph edge;
// every other read links to the observer as usual. This is how a
// computed/external row's apply distributes its dependency surface: item
// leaves -> rows-Map sink dispatch, shared deps (component state, stores,
// computed values) -> the ONE stable per-list effect. Reads inside a NESTED
// node run (a real computed evaluating) track normally to that node; the
// observer-identity guard keeps computed dependency graphs intact; the
// computed's VALUE read under the frame links the computed to the observer.
let listFrame = null;

function trackRead(target, key) {
  if (listFrame !== null && activeObserver === listFrame.observer && listFrame.owns(target)) {
    listFrame.stamp(target, key);
    return;
  }
  track(getNode(target, key));
}

// Run `fn` with `node` installed as the active observer and `frame` as the
// read partition. Tracking is UN-suppressed for the duration: edges append to
// the node's existing source set (the reuse cursor sits at sources.length
// between runs, and _trackRun dedupe spans the node's last __runId, so a dep
// already linked by a previous frame apply links once). Designed for a STABLE
// effect whose own body never retracks; frame applies are the only edge
// source after its first (empty) run. Re-entrant safe: inside the effect's own
// frozen run this temporarily lifts suppressTracking with the cursor already
// at the append position.
function runInListFrame(node, frame, fn) {
  const prevObserver = activeObserver;
  const prevSuppress = suppressTracking;
  const prevFrame = listFrame;
  activeObserver = node;
  suppressTracking = false;
  listFrame = frame;
  try {
    return fn();
  } finally {
    activeObserver = prevObserver;
    suppressTracking = prevSuppress;
    listFrame = prevFrame;
  }
}

function disposeNode(node) {
  if (node.flags & F_DISPOSED) return;
  node.flags |= F_DISPOSED;
  cleanupSources(node);
  node.fn = null;
  node.value = undefined;
  node.queued = false;
}

// ---------------------------------------------------------------------------
// The three algorithms: mark (push), updateIfNecessary (pull), runNode (eval)
// ---------------------------------------------------------------------------

// Push phase: marking only, never evaluates. Direct observers of a changed
// node go DIRTY; everything downstream goes CHECK. The `color < state` guard
// stops re-walking subtrees already at-or-above that color.
function mark(node, state) {
  if (node.color < state) {
    const wasClean = node.color === CLEAN;
    node.color = state;
    if (node.kind === EFFECT && wasClean && !(node.flags & F_DISPOSED)) {
      if (node.flags & F_SYNC) updateIfNecessary(node);
      else schedule(node);
    }
    const obs = node.observers;
    for (let i = 0; i < obs.length; i++) mark(obs[i], CHECK);
  }
}

// Wake a node's direct observers DIRTY. Shared by the computed value-changed path
// and the two deleteProperty traps. notifyNode has its own wake loop (it runs
// the listSink first and wraps the wake in try/finally).
function wakeObservers(node) {
  const obs = node.observers;
  for (let i = 0; i < obs.length; i++) mark(obs[i], DIRTY);
}

// Mark the node for (target, key) dirty if it exists. Returns whether it did.
// Shared by both set traps (object set + array length pulse).
function notifyNode(target, key) {
  const map = nodeTable.get(target);
  const node = map && map.get(key);
  if (!node) return false;
  // Direct text writer: a pure-single-text list field (one bound text node, read
  // by no other binding) writes its node here and skips waking the per-item
  // effect entirely (the direct-writer fast path).
  // The writer returns false when its element is detached (row removed/reused);
  // we then clear the stale writer and fall through to the normal effect wake,
  // which re-stamps a fresh writer against the live DOM. By construction (the
  // renderer only stamps for fields read by no computed/other binding) skipping
  // observer marking here is safe; nothing else reads the node.
  const dw = node.directWriter;
  // Topological demotion guard (read AT WRITE TIME, never cached at stamp
  // time): the suppressing branch is only sound when nothing observes this
  // leaf through the graph. The static retire-safe gate is component-scoped
  // and cannot see a CROSS-component reader (another component's computed
  // reading this store-backed item field forms an observer edge here); the
  // topology decides per write instead. Suppression machinery itself never
  // appears in observers (directWriter/dwEl/listSink are dedicated Node
  // fields, and the list tracking frame partitions the stable effect's item
  // reads to stamps), so a healthy suppressed leaf reads observers.length
  // === 0 and the hot path pays one array-length check. When observers exist
  // the write falls through to the sink + wake path below (the dual sink
  // stamp performs the DOM write); the writer stays stamped so suppression
  // resumes if the observer set empties again (a conditional cross-component
  // reader makes suppression oscillate write-to-write — correct at every
  // instant, documented in the list-pipeline synopsis Appendix A#3).
  // TIMING NOTE (retention, not a leak): while observers exist the writer is
  // never INVOKED, so a writer whose element has since detached cannot
  // self-clear on those writes — the stale dwEl/closure element lives until
  // the first observer-free write invokes it (false -> cleared below), a
  // same-key replace re-stamps the leaf, or clearLeaf/clearRowStamps runs on
  // row removal. All three bounds hold, and detached-but-LIVE rows retain
  // their elements anyway (placeholder revival), so there is no net new
  // retention — pinned white-box in direct-writer-guard.test.js.
  if (dw !== null && node.observers.length === 0) {
    // Return DIRECT_HANDLED so the set trap also skips the onStateChange dispatch
    // (notify) for this write; the field is read by nothing else (the renderer's
    // _reactiveGraphPureText gate + the observer check above), so there are no
    // watchers/computeds/component renders to drive. The fast path returns
    // before its onStateChange, cutting the per-write dispatch that otherwise
    // dominates the steady-state update cost.
    if (dw(target, node) === true) return DIRECT_HANDLED;
    node.directWriter = null;
    node.dwEl = null;
  }
  // Per-list dispatch sink (compiled-row path): apply this row's targeted
  // DOM update synchronously, then FALL THROUGH to the normal version bump +
  // observer wake below. Unlike directWriter this does NOT suppress; a computed
  // or watcher sharing this leaf must still be notified, because the sink
  // replaces only the row's own per-item effect, not every reader of the leaf.
  const ls = node.listSink;
  // Run the sink in a try/finally so a throwing sink (a row text/class/style/attr
  // evaluator blowing up on a bad value) does NOT skip the observer wake below.
  // Without this, a shared computed/watcher reading the same leaf is left at its
  // stale cached value until the next non-throwing write. The exception still
  // propagates after the finally (the app is already erroring); only the
  // bookkeeping is made throw-safe.
  try {
    if (ls !== null) ls(target, key);
  } finally {
    const obs = node.observers;
    for (let i = 0; i < obs.length; i++) mark(obs[i], DIRTY);
  }
  return true;
}

// Pull phase: answer "is this node fresh?" with the minimum work.
//   CLEAN -> O(1), return cached.
//   CHECK -> validate sources; re-eval only if one actually changed value.
//   DIRTY -> re-eval.
// This single function replaces the current core's three-layered staleness
// (per-dep version walk + globalEpoch short-circuit + transitive DIRTY BFS)
// and the cross-entity externalSources epoch capture.
function updateIfNecessary(node) {
  if (node.color === CLEAN) return;
  if (node.color === CHECK) {
    const srcs = node.sources;
    for (let i = 0; i < srcs.length; i++) {
      updateIfNecessary(srcs[i]);
      if (node.color === DIRTY) break; // a source re-eval marked us dirty
    }
  }
  if (node.color === DIRTY) runNode(node);
  node.color = CLEAN;
}

function runNode(node) {
  // Operation fast path: a structural list effect can carry a fastPath() that,
  // given the exact mutations recorded at the write site (see recordArrayWrite),
  // applies a targeted O(k) DOM update and returns true, skipping the
  // cleanupSources + retrack + full re-eval of the body. Skipping the body
  // preserves the effect's source edges, which is correct when the operation
  // does NOT change the set of tracked nodes (length-preserving ops like a swap);
  // operations that add nodes (append) re-link them in O(k) via linkLeaf, run
  // here with the node as activeObserver. A throw or a `false` return falls
  // through to the normal full reconcile below, so the fallback is unchanged.
  if (node.fastPath !== null) {
    const fpObserver = activeObserver;
    activeObserver = node;
    let handled = false;
    try { handled = node.fastPath() === true; }
    catch (_) { handled = false; }
    finally { activeObserver = fpObserver; }
    if (handled) { node.hasRun = true; return; }
  }

  // Re-entrant evaluation guard: a computed CYCLE re-enters runNode for
  // a node whose outer frame is still mid-run (the facade's circular-dependency
  // wrapper detects the cycle inside this inner call and throws). The inner
  // frame must NOT touch the outer frame's tracking cursor (__runId/_depIndex)
  // and must NOT trim the outer frame's partially-rebuilt edges: doing so
  // dropped every dep the outer run had tracked before the cycle point (e.g.
  // the edge to the state that GATES a conditional cycle), leaving the pair
  // unable to recover once the cycle broke. Run the inner frame like a frozen
  // one: tracking suppressed, no cursor reset, no post-run trim.
  const reentrant = (node.flags & F_RUNNING) !== 0;
  // Mark the re-entered computed so its wrapper fn can detect the cycle with a
  // single bitmask test (effects have no wrapper reading the bit; skip them).
  if (reentrant && node.kind === COMPUTED) node.flags |= F_REENTERED;
  const frozen = ((node.flags & F_STABLE) && node.hasRun) || reentrant;
  const prevObserver = activeObserver;
  const prevSuppress = suppressTracking;

  if (frozen) {
    suppressTracking = true;        // keep existing edges, do not retrack
  } else {
    node.__runId = ++RUN_ID;
    node._depIndex = 0;              // reuse cursor: re-link by diffing, not rebuild
    node.flags |= F_RUNNING;
  }
  activeObserver = node;

  let result;
  try {
    result = node.fn();
    node.error = null;
  } catch (e) {
    node.error = e;
    result = node.value; // keep last good value on error
  } finally {
    activeObserver = prevObserver;
    suppressTracking = prevSuppress;
    node.hasRun = true;
    if (!reentrant) node.flags &= ~F_RUNNING;
  }

  // Trim edges the run did not reuse/append; the node now reads fewer deps than
  // last run (or none). Restores the post-run invariant _depIndex === sources.length.
  if (!frozen && node._depIndex < node.sources.length) trimSourcesFrom(node, node._depIndex);

  if (node.kind === COMPUTED) {
    // Avoidable propagation: only a REAL value change bumps version and wakes
    // observers. A recompute that yields the same value stays contained.
    if (!Object.is(result, node.value)) {
      node.value = result;
      wakeObservers(node);
    }
  } else {
    // EFFECT: result may be a cleanup fn in a fuller impl; ignored here.
    node.value = result;
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

function schedule(node) {
  if (node.queued) return;
  node.queued = true;
  queue.push(node);
  if (!flushScheduled && batchDepth === 0) {
    flushScheduled = true;
    queueMicrotask(flush);
  }
}

function flush() {
  flushScheduled = false;
  let i = 0;
  let guard = 0;
  let processed = 0; // DevTools timeline: nodes processed this drain (dev-only; DCE'd in prod)
  // Drain to fixpoint: effects scheduled during the flush extend the queue.
  while (i < queue.length) {
    if (++guard > 1000000) {
      console.error('ReactiveGraph: flush loop breaker tripped');
      // Un-strand the unvisited suffix: queue.length = 0 below would
      // leave their queued flags true, and schedule() would then skip them
      // forever, a permanent reactivity freeze on top of an already-
      // pathological update loop.
      for (let j = i; j < queue.length; j++) queue[j].queued = false;
      break;
    }
    const node = queue[i++];
    node.queued = false;
    if (node.flags & F_DISPOSED) continue;
    if (node.color !== CLEAN) { updateIfNecessary(node); if (__DEV__) processed++; }
  }
  queue.length = 0;
  i = 0;
  if (__DEV__ && _onFlush) _onFlush(processed);
}

// Synchronous flush for tests/benches that want deterministic timing.
function flushSync() {
  if (queue.length) flush();
}

// Discard pending scheduled effects WITHOUT running them: the framework's
// cancelBatch() contract: a batch's mutations persist in state but its pending
// re-renders are dropped (the DOM keeps its pre-batch value until the next real
// change). ReactiveGraph marks the graph eagerly on write, so the batch already
// scheduled its effects; simply clearing the queue would strand them (and their
// source computeds) at DIRTY/CHECK, and a later `mark` would short-circuit on the
// already-dirty colour and never re-schedule them, freezing future reactivity.
// So reset each queued effect AND its transitive computed sources back to CLEAN:
// the cancelled marks are erased, no effect runs, and a subsequent source change
// re-marks from CLEAN and propagates normally. (evaluate-then-quiesce:
// those computeds are re-evaluated FIRST, so a post-cancel synchronous read is
// consistent with the persisted batch writes. Only the DOM stays stale, per the
// contract; data reads never do.)
// Open a discard scope: remember which effects are already pending so a later
// discardScheduled() (cancelBatch) only drops effects scheduled after this point.
function beginBatchScope() {
  batchScopeBoundary = queue.length;
}

// Close a discard scope without cancelling (the applyBatch path). Clears the
// boundary so a later unmatched discardScheduled() can't act on a stale marker.
function endBatchScope() {
  batchScopeBoundary = -1;
}

function discardScheduled() {
  const raw = batchScopeBoundary;
  batchScopeBoundary = -1;

  // Scoped cancel: effects queued before the batch opened (indices < boundary)
  // are unrelated pre-batch work and must still flush; only the batch's own
  // effects (>= boundary) are dropped. boundary === queue.length is legitimate
  // here: the batch's writes hit only nodes whose effects were ALREADY queued
  // pre-batch (the node.queued dedup pushes nothing new), so keep everything
  // and drop the empty suffix. With no active scope (or a stale boundary
  // strictly past the current queue after a mid-batch flush drained it) boundary
  // collapses to 0, i.e. preserve nothing / drop the whole queue (the legacy
  // whole-queue clear). Computeds reachable from a preserved effect must NOT
  // be reset to CLEAN (the preserved effect still needs their fresh-on-pull
  // value), so collect those first and skip them.
  const boundary = (raw >= 0 && raw <= queue.length) ? raw : 0;
  const keep = queue.slice(0, boundary);
  const drop = queue.slice(boundary);

  const protectedComputeds = new Set();
  const collect = (node) => {
    if (!node || (node.flags & F_DISPOSED)) return;
    const srcs = node.sources;
    for (let i = 0; i < srcs.length; i++) {
      const s = srcs[i];
      if (s.kind === COMPUTED && !protectedComputeds.has(s)) {
        protectedComputeds.add(s);
        collect(s);
      }
    }
  };
  for (let i = 0; i < keep.length; i++) collect(keep[i]);

  // Evaluate-then-quiesce: re-evaluate the dropped effects' transitive
  // computeds BEFORE quiescing, so their cached values match the persisted
  // batch writes and a post-cancel synchronous read is never stale. Ordering
  // matters: the dropped effects still carry queued=true and non-CLEAN colors
  // here, so the wakeObservers marks these evaluations emit can neither
  // re-push nor re-schedule them; the reset pass below erases those marks.
  // Protected computeds (sources of kept effects) are deliberately NOT
  // evaluated: the kept flush relies on their value-change wake to go DIRTY
  // and re-run, and a still-marked computed is already fresh-on-pull for any
  // direct read. Cold path (cancelBatch only).
  const refreshed = new Set();
  const gather = (node) => {
    if (!node || (node.flags & F_DISPOSED)) return;
    const srcs = node.sources;
    for (let i = 0; i < srcs.length; i++) {
      const s = srcs[i];
      if (s.kind === COMPUTED && !protectedComputeds.has(s) && !refreshed.has(s)) {
        refreshed.add(s);
        gather(s);
      }
    }
  };
  for (let i = 0; i < drop.length; i++) gather(drop[i]);
  for (const c of refreshed) updateIfNecessary(c);

  const seen = new Set();
  const reset = (node) => {
    if (!node || seen.has(node) || (node.flags & F_DISPOSED)) return;
    if (node.kind === COMPUTED && protectedComputeds.has(node)) return;
    seen.add(node);
    if (node.color !== CLEAN) node.color = CLEAN;
    const srcs = node.sources;
    for (let i = 0; i < srcs.length; i++) {
      if (srcs[i].kind === COMPUTED) reset(srcs[i]);
    }
  };
  for (let i = 0; i < drop.length; i++) reset(drop[i]);

  // Rebuild the queue with only the preserved effects and re-flush them.
  // Dropped effects: clear their queued flag so a later change can re-schedule
  // them; kept effects keep queued=true (they go straight back into the queue).
  for (let i = 0; i < drop.length; i++) drop[i].queued = false;
  queue.length = 0;
  for (let i = 0; i < keep.length; i++) {
    if (keep[i].flags & F_DISPOSED) { keep[i].queued = false; continue; }
    queue.push(keep[i]);
    keep[i].queued = true;
  }
  if (queue.length && !flushScheduled && batchDepth === 0) {
    flushScheduled = true;
    queueMicrotask(flush);
  }
}

// ---------------------------------------------------------------------------
// Proxy surface: reactive(obj)
// ---------------------------------------------------------------------------

function getNode(target, key) {
  let map = nodeTable.get(target);
  if (!map) {
    map = new Map();
    nodeTable.set(target, map);
  }
  let node = map.get(key);
  if (!node) {
    node = new Node(SOURCE, key, null);
    map.set(key, node);
  }
  return node;
}

// Form a graph edge from the active observer to the (object, key) SOURCE node
// directly: getNode + track, bypassing the proxy get trap's branch checks. The
// facade's bulk-list first-run uses this to register a row effect's flat
// item-prop deps without N proxy get dispatches + the renderer's general
// consumeDep analysis. `objOrProxy` may be a tree proxy (unwrapped via RAW) or a
// raw object. No-op when nothing is observing (mirrors track's guard), so it is
// only meaningful when called inside a running effect/computed.
function linkLeaf(objOrProxy, key) {
  if (!activeObserver || suppressTracking) return;
  if (objOrProxy === null || typeof objOrProxy !== 'object') return;
  const raw = objOrProxy[RAW] || objOrProxy;
  track(getNode(raw, key));
}

// Stamp a direct-writer closure on the (object, key) SOURCE node. notifyNode
// then routes a write to that key straight through the closure, bypassing the
// observer mark/schedule. Used by the list renderer's targeted text path to
// retire the per-item effect wake for pure-single-text fields. `objOrProxy` may
// be a tree proxy (unwrapped via RAW) or a raw object. Pass `null` to clear.
function setDirectWriter(objOrProxy, key, writerFn, el) {
  if (objOrProxy === null || typeof objOrProxy !== 'object') return;
  const raw = objOrProxy[RAW] || objOrProxy;
  const node = getNode(raw, key);
  node.directWriter = writerFn;
  // Shared-writer path stores the target element here; closure writers pass no
  // el (dwEl stays null). Clearing (writerFn===null) also drops the el ref so a
  // detached row isn't pinned through the node.
  node.dwEl = el || null;
}

// Stamp a per-list dispatch sink on the (object, key) SOURCE node. notifyNode
// then applies a targeted row update synchronously through it and FALLS THROUGH
// to the normal wake (no suppression). Used by the compiled-row path to retire
// the per-item effect for eligible templates while keeping every other reader of
// the leaf correct. Pass `null` to clear (remove/clear/replace). `objOrProxy`
// may be a tree proxy (unwrapped via RAW) or a raw object.
function setListSink(objOrProxy, key, sinkFn) {
  if (objOrProxy === null || typeof objOrProxy !== 'object') return;
  const raw = objOrProxy[RAW] || objOrProxy;
  getNode(raw, key).listSink = sinkFn;
}

// Mark a raw array as operation-recording: subsequent bare index writes through
// the tree set trap append (index, newValue, oldValue) to its log so the
// structural effect's fastPath can classify a targeted operation. Idempotent;
// pass the RAW array (unwrap proxies first). The facade arms the array each time
// its full reconcile runs, so a replaced array re-arms on the first full pass.
// Shared frozen empty list returned for an absent op channel, so matchers can
// read `.length`/index uniformly without a null check. Never mutated.
const EMPTY_OPS = [];

function enableArrayOps(rawArray) {
  if (rawArray === null || typeof rawArray !== 'object') return;
  if (rawArray[ARR_OPS]) return;
  Object.defineProperty(rawArray, ARR_OPS, { value: { writes: [], mutators: [] }, enumerable: false, configurable: true, writable: true });
}

// Append one bare-index write to a managed array's log. No-op (one property
// read) for unmanaged arrays. `writes` is flat ([index, nv, ov, ...]) to avoid
// a per-write object allocation in the hot mutation path.
function recordArrayWrite(target, index, nv, ov) {
  const log = target[ARR_OPS];
  if (log !== undefined) log.writes.push(index, nv, ov);
}

// Record one normalized structural mutator as a flat [kind, start, deleteCount,
// addCount] tuple. Every supported mutator (splice/shift/pop/push/unshift)
// normalizes to splice semantics (kind 0); reverse/sort/copyWithin/fill record
// nothing, so the fastPath declines and the full reconcile runs.
function recordArrayMutator(target, start, deleteCount, addCount) {
  const log = target[ARR_OPS];
  if (log !== undefined) log.mutators.push(0, start, deleteCount, addCount);
}

// Normalize a structural mutator call into a splice descriptor and record it.
// Gated by the caller to ARR_OPS-managed arrays. `oldLen` is the length BEFORE
// the native call ran.
function recordMutatorFor(target, key, args, oldLen) {
  let start, dc, add;
  if (key === 'splice') {
    let s = args.length > 0 ? (args[0] | 0) : 0;
    if (s < 0) s = oldLen + s < 0 ? 0 : oldLen + s; else if (s > oldLen) s = oldLen;
    if (args.length < 2) dc = oldLen - s;
    else { dc = args[1] | 0; if (dc < 0) dc = 0; if (dc > oldLen - s) dc = oldLen - s; }
    add = args.length > 2 ? args.length - 2 : 0;
    start = s;
  } else if (key === 'shift') { start = 0; dc = oldLen > 0 ? 1 : 0; add = 0; }
  else if (key === 'pop') { start = oldLen > 0 ? oldLen - 1 : 0; dc = oldLen > 0 ? 1 : 0; add = 0; }
  else if (key === 'push') { start = oldLen; dc = 0; add = args.length; }
  else if (key === 'unshift') { start = 0; dc = 0; add = args.length; }
  else return; // reverse/sort/copyWithin/fill: no targeted descriptor
  recordArrayMutator(target, start, dc, add);
}

// Drain and return a managed array's recorded ops as {writes, mutators} (each a
// flat array; an empty channel is the shared frozen empty list). Returns null
// when nothing was recorded since the last drain; the fastPath then declines
// and the full reconcile runs. Clearing on every drain keeps a declined fast
// path from leaking stale ops into the next cycle.
function consumeArrayOps(rawArray) {
  const log = rawArray && rawArray[ARR_OPS];
  if (!log) return null;
  const hasW = log.writes.length > 0;
  const hasM = log.mutators.length > 0;
  if (!hasW && !hasM) return null;
  const out = { writes: hasW ? log.writes : EMPTY_OPS, mutators: hasM ? log.mutators : EMPTY_OPS };
  if (hasW) log.writes = [];
  if (hasM) log.mutators = [];
  return out;
}

// Resolve the underlying raw object behind any proxy, unwrapping repeatedly. A
// `state.list = [...state.list, x]` spread captures WRAPPED children, so the raw
// array can hold proxies that re-wrap (double-wrap) on read; comparing such a
// read against a single-wrapped proxy by identity then fails. toRaw lets callers
// compare by stable raw identity instead. Non-objects pass through.
function toRaw(x) {
  let v = x;
  while (v !== null && typeof v === 'object') {
    const r = v[RAW];
    if (r === undefined || r === v) break;
    v = r;
  }
  return v;
}

const handlers = {
  get(target, key) {
    if (key === RAW) return target;
    if (key === NODES) return nodeTable.get(target);
    const value = target[key];
    // Functions (array methods, etc.) pass through untracked in the core.
    if (typeof value === 'function') return value;
    // Reading under an observer links the source node (lazy materialization),
    // or, under a list frame, registers the leaf on the per-list sink instead.
    if (activeObserver && !suppressTracking) {
      trackRead(target, key);
    }
    // Wrap nested objects so deep reads track too (one proxy per raw object).
    if (value !== null && typeof value === 'object') return reactive(value);
    return value;
  },

  set(target, key, value) {
    // Unwrap proxies on write (see reactiveTree set): keep the raw graph free of
    // nested proxies so splice/reverse/sort can't corrupt path + NODES lookups.
    if (value !== null && typeof value === 'object' && value[RAW]) value = value[RAW];
    const old = target[key];
    if (Object.is(old, value)) return true; // no-op writes are free
    const wasArray = Array.isArray(target);
    const oldLen = wasArray ? target.length : -1;
    // Genuine key ADD (not an update of an undefined-valued existing key):
    // checked only when old === undefined, so existing-field writes pay nothing.
    const isAdd = old === undefined && !hasOwnProp.call(target, key);
    target[key] = value;
    notifyNode(target, key); // wakes observers if this leaf has a node
    // Index writes that extend (or implicitly resize) an array auto-change its
    // length without an explicit length set; pulse the length node so structural
    // readers (mapArray, list effects) wake. This covers index writes that extend
    // an array without an explicit length set (no intercepted array mutator here).
    if (wasArray && key !== 'length' && target.length !== oldLen) {
      notifyNode(target, 'length');
    }
    // New key: wake iteration readers (Object.keys / for...in / spread).
    // String keys only; symbol-keyed internal stamps are not enumerated.
    if (isAdd && !wasArray && typeof key === 'string') {
      notifyNode(target, ITERATE);
    }
    return true;
  },

  has(target, key) {
    return key in target;
  },

  ownKeys(target) {
    // Key iteration registers an iteration dependency. Arrays track their
    // 'length' node instead: every structural array path already pulses it.
    if (activeObserver && !suppressTracking) {
      track(getNode(target, Array.isArray(target) ? 'length' : ITERATE));
    }
    return Reflect.ownKeys(target);
  },

  deleteProperty(target, key) {
    if (!(key in target)) return true;
    delete target[key];
    const map = nodeTable.get(target);
    const node = map && map.get(key);
    if (node) wakeObservers(node);
    // Removed key: wake iteration readers (mirrors the set-trap add pulse).
    if (typeof key === 'string' && !Array.isArray(target)) {
      notifyNode(target, ITERATE);
    }
    return true;
  },
};

function reactive(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj[RAW]) return obj; // already a proxy
  const existing = proxyCache.get(obj);
  if (existing) return existing;
  const p = new Proxy(obj, handlers);
  proxyCache.set(obj, p);
  return p;
}

// ---------------------------------------------------------------------------
// reactiveTree(obj, notify): path-aware variant used by the EntityHandle facade
// to emit onStateChange(path, newValue, oldValue) per leaf change. reactive()
// above is left untouched (shared handlers, no notify); the reactive graph
// (nodes/track/mark) is identical here, this just threads a dot-path and a notify
// callback through the SET trap. Paths are derived lazily, only when a subscriber
// exists; here the subscriber is the facade's onStateChange.
// ---------------------------------------------------------------------------

const treeProxies = new WeakMap(); // rawTarget -> { proxy, prefix }

// Sentinel a computedResolver returns to mean "this key is not a computed";
// the get trap then falls through to normal state resolution.
const COMPUTED_MISS = Symbol('reactive-graph.computed-miss');

// Array mutators that restructure the backing array. A native call on the
// PROXY would walk the raw elements (`arr[i] = arr[i+1]` for a splice shift,
// pairwise swaps for reverse), firing one SET trap per touched index, and each
// trap would emit its own onStateChange, which on a component is the
// framework's full _handleEntityStateChange (beforeUpdate hooks, binding sweep,
// watchers, render scheduling). For `splice(i,1)` on 1000 rows that is ~1000
// full state-change dispatches for a single logical removal.
//
// So the wrapper below runs the native mutator on the RAW target instead: no
// per-index trap fires at all. It then compensates explicitly by pulsing any
// existing per-index graph nodes (genuine absolute-index readers stay correct),
// pulsing `length` once (the structural list effect's wake signal), and
// emitting ONE coalesced `<path>.length` onStateChange. Unrelated state a
// `sort` comparator touches still goes through its own proxy and dispatches
// normally.
const ARRAY_MUTATORS = new Set(['splice', 'push', 'pop', 'shift', 'unshift', 'reverse', 'sort', 'copyWithin', 'fill']);

function wrapTree(obj, prefix, notify, computedResolver) {
  if (obj === null || typeof obj !== 'object') return obj;
  const cached = treeProxies.get(obj);
  if (cached) return cached.proxy;

  const handler = {
    get(target, key) {
      if (key === RAW) return target;
      const value = target[key];
      if (typeof value === 'function') {
        // Structural array mutator: return a wrapper that coalesces the per-index
        // onStateChange storm into a single `.length` structural notify (see
        // ARRAY_MUTATORS comment). Reads/writes still run through the proxy, so
        // graph nodes stay correct; only the framework dispatch is batched.
        if (typeof key === 'string' && ARRAY_MUTATORS.has(key) && Array.isArray(target)) {
          return function (...args) {
            const oldLen = target.length;
            // Unwrap any proxy arguments (inserted elements) to raw. The set trap
            // unwrapped on store; the RAW mutator below bypasses it, so unwrap here
            // (mirrors RSM's raw-array mutators). Numeric args (start/deleteCount)
            // are skipped by the object check.
            for (let i = 0; i < args.length; i++) {
              const a = args[i];
              if (a !== null && typeof a === 'object' && a[RAW]) args[i] = a[RAW];
            }
            // Run the native mutator on the RAW target, NOT the proxy. This avoids
            // ~N per-index set-trap round-trips (+ native [[Set]] dispatch) for the
            // shifted elements, the dominant splice/remove cost. Inserted items are
            // stored raw and proxied lazily on first read by the get trap. (RSM did
            // exactly this; the prior proxy-splice was the RG remove regression.)
            const result = value.apply(target, args);
            // The structural list effect wakes via the `length` pulse below (it
            // tracks length as its single structural signal, not per-index nodes).
            // Genuine absolute-index readers (e.g. a `rows.5` binding) DO observe
            // per-index nodes; the raw mutator didn't pulse them, so wake any that
            // exist. Post-untracked-structural-reads these are rare (the structural
            // effect no longer creates them), so this walk is cheap; a spuriously
            // pulsed unchanged index re-evaluates to the same value and stops.
            const nmap = nodeTable.get(target);
            if (nmap !== undefined) {
              for (const k of nmap.keys()) {
                if (typeof k === 'string') { const ix = +k; if (ix >= 0 && (ix | 0) === ix) notifyNode(target, k); }
              }
            }
            // Wake structural readers (the list effect, length computeds) once,
            // then emit the single coalesced onStateChange for the array.
            notifyNode(target, 'length');
            notify(prefix + 'length', target.length, oldLen);
            // Record a normalized splice descriptor so the structural fastPath can
            // classify a targeted op (remove-one, append-k). Managed arrays only.
            if (target[ARR_OPS] !== undefined) recordMutatorFor(target, key, args, oldLen);
            return result;
          };
        }
        return value;
      }
      // Root-level computed bridge: `this.state.<computedName>` resolves the
      // computed (a computed read via state, not just via `this.computed.X`).
      // The state proxy falls back to computeds for absent keys. Scoped to
      // the root tree (computeds are top-level names) and to keys absent from
      // raw state, so every normal state read is untouched. evaluateComputed
      // does its own graph tracking, so the reader links to the computed node
      // rather than a phantom state node; hence we return BEFORE track() and
      // skip getNode() for the non-existent key.
      if (value === undefined && prefix === '' && computedResolver
          && typeof key === 'string' && !(key in target)) {
        const resolved = computedResolver(key);
        if (resolved !== COMPUTED_MISS) return resolved;
      }
      if (activeObserver && !suppressTracking) trackRead(target, key);
      if (value !== null && typeof value === 'object') {
        if (typeof key === 'symbol') return value; // Symbol-keyed internals are not path-observable
        // On a cache HIT, return the existing child proxy WITHOUT building the
        // `prefix + key + '.'` path string; wrapTree would only use that string to
        // construct a NEW proxy on a miss, and discards it on a hit (it caches by raw
        // object identity, not path). Skipping the concat avoids a short-string
        // allocation + GC on every repeated nested read, which dominates steady-state
        // per-frame workloads (e.g. animating thousands of list rows). Behavior is
        // identical: a cached proxy keeps the prefix from its first access either way.
        const cached = treeProxies.get(value);
        if (cached) return cached.proxy;
        return wrapTree(value, prefix + key + '.', notify, computedResolver);
      }
      return value;
    },
    set(target, key, value) {
      // Never store a proxy back into the raw graph: splice/reverse/sort read
      // elements THROUGH the proxy (get returns a wrapped child) and re-store
      // them, which would nest proxies and corrupt path + NODES lookups. Unwrap
      // to the raw target first (same stance as Vue toRaw / Solid unwrap).
      if (value !== null && typeof value === 'object' && value[RAW]) value = value[RAW];
      const old = target[key];
      if (Object.is(old, value)) return true;
      const wasArray = Array.isArray(target);
      const oldLen = wasArray ? target.length : -1;
      // Genuine key ADD (see the core set trap): checked only when
      // old === undefined, so existing-field writes pay nothing.
      const isAdd = old === undefined && !hasOwnProp.call(target, key);
      target[key] = value;
      // A directWriter handling the write (DIRECT_HANDLED) already updated its one
      // bound text node and, by the _reactiveGraphPureText gate, nothing else observes the
      // field; skip the length pulse and the onStateChange dispatch.
      if (notifyNode(target, key) === DIRECT_HANDLED) return true;
      if (wasArray && key !== 'length' && target.length !== oldLen) {
        notifyNode(target, 'length');
      }
      // New key: wake iteration readers (Object.keys / for...in / spread).
      // A genuine ADD cannot carry a direct writer (writers are only stamped
      // on fields a rendered binding already read), so this sits safely after
      // the DIRECT_HANDLED early return above.
      if (isAdd && !wasArray && typeof key === 'string') {
        notifyNode(target, ITERATE);
      }
      // NOTE: structural mutators run against the RAW target (see the wrapper
      // above), so this trap never fires for a mutator's own element shifts;
      // every write reaching here is a genuine user-level write and dispatches
      // unconditionally.
      notify(prefix + key, value, old);
      // Record bare index writes on a managed array (outside any structural
      // mutator) so the structural effect's fastPath can classify a targeted
      // op. Integer non-negative keys only; 'length' and method writes excluded.
      if (wasArray && typeof key === 'string') {
        const idx = +key;
        if (idx >= 0 && (idx | 0) === idx) {
          recordArrayWrite(target, idx, value, old);
          // Structure signal (RSM-style coarse wake): on a bare index write
          // (swap/replace) to a managed list array, pulse `length` so the
          // structural list effect (which tracks `length` as its single
          // structural signal) wakes and drains the recorded op via its
          // fastPath. This decouples structural wake from per-index node
          // tracking (see the structural effect's untracked index reads), so a
          // splice need not pulse ~N index nodes. notifyNode on an unchanged
          // length value is a cheap version bump; length computeds re-eval to
          // the same value and stop at the graph's value-equality check.
          if (target[ARR_OPS] !== undefined) notifyNode(target, 'length');
        }
      }
      return true;
    },
    has(target, key) { return key in target; },
    ownKeys(target) {
      // Key iteration registers an iteration dependency (see the core
      // handlers' ownKeys). Arrays alias to their 'length' node.
      if (activeObserver && !suppressTracking) {
        track(getNode(target, Array.isArray(target) ? 'length' : ITERATE));
      }
      return Reflect.ownKeys(target);
    },
    deleteProperty(target, key) {
      if (!(key in target)) return true;
      const old = target[key];
      delete target[key];
      const map = nodeTable.get(target);
      const node = map && map.get(key);
      if (node) wakeObservers(node);
      // Removed key: wake iteration readers (mirrors the set-trap add pulse).
      if (typeof key === 'string' && !Array.isArray(target)) {
        notifyNode(target, ITERATE);
      }
      notify(prefix + key, undefined, old);
      return true;
    },
  };

  const proxy = new Proxy(obj, handler);
  treeProxies.set(obj, { proxy, prefix });
  return proxy;
}

function reactiveTree(obj, notify, computedResolver) {
  return wrapTree(obj, '', notify || (() => {}), computedResolver);
}

// ---------------------------------------------------------------------------
// computed(fn) / effect(fn, opts) / batch / untrack
// ---------------------------------------------------------------------------

function computed(fn) {
  const node = new Node(COMPUTED, null, fn);
  node.color = DIRTY; // unevaluated until first read
  const getter = function () {
    if (node.flags & F_DISPOSED) return node.value;
    updateIfNecessary(node);
    if (activeObserver && !suppressTracking) track(node);
    if (node.error) throw node.error;
    return node.value;
  };
  getter.__node = node;
  return getter;
}

function effect(fn, opts) {
  const node = new Node(EFFECT, null, fn);
  if (opts && opts.stable) node.flags |= F_STABLE;
  if (opts && opts.sync) node.flags |= F_SYNC;
  node.color = DIRTY;
  updateIfNecessary(node); // run immediately to collect deps
  const dispose = function () { disposeNode(node); };
  dispose.__node = node;
  return dispose;
}

// Force an effect to re-run on the next flush, re-tracking its sources. Use
// when an effect must re-read state the graph can't yet see it depends on:
// e.g. a list row whose item proxy was swapped for a new same-key object, so
// the row's effect needs to drop the old object's edges and link the new one's.
// runNode's cleanupSources + relink does the retracking; this only schedules it.
function refresh(node) {
  if (node && node.kind === EFFECT && !(node.flags & F_DISPOSED)) mark(node, DIRTY);
}

// Force an effect to re-run SYNCHRONOUSLY NOW (not on the next flush): mark it
// dirty, then pull. The _runEffect contract: the prop-propagation
// (EntitySystem) and cross-entity store-nudge (StoreManager) wake paths set
// effect.dirty then call _runEffect to re-read state the graph can't see it
// depends on (props are plain objects, not graph nodes) within the same
// synchronous turn, before onPropsChange / the computed flush run. Re-running
// here (vs scheduling) leaves the node CLEAN, so a later flush skips it.
function runEffect(node) {
  if (!node || node.kind !== EFFECT || (node.flags & F_DISPOSED)) return;
  mark(node, DIRTY);
  updateIfNecessary(node);
}

function batch(fn) {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) flush();
  }
}

function untrack(fn) {
  const prev = activeObserver;
  activeObserver = null;
  try {
    return fn();
  } finally {
    activeObserver = prev;
  }
}

// ---------------------------------------------------------------------------
// Probes for tests / benches (not part of the eventual facade surface)
// ---------------------------------------------------------------------------

function __nodeOf(getterOrDispose) { return getterOrDispose && getterOrDispose.__node; }

export {
  reactive,
  reactiveTree,
  COMPUTED_MISS,
  computed,
  effect,
  refresh,
  linkLeaf,
  setDirectWriter,
  setListSink,
  runInListFrame,
  enableArrayOps,
  consumeArrayOps,
  toRaw,
  runEffect,
  batch,
  untrack,
  flushSync,
  discardScheduled,
  beginBatchScope,
  endBatchScope,
  setFlushObserver,
  F_REENTERED,
  // probes
  __nodeOf,
  // constants (for white-box tests)
  CLEAN,
  CHECK,
  DIRTY,
  SOURCE,
  COMPUTED,
  EFFECT,
};
