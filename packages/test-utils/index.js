/**
 * @wildflowerjs/test-utils
 *
 * Testing utilities for WildflowerJS applications.
 * Provides helpers for loading the framework, managing test state,
 * and waiting for reactive updates.
 *
 * @example
 * import { loadFramework, resetFramework, waitForUpdate } from '@wildflowerjs/test-utils'
 *
 * beforeAll(async () => {
 *   await loadFramework()
 * })
 *
 * beforeEach(() => {
 *   resetFramework()
 * })
 */

/**
 * Distribution modes for loading the framework
 * - core, lite, spa, full: Minified production builds (.min.js)
 * - core-dev, lite-dev, spa-dev, full-dev: Development builds (.dev.js) with console warnings preserved
 * - experimental, experimental-dev: Experimental builds with ListRenderer.v2 schema-based architecture
 *
 * NOTE: 'source' mode is DEPRECATED. After the ES6 module migration, the source
 * files are now in /src/ and must be built to /dist/ before use.
 * The old monolithic files in /src/ are obsolete.
 *
 * @typedef {'core' | 'lite' | 'spa' | 'full' | 'experimental' | 'core-dev' | 'lite-dev' | 'spa-dev' | 'full-dev' | 'experimental-dev'} DistMode
 */

/**
 * Deterministic mangle map — mirrors mangle.json (Preact-style nameCache).
 * Maps original property names to their mangled short names.
 * Used to create reverse aliases so tests work against minified builds.
 * @private
 */
const MANGLE_MAP = {
  componentInstances: '__ci',
  componentDefinitions: '__cd',
  storeManager: '__sm',
  domElements: '__de',
  evaluateComputed: '__ec',
  getStoreComponentByName: '__gs',
  _contextRegistry: '__cr',
  _templateCache: '__tc',
  _contextSystemInitialized: '__cs',
  _customDirectives: '__cu',
  _pluginStates: '__ps',
  _plugins: '__pl',
  _hooks: '__hk',
  _pluginsByName: '__pn',
  _scanForComponents: '__sc',
  _stateVersions: '__sv',
  _computedDependsOn: '__co',
  _computedDepVersions: '__cv',
  _resolvedTemplateCache: '__rt',
  _pendingStoreDependencies: '__pd',
  _htmlSanitizer: '__hs',
  _htmlSanitizerWarned: '__hw',
  _useCSPSafeEvaluation: '__uc',
  _proxyTargets: '__pt',
  _hasInitialized: '__hi',
  _forceCompleteRender: '__fr',
  _scanForDynamicComponents: '__sd',
  onStateChange: '__oc',
  resolveData: '__rd',
  getValue: '__gv',
  createEffect: '__ce',
  mapArray: '__ma',
  isCircularDependency: '__ic',
  _createObjectProxy: '__op',
  _objectHandler: '__oh',
  _getRawObject: '__ro',
  _createPathlessProxy: '__pp',
  _navigationAborted: '__na',
  _matchAndExecute: '__mx',
  _subscribedStores: '__su',
  _stateManager: '__mg',
  _hasError: '__he',
  _parentIndex: '__px',
  // Phase 2: expanded coverage for describe-level skip removal
  _patternTrie: '__pe',
  _matchCache: '__mc',
  _batchMode: '__bm',
  _batchedContexts: '__bc',
  _cache: '__ch',
  _registry: '__rg',
  _namedStores: '__ns',
  componentInstance: '__cj',
  contextsByElement: '__cb',
  _getAttr: '__ga',
  _hasAttr: '__ha',
  _attrSelector: '__as',
  _scheduleRender: '__sr',
  _globalEpoch: '__ge',
  _computedLastEpoch: '__cl',
  _circularDependencies: '__cy',
  _computedTrackingContext: '__ct',
  _mapArrayInitialized: '__mi',
  _wfDisposeEffect: '__wd',
  _compiledMetadata: '__cm',
  _renderEffect: '__re',
  _expressionEvaluator: '__ee',
  _needsContexts: '__nc',
  _computedDependencies: '__cp',
  _computedNodes: '__cn',
  _initPhase: '__ip',
  _storeSubscriptions: '__ss',
  _effectDependents: '__ef',
  _effects: '__fx',
  _effectPatternEffects: '__ep',
  _parentInfo: '__pi',
  _externalDependencies: '__ed',
  _itemTemplates: '__it',
  _propsData: '__dp',
  _triggerHook: '__th',
  _pathSubscribers: '__pb',
  _createReactiveProxy: '__rp',
  // Phase 5: additional test-accessed properties
  _isComputedStale: '__is',
  _loadFromStorage: '__ls',
  _providers: '__pv',
  _updateComponentProps: '__up',
  _getEntityDependents: '__gd',
  _mutationObserver: '__mo',
  isExpression: '__ie',
  // Phase 6: audit-bugs + security test-accessed properties
  _escapeHTML: '__eh',
  _escapeHTMLReplaceRegex: '__er',
  _escapeHTMLMap: '__em',
  computedCache: '__cc',
  // Phase 7: Bundle audit test-accessed properties (2026-03-08)
  _sanitizeAttrValue: '__sa',
  _lastError: '__le',
  _currentUpdatingInstance: '__ui',
  eventHandlers: '__ev',
  attrBindings: '__ab',
  isComputed: '__ik',
  getContextById: '__gi',
  getContextsByType: '__gt',
  componentChildren: '__ck',
  getContextForElement: '__gf',
  useWfPrefixOnly: '__wp',
  depVersions: '__dv',
  componentParents: '__pa',
  startBatch: '__sb',
  protectedLists: '__tl',
  protectedElements: '__te',
  componentElements: '__cf',
  updateCount: '__ut',
  registerDependency: '__rn',
  listElement: '__lm',
  removeContext: '__rc',
  getFullPath: '__fp',
  contextsByType: '__bt'
}

