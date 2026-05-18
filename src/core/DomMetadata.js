/**
 * DomMetadata - Module-scoped WeakSet/WeakMap storage for DOM element metadata
 *
 * Replaces DOM expando properties with WeakSet (boolean flags) and WeakMap (cached values).
 * Benefits: no DOM pollution, automatic GC when elements are removed, smaller mangling reserved list.
 *
 * @module
 */

// ═══════════════════════════════════════════════════════════════
// Group A — Boolean flags (WeakSets)
// ═══════════════════════════════════════════════════════════════

/** Elements bound by list rendering (prevents component from overwriting) */
export const listBoundElements = new WeakSet();

/** Elements with action bindings applied by PortalSystem */
export const actionBoundElements = new WeakSet();

/** Elements with model bindings applied by PortalSystem */
export const modelBoundElements = new WeakSet();

/** List item elements needing deferred component initialization */
export const needsComponentInitSet = new WeakSet();

/** Elements adopted from SSR (server-side rendered) */
export const ssrAdoptedElements = new WeakSet();

/** SSR list elements whose state has changed (allows re-rendering) */
export const ssrStateChangedElements = new WeakSet();

/** SSR elements with action binding enabled during protection */
export const ssrAllowActionsElements = new WeakSet();

/** Form elements currently handling a submit (prevents double-fire) */
export const handlingSubmitSet = new WeakSet();

// ═══════════════════════════════════════════════════════════════
// Group B — Cached metadata (WeakMaps)
// ═══════════════════════════════════════════════════════════════

/** Cached static portal attributes: { target, show, render } */
export const portalMetaCache = new WeakMap();

/** Cached input validation constraints */
export const validationCache = new WeakMap();

/** Cached parsed key modifiers for action elements */
export const keyModifiersCache = new WeakMap();

/** Cached slot data: { data, path } */
export const slotDataCache = new WeakMap();

/** Cached template element (removed from DOM during list init) */
export const storedTemplateCache = new WeakMap();

/** Cached polymorphic template array (removed from DOM during list init) */
export const storedTemplatesCache = new WeakMap();

/** Cached Set of bound action keys per element (dedup guard) */
export const boundActionsCache = new WeakMap();

// ═══════════════════════════════════════════════════════════════
// Group C — Portal context references (WeakMaps)
// ═══════════════════════════════════════════════════════════════

/** Cached resolved list item context for portal elements */
export const listItemContextCache = new WeakMap();

/** List item context stored on portaled content/binding elements */
export const portalListItemContextCache = new WeakMap();

/** Binding context for portaled data-bind elements */
export const bindingContextCache = new WeakMap();

/** Binding context for portaled data-bind-class elements */
export const classBindingContextCache = new WeakMap();

/** Binding context for portaled data-bind-style elements */
export const styleBindingContextCache = new WeakMap();

/** Array of {eventType, handler} for portal event cleanup */
export const portalHandlersCache = new WeakMap();
