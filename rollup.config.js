/**
 * Rollup configuration for WildflowerJS
 *
 * Bundles ES6 modules into distributable packages.
 */

import terser from '@rollup/plugin-terser';
import replace from '@rollup/plugin-replace';
import filesize from 'rollup-plugin-filesize';
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read version from package.json
const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
const VERSION = pkg.version || '1.0.0';

// License banner
const banner = `/**
 * WildflowerJS v${VERSION}
 * Lightweight reactive framework - no build step, no virtual DOM
 * https://github.com/wfjs-admin/WildflowerJS
 *
 * Copyright (c) ${new Date().getFullYear()} WildflowerJS Contributors
 * Released under the MIT License
 */`;

// ===========================================
// PHASE 1 & 3: Build-time Flags
// ===========================================

// Feature flags for optional features (Phase 3)
// When false, Terser DCE removes the guarded code entirely
const FEATURES_ALL = {
    '__FEATURE_PLUGINS__': 'true',
    '__FEATURE_PORTALS__': 'true',
    '__FEATURE_TRANSITIONS__': 'true',
    '__FEATURE_SSR__': 'false',
    '__LEGACY_RENDER__': 'false'
};

// Full build: everything including SSR
const FEATURES_FULL = {
    ...FEATURES_ALL,
    '__FEATURE_SSR__': 'true'
};

const FEATURES_LITE = {
    '__FEATURE_PLUGINS__': 'false',
    '__FEATURE_PORTALS__': 'false',
    '__FEATURE_TRANSITIONS__': 'false',
    '__FEATURE_SSR__': 'false',
    '__LEGACY_RENDER__': 'false'
};

// __DEV__ replacement for development builds (keeps warnings/full error messages)
const devReplace = replace({
    preventAssignment: true,
    values: {
        '__DEV__': 'true',
        ...FEATURES_ALL
    }
});

// __DEV__ replacement for production builds (strips warnings, uses error codes only)
const prodReplace = replace({
    preventAssignment: true,
    values: {
        '__DEV__': 'false',
        ...FEATURES_ALL
    }
});

// Full build replacements (dev mode, all features + SSR)
const fullDevReplace = replace({
    preventAssignment: true,
    values: {
        '__DEV__': 'true',
        ...FEATURES_FULL
    }
});

// Full build replacements (production mode, all features + SSR)
const fullProdReplace = replace({
    preventAssignment: true,
    values: {
        '__DEV__': 'false',
        ...FEATURES_FULL
    }
});

// Lite build replacements (dev mode, no optional features)
const liteDevReplace = replace({
    preventAssignment: true,
    values: {
        '__DEV__': 'true',
        ...FEATURES_LITE
    }
});

// Lite build replacements (production mode, no optional features)
const liteProdReplace = replace({
    preventAssignment: true,
    values: {
        '__DEV__': 'false',
        ...FEATURES_LITE
    }
});

// Base plugins (without replacements - added per-config)
const basePlugins = [
    resolve(),
    commonjs(),
    filesize({ showMinifiedSize: true, showGzippedSize: true })
];

