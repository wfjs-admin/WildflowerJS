/**
 * createStateManager: the single seam through which every entity (component,
 * store, plugin) obtains its reactive core.
 *
 * The core is ReactiveGraph: the EntityHandle facade over the reactive-graph
 * core (state/reactive-graph/).
 *
 * This was a switch once. During the 2026-06 spike two cores existed, the
 * legacy ReactiveStateManager and the handle, and `setStateManagerImpl(cls)`
 * chose between them for an integration test. The legacy core is gone, the
 * handle is the only implementation, and that test was deleted on 2026-09-20,
 * so the override went with it rather than stay as a seam with nothing on the
 * other side.
 */

import { EntityHandle } from './reactive-graph/entity-handle.js';

/** Construct the reactive core for one entity. */
function createStateManager(options) {
  return new EntityHandle(options);
}

export { createStateManager };