/**
 * Apply reverse aliases from mangled → original property names on an object.
 * For each entry in MANGLE_MAP, if the mangled name exists on obj but the
 * original doesn't, creates a getter/setter alias.
 *
 * @param {Object} obj - Object to apply aliases to
 * @example
 * // After loading minified build:
 * applyMangleAliases(wildflower)
 * // Now wildflower.componentInstances works even though it was mangled to __ci
 */
export function applyMangleAliases(obj) {
  if (!obj) return
  for (const [original, mangled] of Object.entries(MANGLE_MAP)) {
    if (mangled in obj && !(original in obj)) {
      Object.defineProperty(obj, original, {
        get() { return obj[mangled] },
        set(v) { obj[mangled] = v },
        configurable: true,
        enumerable: false
      })
    }
  }
}

/**
 * Apply reverse aliases on a prototype so ALL instances get them.
 * Unlike applyMangleAliases, this:
 * - Uses `this` (not a closed-over obj) so instance properties are read correctly
 * - Doesn't check if the mangled name exists (instance props aren't on the prototype)
 * @private
 */
function applyPrototypeMangleAliases(proto) {
  if (!proto) return
  for (const [original, mangled] of Object.entries(MANGLE_MAP)) {
    if (!(original in proto)) {
      Object.defineProperty(proto, original, {
        get() { return this[mangled] },
        set(v) { this[mangled] = v },
        configurable: true,
        enumerable: false
      })
    }
  }
}

/**
 * Get the current distribution mode
 * Checks for injected global from test config, defaults to 'full-dev' (full framework with debug info)
 *
 * @returns {DistMode} The current distribution mode
 */
export function getDistMode() {
  // Check for injected global from vitest/jest config
  if (typeof __WILDFLOWER_DIST__ !== 'undefined') {
    return __WILDFLOWER_DIST__
  }
  // Check for environment variable in Node context
  if (typeof process !== 'undefined' && process.env?.WILDFLOWER_DIST) {
    return process.env.WILDFLOWER_DIST
  }
  // Default to full-dev (full framework with console warnings for debugging)
  return 'full-dev'
}