// ===========================================
// PHASE 2: Property Name Mangling
// ===========================================
// ===========================================
// PHASE 2: Property Name Mangling
// ===========================================
// Internal properties safe to mangle (class properties, not DOM expandos)
// These appear many times in the bundle and benefit from single-letter names
const MANGLE_PROPERTIES = [
    // High-frequency class properties (state management)
    '_contextRegistry',
    '_arrayOperations',
    '_contextSystemInitialized',
    '_templateCache',
    '_listContexts',
    '_arrayIndexMutations',
    '_listRelationships',
    '_dataFingerprints',
    '_deferredDependencies',
    '_updatedPaths',
    '_pendingStoreUpdates',
    '_bulkArrayUpdates',
    '_initialRenderQueue',
    '_customDirectives',
    '_swapDetectionTimeout',
    '_bindingElements',
    '_batchChangedPaths',
    '_prevBoundClasses',
    '_namedStores',
    '_storeComponents',
    '_storeReadyPromises',
    '_componentListDependencies',
    '_entityDependents',
    '_notifyingPaths',
    '_deferredStoreNotifications',
    '_batchStartState',
    '_computedDependencies',
    '_objectPropertyDependencies',
    '_log',
    '_cache',
    '_lastEvalResult',
    '_triggerHook',
    '_regex',
    '_batchMode',
    '_scheduleRender',
    '_itemTemplates',
    '_batchChanges',
    '_registry',
    '_patternTrie',
    '_pendingComputedUpdates',
    '_parentInfo',
    '_externalDependencies',
    '_componentContext',
    '_compiledMetadata',
    '_state',
    '_handleStateChange',
    '_expressionUsesListContext',
    '_computedTrackingContext',
    '_byId',
    '_transitionLock',
    '_toggleBoundClass',
    '_normalizeStoreShorthands',
    '_htmlInitialQueue',
    '_htmlContextsReady',
    '_enqueueComputedEvaluation',
    '_bindItemData',
    '_watcherHandlers',
    '_propsData',
    '_pluginStates',
    '_namedRoutes',
    '_invalidateCachedComputed',
    '_error',
    '_clearCache',
    '_cachedElementsArray',
    '_batchArrayUpdates',
    '_usedTemplateName',
    '_shouldPreventContentUpdate',
    '_extractTemplateContent',
    '_expressionReservedWords',
    // --- Frequently called methods ---
    '_getAttr',
    '_attrSelector',
    '_hasAttr',
    '_handleError',
    '_findListItemAncestor',
    '_evaluateComputedInListContext',
    '_filterOutNestedListElements',
    '_findDirectParentList',
    '_resolveExternalValue',
    '_processOptimizedClassBinding',
    '_processObjectBinding',
    '_getComponentElement',
    '_getValueFromItem',
    '_getListItems',
    '_generateHTML',
    '_getMergedState',
    '_escapeHTML',
    '_processBindingValue',
    '_updateListItem',
    '_renderListItem',
    // --- Effect system ---
    '_effectPatternEffects',
    '_effects',
    '_notifyEffectDependents',
    '_effectDependents',
    '_wfDisposeEffect',
    '_registerEffectDependency',
    '_effectPatternTrie',
    '_disposeEffect',
    '_disposeItemEffect',
    '_registerEffectPatternDependency',
    '_runEffect',
    '_renderEffect',
    '_createComponentRenderEffect',
    '_disposeComponentRenderEffect',
    '_resolveEffectExpression',
    '_disposeMapArray',
    '_itemEffectsByIndex',
    '_itemEffectContext',
    '_arrayPrefix',
    '_itemProps',
    '_isListItemEffect',
    '_stableDeps',
    'isSimplePath',
    // --- Rendering and scheduling ---
    '_renderScheduled',
    '_renderCounter',
    '_render',
    '_renderList',
    '_initialRenderScheduled',
    '_initialRenderDone',
    '_suppressRender',
    '_hasRendered',
    '_performInitialRender',
    '_forceTemplateRerender',
    '_updateConditionalRender',
    '_actuallyRenderedComponents',
    '_globalEpoch',
    '_dirtyComputeds',
    '_storeSubscriptions',
    '_needsContexts',
    '_expressionEvaluator',
    '_circularDependencies',
    // --- Additional internal properties (Phase 4 expansion, 2026-02-14) ---
    // State management internals (tests run against unmangled dev builds)
    '_stateVersions',
    '_proxyTargets',
    '_computedNodes',
    '_initPhase',
    '_subscriptions',
    '_originalState',
    '_originalComputedFunctions',
    '_stableComputeds',
    '_pathSubscribers',
    '_expressionCache',
    '_evaluationStack',
    '_computedLastEpoch',
    '_boundProperties',
    '_computedDefinitions',
    '_computedRegistry',
    // Rendering internals
    '_parseActions',
    '_getInputValue',
    '_createDomWrapper',
    '_updateBindingElement',
    '_staleCheckDepth',
    '_setNestedProperty',
    '_isModelBinding',
    '_getElementByPath',
    '_currentArrayOperation',
    '_computedsWithExternalDeps',
    '_computedDependsOn',
    '_applyCompiledClassBinding',
    '_resolvedTemplateCache',
    '_executeFallbackBindHtml',
    '_executeFallbackBind',
    // Context and binding system
    '_collisionLockout',
    '_bindItemIndex',
    '_batchListUpdates',
    '_pendingStoreDependencies',
    '_pendingListElements',
    '_pendingComputedTimer',
    '_deferredStateChanges',
    '_deferredComputedClassElements',
    '_customDirectivesSelector',
    '_computationToPaths',
    '_byElement',
    '_addDependency',
    '_contextTypeCache',
    '_circularRefCache',
    '_astCache',
    // Dependency and subscription system
    '_subscriptionQueue',
    '_storeWatcherCleanups',
    '_extractExpressionVars',
    '_invokeActionHandler',
    '_prepareLists',
    '_applyMapArrayMutation',
    '_getStoreFallbackValue',
    '_queueStoreUpdate',
    '_getElementPath',
    '_proxyInstances',
    '_propPaths',
    '_processList',
    '_pathSplitCache',
    '_globalErrorHandlers',
    '_getCompiledExpression',
    '_ensureListEventDelegation',
    '_addListGenericEventDelegation',
    '_dependencyUpdateBatch',
    '_deferredReactiveUpdates',
    '_addDeferredDependency',
    // Component system
    '_webComponentAdapters',
    '_usesMergedContext',
    '_updateModelValue',
    '_updateConditionalElement',
    '_trackDependency',
    '_ssrHydratedComputed',
    '_slotContexts',
    '_slotCleanups',
    '_setCollisionLockout',
    '_sanitizeOrPassHTML',
    '_resolveSlotValue',
    '_resolveComputedPath',
    '_propertyDependents',
    '_processSlotTemplates',
    '_processPortals',
    // Custom directives and DOM
    '_processCustomDirectivesInSubtree',
    '_processCustomDirectives',
    '_originalMethods',
    '_metrics',
    '_isClassBinding',
    '_evaluateBindingExpression',
    '_ensureItemContexts',
    '_earlyStoreAccesses',
    '_deferredCleanupQueue',
    '_deferredCleanupContextIds',
    '_createListContext',
    '_cleanupCustomDirectivesInSubtree',
    '_buildComponentContextHierarchy',
    '_batchedContexts',
    // Misc internals
    '_warnedMissingComputed',
    '_virtualComponents',
    '_updateClassBindingElement',
    // '_scanForDynamicComponents', // called by test code (ensureComponentScanning helper)
    // '_saveToStorage', // accessed by test code (local-storage-persistence.test.js)
    '_resolveStateValue',
    '_resolveBindingValue',
    '_registerExternalDependency',
    '_refreshComputedListItemBindings',
    '_queued',
    '_queue',
    '_mutationObserver',
    '_microtaskQueue',
    '_matchCache',
    '_markComputedsDirtyTransitively',
    // Lifecycle and scheduling
    '_lastChangeInfo',
    '_isHTMLBinding',
    '_hiddenElements',
    '_delegationState',
    '_createReactiveProxy',
    '_computedEvaluationSet',
    '_computedEvaluationScheduled',
    '_computedEvaluationQueue',
    '_computedDepVersions',
    '_computedDepsArray',
    '_computedClassBinding',
    '_collectSlotElements',
    '_clone',
    '_bindWithCompiledMetadata',
    '_arrayUpdateTracking',
    // Event and scheduling system
    '_wrappedHandlers',
    '_staticClasses',
    '_shouldUseMicrotaskBatching',
    '_setupModelEventHandling',
    '_scheduled',
    '_resetArrayIndexMutations',
    '_registerItemTemplates',
    '_registerEntityDependent',
    '_processPortalsInListItems',
    '_processHtmlInitialQueue',
    '_processDeferredDependencies',
    '_parseSubscribeDeclaration',
    '_parentItemProxy',
    '_notifyDependentContexts',
    // Initialization and cleanup
    '_microtaskScheduled',
    '_listParentCache',
    '_itemLevelComputedProperties',
    '_isInsideFalseDataRender',
    '_isInitialSetup',
    '_isCustomEl',
    '_invalidateContextCache',
    '_inSpliceNotification',
    '_initPromise',
    '_htmlSanitizer',
    '_htmlSanitizerWarned',
    '_hasPathSubscribers',
    '_hasInitialized',
    '_hasExplicitData',
    '_handleTransitionedVisibilityChange',
    '_getValueFromPath',
    '_getComponentId',
    '_gcTimeout',
    '_gcIdleId',
    '_findSimilarPropertyNames',
    '_fallbackElement',
    '_executeFallbackShow',
    '_deferredCleanupScheduled',
    '_contextModificationCounter',
    '_compiledBindings',
    '_clearedCacheResetPending',
    '_clearedCacheComponents',
    '_circularDependenciesDetected',
    '_checkTypeMatch',
    '_bulkArrayUpdateTimeout',
    '_buildListContextVars',
    '_buildElementsArrayFromMetadata',
    '_bindComponentActions',
    '_autoCleanupInterval',
    '_applyClassBindingsToRow',
    '_useCSPSafeEvaluation',
    // String-accessed properties (via _ensureSet / cfg.processMethod / cfg.flag)
    // NEVER REMOVE THESE - they are accessed via string literals and cannot be mangled
    '_patternTracking',
    '_ensureSet',
    // --- Non-underscore internal identifiers (2026-02-17 audit) ---
    // CANNOT mangle (string-literal/bracket access or user-facing API):
    //   stateManager (proxy trap string check), classBindings/styleBindings/
    //   htmlBindings (config table bracket access), componentId (user-facing API)
    // Test-accessed properties use nameCache (mangle.json) for deterministic short names;
    // test-utils applies reverse aliases so tests work against minified builds.
    'componentInstance',
    'componentInstances',
    'componentDefinitions',
    'storeManager',
    'domElements',
    'evaluateComputed',
    'rootBindings',
    'computedDependencies',
    'elementPath',
    'contextsByElement',
    'activeComputation',
    'getStoreComponentByName',
    'createBindingContext',
    'resolveData',
    'computedCache',
    'itemProxy',
    'isExpression',
    'isSpliceInProgress',
    'evaluateExpression',
    // disposeEffect — CANNOT mangle: user mapArray callbacks return { disposeEffect: fn }
    //   and the framework reads result.disposeEffect (API boundary)
    'onStateChange',
    'getValue',
    // Underscore properties accessed by tests (also in nameCache for aliasing)
    '_plugins',
    '_hooks',
    '_pluginsByName',
    '_scanForComponents',
    '_forceCompleteRender',
    // RSM methods/properties accessed by tests (nameCache provides deterministic names)
    'createEffect',
    'mapArray',
    'isCircularDependency',
    '_createObjectProxy',
    '_objectHandler',
    '_getRawObject',
    '_createPathlessProxy',
    // --- Phase 5: Comprehensive internal property mangling (2026-02-17 audit) ---
    // 229 additional underscore properties with 3+ occurrences, verified safe
    // (no string/bracket access, no DOM expandos, no API boundaries)
    // Component initialization and lifecycle
    '_initialize',
    '_initializeComponentElement',
    '_initializingComponentIds',
    '_isInitializingComponents',
    '_completeInitialization',
    '_completeSingleSSRIntegration',
    '_prepareSingleInstanceForInit',
    '_prepareSSRElement',
    '_createComponentCore',
    '_createComponentInstance',
    '_createComponentStateManager',
    '_createSingleInstance',
    '_createScanContext',
    '_createEventContext',
    '_createDollarHelper',
    '_createBaseEntityContext',
    '_createEntityTrackingProxy',
    '_createPropertyAccessor',
    '_generateInstanceId',
    '_callBeforeInitHook',
    '_callSingleBeforeInitHook',
    '_callBeforeDestroyHook',
    '_callOnUpdateHook',
    '_triggerComponentLifecycleHook',
    '_shouldUpdateComponent',
    '_handlePostUpdate',
    // Binding execution and processing
    '_executeBindings',
    '_executeClassBindings',
    '_executeShows',
    '_executeHtmlBindings',
    '_executeDeferredInits',
    '_processBindElement',
    '_processActionElement',
    '_processModelElement',
    '_processShowElement',
    '_processRenderElement',
    '_processDataRenderElement',
    '_processComponentBindings',
    '_processClassBindings',
    '_processObjectBindingElements',
    '_processConditionalElements',
    '_processComponentLists',
    '_processFilteredBindings',
    '_processFilteredConditionals',
    '_processFilteredModels',
    '_processDeferredComputedClassBindings',
    '_processDeferredCleanup',
    '_processingDeferredDependencies',
    '_processBulkArrayUpdates',
    '_processPendingComputedUpdates',
    '_processQueuedChange',
    '_processNestedTemplates',
    '_processNestedListsForItem',
    // Binding updates
    '_updateBindings',
    '_updateClassBindings',
    '_updateHTMLBindings',
    '_updateModelElement',
    '_updateNode',
    '_updateLists',
    '_updateComputedProperties',
    '_updateComponentProps',
    '_updatePropsBindingsForComponent',
    '_updateNestedListState',
    '_updateListItemProperty',
    '_updateObjectBindingsForProperty',
    '_updateStyleBindingsForProperty',
    '_updateAttrBindingsForProperty',
    '_updateCustomDirectives',
    '_updateSlotTemplate',
    '_applyObjectBinding',
    // List rendering and management
    '_renderListWithMapArray',
    '_reindexArrayItemPaths',
    '_reindexEffectDepsForSplice',
    '_refreshListItemComputedBindings',
    '_resolveListItemContext',
    '_resolveItemLevelData',
    '_getListItemData',
    '_listContextVars',
    '_buildNestedListPath',
    '_buildParentListChain',
    '_groupListsByComponent',
    '_setupListContexts',
    '_setupListEventDelegation',
    '_findListItemForAction',
    '_findItemTemplateInHierarchy',
    '_findTemplate',
    '_bindListItemConditionals',
    '_bindListItemModel',
    '_storeArrayOperation',
    '_isListManagedPath',
    '_isReactiveListContext',
    // Computed property management
    '_isComputedStale',
    '_isEvaluatingComputed',
    '_evaluateComputedFull',
    '_evaluateCondition',
    '_evaluateConditionWithListContext',
    '_evaluateExternalListPath',
    '_evaluateSlotExpression',
    '_saveDepVersions',
    '_flushComputedEvaluationQueue',
    '_setupComputedProperties',
    '_setupSingleInstanceComputed',
    '_originalComputed',
    '_clearDependenciesForComputation',
    // State management
    '_enqueueStateChange',
    '_pendingStateChanges',
    '_batchUpdate',
    '_batchUpdateTimeout',
    '_scheduleMicrotaskFlush',
    '_mergeStoreState',
    '_syncFormToState',
    '_handleInputChange',
    '_handleEntityStateChange',
    // Array operations
    '_detectArrayAppend',
    '_detectArraySwap',
    '_detectSparsePropertyUpdate',
    '_handleArrayIndexMutation',
    '_handleArrayLengthChange',
    '_handleArrayPropertyUpdate',
    '_handleReactiveListData',
    '_bulkDisposeEffects',
    '_bulkDisposeItemEffects',
    // Action handling
    '_handleActionWithContext',
    '_handleDelegatedActionFallback',
    '_handleDelegatedActionFromContext',
    '_handleDelegatedActionWithListItem',
    '_handleDetachedElementData',
    '_handleDebouncedModelInput',
    '_findActionElementViaMetadata',
    '_findActionElementViaRegistry',
    // Context and dependency resolution
    '_resolveByContextType',
    '_resolveDirectiveValue',
    '_resolveModelTarget',
    '_resolvePropsValue',
    '_resolvePendingStoreDependencies',
    '_registerContextInternal',
    '_registerComponentInContextSystem',
    '_registerPluginDependent',
    '_checkResolveCache',
    '_checkCircularOrDependent',
    '_detectCircularReferences',
    '_cycleSafeEqual',
    '_collectMatches',
    '_collectElementsWithAttribute',
    '_collectDataIndexHierarchy',
    '_collectGarbage',
    '_propagateToParent',
    '_notifyPathSubscribers',
    // Store and plugin system
    '_setupStoreSubscriptions',
    '_setupWatchers',
    '_injectStoreReferences',
    '_installPlugin',
    '_dispatchStoreReadyEvent',
    '_loadFromStorage',
    '_loadDeferred',
    '_doLoad',
    '_providers',
    '_directiveContexts',
    '_cacheGeneration',
    '_cacheResult',
    '_patternCache',
    // Template and slot processing
    '_compileTemplate',
    '_processSlots',
    '_setupSlotBindings',
    '_cleanupSlotBindings',
    '_setupSingleInstanceFeatures',
    // Portal and modal system
    '_processPortalElement',
    '_setupPortalConditionWatcher',
    '_updatePortalVisibility',
    '_bindPortaledAction',
    '_bindPortaledModel',
    '_activePortals',
    '_openModals',
    '_addModalCloseMethod',
    // Model binding
    '_bindModelElement',
    '_bindRootElementModelShow',
    '_bindWebComponentModel',
    '_bindMethods',
    '_setInputValue',
    // DOM and element utilities
    '_findProcessableElements',
    '_findParentComponent',
    '_getElementDepth',
    '_getNestedValue',
    '_getOrCreateEvaluator',
    '_getExternalFn',
    '_getEntityDependents',
    '_getHandlerWithLimits',
    '_getDefaultEventsConfig',
    '_getTransitionDuration',
    '_getDataFingerprint',
    '_generateRowsHTML',
    '_generateDOMFingerprint',
    '_expandPathPatterns',
    '_expressionUsesPath',
    // Validation
    '_validateProps',
    '_validateForm',
    '_validateBindingPath',
    '_validateExpressionVariables',
    // Event handling
    '_parseKeyModifiers',
    '_matchesKeyModifiers',
    '_normalizeEventsConfig',
    '_debounce',
    // Cleanup and GC
    '_cleanupComponentEventHandlers',
    '_cleanupComponentPortals',
    '_cleanupCustomDirectives',
    '_scheduleDeferredCleanup',
    '_destroyNestedComponentsInItem',
    '_initializeNestedComponentsInItem',
    '_gcCancelled',
    '_poolCleanupInterval',
    '_lastCleanupTime',
    '_leakDetectionInterval',
    // Parsing
    '_parsePropLiteral',
    '_parseLiteralValue',
    '_pathlessProxyCounter',
    // SSR
    '_ssrListsInitialized',
    '_showErrorFallback',
    // Miscellaneous internal
    '_previousClass',
    '_orderComponentsByHierarchy',
    '_inferTypeFromValue',
    '_useServices',
    '_addPropertyDependent',
    '_beforeContentUpdateHooks',
    '_bindingUpdateCount',
    '_isOwnedBindingElement',
    '_lastRenderScheduled',
    // --- Phase 4: Additional internal properties (2026-02-27 audit) ---
    // BindingResolver methods
    '_classifyBinding',
    '_resolveCompiledBinding',
    '_resolveRawBinding',
    '_lookupFromComponent',
    // RouteManager
    '_navigationAborted',
    '_eventListeners',
    '_dispatchRouteEvent',
    '_handlePopState',
    '_handleHashChange',
    '_handleLinkClick',
    '_patternToRegex',
    '_matchAndExecute',
    '_isSameLocation',
    '_frameworkIntegration',
    '_routeChangeHandler',
    '_emit',
    '_extractParamNames',
    // ListItemBinding / ListRenderer
    '_applyCustomElementAdapter',
    '_createListAwareBindingContext',
    '_mapArrayItems',
    '_movedFrom',
    '_mapArrayCleanups',
    '_childPath',
    // ContextManager
    '_createItemLevelContext',
    '_parentIndex',
    // SSR / ErrorBoundaries
    '_phase',
    '_hasError',
    // ReactiveStateManager
    '_effect',
    '_componentId',
    '_computedCache',
    // Entity / Framework internals
    '_bindTypeFlags',
    '_watchHandlers',
    '_ensureContextSystem',
    '_updatingExpressionBindings',
    '_updateListClassBindingsForProperty',
    '_forEachDirectiveElement',
    '_hasConditionalPortals',
    '_debounceTime',
    // StoreManager / PluginSystem
    '_subscribedStores',
    '_stateManager',
    // DOM-to-Context caching (BindingContext properties)
    'elementMeta',
    'modelModifiers',
    // ListRenderer cached metadata
    '_staticItemProps',
    // Additional internal methods (not test-accessed, no nameCache needed)
    '_scheduleComputedEvaluationFlush',
    '_pendingEffectInstances',
    '_executeWithViewTransition',
    '_trySSRHydrationForMapArray',
    '_levenshteinDistance',
    // --- Phase 6: Bundle audit (2026-03-08) ---
    // Underscore instance properties/methods (no test coverage, no DOM expandos)
    '_componentDeps',
    '_bindingDesc',
    '_rsm',
    '_renderContexts',
    '_instanceIdCounter',
    '_hasAnyEffects',
    '_contextHierarchyDirty',
    '_resolveDepth',
    '_processPolymorphicTemplates',
    '_gcIntervalId',
    '_focusRestorationTimer',
    '_flushCount',
    '_boundTextNode',
    '_webComponentAdapter',
    '_templateIdCounter',
    '_running',
    '_processPortalBindingType',
    '_isBlocklistedAttr',
    '_bindEntityMethods',
    '_wfComponent',
    '_warnedSlowPath',
    '_uid',
    '_swapPolymorphicTemplate',
    '_storesInjected',
    '_slotCounter',
    '_scrollToHash',
    '_resolveComponentValue',
    '_registerChildren',
    '_portalPending',
    '_parseValueFromElement',
    '_originalContent',
    '_maxSize',
    '_maxCacheSize',
    '_isPropertyAccessor',
    '_hasWebComponentBindings',
    '_ensureRender',
    '_dispatchError',
    '_cycleSafeStringify',
    '_createPluginAccessor',
    '_createEntitySubscription',
    '_cleanPolymorphicContent',
    '_arrayHandler',
    '_args',
    '_applyListItemIntegrations',
    '_allowActions',
    '_actionContext',
    // Non-underscore internal properties (no test coverage)
    'expressionVars',
    'bindClassExpr',
    'compiledFn',
    'renderedElement',
    'bindAttrExpr',
    'updateData',
    'rootContext',
    'renderedElements',
    'bindStyleExpr',
    'templateNames',
    'initialArrayLength',
    'deferredEffectData',
    'createActionContext',
    'usesListContext',
    'isSimpleProperty',
    'computedName',
    'classEvaluators',
    'originalData',
    'actionArgs',
    'templateClone',
    'skipTransition',
    'pendingChanges',
    'lastUpdateTime',
    'isPropsPath',
    'isListContextVar',
    'customValidate',
    'createConditionalContext',
    'additionalContext',
    'actionMethods',
    'lastMutationTime',
    'isRendered',
    'hasBindStyle',
    'hasBindClass',
    'hasBindAttr',
    'createContext',
    // Test-accessed properties (Bucket 2 — need nameCache + test-utils aliases)
    // _internal — CANNOT mangle: string-accessed in StoreManager (key !== '_internal')
    //   and ComponentLifecycle (key.startsWith('_internal'))
    '_sanitizeAttrValue',
    '_lastError',
    '_currentUpdatingInstance',
    'eventHandlers',
    'attrBindings',
    'isComputed',
    'getContextById',
    'getContextsByType',
    'componentChildren',
    'getContextForElement',
    'useWfPrefixOnly',
    'depVersions',
    'componentParents',
    'startBatch',
    'protectedLists',
    'protectedElements',
    'componentElements',
    'updateCount',
    'registerDependency',
    'listElement',
    'removeContext',
    'getFullPath',
    'contextsByType',
    '_errorFallbackSelector',
    // --- Phase 7: Pool/Effect/Rendering audit (2026-04-04) ---
    // Pool system internals
    '_wf',
    '_entities',
    '_entitiesArray',
    '_pools',
    '_poolDefinitions',
    '_poolClassList',
    '_poolLoopId',
    '_poolLoopRunning',
    '_poolLoopTick',
    '_poolPrevStyle',
    '_poolPrevAttr',
    '_poolPrevClass',
    '_poolPrevRaw',
    '_freeList',
    '_maxFreeListSize',
    '_container',
    '_tickableInstances',
    '_tickFn',
    '_startPoolLoop',
    '_boundPoolLoopTick',
    '_isPassive',
    '_templateContent',
    '_templateSnapshot',
    '_templateType',
    '_templateKeyProp',
    '_templateHasNestedComponents',
    '_templatesByType',
    '_setupPools',
    '_cleanupPools',
    '_getPool',
    '_activePoolHandles',
    '_addSingle',
    '_addBulk',
    '_onAdd',
    '_onRemove',
    '_onClear',
    '_checkPoolLoopNeeded',
    '_lastTickTime',
    '_frameInterval',
    '_targetFps',
    '_targetedMode',
    '_targetedProp',
    '_defaultEntityWidth',
    '_defaultEntityHeight',
    '_customCullBounds',
    '_cullDirty',
    '_cullPadding',
    '_cullProps',
    '_restoreRecycledElement',
    '_extractStaticItemProps',
    '_applyStyleBindingsToRow',
    '_applyAttrBindingsToRow',
    '_v',
    '_ctxBuffer',
    // Effect system additions
    '_effectMeta',
    '_deferredEffectMeta',
    '_nodeTrackingSet',
    '_dirtySet',
    '_reusableTrackingSet',
    '_hasNotifyTargets',
    '_hasDOMDependents',
    '_executeBindForEffect',
    '_executeClassBindForEffect',
    '_executeShowForEffect',
    '_executeHtmlBindForEffect',
    '_executeModelBindForEffect',
    '_executeAttrBindForEffect',
    '_executeStyleBindForEffect',
    '_executeComponentBindingsForEffect',
    // Rendering internals
    '_applyBindings',
    '_changedProp',
    '_activeChangedProp',
    '_skipTracking',
    '_prevCompDepValues',
    '_swapDetectionPending',
    '_processSwapDetection',
    '_querySelfAndDescendants',
    '_framework',
    '_classOnlyCompDeps',
    '_collectComponentBindingMeta',
    '_compiledMetaByType',
    '_compileComponentBindings',
    '_processBindingElements',
    '_processClassBindingElements',
    '_processStyleBindingElements',
    '_processAttrBindingElements',
    '_processHTMLBindingElements',
    '_processModelElements',
    '_processListElement',
    '_processListItemDataRender',
    '_processInsertedElement',
    '_processEarlyStoreAccesses',
    '_processComponentBindingsFromCompiled',
    '_processComponentBindingsFallback',
    '_executeAttrBindings',
    '_executeStyleBindings',
    '_executeModels',
    '_executeRenders',
    '_executeWatchers',
    '_executeFallbackModel',
    '_updateConditionals',
    '_updateRenderConditional',
    '_updateListsAsync',
    '_updateListContextClassBindings',
    '_updateHTMLWithPreservation',
    '_updateElementValue',
    '_updateContextsForStateChange',
    '_updateCustomDirectivesInSubtree',
    '_updateSlotBindings',
    '_insertRenderElement',
    '_removeRenderElement',
    '_initializeTemplates',
    '_initializeSlotTemplate',
    '_evaluateListItemCondition',
    // Component lifecycle additions
    '_componentInstance',
    '_componentMightBeAffected',
    '_deferComponentUpdate',
    '_finishComponentInitialization',
    '_initializeComponentElements',
    '_initializeEventHandling',
    '_initializeProps',
    '_initWithStoreWait',
    '_scanForComponentsAsync',
    '_scheduleBackgroundGC',
    '_scheduleComponentRender',
    '_scheduleInitialRender',
    '_scheduleOnUpdateHook',
    '_callBeforeUpdateHook',
    '_callInitHook',
    '_cancelPendingGC',
    '_notifyComponentDestroyed',
    '_removeFromComponentHierarchy',
    '_resetComponentError',
    '_propagateErrorToBoundary',
    '_registerComponentDep',
    '_extractComponentDeps',
    '_handleComponentDOMUpdates',
    '_handleComponentListStateChange',
    '_findListItemForComponent',
    '_sortElementsForContextCreation',
    '_inferTypesFromState',
    '_normalizePropsDefinition',
    '_parsePropsFromElement',
    '_validateComponentBindings',
    '_validateActionMethods',
    '_validateInput',
    '_validateStyleExpression',
    '_isValidPropType',
    '_getValidationTriggers',
    '_handleValidationBlur',
    '_handleFormSubmit',
    '_handleListStateChange',
    // State management additions
    '_flush',
    '_flushMicrotaskQueue',
    '_flushDeferredStoreNotifications',
    '_lastFlushTime',
    '_enableMicrotaskBatching',
    '_microtaskBatchingEligible',
    '_syncMode',
    '_syncInputToState',
    '_recentArrayStatePath',
    '_subscribedStoreRSMsCache',
    '_hashString',
    '_externalEvalCount',
    '_expressionVarsCache',
    '_evalExpr',
    // Context and binding additions
    '_createComponentContext',
    '_createComponentWithoutInit',
    '_createNestedListContext',
    '_createArrayProxy',
    '_createSharedObjectHandler',
    '_createSharedArrayHandler',
    '_ensureContextParentInfo',
    '_ensureItemContextsFromMetadata',
    '_bindingContextId',
    '_bindingTypeConfigs',
    '_bindRootElementData',
    '_bindStandardModel',
    '_bindWithFallback',
    '_resolveBindingData',
    '_resolveConditionalData',
    '_resolveExternalListData',
    '_resolveGenericData',
    '_resolveListData',
    '_lookupFromItem',
    '_parentContext',
    '_reusableListContext',
    '_fullPath',
    '_generateContextId',
    '_generateItemFingerprint',
    '_findDeepestParentListContext',
    '_findChangedIndices',
    '_inBatchListCleanup',
    '_batchCleanupListItemsWithNestedComponents',
    '_applyBatchedListUpdates',
    '_applyBatchToLists',
    '_applyPendingStoreUpdates',
    '_hasConditionals',
    '_hasProps',
    '_hasNonListDataRender',
    '_hasNestedProperty',
    '_hasElementDelegation',
    '_markElementDelegation',
    '_isRenderConditional',
    '_isStatic',
    '_isTemplateList',
    '_isTemplateRendered',
    '_isNestedListUpdate',
    // Event system additions
    '_setupFormHandling',
    '_setupActionElementRefs',
    '_setupComponentListeners',
    '_setupDynamicComponentDetection',
    '_setupGarbageCollection',
    '_setupHierarchyTracking',
    '_setupOutsideClickHandler',
    '_setupStoreWatcher',
    '_splitActionDefs',
    '_parseActionArgs',
    '_parseActionDefsSimple',
    '_parseEventModifiers',
    '_applyEventConfiguration',
    '_mergeEventConfigs',
    '_getActionEventType',
    '_getCompiledMetadata',
    '_getCompiledComponentBindings',
    '_wrapMethod',
    '_throttle',
    // Slot system additions
    '_cleanupSlotTemplates',
    '_setSlotValue',
    '_slotContext',
    '_processSlotActions',
    '_processSlotClassBindings',
    '_processSlotConditionals',
    '_processSlotDataBindings',
    '_processSlotModels',
    // Template and rendering additions
    '_placeholder',
    '_polyTemplateKeyProp',
    '_defaultPolyTemplate',
    '_cleanupNestedContent',
    '_cleanupContextsInSubtree',
    '_resetElementCaches',
    '_stripWhitespaceNodes',
    '_dynamicArray',
    '_staticArray',
    '_staticProp',
    '_keyProp',
    '_sortProp',
    '_sortDesc',
    '_source',
    '_types',
    '_cacheModelModifiers',
    '_listContextMethods',
    '_destroy',
    '_detectCSPRestrictions',
    '_escapeHTMLMap',
    '_escapeHTMLReplaceRegex',
    '_addFullPathMethod',
    '_addListSubmitDelegation',
    '_addListFocusBlurDelegation',
    '_refreshListItemExternalBindings',
    '_refreshStandaloneExternalBindings',
    '_registerExpressionDependencies',
    '_extractParentIndex',
];

