/**
 * createStateManager: the single seam through which every entity (component,
 * store, plugin) obtains its reactive core.
 *
 * The core is ReactiveGraph: the EntityHandle facade over the reactive-graph
 * core (state/reactive-graph/).
 *
 * setStateManagerImpl() allows a process-wide runtime override, used by the
 * reactive-graph node/jsdom integration tests to inject the handle explicitly.
 */

import { EntityHandle } from './reactive-graph/entity-handle.js';

let _impl = EntityHandle;

/**
 * Override the reactive core implementation process-wide. Pass a class with the
 * state-manager surface, or null to restore the default (EntityHandle).
 */
function setStateManagerImpl(cls) {
  _impl = cls || EntityHandle;
}

/** Construct the active reactive core for one entity. */
function createStateManager(options) {
  return new _impl(options);
}

export { createStateManager, setStateManagerImpl };
