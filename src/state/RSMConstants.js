/**
 * RSMConstants - Shared symbols for ReactiveStateManager sub-modules
 *
 * These symbols are used across multiple RSM sub-modules (ProxyHandlers,
 * ComputedPropertyManager) for proxy metadata storage.
 * Centralizing them here avoids circular imports.
 *
 * @module
 */

// ===================================================================
// V8 SHARED HANDLER OPTIMIZATION
// Symbols for storing proxy metadata on targets to enable handler reuse.
// Instead of creating new closure-based handlers for each proxy,
// we create one handler per RSM instance and store path/RSM on targets.
// This eliminates handler allocation overhead during Create operations.
// ===================================================================
export const RSM_SYMBOL = Symbol('rsmInstance');
export const PATH_SYMBOL = Symbol('proxyPath');
export const ARRAY_PATH_SYMBOL = Symbol('arrayPath');
export const ERRORED_SYMBOL = Symbol('erroredComputed');