/**
 * Get the framework script paths based on distribution mode
 *
 * @param {DistMode} [mode] - Override the distribution mode
 * @returns {string[]} Array of script paths to load
 */
export function getFrameworkScripts(mode) {
  const distMode = mode || getDistMode()

  switch (distMode) {
    // Minified production builds
    case 'core':
      return ['/dist/wildflower.min.js']
    case 'lite':
      return ['/dist/wildflower.lite.min.js']
    case 'spa':
      return ['/dist/wildflower.spa.min.js']
    case 'full':
      return ['/dist/wildflower.full.min.js']
    // Explicit minified builds (same as short names, for clarity)
    case 'core-min':
      return ['/dist/wildflower.min.js']
    case 'lite-min':
      return ['/dist/wildflower.lite.min.js']
    case 'spa-min':
      return ['/dist/wildflower.spa.min.js']
    case 'full-min':
      return ['/dist/wildflower.full.min.js']
    case 'experimental-min':
      return ['/dist/wildflower.experimental.js']
    // Development builds (console warnings preserved)
    case 'core-dev':
      return ['/dist/wildflower.dev.js']
    case 'lite-dev':
      return ['/dist/wildflower.lite.dev.js']
    case 'spa-dev':
      return ['/dist/wildflower.spa.dev.js']
    case 'full-dev':
      return ['/dist/wildflower.full.dev.js']
    // EXPERIMENTAL: Schema-based ListRenderer v2
    case 'experimental':
      return ['/dist/wildflower.experimental.js']
    case 'experimental-dev':
      return ['/dist/wildflower.experimental.dev.js']
    case 'source':
      // DEPRECATED: The old monolithic files in /src/ are obsolete after ES6 migration.
      // Source is now in /src/ and must be built to /dist/.
      // Fall through to full-dev as the default.
      console.warn('[WF Test] "source" mode is deprecated. Using "full-dev" instead. See /src/ for ES6 modules.')
      return ['/dist/wildflower.full.dev.js']
    default:
      return ['/dist/wildflower.full.dev.js']
  }
}

/**
 * Get the base build type from a mode (strips -dev suffix)
 * @private
 * @param {string} mode - Distribution mode
 * @returns {string} Base mode without -dev suffix
 */
function getBaseMode(mode) {
  return mode.replace(/-(dev|min)$/, '')
}

/**
 * Check if a mode is a development build
 * @private
 * @param {string} mode - Distribution mode
 * @returns {boolean} Whether this is a dev build
 */
function isDevBuild(mode) {
  return mode.endsWith('-dev')
}

/**
 * Check if a feature is available in the current build
 *
 * @param {string} feature - Feature name to check
 * @returns {boolean} Whether the feature is available
 *
 * @example
 * if (hasFeature('portals')) {
 *   // Test portal functionality
 * }
 */
export function hasFeature(feature) {
  const mode = getDistMode()
  const baseMode = getBaseMode(mode)

  // Features stripped from lite build only
  const liteStrippedFeatures = ['portals', 'transitions', 'modals', 'configurable-templates', 'plugins']

  if (baseMode === 'lite' && liteStrippedFeatures.includes(feature)) {
    return false
  }

  // Binding validation is only in source and dev builds
  // Minified builds strip FEATURE_BINDING_VALIDATION, but dev builds keep it
  if ((feature === 'validation' || feature === 'binding-validation')) {
    // Available in source and all dev builds
    if (mode === 'source' || isDevBuild(mode)) {
      return true
    }
    return false
  }

  // SSR is only in full builds (and source)
  // Experimental build is based on core, so no SSR
  if (feature === 'ssr' && (baseMode === 'core' || baseMode === 'lite' || baseMode === 'spa' || baseMode === 'experimental')) {
    return false
  }

  // Router is only in spa and full builds (and source)
  // Experimental build is based on core, so no router
  if (feature === 'router' && (baseMode === 'core' || baseMode === 'lite' || baseMode === 'experimental')) {
    return false
  }

  return true
}

