/**
 * Probe entry (thread extension, Probe 7): the reactive graph, headless.
 *
 * Bundles the ReactiveGraph core plus the EntityHandle facade and NOTHING else
 * from the framework, so the built file can be loaded into a Web Worker to
 * prove the graph runs where there is no DOM. This is a probe artifact, not a
 * shipped tier: it is not in the 21-lane matrix and not in the sizes check.
 *
 * Built by the normal pipeline (scripts/build-rollup.cjs), so __DEV__ folds
 * and, on the mangled variant, the mangle allowlist renames internals exactly
 * as it does for the shipped tiers. See probe-reactive-graph-in-worker.test.js.
 */

import { EntityHandle } from './state/reactive-graph/entity-handle.js';
import {
  reactive,
  reactiveTree,
  computed,
  effect,
  batch,
  untrack,
  flushSync,
  toRaw,
  setFlushObserver,
} from './state/reactive-graph/core.js';

export {
  EntityHandle,
  reactive,
  reactiveTree,
  computed,
  effect,
  batch,
  untrack,
  flushSync,
  toRaw,
  setFlushObserver,
};