// String-accessed properties - CANNOT be mangled (accessed via string literals)
// These must NEVER be added to MANGLE_PROPERTIES:
//   _componentsToUpdate  (via _ensureSet('_componentsToUpdate'))
//   _batchChangedComponents  (via _ensureSet('_batchChangedComponents'))
//   _contextsToUpdate  (via _ensureSet('_contextsToUpdate'))
//   _pendingDependentUpdates  (via _ensureSet('_pendingDependentUpdates'))
//   _processStyleBinding  (via this[cfg.processMethod])
//   _processAttrBinding  (via this[cfg.processMethod])
//   _isStyleBinding  (via bindingContext[cfg.flag])
//   _isAttrBinding  (via bindingContext[cfg.flag])
//   _length, _index, _first, _last  (list context variables, string-accessed in BindingResolver/ListExpressionEval)
//   _internal  (string-accessed in StoreManager and ComponentLifecycle)

// DOM expando properties - these CANNOT be mangled (set on DOM/event objects, cross-scope access)
const DOM_EXPANDO_RESERVED = [
    // Hot-path list rendering
    '_listContext',
    '_itemData',
    '_listIndex',
    '_itemIndex',
    '_wfBoundElements',
    '_previousData',
    '_previousDataLength',
    '_lastDataFingerprint',
    '_mapArrayItemElements',
    '_mapArrayInitialized',
    // SSR lifecycle (hot-path)
    '_ssrPhase',
    // Transition state machine
    '_transitionTarget',
    '_transitionRAF',
    '_transitionTimeout',
    '_transitionInProgress',
    // Timer IDs
    '_debounceTimeout',
    '_debounceId',
    // Display cache
    '_wf_orig_disp',
    // Event handler registry
    '_wf_evts',
    // Polymorphic template state machine
    '_polyGeneratedNodes',
    '_polyCurrentType',
    '_polyTemplatesByType',
    '_polyInsertBeforeRef',
    '_polyDefaultTemplate',
    // Pool entity marker and item reference (set on pool DOM elements)
    '_poolEntity',
    '_poolItem',
    // Event object expandos
    '_handledByDebounce',
    '_handledByDirectUpdate',
    // Action delegation marker
    '_wfActionBound',
];

