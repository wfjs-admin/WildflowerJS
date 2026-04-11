/**
 * ArrayOperationDetection - Reconstructing high-level array operations from
 * low-level proxy traps
 *
 * These methods are assigned to ReactiveStateManager.prototype.
 *
 * ## The Core Problem
 *
 * When a user writes `this.state.items.push(newItem)`, the JavaScript engine
 * executes the native Array.prototype.push, which triggers proxy set traps at
 * the individual property level: `set(target, '5', newItem)` followed by
 * `set(target, 'length', 6)`. The framework never sees a "push" call — it only
 * sees these low-level signals.
 *
 * The list renderer needs to know the high-level operation (append, swap, splice)
 * so it can use an optimized DOM update path — appending a single element is O(1),
 * while diffing and rebuilding an entire list is O(n). This module exists to
 * reverse-engineer the user's intent from the proxy trap sequence.
 *
 * ## Mutation Tracking State Machine
 *
 * The `_arrayIndexMutations` object acts as a state machine that tracks
 * in-flight mutations for the currently active array:
 *
 * - Index mutations accumulate (up to 3) with timestamps. The initial array
 *   length is captured on the first mutation.
 * - After 2 mutations with unchanged length: a swap detection check is
 *   scheduled via setTimeout(0), deferring analysis until the synchronous
 *   mutation batch completes.
 * - When length DECREASES after index mutations: a splice is detected, and the
 *   isSpliceInProgress flag is set so the proxy set trap can suppress redundant
 *   notifications for the remaining index shifts.
 * - When length INCREASES after index mutations: an append is detected.
 * - A 500ms gap between mutations resets tracking, allowing the next batch to
 *   be analyzed independently.
 *
 * ## Operation Types Detected
 *
 * - **append**: length increased, array prefix is unchanged — items were added
 *   at the end. The list renderer can append new DOM nodes without touching
 *   existing ones.
 * - **swap**: exactly 2 index mutations, length unchanged, and the values at
 *   those indices were cross-assigned (A[i] got old A[j] and vice versa). The
 *   renderer can swap two DOM nodes in place.
 * - **splice**: index mutations followed by a length decrease — items were
 *   removed. The renderer removes specific DOM nodes and shifts remaining ones.
 * - **sparse-update**: scattered property changes across multiple array items
 *   (e.g., updating a field on items 2, 5, and 9). The renderer updates only
 *   the affected DOM nodes at those indices.
 * - **property-change-hint**: a subset of indices had property changes — a
 *   lighter signal than sparse-update used when only a few properties changed.
 *
 * ## Collision Detection
 *
 * When different operation types are detected for the same array path within
 * one synchronous batch (e.g., an append and a swap on the same array in the
 * same microtask), both operations are discarded and a collision lockout is set
 * for that path. This forces the list renderer to perform a full re-render,
 * which is always correct even if suboptimal. The lockout clears after a
 * microtask (Promise.resolve().then) to allow the next batch to attempt
 * optimization normally.
 *
 * This defensive strategy prevents a class of subtle bugs where two conflicting
 * optimizations would produce an inconsistent DOM state.
 *
 * ## Path Reindexing After Splice
 *
 * After a splice removes items from the middle of an array, the remaining items
 * shift to lower indices. However, each item's proxy target still carries a
 * PATH_SYMBOL pointing to its old position (e.g., "items.3" for an item that
 * is now at index 2). `_reindexArrayItemPaths` walks the array starting from
 * the first mutated index and corrects each item's PATH_SYMBOL to reflect its
 * new position. Without this, subsequent state changes on those items would
 * update bindings at the wrong index, producing stale or misplaced DOM content.
 *
 * ## Bulk Property Batching
 *
 * When updating a property across many array items in a loop (e.g., toggling
 * `selected` on all 100 rows), each individual property write would normally
 * trigger a separate state change notification. Instead, individual property
 * updates on array items are batched via setTimeout(0). The batch accumulates
 * affected indices and property names, then emits a single sparse-update
 * operation so the list renderer can update only the affected cells in one pass.
 *
 * @module
 */

import { arrayDetector } from '../core/wfUtils.js';
import { PATH_SYMBOL, ARRAY_PATH_SYMBOL } from './RSMConstants.js';

/**
 * V8 OPTIMIZATION: Single canonical shape for all array operation objects.
 * V8 inline caches work best when the same call sites always see objects
 * with identical hidden classes. By always creating objects with the same
 * property set (unused fields set to null), we keep _arrayOperations access
 * monomorphic across all operation types.
 */