/**
 * Check if we're testing a minified build (console.* calls are stripped)
 * Dev builds (.dev.js) are NOT minified and preserve console warnings
 *
 * @returns {boolean} Whether the current build is minified
 */
export function isMinifiedBuild() {
  const mode = getDistMode()
  // Source and dev builds are not minified
  return mode !== 'source' && !isDevBuild(mode)
}

/**
 * Check if console warnings are available (not in minified builds)
 *
 * @returns {boolean} Whether console warnings are available
 */
export function hasConsoleWarnings() {
  return !isMinifiedBuild()
}

/**
 * Load a single script and return a promise
 * @private
 */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    // Check if already loaded
    const existing = document.querySelector(`script[src="${src}"]`)
    if (existing) {
      resolve()
      return
    }

    const script = document.createElement('script')
    script.src = src
    script.onload = resolve
    script.onerror = () => reject(new Error(`Failed to load: ${src}`))
    document.head.appendChild(script)
  })
}

/**
 * Load the WildflowerJS framework
 *
 * @param {Object} [options] - Configuration options
 * @param {DistMode} [options.mode] - Distribution mode to load
 * @param {string[]} [options.scripts] - Custom script paths (overrides mode)
 * @returns {Promise<Object>} The wildflower instance (window.wildflower)
 *
 * @example
 * // Load source files (default)
 * await loadFramework()
 *
 * // Load minified core build
 * await loadFramework({ mode: 'core' })
 *
 * // Load custom scripts
 * await loadFramework({ scripts: ['/my/custom/build.js'] })
 */
export async function loadFramework(options = {}) {
  const scripts = options.scripts || getFrameworkScripts(options.mode)
  const mode = options.mode || getDistMode()

  // Log which mode we're testing (useful for debugging)
  if (mode !== 'source' && typeof console !== 'undefined') {
    console.log(`[WF Test] Loading distribution build: ${mode}`)
  }

  // Load scripts sequentially (order matters for source files)
  for (const src of scripts) {
    await loadScript(src)
  }

  // Wait for framework to initialize
  await new Promise(resolve => setTimeout(resolve, 100))

  // Verify framework loaded
  if (typeof window !== 'undefined' && !window.wildflower) {
    throw new Error('Framework failed to load - window.wildflower is undefined')
  }

  // Apply reverse mangle aliases so tests can access internal properties by original name
  if (isMinifiedBuild() && window.wildflower) {
    const wf = window.wildflower

    // 1. Alias WildflowerJS instance properties (componentInstances, storeManager, etc.)
    applyMangleAliases(wf)

    // 2. Alias WildflowerJS prototype (methods like _getAttr, _hasAttr, _attrSelector, etc.)
    applyPrototypeMangleAliases(Object.getPrototypeOf(wf))

    // 3. Alias StoreManager instance properties
    if (wf.storeManager || wf.__sm) {
      const sm = wf.storeManager || wf.__sm
      applyMangleAliases(sm)
    }

    // 4. Alias ContextRegistry prototype (getContextForElement, _batchMode, etc.)
    try {
      const registry = wf._contextRegistry
      if (registry) {
        applyPrototypeMangleAliases(Object.getPrototypeOf(registry))
        applyMangleAliases(registry)
      }
    } catch (e) { /* ignore */ }

    // 5. Create probe component to grab RSM and PatternTrie prototypes
    const probeName = '__mangle_probe__'
    wf.component(probeName, {
      state: { _probeItems: [{ id: 1 }] }
    })
    const probeEl = document.createElement('div')
    probeEl.setAttribute('data-component', probeName)
    // Add a data-list to generate a context object for prototype aliasing
    probeEl.innerHTML = '<div data-list="_probeItems" data-key="id"><template><span></span></template></div>'
    probeEl.style.display = 'none'
    document.body.appendChild(probeEl)
    wf.scan()

    const probeInstance = wf.componentInstances.values().next().value
    if (probeInstance) {
      // 6. Alias component instance prototype (_renderEffect, _itemTemplates, _propsData, etc.)
      applyPrototypeMangleAliases(Object.getPrototypeOf(probeInstance))

      if (probeInstance.stateManager) {
        const sm = probeInstance.stateManager

        // 7. Alias ReactiveStateManager prototype
        applyPrototypeMangleAliases(Object.getPrototypeOf(sm))

        // 8. Alias PatternTrie prototype (for _matchCache, etc.)
        try {
          const trie = sm._patternTrie
          if (trie) {
            applyPrototypeMangleAliases(Object.getPrototypeOf(trie))
          }
        } catch (e) { /* ignore */ }
      }
    }

    // 9. Alias HTMLElement prototype for DOM expandos (_wfDisposeEffect, _mapArrayInitialized, etc.)
    applyPrototypeMangleAliases(HTMLElement.prototype)

    // 8. Alias Context/ListContext prototypes via the probe's list context
    try {
      const listEl = probeEl.querySelector('[data-list]')
      if (listEl && listEl._listContext) {
        const ctx = listEl._listContext
        // Alias ListContext prototype
        applyPrototypeMangleAliases(Object.getPrototypeOf(ctx))
        // Also alias Context prototype (parent class)
        const listCtxProto = Object.getPrototypeOf(ctx)
        const ctxProto = Object.getPrototypeOf(listCtxProto)
        if (ctxProto && ctxProto !== Object.prototype) {
          applyPrototypeMangleAliases(ctxProto)
        }
      }
    } catch (e) { /* ignore */ }

    // Clean up probe
    try {
      const probeId = probeEl.dataset.componentId || probeEl.dataset.wfComponentId
      if (probeId) wf.destroyComponent(probeId)
    } catch (e) { /* ignore cleanup errors */ }
    probeEl.remove()
    wf.componentDefinitions.delete(probeName)
  }

  return window.wildflower
}