// Build regex that matches our whitelist
const mangleRegex = new RegExp(`^(${MANGLE_PROPERTIES.join('|')})$`);

// Load nameCache for deterministic property mangling (Preact-style)
// This ensures test-accessed properties get known short names so test-utils can alias them.
const mangleNameCache = JSON.parse(fs.readFileSync('./mangle.json', 'utf8'));

// Terser config for minification - aggressive optimization
const terserConfig = {
    compress: {
        drop_console: false, // Keep console for errors
        passes: 3,           // More passes for better optimization
        dead_code: true,     // Remove unreachable code
        drop_debugger: true, // Remove debugger statements
        conditionals: true,  // Optimize conditionals
        evaluate: true,      // Evaluate constant expressions
        booleans: true,      // Optimize boolean expressions
        loops: true,         // Optimize loops
        unused: true,        // Drop unused variables/functions
        hoist_funs: true,    // Hoist function declarations
        hoist_vars: false,   // Don't hoist var declarations (can break code)
        if_return: true,     // Optimize if-return sequences
        join_vars: true,     // Join consecutive var statements
        sequences: true,     // Use comma operator
        properties: true,    // Rewrite property access
        comparisons: true,   // Optimize comparisons
        inline: true,        // Inline single-use functions
        reduce_vars: true,   // Optimize variable references
        collapse_vars: true, // Collapse single-use variables
    },
    mangle: {
        reserved: ['WildflowerJS', 'wildflower', 'RouteManager', 'SSRManager'],
        properties: false    // Don't mangle property names (breaks cross-module access)
    },
    format: {
        comments: /^!/  // Keep license comments
    }
};

