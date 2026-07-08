/**
 * list-reconciler: the keyed-list reconciler extracted from the EntityHandle
 * facade. It is a DOM-list reconciler that closes only over ReactiveGraph core
 * primitives (effect/refresh/toRaw/untrack/array-op channel), not over any
 * facade state, so it lives as a free function (`reconcile`) the facade calls
 * through a one-line shim (sm.mapArray -> reconcile). The body matches the
 * framework mapArray contract that ListRenderer drives.
 */

import {
  effect as mEffect,
  refresh as mRefresh,
  toRaw as mToRaw,
  untrack as mUntrack,
  enableArrayOps as mEnableArrayOps, consumeArrayOps as mConsumeArrayOps,
} from './core.js';

// Longest strictly-increasing subsequence of `arr`, returned as the Set of
// POSITIONS that belong to it (entries === -1 are non-survivors and skipped).
// Used by mapArray's move pass: positions in this set are already in correct
// relative DOM order, so they need no move; everything else does. O(n log n)
// patience-sorting with predecessor links for reconstruction.
function _lisKeepSet(arr) {
  const n = arr.length;
  const tails = [];                 // tails[k] = position ending the best length-(k+1) run
  const prev = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    if (v === -1) continue;         // freshly inserted row: not part of the survivor LIS
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[tails[mid]] < v) lo = mid + 1; else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set();
  let k = tails.length ? tails[tails.length - 1] : -1;
  while (k !== -1) { keep.add(k); k = prev[k]; }
  return keep;
}

// Dispose a reconciler row entry's per-row effect. Shared by mapArray's
// append/move/replace/reconcile paths; swallows a double-dispose on an
// already-gone effect.
function _disposeRow(e) {
  if (e && e.disposeEffect) { try { e.disposeEffect(); } catch (_) { /* already gone */ } }
}