/**
 * Reset framework state between tests
 * Clears all component definitions, instances, stores, templates, and caches
 *
 * @example
 * beforeEach(() => {
 *   resetFramework()
 * })
 */
export function resetFramework() {
  if (typeof window === 'undefined') return

  const wildflower = window.wildflower
  if (!wildflower) return

  // Dispose context registry (cancels GC interval)
  if (wildflower._contextRegistry && typeof wildflower._contextRegistry.dispose === 'function') {
    wildflower._contextRegistry.dispose()
  }

  // Clear component definitions and instances
  if (wildflower.componentDefinitions) {
    wildflower.componentDefinitions.clear()
  }
  if (wildflower.componentInstances) {
    wildflower.componentInstances.clear()
  }

  // Clear store manager
  if (wildflower.storeManager && wildflower.storeManager._namedStores) {
    wildflower.storeManager._namedStores.clear()
  }

  // Clear template cache
  if (wildflower._templateCache) {
    if (wildflower._templateCache.general) wildflower._templateCache.general.clear()
    if (wildflower._templateCache.lists) wildflower._templateCache.lists.clear()
    if (wildflower._templateCache.compiled) wildflower._templateCache.compiled.clear()
    if (wildflower._templateCache.extracted) wildflower._templateCache.extracted.clear()
    if (wildflower._templateCache.fragmentPools) wildflower._templateCache.fragmentPools.clear()
    if (wildflower._templateCache.stats) wildflower._templateCache.stats.clear()
  }

  // Clear pending effect batch (leaked batches prevent effect creation in next scan)
  wildflower._pendingEffectInstances = null

  // Clear list relationships (critical for nested list tests)
  if (wildflower._listRelationships) {
    wildflower._listRelationships.clear()
  }

  // Reset SSR manager state
  if (wildflower.ssrManager) {
    if (wildflower.ssrManager.protectedElements) wildflower.ssrManager.protectedElements.clear()
    if (wildflower.ssrManager.protectedLists) wildflower.ssrManager.protectedLists.clear()
  }

  // Clear component relationships
  if (wildflower.componentParents) wildflower.componentParents.clear()
  if (wildflower.componentChildren) wildflower.componentChildren.clear()
  if (wildflower.eventHandlers) wildflower.eventHandlers.clear()

  // Reset domElements arrays
  if (wildflower.domElements) {
    wildflower.domElements.bindings = []
    wildflower.domElements.conditionals = []
    wildflower.domElements.lists = []
    wildflower.domElements.models = []
    wildflower.domElements.slots = []
    wildflower.domElements.actions = []
  }

  // Clear global error handlers
  if (wildflower._globalErrorHandlers) {
    wildflower._globalErrorHandlers.length = 0
  }

  // Clear plugin registry (if it's a Map)
  if (wildflower._plugins && typeof wildflower._plugins.clear === 'function') {
    wildflower._plugins.clear()
  }

  // Clear entity dependents (if it's a Map)
  if (wildflower._entityDependents && typeof wildflower._entityDependents.clear === 'function') {
    wildflower._entityDependents.clear()
  }

  // Clear external dependencies (if it's a Map)
  if (wildflower._externalDependencies && typeof wildflower._externalDependencies.clear === 'function') {
    wildflower._externalDependencies.clear()
  }

  // Clear v2 list bindings (experimental schema-based architecture)
  if (wildflower._listBindings && typeof wildflower._listBindings.clear === 'function') {
    wildflower._listBindings.clear()
  }
}