// Production terser (strips most console.* and mangles whitelisted properties)
const terserProd = terser({
    ...terserConfig,
    compress: {
        ...terserConfig.compress,
        pure_funcs: ['console.log', 'console.info', 'console.debug', 'console.trace']
    },
    mangle: {
        ...terserConfig.mangle,
        properties: {
            // Only mangle properties matching our whitelist
            regex: mangleRegex,
            // Preserve DOM expando properties
            reserved: DOM_EXPANDO_RESERVED
        }
    },
    // Deterministic property name mappings (like Preact's mangle.json)
    nameCache: mangleNameCache
});

// Development terser (keeps all console.*)
const terserDev = terser(terserConfig);

// Footer templates for different package variants
const footers = {
    core: `
// Expose globals for script tag usage
if (typeof window !== 'undefined') {
    window.WildflowerJS = WildflowerBundle.WildflowerJS;
    window.wildflower = WildflowerBundle.wildflower;
}`,
    spa: `
// Expose globals for script tag usage
if (typeof window !== 'undefined') {
    window.WildflowerJS = WildflowerBundle.WildflowerJS;
    window.wildflower = WildflowerBundle.wildflower;
    window.RouteManager = WildflowerBundle.RouteManager;
}`,
    full: `
// Expose globals for script tag usage
if (typeof window !== 'undefined') {
    window.WildflowerJS = WildflowerBundle.WildflowerJS;
    window.wildflower = WildflowerBundle.wildflower;
    window.RouteManager = WildflowerBundle.RouteManager;
    window.SSRManager = WildflowerBundle.SSRManager;
    window.SSRProtectionContext = WildflowerBundle.SSRProtectionContext;
    window.SSRPhase = WildflowerBundle.SSRPhase;
}`,
};

