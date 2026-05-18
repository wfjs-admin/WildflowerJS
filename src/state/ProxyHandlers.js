/**
 * ProxyHandlers - Shared proxy trap handlers for reactive state interception
 *
 * These methods are assigned to ReactiveStateManager.prototype.
 *
 * ## Why Two Handlers (Array vs Object)?
 *
 * Arrays need fundamentally different interception logic from plain objects:
 * - Length change detection to identify push/splice/pop operations
 * - Numeric index mutation tracking for swap detection
 * - A splice-in-progress flag to suppress redundant effect notifications while
 *   the engine is mid-splice (multiple set traps fire for a single logical operation)
 *
 * Objects need none of this. Combining both into a single handler would require
 * branching on every get/set trap invocation — code that sits in the hottest path
 * of the entire framework. Two separate handlers keep each branch-free and let V8
 * generate tighter JIT code for the common case.
 *
 * ## Why Symbols on Targets Instead of Closures?
 *
 * The original design created a new handler closure per proxy, capturing `path` and
 * `rsmInstance` in the closure scope. This meant V8 could not share hidden classes
 * across handlers — each was a unique object shape, defeating inline caching and
 * bloating memory for deep state trees.
 *
 * The shared handler pattern stores metadata on the target object itself using
 * well-known Symbols:
 * - RSM_SYMBOL: back-reference to the owning ReactiveStateManager instance
 * - PATH_SYMBOL: the dot-delimited property path for this proxy's position in the tree
 * - ARRAY_PATH_SYMBOL: cached parent array path (avoids repeated string splitting)
 *
 * V8 treats Symbol-keyed properties as hidden — they do not affect the object's
 * hidden class, do not appear in for...in or Object.keys(), and do not interfere
 * with JSON.stringify. One handler instance is created per RSM, then reused for
 * every proxy in that state tree regardless of depth.
 *
 * ## Get Trap Decision Tree
 *
 * The get trap follows a specific priority order optimized for the common case
 * (reading a primitive state value, which should return as fast as possible):
 *
 * 1. **Skip symbols and special properties** (__proto__, constructor) — prevents
 *    infinite recursion when the engine inspects the proxy itself.
 * 2. **Read value from target FIRST** — Reflect.get happens before any path
 *    computation. This enables the fast primitive exit below without computing
 *    a child path string that will never be used.
 * 3. **Primitive fast path**: if the value is not an object, route through
 *    computed property resolution, register the read with the active effect
 *    (if any), and return immediately. No proxy wrapping is needed.
 * 4. **Object path**: computed routing, effect dependency registration, then
 *    a type check — plain objects and arrays get wrapped in a child proxy;
 *    built-in types (Date, RegExp, Map, Set, DOM nodes) pass through unwrapped
 *    because proxying them breaks their internal slots.
 *
 * ## Set Trap Decision Tree
 *
 * The set trap handles multiple orthogonal concerns in a carefully ordered sequence:
 *
 * 1. **Unchanged value detection** — uses Object.is() for correct NaN and
 *    signed-zero semantics (NaN === NaN should not trigger an update,
 *    +0 !== -0 should).
 * 2. **Array length change delegation** — when the 'length' property is set,
 *    control is handed to _handleArrayLengthChange which reconstructs the
 *    high-level operation (append, splice, truncation).
 * 3. **Ultra-fast path for root primitive updates** — when path is empty (root
 *    level) and the value is primitive, _handleStateChange logic is inlined
 *    directly to avoid function call overhead on the most common write pattern.
 * 4. **HTML flash prevention** — during initial component setup, HTML binding
 *    updates are deferred to prevent visible content flashing before the
 *    framework finishes initialization.
 * 5. **Array index mutation tracking** — numeric index writes on arrays are
 *    recorded in _arrayIndexMutations for later swap/splice pattern matching
 *    via a setTimeout(0) deferred analysis.
 * 6. **Array item property batching** — when multiple properties on array items
 *    are updated in a tight loop (e.g., marking all rows as selected), updates
 *    are aggregated into a single bulk notification.
 * 7. **Array replacement detection** — after mutations accumulate, pattern
 *    matching determines whether the operation is an append, swap, sparse
 *    update, or something else entirely.
 * 8. **State change notification** — dispatched synchronously, via microtask
 *    batching, or via explicit batch mode depending on framework configuration.
 *
 * @module
 */

import { RSM_SYMBOL, PATH_SYMBOL, ARRAY_PATH_SYMBOL } from './RSMConstants.js';
import { createArrayOperation } from './ArrayOperationDetection.js';

/**
 * Methods to be mixed into ReactiveStateManager.prototype
 */