/**
 * Wait for framework to process reactive updates
 * Use this after state changes to allow the DOM to update
 *
 * @param {number} [ms=50] - Milliseconds to wait
 * @returns {Promise<void>}
 *
 * @example
 * instance.state.count++
 * await waitForUpdate()
 * expect(element.textContent).toBe('1')
 */
export async function waitForUpdate(ms) {
  // When called without args, use the framework's deterministic whenSettled().
  // When called with explicit ms, use setTimeout (needed for debounce tests etc).
  if (ms === undefined && typeof window !== 'undefined' && window.wildflower?.whenSettled) {
    await window.wildflower.whenSettled()
    return
  }
  await new Promise(resolve => setTimeout(resolve, ms ?? 50))
}

/**
 * Wait for the framework to finish processing all pending work:
 * microtask effect flushes, rAF render cycles, and pool flushes.
 *
 * This is the preferred way to wait in tests. It's deterministic (no
 * arbitrary timeouts) and fast (resolves as soon as work is done).
 *
 * Falls back to waitForUpdate() if the framework isn't loaded yet.
 *
 * @returns {Promise<void>}
 *
 * @example
 * instance.state.count++
 * await whenSettled()
 * expect(el.textContent).toBe('1')
 */
export async function whenSettled() {
  if (typeof window !== 'undefined' && window.wildflower?.whenSettled) {
    await window.wildflower.whenSettled()
  } else {
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

/**
 * Wait for complete render cycle including microtask queue
 * Use this when you need to ensure all pending renders are complete
 *
 * @returns {Promise<void>}
 *
 * @example
 * wildflower._scanForDynamicComponents()
 * await waitForCompleteRender()
 */
export async function waitForCompleteRender() {
  if (typeof window !== 'undefined' && window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

/**
 * Create a test container element
 *
 * @param {Object} [options] - Container options
 * @param {boolean} [options.visible=false] - Make container visible for debugging
 * @param {string} [options.id='test-container'] - Container ID
 * @returns {{ container: HTMLElement, cleanup: () => void }}
 *
 * @example
 * const { container, cleanup } = createTestContainer()
 * container.innerHTML = `<div data-component="test">...</div>`
 * // ... run tests
 * cleanup()
 */
export function createTestContainer(options = {}) {
  const container = document.createElement('div')
  container.id = options.id || 'test-container'

  if (!options.visible) {
    container.style.position = 'absolute'
    container.style.left = '-9999px'
    container.style.opacity = '0'
  }

  document.body.appendChild(container)

  const cleanup = () => {
    if (container.parentNode) {
      container.parentNode.removeChild(container)
    }
  }

  return { container, cleanup }
}

/**
 * Get a component instance by name or element
 *
 * @param {string|HTMLElement} target - Component name or element
 * @returns {Object|null} Component instance or null if not found
 *
 * @example
 * const instance = getComponent('my-component')
 * const instance = getComponent(element)
 */
export function getComponent(target) {
  if (typeof window === 'undefined' || !window.wildflower) return null

  const wildflower = window.wildflower

  if (typeof target === 'string') {
    // Find by component name
    return wildflower.getComponent(target)
  }

  if (target instanceof HTMLElement) {
    // Find by element
    const componentId = target.dataset?.componentId || target.dataset?.wfComponentId
    if (componentId && wildflower.componentInstances) {
      return wildflower.componentInstances.get(componentId)
    }
  }

  return null
}

/**
 * Trigger an action on an element
 *
 * @param {HTMLElement} element - Element with data-action attribute
 * @param {string} [eventType='click'] - Event type to dispatch
 * @returns {Promise<void>}
 *
 * @example
 * const button = container.querySelector('[data-action="increment"]')
 * await triggerAction(button)
 * await waitForUpdate()
 */
export async function triggerAction(element, eventType = 'click') {
  if (!element) {
    throw new Error('triggerAction: element is required')
  }

  const event = new Event(eventType, { bubbles: true, cancelable: true })
  element.dispatchEvent(event)
  await waitForUpdate()
}

/**
 * Wait for a DOM element's content to match expected value
 * Polls until the condition is met or timeout is reached.
 * Much more reliable than fixed timeouts for reactive DOM updates.
 *
 * @param {Function} getter - Function that returns the current DOM value
 * @param {*} expected - Expected value to match
 * @param {Object} [options] - Options
 * @param {number} [options.timeout=1000] - Timeout in milliseconds
 * @param {number} [options.interval=10] - Polling interval in milliseconds
 * @param {string} [options.message] - Custom error message
 * @returns {Promise<void>}
 * @throws {Error} If timeout is reached before value matches
 *
 * @example
 * // Wait for text content
 * await waitForDOM(() => element.textContent.trim(), 'Updated Value')
 *
 * // Wait for element count
 * await waitForDOM(() => container.querySelectorAll('li').length, 3)
 *
 * // With custom options
 * await waitForDOM(() => span.textContent, 'Done', { timeout: 2000, message: 'Loading never finished' })
 */
export async function waitForDOM(getter, expected, options = {}) {
  const { timeout = 1000, interval = 10, message } = options
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      const current = getter()
      if (current === expected) return
    } catch (e) {
      // Element might not exist yet, keep polling
    }
    await new Promise(resolve => setTimeout(resolve, interval))
  }

  // Final check before throwing
  let current
  try {
    current = getter()
    if (current === expected) return
  } catch (e) {
    current = `[error: ${e.message}]`
  }

  throw new Error(
    message ||
    `waitForDOM: timeout after ${timeout}ms waiting for value to equal ${JSON.stringify(expected)}. ` +
    `Current value: ${JSON.stringify(current)}`
  )
}

/**
 * Wait for a specific state value
 *
 * @param {Object} instance - Component instance
 * @param {string} path - State path (supports dot notation)
 * @param {*} expected - Expected value
 * @param {number} [timeout=1000] - Timeout in milliseconds
 * @returns {Promise<void>}
 * @throws {Error} If timeout is reached before value matches
 *
 * @example
 * await waitForState(instance, 'loading', false)
 * await waitForState(instance, 'user.name', 'John')
 */
export async function waitForState(instance, path, expected, timeout = 1000) {
  const startTime = Date.now()
  const pathParts = path.split('.')

  const getValue = () => {
    let value = instance.state
    for (const part of pathParts) {
      if (value == null) return undefined
      value = value[part]
    }
    return value
  }

  while (Date.now() - startTime < timeout) {
    const current = getValue()
    if (current === expected) return
    await waitForUpdate(10)
  }

  throw new Error(
    `waitForState: timeout waiting for state.${path} to equal ${JSON.stringify(expected)}. ` +
    `Current value: ${JSON.stringify(getValue())}`
  )
}

/**
 * Skip test if feature is not available in current build
 *
 * @param {string} feature - Feature name
 * @param {Function} testFn - Test function
 * @returns {Function} Original function or no-op
 *
 * @example
 * it('should use portals', skipIfNoFeature('portals', async () => {
 *   // Test code
 * }))
 */
export function skipIfNoFeature(feature, testFn) {
  if (!hasFeature(feature)) {
    return () => {
      console.log(`[WF Test] Skipping test - ${feature} not available in ${getDistMode()} build`)
    }
  }
  return testFn
}

/**
 * Initialize the context system (needed after resetFramework in some cases)
 *
 * @example
 * resetFramework()
 * initContextSystem()
 */
export function initContextSystem() {
  if (typeof window === 'undefined' || !window.wildflower) return

  const wildflower = window.wildflower
  if (wildflower._initContextSystem) {
    wildflower._contextSystemInitialized = false
    wildflower._initContextSystem()
  }
}

/**
 * Find an element by its binding path using the context registry
 * This is more reliable than querySelector('[data-bind="path"]') since
 * data-bind attributes may be stripped from the DOM for performance.
 *
 * @param {HTMLElement} container - Container element to search within
 * @param {string} path - The binding path (e.g., 'name', 'user.email', 'computed:total')
 * @returns {HTMLElement|null} The bound element or null if not found
 *
 * @example
 * const nameSpan = findBoundElement(component, 'name')
 * expect(nameSpan.textContent).toBe('Alice')
 *
 * const totalSpan = findBoundElement(listItem, 'computed:total')
 */
export function findBoundElement(container, path) {
  if (typeof window === 'undefined' || !window.wildflower) return null

  const wildflower = window.wildflower
  const registry = wildflower._contextRegistry

  if (!registry) return null

  // Get the component ID from the container or its parent
  const componentEl = container.closest('[data-component-id]')
  const componentId = componentEl?.dataset?.componentId

  if (!componentId) {
    // Try to find by iterating through all binding contexts
    const bindingContexts = registry.getContextsByType?.('binding') || []
    for (const ctx of bindingContexts) {
      if (ctx.path === path && ctx.element && container.contains(ctx.element)) {
        return ctx.element
      }
    }
    return null
  }

  // Get all contexts for this component
  const contexts = registry.getContextsForComponent?.(componentId) || []

  // Find the binding context with matching path
  for (const ctx of contexts) {
    if (ctx.type === 'binding' && ctx.path === path && container.contains(ctx.element)) {
      return ctx.element
    }
  }

  return null
}

/**
 * Find all elements bound to a specific path within a container
 * Useful for lists where multiple elements may be bound to the same path
 *
 * @param {HTMLElement} container - Container element to search within
 * @param {string} path - The binding path
 * @returns {HTMLElement[]} Array of bound elements
 *
 * @example
 * const nameSpans = findAllBoundElements(list, 'name')
 * expect(nameSpans.length).toBe(3)
 */
export function findAllBoundElements(container, path) {
  if (typeof window === 'undefined' || !window.wildflower) return []

  const wildflower = window.wildflower
  const registry = wildflower._contextRegistry

  if (!registry) return []

  const bindingContexts = registry.getContextsByType?.('binding') || []
  const elements = []

  for (const ctx of bindingContexts) {
    if (ctx.path === path && ctx.element && container.contains(ctx.element)) {
      elements.push(ctx.element)
    }
  }

  return elements
}

/**
 * Get list item elements from a list container.
 * List items are identified by having the _listIndex JS property.
 *
 * @param {HTMLElement} listContainer - The list container element (has data-list attribute)
 * @returns {HTMLElement[]} Array of list item elements
 *
 * @example
 * const items = getListItems(container.querySelector('[data-list="items"]'))
 * expect(items.length).toBe(3)
 */
export function getListItems(listContainer) {
  if (!listContainer) return []
  return Array.from(listContainer.children).filter(c =>
    c._listIndex !== undefined && c.tagName !== 'TEMPLATE'
  )
}
