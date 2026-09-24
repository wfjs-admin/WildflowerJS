/**
 * Browser globals for script-tag usage: window.WF_ERRORS, window.wfError,
 * window.wfWarn, window.PathResolver, window.pathResolver, window.objectUtils.
 *
 * Moved out of wfUtils.js (2026-09-19). There the assignment was a module-load
 * side effect, which kept the whole WF_ERRORS table, PathResolver and
 * objectUtils alive in ANY bundle that imported one export from wfUtils,
 * including headless bundles of the reactive graph (the thread extension's
 * worker half) that raise two codes and use none of the rest. Here it is a
 * side-effect import of WildflowerCore.js, which every framework tier ships
 * and no headless bundle does, so the tiers behave exactly as before and a
 * headless bundle tree-shakes what it does not use.
 */

import { WF_ERRORS, wfError, wfWarn, PathResolver, pathResolver, objectUtils } from './wfUtils.js';

if (typeof window !== 'undefined') {
    window.WF_ERRORS = WF_ERRORS;
    window.wfError = wfError;
    window.wfWarn = wfWarn;
    window.PathResolver = PathResolver;
    window.pathResolver = pathResolver;
    window.objectUtils = objectUtils;
}