export const ProxyHandlerMethods = {
    /**
     * Ultra-fast inline write for root-level primitive properties. Shared
     * implementation between the array and object set traps — both handlers
     * gate on the same conditions (no nested path, primitive value, primitive
     * old value, no batching, microtask batching not eligible) and then run
     * an identical sequence of operations. Extracting here keeps the two
     * gate sites in lockstep so future changes to the version-bump / effect-
     * notify / onStateChange / auto-save sequence don't have to be applied
     * twice.
     *
     * Only called when `!useMicrotaskBatching` (sync mode, component opt-out,
     * or global disable). With microtask batching as default, this path is
     * dead code for most production components, so the call-overhead cost of
     * extraction is negligible in practice.
     *
     * @returns {boolean} The result of the underlying Reflect.set
     * @private
     */
    _inlinePrimitiveSet(targetObj, prop, value, oldValue, receiver) {
        const result = Reflect.set(targetObj, prop, value, receiver);
        if (result) {
            // Inline the essential _handleStateChange work
            this._stateVersions.set(prop, (this._stateVersions.get(prop) || 0) + 1);
            this._globalEpoch++;
            if (this.component && this.component.isVirtual && !this._hasDOMDependents) {
                // Virtual-entity specialization (store / plugin / pool entity
                // with no DOM bindings): skip updatedPaths, effects, dirty
                // propagation, and onStateChange — there is nothing downstream
                // to notify, so a version bump is sufficient. Lean eval will
                // re-evaluate dependents lazily on next read.
            } else {
                // Standard sync-mode path: notify effects, propagate to
                // dependent computeds, fire onStateChange for component
                // re-render scheduling.
                this._updatedPaths.add(prop);
                this._notifyEffectDependents(prop);
                const dependentComputeds = this.computedDependencies.get(prop);
                if (dependentComputeds && dependentComputeds.size > 0) {
                    this._markComputedsDirtyTransitively(dependentComputeds);
                }
                this.onStateChange(prop, value, oldValue);
            }
            // Auto-save to localStorage if enabled
            if (this.autoSave && this.storageKey) {
                this._saveToStorage();
            }
        }
        return result;
    },

    /**
     * V8 OPTIMIZATION: Creates a shared handler for Array proxies.
     * This handler is created ONCE per RSM instance and reused for all array proxies.
     * Path and RSM reference are stored on targets via symbols, not in closures.
     * @returns {Object} Proxy handler object
     * @private
     */
    _createSharedArrayHandler() {
        return {
            get(targetObj, prop, receiver) {
                // Skip special properties and symbols
                if (typeof prop === 'symbol' || prop === '__proto__' || prop === 'constructor') {
                    return Reflect.get(targetObj, prop, receiver);
                }

                // Get path from target's symbol property
                const path = targetObj[PATH_SYMBOL];
                const self = targetObj[RSM_SYMBOL];

                // V8 OPTIMIZATION: Get value FIRST to enable fast primitive exit
                const value = Reflect.get(targetObj, prop, receiver);

                // V8 OPTIMIZATION: Fast primitive exit - skip all processing for non-objects
                if (value === null || typeof value !== 'object') {
                    // COMPUTED PROPERTY ROUTING
                    if (!path && self.computed && self.computed[prop]) {
                        return self.evaluateComputed(prop);
                    }

                    // PERF: STATIC computed bypass — skip all tracking and string work.
                    // Deps are deterministic, so no tracking needed during _updateNode.
                    if (self._skipTracking) return value;

                    // Track dependencies for primitives
                    const fullPath = path ? `${path}.${prop}` : prop;

                    // EFFECT SYSTEM: Register effect dependency
                    // PERF: Skip during splice operations — index shifts move
                    // existing item paths around (501→500, etc.) but the
                    // underlying data is the same; effects already have those
                    // paths in their dep set from the pre-splice render and
                    // mapArray reconciles the row set directly. Re-registering
                    // every shifted index would be O(n) per splice with no
                    // benefit. Anti-pattern footgun: an effect that mutates an
                    // array via splice and continues reading entries in the
                    // same evaluation will NOT register the post-mutation
                    // reads as deps. Don't write effects that splice + read
                    // mid-execution.
                    if (!self._arrayIndexMutations.isSpliceInProgress) {
                        self._registerEffectDependency(fullPath);
                    }

                    // PERF: Lightweight tracking for _updateNode dep comparison.
                    // Just collect dep paths — no Map/Set writes to dependency indexes.
                    if (self._nodeTrackingSet) {
                        self._nodeTrackingSet.add(fullPath);
                    } else if (self.activeComputation) {
                        self._trackDependency(fullPath);
                        if (path) {
                            if (!self._objectPropertyDependencies.has(path)) {
                                self._objectPropertyDependencies.set(path, new Set());
                            }
                            self._objectPropertyDependencies.get(path).add(String(prop));
                            self._boundProperties.add(fullPath);
                        }
                    }

                    return value;
                }

                // COMPUTED PROPERTY ROUTING (for object-valued computed properties)
                if (!path && self.computed && self.computed[prop]) {
                    return self.evaluateComputed(prop);
                }

                // PERF: STATIC computed bypass — return raw value, no proxy wrapping.
                if (self._skipTracking) return value;

                // Calculate path for objects
                const fullPath = path ? `${path}.${prop}` : prop;

                // EFFECT SYSTEM: Register effect dependency
                // PERF: Skip during splice operations — see the matching skip
                // in the primitive branch above for rationale and the
                // splice-mid-read anti-pattern that this optimization
                // intentionally does not protect against.
                if (!self._arrayIndexMutations.isSpliceInProgress) {
                    self._registerEffectDependency(fullPath);
                }

                // Track dependencies for object access
                // PERF: Lightweight tracking for _updateNode dep comparison.
                if (self._nodeTrackingSet) {
                    self._nodeTrackingSet.add(fullPath);
                } else if (self.activeComputation) {
                    self._trackDependency(fullPath);
                    if (path) {
                        if (!self._objectPropertyDependencies.has(path)) {
                            self._objectPropertyDependencies.set(path, new Set());
                        }
                        self._objectPropertyDependencies.get(path).add(String(prop));
                        self._boundProperties.add(fullPath);
                    }
                }

                // Constructor-based type checking (best overall performance)
                const ctor = value.constructor;

                // Fast path: Plain objects and arrays
                if (ctor === Object || ctor === Array) {
                    return self._createReactiveProxy(value, fullPath);
                }

                // Skip built-in objects that don't work well with Proxies
                if (ctor === Date || ctor === RegExp ||
                    ctor === Map || ctor === Set ||
                    ctor === WeakMap || ctor === WeakSet ||
                    value instanceof Node) {
                    return value;
                }

                // Custom objects - wrap in proxy
                return self._createReactiveProxy(value, fullPath);
            },

            set(targetObj, prop, value, receiver) {
                // Skip special properties and symbols
                if (typeof prop === 'symbol' || prop === '__proto__' || prop === 'constructor') {
                    return Reflect.set(targetObj, prop, value, receiver);
                }

                // Get path and RSM from target's symbol properties
                const path = targetObj[PATH_SYMBOL];
                const self = targetObj[RSM_SYMBOL];

                // Early exit for unchanged values
                // Use Object.is() for proper NaN and signed zero handling:
                // - Object.is(NaN, NaN) = true (prevents unnecessary updates)
                // - Object.is(+0, -0) = false (correctly detects signed zero changes)
                const oldValue = Reflect.get(targetObj, prop, receiver);
                if (Object.is(oldValue, value)) {
                    // Exception: pending array append
                    const isPendingArrayAppend = prop === 'length' &&
                                                 self._arrayIndexMutations.mutations.length > 0;
                    if (!isPendingArrayAppend) {
                        return true;
                    }
                }

                // ARRAY-SPECIFIC: Length change detection
                if (prop === 'length' && typeof value === 'number') {
                    self._handleArrayLengthChange(targetObj, value, path);
                }

                // PERF: ULTRA-FAST PATH for simple root PRIMITIVE property updates.
                // Shared with the object handler — see _inlinePrimitiveSet.
                // CRITICAL: Only for primitives. Objects need full processing
                // for nested property tracking. Skip when batching is active.
                const valueType = typeof value;
                const isPrimitive = value === null || (valueType !== 'object' && valueType !== 'function');
                const oldIsPrimitive = oldValue === null || (typeof oldValue !== 'object' && typeof oldValue !== 'function');
                const batchModeActive = self._wf && self._wf._batchMode;
                const useMicrotaskBatching = self._microtaskBatchingEligible && !(self._wf && self._wf._batchMode);
                if (!path && typeof prop === 'string' && isPrimitive && oldIsPrimitive && !batchModeActive && !useMicrotaskBatching) {
                    return self._inlinePrimitiveSet(targetObj, prop, value, oldValue, receiver);
                }

                const fullPath = path ? `${path}.${prop}` : prop;

                // Type validation
                if (!path && self.component?.id && self._wf?._checkTypeMatch) {
                    const fullInstance = self._wf.componentInstances?.get(self.component.id);
                    if (fullInstance) {
                        self._wf._checkTypeMatch(fullInstance, prop, value);
                    }
                }

                // HTML Flash Fix
                if (self.component?._isInitialSetup) {
                    const element = self.component.element;
                    const hasHtmlBinding = element && element.querySelector(`[data-bind-html="${prop}"], [data-bind-html="computed:${prop}"]`);

                    if (hasHtmlBinding &&
                        self.component._htmlContextsReady &&
                        !self.component._htmlContextsReady.has(prop)) {
                        // V8 OPT: Guard removed — _htmlInitialQueue pre-initialized in constructor
                        self._htmlInitialQueue.set(fullPath, {
                            targetObj, prop, value, receiver, timestamp: Date.now()
                        });
                        return true;
                    }
                }

                // ARRAY-SPECIFIC: Index mutation detection
                const isArrayIndexMutation = self._regex.isNumeric.test(prop);
                if (isArrayIndexMutation) {
                    self._handleArrayIndexMutation(targetObj, prop, oldValue, value, path);

                    // BATCH: record the per-index write so applyBatch's proxy
                    // change-tracking path can flag the array correctly. Without
                    // this, push() and direct index assignments are invisible
                    // to batch tracking — they only register the .length write
                    // that follows, missing the per-index paths the JSON-diff
                    // path expanded.
                    if (self._wf && self._wf._batchMode) {
                        const fullPath = path ? `${path}.${prop}` : prop;
                        self._batchChanges.set(fullPath, {
                            newValue: value,
                            oldValue: self._batchChanges.has(fullPath)
                                ? self._batchChanges.get(fullPath).oldValue
                                : oldValue
                        });
                    }

                    return Reflect.set(targetObj, prop, value, receiver);
                }

                // PERF: For array length changes during splice, we still need to:
                // 1. Notify effects (for mapArray structural effect)
                // 2. Call onStateChange (for computed bindings like todoCount)
                // 3. Update versions (for staleness detection)
                // But we skip the full _handleStateChange path which does redundant work
                if (prop === 'length' && Array.isArray(targetObj) && self._arrayIndexMutations.isSpliceInProgress) {
                    const result = Reflect.set(targetObj, prop, value, receiver);
                    const lengthPath = path ? `${path}.length` : 'length';
                    const arrayPath = path || '';

                    // Update versions for staleness detection
                    self._stateVersions.set(lengthPath, (self._stateVersions.get(lengthPath) || 0) + 1);
                    self._stateVersions.set(arrayPath, (self._stateVersions.get(arrayPath) || 0) + 1);
                    self._globalEpoch++;
                    self._updatedPaths.add(lengthPath);

                    // BATCH: record the array-level change so applyBatch's
                    // proxy path can flag it for path expansion. Without
                    // this, splice operations are invisible to batch
                    // tracking — the index shifts go through the early
                    // return at the index-mutation branch above (which
                    // now records them), but the splice signal itself
                    // (length truncation) only registers if we record
                    // the array path here.
                    if (self._wf && self._wf._batchMode) {
                        if (path) {
                            self._batchChanges.set(path, {
                                newValue: targetObj,
                                oldValue: self._batchChanges.has(path)
                                    ? self._batchChanges.get(path).oldValue
                                    : null
                            });
                        }
                        self._batchChanges.set(lengthPath, {
                            newValue: value,
                            oldValue: self._batchChanges.has(lengthPath)
                                ? self._batchChanges.get(lengthPath).oldValue
                                : oldValue
                        });
                    }

                    // Notify effects (mapArray depends on this).
                    // Only the .length notification reaches subscribers — the
                    // splice guard in _notifyEffectDependents short-circuits
                    // any non-.length / non-computed:* path while
                    // isSpliceInProgress is set, which is exactly when this
                    // branch runs. The bare-array-path notification is left
                    // implicit: every effect that reads `this.tasks` also
                    // reads `.length` or an indexed entry, so it's already
                    // dirtied by the .length path above.
                    self._notifyEffectDependents(lengthPath);

                    // Mark dependent computeds as dirty (transitively)
                    for (const checkPath of [lengthPath, arrayPath]) {
                        const dependentComputeds = self.computedDependencies.get(checkPath);
                        if (dependentComputeds && dependentComputeds.size > 0) {
                            self._markComputedsDirtyTransitively(dependentComputeds);
                        }
                    }

                    // Notify state change for computed binding updates.
                    // Skip for virtual stores with no DOM dependents.
                    if (!(self.component && self.component.isVirtual && !self._hasDOMDependents)) {
                        self.onStateChange(lengthPath, value, oldValue);
                    }

                    // Auto-save to localStorage if enabled
                    // Splice operations bypass _handleStateChange, so trigger autoSave here
                    if (self.autoSave && self.storageKey) {
                        self._saveToStorage();
                    }

                    // Clear splice flag after all notifications are sent.
                    // The flag suppressed redundant index-level notifications during the
                    // splice operation — that work is done. Clearing it here prevents
                    // the flag from bleeding into subsequent splice operations on
                    // DIFFERENT arrays within the same RSM (e.g., cross-column card
                    // moves in a store with multiple array properties).
                    self._arrayIndexMutations.isSpliceInProgress = false;

                    return result;
                }

                // LAZY arrayPath: Only compute when needed for batching
                let arrayPath = targetObj[ARRAY_PATH_SYMBOL];
                if (arrayPath === undefined) {
                    const arrayItemMatch = path ? path.match(self._regex.arrayItemPath) : null;
                    arrayPath = arrayItemMatch ? arrayItemMatch[1] : null;
                    targetObj[ARRAY_PATH_SYMBOL] = arrayPath;
                }

                // ARRAY-SPECIFIC: Array item property batching
                if (arrayPath && typeof prop === 'string') {
                    const result = self._handleArrayPropertyUpdate(
                        targetObj, prop, value, oldValue, fullPath, arrayPath, receiver
                    );
                    if (result !== null) {
                        return result;
                    }
                }

                // ARRAY-SPECIFIC: Array replacement detection
                let changedPaths = [fullPath];

                if (Array.isArray(value) && Array.isArray(oldValue)) {
                    // Clear pending swap detection
                    self._swapDetectionPending = false;
                    self._resetArrayIndexMutations();

                    // Detect patterns
                    const appendOperation = self._detectArrayAppend(oldValue, value, fullPath);
                    if (appendOperation) {
                        self._arrayOperations.set(fullPath, {
                            type: 'append',
                            startIndex: appendOperation.startIndex,
                            newItems: appendOperation.newItems,
                            timestamp: Date.now()
                        });
                    } else {
                        const swapOperation = self._detectArraySwap(oldValue, value);
                        if (swapOperation) {
                            self._arrayOperations.set(fullPath, swapOperation);
                        } else {
                            const sparseUpdate = self._detectSparsePropertyUpdate(oldValue, value);
                            if (sparseUpdate) {
                                self._arrayOperations.set(fullPath, sparseUpdate);
                            } else {
                                self._arrayOperations.delete(fullPath);
                            }
                        }
                    }

                    // ARRAY-SPECIFIC: Changed indices tracking
                    const isClearOperation = value.length === 0 && oldValue.length > 0;
                    const isArrayShrinking = value.length < oldValue.length;

                    let changedIndices = null;
                    if (!isClearOperation && !isArrayShrinking) {
                        changedIndices = new Set();
                        const minLength = Math.min(value.length, oldValue.length);
                        const maxLength = Math.max(value.length, oldValue.length);

                        for (let i = 0; i < maxLength; i++) {
                            if (i >= minLength || oldValue[i] !== value[i]) {
                                changedIndices.add(i);
                            }
                        }

                        for (const i of changedIndices) {
                            changedPaths.push(`${fullPath}.${i}`);
                        }
                    }

                    // Immutable append detection
                    const lengthIncreased = value.length > oldValue.length;
                    const expectedNewCount = value.length - oldValue.length;
                    const isLikelyAppend = lengthIncreased && expectedNewCount >= 10;

                    if (isLikelyAppend) {
                        self._arrayOperations.set(fullPath, {
                            type: 'append',
                            startIndex: oldValue.length,
                            count: value.length - oldValue.length,
                            timestamp: Date.now()
                        });
                    } else if (changedIndices) {
                        const existingOperation = self._arrayOperations.get(fullPath);
                        if (changedIndices.size > 0 &&
                            changedIndices.size < value.length * 0.8 &&
                            (!existingOperation || existingOperation.type !== 'swap')) {
                            const hintOp = createArrayOperation('property-change-hint');
                            hintOp.changedIndices = Array.from(changedIndices);
                            self._arrayOperations.set(fullPath, hintOp);
                        }
                    }

                    if (value.length < oldValue.length) {
                        self._setCollisionLockout(fullPath);
                    }
                }

                // SHARED: Apply the change
                const newValue = value;
                const result = Reflect.set(targetObj, prop, newValue, receiver);

                self._updatedPaths.add(fullPath);

                if (self._wf && self._wf._batchMode) {
                    // V8 OPT: Guard removed — _batchChanges pre-initialized in constructor
                    self._batchChanges.set(fullPath, {
                        newValue,
                        oldValue: self._batchChanges.has(fullPath)
                            ? self._batchChanges.get(fullPath).oldValue
                            : oldValue
                    });

                    if (Array.isArray(newValue) && Array.isArray(oldValue)) {
                        // V8 OPT: Guard removed — _batchArrayUpdates pre-initialized in constructor
                        self._batchArrayUpdates.push({
                            path: fullPath,
                            oldArray: oldValue,
                            newArray: newValue
                        });
                    }
                } else if (self._shouldUseMicrotaskBatching()) {
                    self._enqueueStateChange(fullPath, newValue, oldValue, false, fullPath, changedPaths);
                } else {
                    self._handleStateChange(fullPath, newValue, oldValue);

                    const affectedByProperty = new Map();
                    for (let i = 0; i < changedPaths.length; i++) {
                        const changePath = changedPaths[i];
                        if (changePath === fullPath) continue;

                        // Fast-fail: skip regex for simple paths (no dot = can't be array.N.prop)
                        const matches = changePath.indexOf('.') !== -1
                            ? self._regex.nestedArrayProperty.exec(changePath) : null;
                        if (matches && self._patternTrie) {
                            const [_, arrayName, index, propPath] = matches;
                            const patternPath = `${arrayName}.*.${propPath}`;
                            const propMatches = self._patternTrie.match(patternPath);
                            if (propMatches && propMatches.size > 0) {
                                if (!affectedByProperty.has(propPath)) {
                                    affectedByProperty.set(propPath, new Set());
                                }
                                const targetSet = affectedByProperty.get(propPath);
                                for (const comp of propMatches) {
                                    targetSet.add(comp);
                                }
                            }

                            const pathSuffix = changePath.slice(fullPath.length + 1);
                            const oldItemValue = self._getValueFromPath(oldValue, pathSuffix);
                            const newItemValue = self._getValueFromPath(newValue, pathSuffix);
                            self._handleStateChange(changePath, newItemValue, oldItemValue, true);
                        }
                    }

                    for (const comps of affectedByProperty.values()) {
                        for (const comp of comps) {
                            if (!self._pendingComputedUpdates.has(comp)) {
                                self._pendingComputedUpdates.set(comp, true);
                                if (!self._pendingComputedTimer) {
                                    self._pendingComputedTimer = true;
                                    queueMicrotask(() => {
                                        self._pendingComputedTimer = null;
                                        self._processPendingComputedUpdates();
                                    });
                                }
                            }
                        }
                    }
                }

                // NOTE: autoSave is now handled centrally in _handleStateChange()

                if (!result) {
                    if (__DEV__) wfWarn(`Failed to set property "${String(prop)}" at path "${fullPath}"`);
                }

                return result;
            },

            deleteProperty(targetObj, prop) {
                if (typeof prop === 'symbol' || prop === '__proto__' || prop === 'constructor') {
                    return Reflect.deleteProperty(targetObj, prop);
                }

                const path = targetObj[PATH_SYMBOL];
                const self = targetObj[RSM_SYMBOL];

                const oldValue = targetObj[prop];
                const fullPath = path ? `${path}.${prop}` : prop;
                const result = Reflect.deleteProperty(targetObj, prop);

                // PERF: Skip state change notification for array element deletions
                // Deleting a numeric index from an array is always part of splice/pop/shift
                // mapArray handles these DOM updates directly via onRemove callback
                // Individual array element deletion (delete arr[i]) is rare and usually a mistake
                const isNumericProp = self._regex.isNumeric.test(prop);
                if (self._arrayIndexMutations.isSpliceInProgress || isNumericProp) {
                    return result;
                }

                self._updatedPaths.add(fullPath);
                self._handleStateChange(fullPath, undefined, oldValue);

                // NOTE: autoSave is now handled centrally in _handleStateChange()

                return result;
            }
        };
    },

    /**
     * V8 OPTIMIZATION: Creates a shared handler for Object proxies.
     * This handler is created ONCE per RSM instance and reused for all object proxies.
     * Path and RSM reference are stored on targets via symbols, not in closures.
     * @returns {Object} Proxy handler object
     * @private
     */
    _createSharedObjectHandler() {
        return {
            get(targetObj, prop, receiver) {
                // Skip special properties and symbols
                if (typeof prop === 'symbol' || prop === '__proto__' || prop === 'constructor') {
                    return Reflect.get(targetObj, prop, receiver);
                }

                // Get path from target's symbol property
                const path = targetObj[PATH_SYMBOL];
                const self = targetObj[RSM_SYMBOL];

                // V8 OPTIMIZATION: Get value FIRST to enable fast primitive exit
                const value = Reflect.get(targetObj, prop, receiver);

                // V8 OPTIMIZATION: Fast primitive exit
                if (value === null || typeof value !== 'object') {
                    if (!path && self.computed && self.computed[prop]) {
                        return self.evaluateComputed(prop);
                    }

                    // PERF: STATIC computed bypass
                    if (self._skipTracking) return value;

                    // Track dependencies for primitives
                    const fullPath = path ? `${path}.${prop}` : prop;

                    // EFFECT SYSTEM: Register effect dependency
                    self._registerEffectDependency(fullPath);

                    // PERF: Lightweight tracking for _updateNode dep comparison.
                    if (self._nodeTrackingSet) {
                        self._nodeTrackingSet.add(fullPath);
                    } else if (self.activeComputation) {
                        self._trackDependency(fullPath);
                        if (path) {
                            if (!self._objectPropertyDependencies.has(path)) {
                                self._objectPropertyDependencies.set(path, new Set());
                            }
                            self._objectPropertyDependencies.get(path).add(String(prop));
                            self._boundProperties.add(fullPath);
                        }
                    }

                    return value;
                }

                if (!path && self.computed && self.computed[prop]) {
                    return self.evaluateComputed(prop);
                }

                // PERF: STATIC computed bypass — return raw value, no proxy wrapping.
                if (self._skipTracking) return value;

                const fullPath = path ? `${path}.${prop}` : prop;

                // EFFECT SYSTEM: Register effect dependency
                self._registerEffectDependency(fullPath);

                // PERF: Lightweight tracking for _updateNode dep comparison.
                if (self._nodeTrackingSet) {
                    self._nodeTrackingSet.add(fullPath);
                } else if (self.activeComputation) {
                    self._trackDependency(fullPath);
                    if (path) {
                        if (!self._objectPropertyDependencies.has(path)) {
                            self._objectPropertyDependencies.set(path, new Set());
                        }
                        self._objectPropertyDependencies.get(path).add(String(prop));
                        self._boundProperties.add(fullPath);
                    }
                }

                // Constructor-based type checking (best overall performance)
                const ctor = value.constructor;

                // Fast path: Plain objects and arrays
                if (ctor === Object || ctor === Array) {
                    return self._createReactiveProxy(value, fullPath);
                }

                // Skip built-in objects that don't work well with Proxies
                if (ctor === Date || ctor === RegExp ||
                    ctor === Map || ctor === Set ||
                    ctor === WeakMap || ctor === WeakSet ||
                    value instanceof Node) {
                    return value;
                }

                // Custom objects - wrap in proxy
                return self._createReactiveProxy(value, fullPath);
            },

            set(targetObj, prop, value, receiver) {
                // Skip special properties and symbols
                if (typeof prop === 'symbol' || prop === '__proto__' || prop === 'constructor') {
                    return Reflect.set(targetObj, prop, value, receiver);
                }

                // Get path and RSM from target's symbol properties
                const path = targetObj[PATH_SYMBOL];
                const self = targetObj[RSM_SYMBOL];

                // Early exit for unchanged values
                // Use Object.is() for proper NaN and signed zero handling
                const oldValue = Reflect.get(targetObj, prop, receiver);
                if (Object.is(oldValue, value)) {
                    return true;
                }

                const fullPath = path ? `${path}.${prop}` : prop;

                // Type validation
                if (!path && self.component?.id && self._wf?._checkTypeMatch) {
                    const fullInstance = self._wf.componentInstances?.get(self.component.id);
                    if (fullInstance) {
                        self._wf._checkTypeMatch(fullInstance, prop, value);
                    }
                }

                // HTML Flash Fix
                if (self.component?._isInitialSetup) {
                    const element = self.component.element;
                    const hasHtmlBinding = element && element.querySelector(`[data-bind-html="${prop}"], [data-bind-html="computed:${prop}"]`);

                    if (hasHtmlBinding &&
                        self.component._htmlContextsReady &&
                        !self.component._htmlContextsReady.has(prop)) {
                        // V8 OPT: Guard removed — _htmlInitialQueue pre-initialized in constructor
                        self._htmlInitialQueue.set(fullPath, {
                            targetObj, prop, value, receiver, timestamp: Date.now()
                        });
                        return true;
                    }
                }

                // PERF: ULTRA-FAST PATH for simple root PRIMITIVE property updates.
                // Shared with the array handler — see _inlinePrimitiveSet.
                // CRITICAL: Only for primitives. Objects/arrays need full
                // processing for nested property tracking. Skip when batching
                // is active.
                const valueType = typeof value;
                const isPrimitive = value === null || (valueType !== 'object' && valueType !== 'function');
                const oldIsPrimitive = oldValue === null || (typeof oldValue !== 'object' && typeof oldValue !== 'function');
                const batchModeActive = self._wf && self._wf._batchMode;
                const useMicrotaskBatching = self._microtaskBatchingEligible && !(self._wf && self._wf._batchMode);
                if (!path && typeof prop === 'string' && isPrimitive && oldIsPrimitive && !batchModeActive && !useMicrotaskBatching) {
                    return self._inlinePrimitiveSet(targetObj, prop, value, oldValue, receiver);
                }

                // LAZY arrayPath: Only compute when needed for batching
                let arrayPath = targetObj[ARRAY_PATH_SYMBOL];
                if (arrayPath === undefined) {
                    const arrayItemMatch = path ? path.match(self._regex.arrayItemPath) : null;
                    arrayPath = arrayItemMatch ? arrayItemMatch[1] : null;
                    targetObj[ARRAY_PATH_SYMBOL] = arrayPath;
                }

                // ARRAY ITEM PROPERTY BATCHING: Handle properties of objects nested in arrays
                if (arrayPath && typeof prop === 'string') {
                    const result = self._handleArrayPropertyUpdate(
                        targetObj, prop, value, oldValue, fullPath, arrayPath, receiver
                    );
                    if (result !== null) {
                        return result;
                    }
                }

                // ARRAY REPLACEMENT DETECTION: When setting an array property on an object
                let changedPaths = [fullPath];
                let changedIndices = null;

                if (Array.isArray(value) && Array.isArray(oldValue)) {
                    // Clear pending swap detection
                    self._swapDetectionPending = false;
                    self._resetArrayIndexMutations();

                    // Detect patterns
                    const appendOperation = self._detectArrayAppend(oldValue, value, fullPath);
                    if (appendOperation) {
                        self._arrayOperations.set(fullPath, {
                            type: 'append',
                            startIndex: appendOperation.startIndex,
                            newItems: appendOperation.newItems,
                            timestamp: Date.now()
                        });
                    } else {
                        const swapOperation = self._detectArraySwap(oldValue, value);
                        if (swapOperation) {
                            self._arrayOperations.set(fullPath, swapOperation);
                        } else {
                            const sparseUpdate = self._detectSparsePropertyUpdate(oldValue, value);
                            if (sparseUpdate) {
                                self._arrayOperations.set(fullPath, sparseUpdate);
                            } else {
                                self._arrayOperations.delete(fullPath);
                            }
                        }
                    }

                    // Changed indices tracking for targeted updates
                    const isClearOperation = value.length === 0 && oldValue.length > 0;
                    const isArrayShrinking = value.length < oldValue.length;

                    if (!isClearOperation && !isArrayShrinking) {
                        changedIndices = new Set();
                        const minLength = Math.min(value.length, oldValue.length);
                        const maxLength = Math.max(value.length, oldValue.length);

                        for (let i = 0; i < maxLength; i++) {
                            if (i >= minLength || oldValue[i] !== value[i]) {
                                changedIndices.add(i);
                            }
                        }

                        for (const i of changedIndices) {
                            changedPaths.push(`${fullPath}.${i}`);
                        }
                    }

                    // Immutable append detection
                    const lengthIncreased = value.length > oldValue.length;
                    const expectedNewCount = value.length - oldValue.length;
                    const isLikelyAppend = lengthIncreased && expectedNewCount >= 10;

                    if (isLikelyAppend) {
                        self._arrayOperations.set(fullPath, {
                            type: 'append',
                            startIndex: oldValue.length,
                            count: value.length - oldValue.length,
                            timestamp: Date.now()
                        });
                    } else if (changedIndices) {
                        const existingOperation = self._arrayOperations.get(fullPath);
                        if (changedIndices.size > 0 &&
                            changedIndices.size < value.length * 0.8 &&
                            (!existingOperation || existingOperation.type !== 'swap')) {
                            const hintOp = createArrayOperation('property-change-hint');
                            hintOp.changedIndices = Array.from(changedIndices);
                            self._arrayOperations.set(fullPath, hintOp);
                        }
                    }

                    // COLLISION LOCKOUT
                    if (value.length < oldValue.length) {
                        self._setCollisionLockout(fullPath);
                    }
                }

                // Apply the change
                const newValue = value;
                const result = Reflect.set(targetObj, prop, newValue, receiver);

                self._updatedPaths.add(fullPath);

                if (self._wf && self._wf._batchMode) {
                    // V8 OPT: Guard removed — _batchChanges pre-initialized in constructor
                    self._batchChanges.set(fullPath, {
                        newValue,
                        oldValue: self._batchChanges.has(fullPath)
                            ? self._batchChanges.get(fullPath).oldValue
                            : oldValue
                    });

                    if (Array.isArray(newValue) && Array.isArray(oldValue)) {
                        // V8 OPT: Guard removed — _batchArrayUpdates pre-initialized in constructor
                        self._batchArrayUpdates.push({
                            path: fullPath,
                            oldArray: oldValue,
                            newArray: newValue
                        });
                    }
                } else if (self._shouldUseMicrotaskBatching()) {
                    self._enqueueStateChange(fullPath, newValue, oldValue, false, fullPath, changedPaths);
                } else {
                    self._handleStateChange(fullPath, newValue, oldValue);

                    // Process changed paths for targeted property updates
                    const affectedByProperty = new Map();
                    for (let i = 0; i < changedPaths.length; i++) {
                        const changePath = changedPaths[i];
                        if (changePath === fullPath) continue;

                        // Fast-fail: skip regex for simple paths (no dot = can't be array.N.prop)
                        const matches = changePath.indexOf('.') !== -1
                            ? self._regex.nestedArrayProperty.exec(changePath) : null;
                        if (matches && self._patternTrie) {
                            const [_, arrayName, index, propPath] = matches;
                            const patternPath = `${arrayName}.*.${propPath}`;
                            const propMatches = self._patternTrie.match(patternPath);
                            if (propMatches && propMatches.size > 0) {
                                if (!affectedByProperty.has(propPath)) {
                                    affectedByProperty.set(propPath, new Set());
                                }
                                const targetSet = affectedByProperty.get(propPath);
                                for (const comp of propMatches) {
                                    targetSet.add(comp);
                                }
                            }

                            const pathSuffix = changePath.slice(fullPath.length + 1);
                            const oldItemValue = self._getValueFromPath(oldValue, pathSuffix);
                            const newItemValue = self._getValueFromPath(newValue, pathSuffix);
                            self._handleStateChange(changePath, newItemValue, oldItemValue, true);
                        }
                    }

                    for (const comps of affectedByProperty.values()) {
                        for (const comp of comps) {
                            if (!self._pendingComputedUpdates.has(comp)) {
                                self._pendingComputedUpdates.set(comp, true);
                                if (!self._pendingComputedTimer) {
                                    self._pendingComputedTimer = true;
                                    queueMicrotask(() => {
                                        self._pendingComputedTimer = null;
                                        self._processPendingComputedUpdates();
                                    });
                                }
                            }
                        }
                    }
                }

                // NOTE: autoSave is now handled centrally in _handleStateChange()

                if (!result) {
                    if (__DEV__) wfWarn(`Failed to set property "${String(prop)}" at path "${fullPath}"`);
                }

                return result;
            },

            deleteProperty(targetObj, prop) {
                if (typeof prop === 'symbol' || prop === '__proto__' || prop === 'constructor') {
                    return Reflect.deleteProperty(targetObj, prop);
                }

                const path = targetObj[PATH_SYMBOL];
                const self = targetObj[RSM_SYMBOL];

                const oldValue = targetObj[prop];
                const fullPath = path ? `${path}.${prop}` : prop;
                const result = Reflect.deleteProperty(targetObj, prop);

                // PERF: Skip state change notification during splice operations
                // mapArray handles DOM updates directly via onRemove callback
                // Note: This handler is for objects, but array items can trigger it via splice
                if (self._arrayIndexMutations.isSpliceInProgress) {
                    return result;
                }

                self._updatedPaths.add(fullPath);
                self._handleStateChange(fullPath, undefined, oldValue);

                // NOTE: autoSave is now handled centrally in _handleStateChange()

                return result;
            }
        };
    }
};