// Output configurations
const outputConfigs = {
    // IIFE for script tags (browser global)
    iife: (filename, variant = 'core') => ({
        file: `dist/${filename}`,
        format: 'iife',
        name: 'WildflowerBundle',
        banner,
        footer: footers[variant] || footers.core
    }),

    // ES module for bundlers
    esm: (filename) => ({
        file: `dist/${filename}`,
        format: 'es',
        banner
    })
};

// Build configurations for each package variant
const configs = [
    // ===========================================
    // CORE PACKAGE
    // ===========================================

    // Core - unminified (for debugging, __DEV__ = true)
    {
        input: 'src/index.js',
        output: outputConfigs.iife('wildflower.js'),
        plugins: [devReplace, ...basePlugins]
    },

    // Core - development (minified but keeps console, __DEV__ = true)
    {
        input: 'src/index.js',
        output: outputConfigs.iife('wildflower.dev.js'),
        plugins: [devReplace, ...basePlugins, terserDev]
    },

    // Core - production (minified, __DEV__ = false, strips warnings)
    {
        input: 'src/index.js',
        output: outputConfigs.iife('wildflower.min.js'),
        plugins: [prodReplace, ...basePlugins, terserProd]
    },

    // ===========================================
    // LITE PACKAGE (no portals/transitions/modals/plugins)
    // Uses FEATURES_LITE flags to eliminate feature code via DCE
    // ===========================================

    {
        input: 'src/index.lite.js',
        output: outputConfigs.iife('wildflower.lite.js'),
        plugins: [liteDevReplace, ...basePlugins]
    },
    {
        input: 'src/index.lite.js',
        output: outputConfigs.iife('wildflower.lite.dev.js'),
        plugins: [liteDevReplace, ...basePlugins, terserDev]
    },
    {
        input: 'src/index.lite.js',
        output: outputConfigs.iife('wildflower.lite.min.js'),
        plugins: [liteProdReplace, ...basePlugins, terserProd]
    },

    // ===========================================
    // SPA PACKAGE (core + router)
    // ===========================================

    {
        input: 'src/index.spa.js',
        output: outputConfigs.iife('wildflower.spa.js', 'spa'),
        plugins: [devReplace, ...basePlugins]
    },
    {
        input: 'src/index.spa.js',
        output: outputConfigs.iife('wildflower.spa.dev.js', 'spa'),
        plugins: [devReplace, ...basePlugins, terserDev]
    },
    {
        input: 'src/index.spa.js',
        output: outputConfigs.iife('wildflower.spa.min.js', 'spa'),
        plugins: [prodReplace, ...basePlugins, terserProd]
    },

    // ===========================================
    // FULL PACKAGE (core + SSR + router)
    // ===========================================

    {
        input: 'src/index.full.js',
        output: outputConfigs.iife('wildflower.full.js', 'full'),
        plugins: [fullDevReplace, ...basePlugins]
    },
    {
        input: 'src/index.full.js',
        output: outputConfigs.iife('wildflower.full.dev.js', 'full'),
        plugins: [fullDevReplace, ...basePlugins, terserDev]
    },
    {
        input: 'src/index.full.js',
        output: outputConfigs.iife('wildflower.full.min.js', 'full'),
        plugins: [fullProdReplace, ...basePlugins, terserProd]
    },

];

// Support filtering builds via BUNDLE environment variable
// Usage: BUNDLE=full.min npm run build
// Or: BUNDLE=full npm run build (builds all full variants)
const bundleFilter = process.env.BUNDLE;
const filteredConfigs = bundleFilter
    ? configs.filter(c => c.output.file.includes(bundleFilter))
    : configs;

export default filteredConfigs;