export function reconcile(arrayFn, mapFn, options = {}) {
    const keyProp = options.key;
    // Key by item[keyProp], falling back to the index when that value is absent
    // (the framework's defaultKey behavior). Lists without an id field are then keyed
    // positionally, so replacing one item is a same-key in-place update (its row
    // is reused and onItemUpdate refreshes the bindings) rather than a churn.
    const keyOf = keyProp
      ? ((it, i) => { const k = (it == null ? undefined : it[keyProp]); return (k === undefined || k === null) ? i : k; })
      : ((it, i) => (it == null ? i : it));
    // entries: { key, element, itemProxy, disposeEffect }; mapFn returns
    // { element, disposeEffect }, and the DOM callbacks take .element.
    let prev = [];

    // Structural fast paths apply only to keyed lists that can move rows: a
    // keyless (index-keyed) list treats an in-place value change as a same-key
    // update, not a move, so an exchange is two updates, not a swap. Gating
    // here also ensures the op log is only armed when a fastPath will drain it.
    const useFastPaths = !!(keyProp && options.onMove);

    const dispose = mEffect(() => {
      const arr = arrayFn() || [];
      const n = arr.length;                 // track length
      // Read keys off the RAW array so the structural effect does NOT track (and
      // allocate) a key node per row: it only needs to react to structural change
      // length (append/remove) and index reassignment (reorder/replace, tracked
      // via the items[i] proxy read below). An item's KEY changing in place is not
      // a structural change (it is effectively a different item) and the framework's
      // pattern-dep model doesn't react to it either, so reading keys untracked is
      // parity-faithful and saves N getNode+track per reconcile (cross-cutting:
      // create/replace/append/swap/remove/clear).
      const rawArr = mToRaw(arr);
      // Arm operation recording on the live array so a subsequent in-place
      // mutation (e.g. a swap) is captured for the structural fastPath. Runs each
      // full reconcile, so a replaced array re-arms here on its first full pass.
      // Only when a fastPath exists to drain the log (else it would grow unbounded).
      if (useFastPaths) mEnableArrayOps(rawArr);
      const items = new Array(n);
      const keys = new Array(n);
      // Read indices UNTRACKED. The effect's single structural signal is `length`
      // (tracked above): a splice changes it, and a bare index write (swap/replace)
      // now pulses it too (the set-trap's structure signal on managed arrays). So
      // the effect no longer needs to observe ~N per-index nodes to react to a
      // reorder, which is what made a splice pulse ~N index nodes. Per-index nodes
      // now exist only for genuine absolute-index readers (e.g. a `rows.5` binding),
      // not the structural effect. items[i] is still the proxy (the get-trap wraps
      // regardless of tracking); keys read raw as before.
      mUntrack(() => {
        for (let i = 0; i < n; i++) { items[i] = arr[i]; keys[i] = keyOf(rawArr[i], i); }
      });

      const oldByKey = new Map();
      const oldIndexByKey = new Map();
      // Clear (n===0) takes the full-clear fast path below, which works off `prev`
      // directly and never reads these key maps. Skip the 2×oldLen Map.set on a
      // clear of a large list, where it is pure waste.
      if (n !== 0) {
        for (let i = 0; i < prev.length; i++) { oldByKey.set(prev[i].key, prev[i]); oldIndexByKey.set(prev[i].key, i); }
      }
      const used = new Set();
      const next = new Array(n);
      const oldLen = prev.length;
      let anyCreated = false;

      mUntrack(() => {
        // Full-clear fast path: the list emptied (`state.rows = []`) with existing
        // rows. Dispose every per-item effect, then batch-clean + clear the DOM via
        // onBulkRemove (one cleanup pass + replaceChildren) instead of N per-item
        // onRemove calls (each tears down contexts/nested components + el.remove).
        if (n === 0 && oldLen > 0 && options.onBulkRemove) {
          for (let i = 0; i < prev.length; i++) {
            _disposeRow(prev[i]);
          }
          const oldEls = new Array(prev.length);
          for (let i = 0; i < prev.length; i++) oldEls[i] = prev[i].element;
          options.onBulkRemove(oldEls, prev);
          if (options.onComplete) options.onComplete(arr, oldLen, 0);
          return; // cleared; skip the per-item reconcile
        }
        // Bulk-create fast path: initial render of a large keyed list. ListRenderer's
        // onBulkCreate clones a cached row prototype and writes each text binding
        // straight to textContent in one DocumentFragment (the ~85% of create-script
        // that the per-item mapFn path spends on serialize/bind), inserting the rows
        // itself; onDeferredEffects then creates each row's per-item effect (passing
        // arrPath=undefined so, under ReactiveGraph, each effect does a normal first-run
        // graph dep registration, no index routing). Gated to oldLen===0 (initial)
        // and n>=10 to match the framework's bulk threshold, so small lists (including
        // the white-box tests that assert eager per-row contexts) keep the mapFn path;
        // and to keyed lists, since onBulkCreate keys by index for keyless lists
        // which would mismatch this reconciler's identity keyOf. onBulkCreate returns
        // null for templates it can't fast-path (polymorphic / custom elements / no
        // innerHTML parts) → fall through to the per-item loop below.
        if (oldLen === 0 && n >= 10 && keyProp && options.onBulkCreate) {
          const bulkResults = options.onBulkCreate(arr, keyProp, 0);
          if (bulkResults && bulkResults.length > 0) {
            for (let i = 0; i < n; i++) {
              const r = bulkResults[i];
              next[i] = r
                ? { key: r.key, element: r.element, itemProxy: r.itemProxy, disposeEffect: r.disposeEffect }
                : { key: keys[i], element: undefined, itemProxy: items[i], disposeEffect: null };
            }
            // onDeferredEffects writes each created disposeEffect back into the
            // matching next[] entry (keyed by .key), so survivors dispose correctly.
            if (options.onDeferredEffects) options.onDeferredEffects(bulkResults, next, undefined);
            if (options.onComplete) options.onComplete(arr, oldLen, n);
            return; // bulk handled; rows already inserted; skip the per-item reconcile
          }
        }
        // Append bulk fast path: a large tail of new rows appended to an unchanged
        // front (the `[...items, ...more]` / push pattern). When the first oldLen
        // entries are the SAME keys and SAME item proxies in order (no reorder, no
        // removal, no replacement) and the new tail is >=10, reuse the existing rows
        // untouched and bulk-create only [oldLen, n) via onBulkCreate(arr, key,
        // oldLen), which appends (startIndex>0) without disturbing the front.
        if (oldLen > 0 && n - oldLen >= 10 && keyProp && options.onBulkCreate) {
          // Front entries must be the SAME items in order. Proxy identity is the
          // fast check the prioritized direct-mutation (push) path hits with zero
          // overhead; only an immutable append (`[...rows, x]`), which spreads the
          // reactive proxy and stores re-wrapping children, needs the raw-identity
          // fallback, paid only when the proxy check fails.
          let pureAppend = true;
          for (let i = 0; i < oldLen; i++) {
            if (keys[i] !== prev[i].key) { pureAppend = false; break; }
            if (items[i] !== prev[i].itemProxy && mToRaw(items[i]) !== mToRaw(prev[i].itemProxy)) { pureAppend = false; break; }
          }
          if (pureAppend) {
            const bulkResults = options.onBulkCreate(arr, keyProp, oldLen);
            if (bulkResults && bulkResults.length > 0) {
              for (let i = 0; i < oldLen; i++) { next[i] = prev[i]; used.add(keys[i]); }
              for (let j = 0; j < bulkResults.length; j++) {
                const r = bulkResults[j];
                const idx = oldLen + j;
                next[idx] = r
                  ? { key: r.key, element: r.element, itemProxy: r.itemProxy, disposeEffect: r.disposeEffect }
                  : { key: keys[idx], element: undefined, itemProxy: items[idx], disposeEffect: null };
              }
              if (options.onDeferredEffects) options.onDeferredEffects(bulkResults, next, undefined);
              if (options.onComplete) options.onComplete(arr, oldLen, n);
              return; // append handled; front reused, tail appended; skip the reconcile
            }
          }
        }
        // Full-replace bulk fast path: the whole array swapped for new objects with
        // new keys (a full "replace all rows"). When NONE of the new keys exist in
        // the old set, every old row is removed and every new row created, so dispose
        // the old per-item effects, run the batched cleanup+clear (onBulkRemove),
        // then bulk-create the new rows. Same-key-new-object replacement is a
        // DIFFERENT case (keys overlap) and falls through to the reconcile, which
        // reuses each row and re-tracks via mRetrack.
        if (oldLen > 0 && n >= 10 && keyProp && options.onBulkCreate && options.onBulkRemove) {
          let overlap = false;
          for (let i = 0; i < n; i++) { if (oldByKey.has(keys[i])) { overlap = true; break; } }
          if (!overlap) {
            // Dispose old effects, then batch-clean + clear the old rows.
            for (let i = 0; i < prev.length; i++) {
              const e = prev[i];
              _disposeRow(e);
            }
            const oldEls = new Array(prev.length);
            for (let i = 0; i < prev.length; i++) oldEls[i] = prev[i].element;
            options.onBulkRemove(oldEls, prev);
            // Bulk-create into the now-empty container. onBulkCreate returns null for
            // templates it can't fast-path; recreate those per-item (container is
            // already empty, so onInsert appends in order).
            const bulkResults = options.onBulkCreate(arr, keyProp, 0);
            if (bulkResults && bulkResults.length > 0) {
              for (let i = 0; i < n; i++) {
                const r = bulkResults[i];
                next[i] = r
                  ? { key: r.key, element: r.element, itemProxy: r.itemProxy, disposeEffect: r.disposeEffect }
                  : { key: keys[i], element: undefined, itemProxy: items[i], disposeEffect: null };
              }
              if (options.onDeferredEffects) options.onDeferredEffects(bulkResults, next, undefined);
            } else {
              for (let i = 0; i < n; i++) {
                const res = mapFn(items[i], i, false) || {};
                next[i] = { key: keys[i], element: res.element, itemProxy: items[i], disposeEffect: res.disposeEffect };
                if (options.onInsert && next[i].element) options.onInsert(next[i].element, i);
              }
            }
            if (options.onComplete) options.onComplete(arr, oldLen, n);
            return; // replace handled; old cleared, new created; skip the reconcile
          }
        }
        for (let i = 0; i < n; i++) {
          const k = keys[i];
          const ex = oldByKey.get(k);
          if (ex && !used.has(k)) {
            used.add(k);
            if (ex.itemProxy !== items[i]) {
              // Same key, new object (e.g. whole-array replace): onItemUpdate
              // re-points the row's bookkeeping (_itemData/_listIndex, sink
              // stamps moved to the new raw, nested-list refresh) and applies
              // the row's full binding set against the new proxy; rows have
              // no per-item effect, so it is the sole applier.
              if (options.onItemUpdate) options.onItemUpdate(ex.element, items[i], ex.itemProxy, i);
            }
            ex.itemProxy = items[i];
            next[i] = ex;
          } else {
            anyCreated = true;
            const res = mapFn(items[i], i, false) || {};
            next[i] = { key: k, element: res.element, itemProxy: items[i], disposeEffect: res.disposeEffect };
            if (options.onInsert && next[i].element) options.onInsert(next[i].element, i);
          }
        }
        for (let i = 0; i < prev.length; i++) {
          const e = prev[i];
          if (!used.has(e.key)) {
            if (options.onRemove) options.onRemove(e.element, e.key);
            _disposeRow(e);
          }
        }
        // Reorder surviving rows into the new sequence. Walk right-to-left so
        // each element's reference (the element that should follow it) is
        // already in place: refElement = next[i+1].element, or null for the
        // tail (append). insertBefore(el, next[i+1].element) processed this way
        // yields the target order in minimal moves. When the element already
        // sits before its reference it is in place; pass skipDomMove=true so
        // the consumer still refreshes index metadata without touching the DOM.
        // New rows (oldIdx === -1) were positioned by onInsert above; onMove
        // here only corrects their final slot if a survivor shifted past them.
        //
        // LIS-minimal moves: for a pure reorder/remove (nothing created this
        // reconcile) compute the longest run of survivors already in increasing
        // old-index order. Those rows are in correct relative position and stay
        // put; only the rest move. This collapses a far swap from O(n) DOM moves
        // (the naive nextSibling check moves every row between the two swapped
        // ends) to the minimal set (2 for a swap). When rows WERE created,
        // onInsert has already disturbed the DOM mid-pass, so the LIS invariant
        // no longer holds; fall back to the dynamic nextSibling check
        // (correct, just not move-minimal for that mixed case).
        if (options.onMove) {
          let keepInPlace = null;
          if (!anyCreated) {
            const oldOrder = new Array(n);
            for (let i = 0; i < n; i++) {
              oldOrder[i] = oldIndexByKey.has(next[i].key) ? oldIndexByKey.get(next[i].key) : -1;
            }
            keepInPlace = _lisKeepSet(oldOrder);
          }
          for (let i = n - 1; i >= 0; i--) {
            const e = next[i];
            const el = e.element;
            if (!el) continue;
            const ref = (i + 1 < n) ? next[i + 1].element : null;
            const oldIdx = oldIndexByKey.has(e.key) ? oldIndexByKey.get(e.key) : -1;
            if (oldIdx === -1) continue; // freshly inserted: already placed by onInsert
            const inPlace = keepInPlace ? keepInPlace.has(i) : (el.nextSibling === ref);
            // Fully unchanged row: same index value AND already in the right DOM slot.
            // onMove would only re-write the identical _listIndex/_bindItemIndex and
            // re-check DOM position; skip it. For a far swap or a single removal this
            // collapses ~N onMove calls to just the rows whose index actually shifted.
            if (inPlace && oldIdx === i) continue;
            options.onMove(el, i, oldIdx, ref, inPlace);
          }
        }
        if (options.onComplete) options.onComplete(arr, oldLen, n);
      });

      prev = next;
    }, { scope: options.scope });

    // === Structural operation fast paths ===
    // The structural effect above runs a full O(n) keyed reconcile on every
    // structural change (it rebuilds the key→index maps, re-tracks N index
    // nodes, and runs an LIS pass) even when the change touched only a couple
    // of rows (a swap, a single removal, a single move). For those the cost is
    // pure waste: the graph already recorded the EXACT mutation at the write site
    // (recordArrayWrite for bare index writes, recordMutatorFor for splice-family
    // mutators; armed via mEnableArrayOps above), so we can classify the
    // operation precisely (no heuristics, no timers) and apply a targeted O(k)
    // update, then skip the full body. The core's runNode invokes this BEFORE
    // cleanup/retrack; returning true preserves the effect's index-node edges,
    // correct for length-preserving ops (their tracked-node SET is invariant) and
    // for a single removal (the dropped tail node simply goes unobserved, and the
    // surviving indices keep the edges they already had).
    //
    // Each matcher is `(arr, raw, ops) => bool` where ops = {writes, mutators}
    // (flat arrays: index triples and [kind,start,del,add] tuples). A matcher
    // inspects the channel it cares about (requiring the other empty for a clean
    // classification), applies its operation against `prev`, and returns true; or
    // false so the next matcher (and ultimately the full reconcile) gets a turn.
    // Add a fast path by adding a matcher. Order: cheapest/most-specific first.
    const fastPathMatchers = useFastPaths ? [
      // In-place swap of two distinct rows (any A/B exchange):
      // exactly two index writes, length unchanged, values exchanged. Length-
      // preserving, so the index-node edge set is invariant.
      function tryInPlaceSwap(arr, raw, ops) {
        if (ops.mutators.length !== 0) return false;
        const writes = ops.writes;
        if (writes.length !== 6) return false;          // not exactly 2 index writes
        const a = writes[0], b = writes[3];
        if (a === b) return false;                       // same index written twice
        const n = arr.length;
        if (n !== prev.length) return false;             // length changed → not a swap
        if (a < 0 || b < 0 || a >= n || b >= n) return false;
        const ea = prev[a], eb = prev[b];
        if (!ea || !eb) return false;
        // Confirm a genuine exchange against the LIVE array (recorded values may
        // be superseded by a later write; the live read is authoritative): the
        // item now at a is the row that was at b, and vice versa.
        if (mToRaw(arr[a]) !== mToRaw(eb.itemProxy)) return false;
        if (mToRaw(arr[b]) !== mToRaw(ea.itemProxy)) return false;
        // Swap the entries (their element/key/disposeEffect travel with the row).
        prev[a] = eb; prev[b] = ea;
        prev[a].itemProxy = arr[a];
        prev[b].itemProxy = arr[b];
        // Move the two elements into place. Process the higher index first so the
        // lower index's reference element is still settled when we move it.
        const lo = a < b ? a : b, hi = a < b ? b : a;
        const refHi = (hi + 1 < n) ? prev[hi + 1].element : null;
        if (prev[hi].element) options.onMove(prev[hi].element, hi, lo, refHi, false);
        const refLo = (lo + 1 < n) ? prev[lo + 1].element : null;
        if (prev[lo].element) options.onMove(prev[lo].element, lo, hi, refLo, false);
        // Position-frame conditionals (_first/_last, item computeds) re-evaluate
        // for the moved rows; a no-op when the template uses no positional vars.
        if (options.onComplete) options.onComplete(arr, n, n);
        return true;
      },
      // Single-row removal (splice(i,1) / shift / pop): one
      // splice descriptor that deletes exactly one item and adds none, length
      // dropped by one. Remove that DOM row, then renumber the rows after it
      // (their _listIndex shifts down by one; list-item action dispatch reads it,
      // so it MUST stay accurate, but no DOM move is needed; deleting the node
      // shifts the rest visually). onMove with skipDomMove=true does exactly that.
      function tryRemoveOne(arr, raw, ops) {
        if (ops.writes.length !== 0) return false;
        const mut = ops.mutators;
        if (mut.length !== 4) return false;              // not exactly one mutator
        if (mut[0] !== 0) return false;                  // not splice-kind
        const start = mut[1], del = mut[2], add = mut[3];
        if (del !== 1 || add !== 0) return false;        // not a pure single removal
        const n = arr.length;
        if (n !== prev.length - 1) return false;         // length must drop by one
        if (start < 0 || start >= prev.length) return false;
        // Validate the shift against the LIVE array: the row that was after the
        // removed slot now sits at `start`.
        if (start < n && mToRaw(arr[start]) !== mToRaw(prev[start + 1].itemProxy)) return false;
        const removed = prev[start];
        if (options.onRemove) options.onRemove(removed.element, removed.key);
        _disposeRow(removed);
        prev.splice(start, 1);
        for (let i = start; i < prev.length; i++) {
          if (prev[i].element) options.onMove(prev[i].element, i, i + 1, null, true);
        }
        if (options.onComplete) options.onComplete(arr, n + 1, n);
        return true;
      },
      // Single-row move (drag-reorder via index reassignment): a contiguous run
      // of index writes that left- or right-rotates a range [lo..hi] by one, i.e.
      // one row moved from one end of the range to the other while the rest shift
      // by a position. Length-preserving. One DOM move + O(range) index renumber.
      function tryMoveRotation(arr, raw, ops) {
        if (ops.mutators.length !== 0) return false;
        const writes = ops.writes;
        const k = writes.length / 3;
        if (k < 3) return false;                         // 2 writes are a swap, not a move
        const n = arr.length;
        if (n !== prev.length) return false;
        // Written indices must be a contiguous range [lo..hi] of exactly k slots.
        let lo = Infinity, hi = -Infinity;
        for (let w = 0; w < writes.length; w += 3) {
          const ix = writes[w];
          if (ix < lo) lo = ix; if (ix > hi) hi = ix;
        }
        if (hi - lo + 1 !== k) return false;             // not contiguous / has gaps
        if (lo < 0 || hi >= n) return false;
        // Classify the rotation by checking the live array against prev:
        //  - left-rotation: row that was at lo is now at hi; lo..hi-1 hold old lo+1..hi.
        //  - right-rotation: row that was at hi is now at lo; lo+1..hi hold old lo..hi-1.
        const leftRot = mToRaw(arr[hi]) === mToRaw(prev[lo].itemProxy);
        const rightRot = mToRaw(arr[lo]) === mToRaw(prev[hi].itemProxy);
        if (leftRot === rightRot) return false;          // ambiguous or neither → full reconcile
        // Verify every position in the range matches the rotation hypothesis, so a
        // non-rotation set of k writes safely declines.
        if (leftRot) {
          for (let i = lo; i < hi; i++) if (mToRaw(arr[i]) !== mToRaw(prev[i + 1].itemProxy)) return false;
        } else {
          for (let i = lo + 1; i <= hi; i++) if (mToRaw(arr[i]) !== mToRaw(prev[i - 1].itemProxy)) return false;
        }
        // Apply to prev[]: the moved entry travels; the rest of the range shifts.
        if (leftRot) {
          const moved = prev[lo];
          for (let i = lo; i < hi; i++) prev[i] = prev[i + 1];
          prev[hi] = moved;
        } else {
          const moved = prev[hi];
          for (let i = hi; i > lo; i--) prev[i] = prev[i - 1];
          prev[lo] = moved;
        }
        for (let i = lo; i <= hi; i++) prev[i].itemProxy = arr[i];
        // Single DOM move: place the moved element at its new slot; the rest of the
        // range shifts visually on their own. Then renumber the range (no DOM move).
        const movedIdx = leftRot ? hi : lo;
        const ref = (movedIdx + 1 < n) ? prev[movedIdx + 1].element : null;
        if (prev[movedIdx].element) options.onMove(prev[movedIdx].element, movedIdx, leftRot ? lo : hi, ref, false);
        for (let i = lo; i <= hi; i++) {
          if (i === movedIdx) continue;
          if (prev[i].element) options.onMove(prev[i].element, i, -1, null, true);
        }
        if (options.onComplete) options.onComplete(arr, n, n);
        return true;
      },
    ] : null;

    if (fastPathMatchers && dispose.__node) {
      dispose.__node.fastPath = function structuralFastPath() {
        let handled = false;
        mUntrack(() => {
          const arr = arrayFn() || [];
          const raw = mToRaw(arr);
          const ops = mConsumeArrayOps(raw); // drains the log; null when empty
          if (!ops) return;                  // nothing recorded → full reconcile
          for (let m = 0; m < fastPathMatchers.length; m++) {
            if (fastPathMatchers[m](arr, raw, ops)) { handled = true; return; }
          }
        });
        return handled;
      };
    }

    // Disposing the mapping must cascade to every surviving row's per-item
    // effect (the framework contract). Removed rows already had their disposeEffect
    // called during reconciliation, so prev holds only survivors; each is
    // disposed exactly once over the mapping's lifetime.
    const stop = () => {
      dispose();
      for (let i = 0; i < prev.length; i++) {
        _disposeRow(prev[i]);
      }
      prev = [];
    };
    // Expose an in-place refresh so a parent list reusing this nested list's host
    // element (same key, new parent-item identity) can re-run the reconcile
    // against the preserved `prev` (reusing/moving keyed children) instead of
    // disposing and rebuilding the whole nested subtree. The structural effect
    // node rides on the effect's dispose handle (effect() sets dispose.__node).
    stop.__refresh = () => { if (dispose && dispose.__node) mRefresh(dispose.__node); };
    return stop;
  }