function createArrayOperation(type) {
    return {
        type: type,
        startIndex: 0,
        count: 0,
        newItems: null,
        removedCount: 0,
        index1: -1,
        index2: -1,
        item1: null,
        item2: null,
        changes: null,
        totalChanges: 0,
        commonProperties: null,
        interval: 0,
        changedIndices: null,
        timestamp: Date.now()
    };
}

/**
 * Methods to be mixed into ReactiveStateManager.prototype
 */
export { createArrayOperation };
export const ArrayOperationMethods = {
    /**
     * Reset array index mutations to default state (V8 hidden class stable)
     * Instead of setting to null which changes object shape, we reset properties
     * @private
     */
    _resetArrayIndexMutations() {
        this._arrayIndexMutations.mutations.length = 0;
        this._arrayIndexMutations.lastMutationTime = 0;
        this._arrayIndexMutations.initialArrayLength = 0;
        this._arrayIndexMutations.isSpliceInProgress = false;
        this._arrayIndexMutations.spliceStartIndex = null;
    },

    /**
     * Store an array operation with collision detection.
     * If a different operation type already exists for this path, delete both
     * to force a full render (prevents optimization bugs with mixed operations).
     * @param {string} path - The array path
     * @param {Object} operation - The operation to store
     * @returns {boolean} - true if stored, false if collision caused deletion
     */
    _storeArrayOperation(path, operation) {
        // Check if this path is locked out due to recent collision
        if (this._collisionLockout.has(path)) {
            return false;
        }

        const existing = this._arrayOperations.get(path);

        if (existing) {
            // Same operation type - allow overwrite/update
            if (existing.type === operation.type) {
                // For append operations, combine the counts
                if (operation.type === 'append' && existing.count !== undefined && operation.count !== undefined) {
                    operation.count = (existing.count || 1) + (operation.count || 1);
                    operation.startIndex = existing.startIndex; // Keep original start index
                }
                this._arrayOperations.set(path, operation);
                return true;
            }

            // Different operation types - collision! Delete to force full render
            this._arrayOperations.delete(path);
            this._setCollisionLockout(path);
            return false;
        }

        // No existing operation - just store it
        this._arrayOperations.set(path, operation);
        return true;
    },

    /**
     * Set a collision lockout for a path to prevent new hints until next render
     * @param {string} path - The array path to lock out
     */
    _setCollisionLockout(path) {
        this._collisionLockout.add(path);

        // Clear lockout after a microtask (allows current sync operations to complete)
        Promise.resolve().then(() => {
            if (this._collisionLockout) {
                this._collisionLockout.delete(path);
            }
        });
    },

    /**
     * Handle array length property changes (push/splice append/removal detection)
     * Called when prop === 'length' on an array target
     * @param {Array} targetObj - The array being modified
     * @param {number} newLength - The new length value
     * @param {string} path - The array path
     * @returns {void}
     * @private
     */
    _handleArrayLengthChange(targetObj, newLength, path) {
        // Use initialArrayLength from index mutations tracking
        const hasIndexMutations = this._arrayIndexMutations.mutations.length > 0;
        const trackedInitialLength = hasIndexMutations ? this._arrayIndexMutations.initialArrayLength : 0;
        const initialLength = trackedInitialLength || targetObj.length;
        // Detect append operation (length increased)
        if (newLength > initialLength) {
            // Check for pending swap detection - collision case
            if (this._swapDetectionPending) {
                this._swapDetectionPending = false;
                // Clear mutation tracking — microtask will no-op when it sees mutations.length !== 2
                this._resetArrayIndexMutations();
                // Clear existing operation for this path
                if (this._arrayOperations) {
                    this._arrayOperations.delete(path);
                }
                // Set lockout to prevent subsequent operations
                this._setCollisionLockout(path);
            } else {
                // No pending swap - safe to store append hint
                const op = createArrayOperation('append');
                op.startIndex = initialLength;
                op.count = newLength - initialLength;
                const stored = this._storeArrayOperation(path, op);

                // Only clear index mutations if append was stored successfully
                if (stored) {
                    this._resetArrayIndexMutations();
                }
                // Mark that an operation was already processed for this path.
                // If a swap microtask fires later for the same path, it should
                // skip storing a swap hint (effects handle it via reconciliation).
                this._recentArrayStatePath = path;
            }
        }
        // Detect splice/removal operation (length decreased)
        else if (newLength < initialLength && hasIndexMutations) {
            // Cancel any pending swap detection — microtask will no-op
            this._swapDetectionPending = false;

            // PERF: Set splice flag EARLY to prevent item effects from being marked dirty
            // When items shift indices (501→500), their effect paths appear to change
            // but the actual data is unchanged - mapArray handles DOM updates directly
            // Without this, ~9499 item effects would be marked dirty and re-run
            this._arrayIndexMutations.isSpliceInProgress = true;

            // Store operation hint for splice BEFORE clearing tracking
            // This persists through the microtask queue processing
            const spliceOp = createArrayOperation('splice');
            spliceOp.removedCount = initialLength - newLength;
            this._arrayOperations.set(path, spliceOp);

            // CRITICAL FIX: Re-index proxy paths after splice
            // When items shift positions, their PATH_SYMBOL becomes stale
            // e.g., after splice(0,1), item at index 1 shifts to 0 but still has path "items.1"
            // This causes subsequent property updates to target wrong DOM elements
            // OPTIMIZATION: Only reindex from the first mutated index onwards
            // Items before the splice point don't change indices
            const mutations = this._arrayIndexMutations.mutations;
            const startIndex = mutations.length > 0
                ? Math.min(...mutations.map(m => m.index))
                : 0;
            this._reindexArrayItemPaths(targetObj, path, startIndex);

            // NOTE: _itemEffectsByIndex splice is handled by mapArray's structural effect
            // (single-remove fast paths or keyed diff rebuild). Do NOT splice here —
            // it would double-splice since mapArray also splices when it processes the removal.

            // Clear mutation tracking (but keep isSpliceInProgress flag set)
            this._arrayIndexMutations.mutations.length = 0;
            this._arrayIndexMutations.lastMutationTime = 0;
            this._arrayIndexMutations.initialArrayLength = 0;
            // NOTE: Do NOT reset isSpliceInProgress here - it will be cleared by mapArray

            // Set lockout
            this._setCollisionLockout(path);
        }
    },

    /**
     * Handle array index mutations for swap detection
     * Called when prop is a numeric index on an array
     * @param {Array} targetObj - The array being modified
     * @param {string} prop - The index being set (as string)
     * @param {*} oldValue - Previous value at index
     * @param {*} newValue - New value being set
     * @param {string} path - The array path
     * @returns {boolean} Whether to continue with immediate render (false = defer to timeout)
     * @private
     */
    _handleArrayIndexMutation(targetObj, prop, oldValue, newValue, path) {
        // PERF: Ultra-fast path for splice in progress - skip ALL processing
        // This reduces 10,000+ function calls to nearly zero overhead
        if (this._arrayIndexMutations.isSpliceInProgress) {
            return true;
        }

        const now = Date.now();

        // Note: _arrayIndexMutations is pre-initialized in constructor for V8 hidden class stability

        const timeSinceLastMutation = now - this._arrayIndexMutations.lastMutationTime;

        // If >500ms since last mutation, start new tracking period
        if (timeSinceLastMutation > 500) {
            this._arrayIndexMutations.mutations.length = 0; // Clear without creating new array
            this._arrayIndexMutations.initialArrayLength = targetObj.length;
            this._arrayIndexMutations.isSpliceInProgress = false;
        }

        // Store initial array length on first mutation
        if (this._arrayIndexMutations.mutations.length === 0) {
            this._arrayIndexMutations.initialArrayLength = targetObj.length;
            this._arrayIndexMutations.isSpliceInProgress = false;
        }

        const index = parseInt(prop, 10);
        const initialLen = this._arrayIndexMutations.initialArrayLength;

        // Check for collision with existing operation hint
        if (this._arrayOperations.has(path)) {
            this._arrayOperations.delete(path);
            this._arrayIndexMutations.mutations.length = 0; // Clear without creating new array
            this._arrayIndexMutations.lastMutationTime = 0;
            this._arrayIndexMutations.initialArrayLength = targetObj.length;
            this._arrayIndexMutations.isSpliceInProgress = false;
            this._setCollisionLockout(path);
        }

        // Record mutation (only keep up to 3 for swap/append detection)
        if (this._arrayIndexMutations.mutations.length < 3) {
            this._arrayIndexMutations.mutations.push({
                path: path,
                index: index,
                oldValue: oldValue,
                newValue: newValue,
                timestamp: now
            });
        }
        this._arrayIndexMutations.lastMutationTime = now;

        const mutationCount = this._arrayIndexMutations.mutations.length;

        // Schedule swap detection if exactly 2 mutations
        if (mutationCount === 2) {
            const [mut1, mut2] = this._arrayIndexMutations.mutations;

            // Check for append pattern (both indices >= initialArrayLength)
            const isAppendPattern = mut1.index >= initialLen && mut2.index >= initialLen;

            if (!isAppendPattern) {
                // Schedule swap detection via microtask (fires before paint, same frame).
                // No cancellation needed — _processSwapDetection validates mutation state.
                if (!this._swapDetectionPending) {
                    this._swapDetectionPending = true;
                    queueMicrotask(() => {
                        this._swapDetectionPending = false;
                        this._processSwapDetection(targetObj, path);
                    });
                }
            }
        }
        // Note: We don't pre-emptively mark splice-in-progress at 3 mutations anymore.
        // The length change handler (_handleArrayLengthChange) properly detects actual splices.
        // Pre-emptive detection was breaking consecutive swaps which have 4 mutations total.

        return true; // Continue with normal set
    },

    /**
     * Process deferred swap detection
     * Called after timeout to check if mutations form a swap pattern
     * @param {Array} targetObj - The array
     * @param {string} path - The array path
     * @private
     */
    _processSwapDetection(targetObj, path) {
        if (this._arrayIndexMutations.mutations.length !== 2) {
            // Not exactly 2 mutations - check other scenarios
            if (this._arrayIndexMutations.mutations.length > 2) {
                this._arrayIndexMutations.mutations.length = 0; // Clear without creating new array
                this._handleStateChange(path, targetObj, targetObj);
            }
            return;
        }

        const [mut1, mut2] = this._arrayIndexMutations.mutations;

        // Verify real swap pattern: same path, length unchanged
        if (mut1.path === mut2.path && targetObj.length === this._arrayIndexMutations.initialArrayLength) {
            // If another operation (append, splice) already triggered rendering
            // for this path in this tick, skip storing a swap hint — the effect
            // system will reconcile the swap via normal data diffing.
            const recentOp = this._recentArrayStatePath === mut1.path;
            if (recentOp) {
                this._recentArrayStatePath = null;
            } else {
                const item1 = mut2.newValue;
                const item2 = mut1.newValue;

                const swapOp = createArrayOperation('swap');
                swapOp.index1 = mut1.index;
                swapOp.index2 = mut2.index;
                swapOp.item1 = item1;
                swapOp.item2 = item2;
                this._storeArrayOperation(mut1.path, swapOp);
            }

            this._arrayIndexMutations.mutations.length = 0; // Clear without creating new array
            this._handleStateChange(path, targetObj, targetObj);
        }
        // 2 mutations but length changed = partial splice
        else if (targetObj.length !== this._arrayIndexMutations.initialArrayLength) {
            this._arrayIndexMutations.mutations.length = 0; // Clear without creating new array
            this._handleStateChange(path, targetObj, targetObj);
        }
    },

    /**
     * Re-index array item proxy paths after splice/shift operations.
     * When items shift positions, their PATH_SYMBOL becomes stale.
     * This updates each item's path to match its current array index.
     * @param {Array} array - The array that was spliced (this is the target, not proxy)
     * @param {string} arrayPath - The path to the array (e.g., "items")
     * @param {number} startIndex - Index to start reindexing from (optimization: skip unchanged items)
     * @private
     */
    _reindexArrayItemPaths(array, arrayPath, startIndex = 0) {
        // Only iterate from startIndex onwards - items before splice point are unchanged
        for (let i = startIndex; i < array.length; i++) {
            const item = array[i];
            if (item && typeof item === 'object') {
                // The item in the array is the raw object (target)
                // Check if it has PATH_SYMBOL set (meaning it was proxied before)
                if (item[PATH_SYMBOL] !== undefined) {
                    const correctPath = `${arrayPath}.${i}`;
                    const oldPath = item[PATH_SYMBOL];
                    if (oldPath !== correctPath) {
                        item[PATH_SYMBOL] = correctPath;
                        // Also clear cached ARRAY_PATH_SYMBOL since path changed
                        item[ARRAY_PATH_SYMBOL] = undefined;
                        // NOTE: Effect dep reindexing is now handled per-item
                        // inside mapArray fast paths via _reindexItemEffectDeps
                    }
                }
            }
        }
    },

    /**
     * Handle array item property updates with bulk batching
     * Called for paths like "rows.0.label" (array item property, not index mutation)
     * @param {Object} targetObj - The object being modified
     * @param {string} prop - The property being set
     * @param {*} value - New value
     * @param {*} oldValue - Previous value
     * @param {string} fullPath - Full path to property
     * @param {string} arrayPath - Path to parent array
     * @param {Object} receiver - Proxy receiver
     * @returns {boolean|null} Result of set, or null if not handled
     * @private
     */
    _handleArrayPropertyUpdate(targetObj, prop, value, oldValue, fullPath, arrayPath, receiver) {
        // PERF: Skip Date.now() — bulk mode is always active during rapid updates.
        // The 50ms timeout check was only needed for edge cases; bulk mode resets
        // after each flush anyway. This saves a syscall per property write.
        if (!this._bulkArrayUpdates.active) {
            this._bulkArrayUpdates.active = true;
            this._bulkArrayUpdates.lastUpdateTime = Date.now();
        }

        this._bulkArrayUpdates.count++;
        this._bulkArrayUpdates.arrayPaths.add(arrayPath);

        // PERF: Track pending change (skip if already tracked — dedup by path)
        if (!this._bulkArrayUpdates.pendingChanges.has(fullPath)) {
            this._bulkArrayUpdates.pendingChanges.set(fullPath, { newValue: value, oldValue: targetObj[prop] });
        }

        // Apply the change
        const result = Reflect.set(targetObj, prop, value, receiver);

        // Schedule bulk update notification
        if (!this._bulkArrayUpdateTimeout) {
            // PERF: Use microtask instead of setTimeout(0) so bulk updates
            // flush before browser paint — keeps everything in one frame.
            this._bulkArrayUpdateTimeout = true;
            queueMicrotask(() => {
                this._bulkArrayUpdateTimeout = null;
                this._processBulkArrayUpdates();
            });
        }

        return result;
    },

    /**
     * Process accumulated bulk array updates
     * Called after timeout to batch property changes
     * @private
     */
    _processBulkArrayUpdates() {
        // PERF: Single epoch increment for entire batch instead of per-path
        // (was incrementing per-path — 200 increments → 1)
        this._globalEpoch++;

        // PERF: Batch version increments and effect notifications
        for (const changePath of this._bulkArrayUpdates.pendingChanges.keys()) {
            this._updatedPaths.add(changePath);
            // Version increment (for computed property staleness)
            this._stateVersions.set(changePath, (this._stateVersions.get(changePath) || 0) + 1);
            // Effect notification
            this._notifyEffectDependents(changePath);
            // Mark dependent computeds dirty
            const dependentComputeds = this.computedDependencies.get(changePath);
            if (dependentComputeds && dependentComputeds.size > 0) {
                this._markComputedsDirtyTransitively(dependentComputeds);
            }
        }

        // Notify parent arrays with sparse-update metadata
        for (const arrayPath of this._bulkArrayUpdates.arrayPaths) {
            const arrayValue = this.getValue(arrayPath);
            if (arrayValue && Array.isArray(arrayValue)) {
                // Build sparse-update operation from pending changes
                // Use index-based string parsing to avoid split()/slice()/join() allocations
                const changes = new Map();
                let commonProperties = null;
                const prefixLen = arrayPath.length + 1; // skip "arrayPath."

                for (const [changePath] of this._bulkArrayUpdates.pendingChanges) {
                    if (changePath.length > prefixLen && changePath.charCodeAt(prefixLen - 1) === 46 /* '.' */ && changePath.startsWith(arrayPath)) {
                        // Parse index and property from subPath without split/slice/join
                        const dotPos = changePath.indexOf('.', prefixLen);
                        const indexStr = dotPos === -1 ? changePath.substring(prefixLen) : changePath.substring(prefixLen, dotPos);
                        const index = parseInt(indexStr, 10);
                        const property = dotPos === -1 ? '' : changePath.substring(dotPos + 1);

                        if (!isNaN(index)) {
                            let changedProps = changes.get(index);
                            if (!changedProps) {
                                changedProps = new Set();
                                changes.set(index, changedProps);
                            }

                            changedProps.add(property || '*');

                            if (property) {
                                if (commonProperties === null) {
                                    commonProperties = new Set(changedProps);
                                } else {
                                    for (const prop of commonProperties) {
                                        if (!changedProps.has(prop)) {
                                            commonProperties.delete(prop);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Store sparse-update operation if we have changes
                if (changes.size > 0) {
                    const sparseOp = createArrayOperation('sparse-update');
                    sparseOp.changes = changes;
                    sparseOp.totalChanges = changes.size;
                    sparseOp.commonProperties = commonProperties || [];
                    this._arrayOperations.set(arrayPath, sparseOp);
                }

                // Increment version for array path (for computed property staleness)
                // This is needed for computed properties that depend on patterns like "items.*"
                this._stateVersions.set(arrayPath, (this._stateVersions.get(arrayPath) || 0) + 1);
                this._globalEpoch++;

                // Mark dependent computeds dirty for the parent array path.
                // Computeds like activeCount depend on 'users' (the array), not
                // individual item paths like 'users.1.active'.
                // NOTE: We intentionally DON'T call _notifyEffectDependents(arrayPath)
                // because that would trigger the structural mapArray effect.
                // _markComputedsDirtyTransitively handles effect notification via
                // the computed path (e.g., 'computed:activeCount').
                const arrayComputedDeps = this.computedDependencies.get(arrayPath);
                if (arrayComputedDeps && arrayComputedDeps.size > 0) {
                    this._markComputedsDirtyTransitively(arrayComputedDeps);
                }

                // Trigger array-level notification for list renderer (via onStateChange callback)
                // but DON'T call _notifyEffectDependents(arrayPath) - that would trigger the
                // structural Effect even though only nested properties changed.
                // Effects were already notified for individual property paths above.
                this.onStateChange(arrayPath, arrayValue, arrayValue);
            }
        }

        // Auto-save to localStorage if enabled
        // Nested array property mutations bypass _handleStateChange (which has autoSave),
        // so we must trigger it here after processing the batched updates
        if (this.autoSave && this.storageKey) {
            this._saveToStorage();
        }

        // Reset bulk update tracking
        this._bulkArrayUpdates.active = false;
        this._bulkArrayUpdates.count = 0;
        this._bulkArrayUpdates.lastUpdateTime = 0;
        this._bulkArrayUpdates.arrayPaths.clear();
        this._bulkArrayUpdates.pendingChanges.clear();
        this._bulkArrayUpdateTimeout = null;
    },

// Detect if new array is just old array + appended items
    _detectArrayAppend(oldArray, newArray, path) {
        // SSR check: Force full render on first update for SSR components
        if (__FEATURE_SSR__ && oldArray && oldArray.length > 0 && !this._ssrListsInitialized.has(path) && this.component) {
            this._ssrListsInitialized.add(path);
            const wf = this._wf;
            if (wf && wf.componentInstances) {
                const instance = wf.componentInstances.get(this.component.id);
                if (instance && instance.element && instance.element.hasAttribute('data-ssr')) {
                    return null; // Force full render to ensure all items get event bindings
                }
            }
        }

        // Delegate to arrayDetector for the pure detection logic
        return arrayDetector.detectAppend(oldArray, newArray);
    },


    /**
     * Detect if two arrays differ by exactly one swap of two elements.
     * @param {Array} oldArray - Previous array state
     * @param {Array} newArray - Current array state
     * @returns {Object|null} Swap indices {i, j} or null if not a simple swap
     * @private
     */
    _detectArraySwap(oldArray, newArray) {
        // Delegate to arrayDetector for the pure detection logic
        const result = arrayDetector.detectSwap(oldArray, newArray);
        if (!result) return null;
        // V8 OPT: Wrap in canonical shape instead of mutating foreign object
        const op = createArrayOperation('swap');
        op.index1 = result.index1;
        op.index2 = result.index2;
        op.item1 = result.item1;
        op.item2 = result.item2;
        return op;
    },


    // Detect sparse property updates across an array
    _detectSparsePropertyUpdate(oldArray, newArray) {
        // Delegate to arrayDetector for the pure detection logic
        const result = arrayDetector.detectSparseUpdate(oldArray, newArray);
        if (!result) return null;
        // V8 OPT: Wrap in canonical shape instead of mutating foreign object
        const op = createArrayOperation('sparse-update');
        op.changes = result.changes;
        op.totalChanges = result.totalChanges;
        op.commonProperties = result.commonProperties || [];
        op.interval = result.interval || 0;
        return op;
    }
};
