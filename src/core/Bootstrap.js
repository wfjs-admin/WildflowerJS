/**
 * WildflowerJS Bootstrap
 *
 * Reads configuration from script tag and creates the global instance.
 * This file MUST be loaded last after all mixins have been applied.
 *
 * @module Bootstrap
 */

// Read configuration from script tag before creating instance
// Usage: <script src="wildflower.js" data-debug="true" data-error-handling="throw"></script>
let _scriptConfig = {};
if (typeof document !== 'undefined' && document.currentScript) {
    const script = document.currentScript;

    // Debug mode: data-debug="true"
    if (script.hasAttribute('data-debug')) {
        const debugValue = script.getAttribute('data-debug');
        _scriptConfig.debug = debugValue === 'true' || debugValue === '';
    }

    // Error handling: data-error-handling="log|throw|silent"
    if (script.hasAttribute('data-error-handling')) {
        const errorVal = script.getAttribute('data-error-handling');
        if (errorVal === 'log' || errorVal === 'throw' || errorVal === 'silent') {
            _scriptConfig.errorHandling = errorVal;
        } else if (__DEV__) {
            console.warn(`[WF] Invalid data-error-handling="${errorVal}". Must be 'log', 'throw', or 'silent'.`);
        }
    }

    // Auto-init: data-auto-init="false" to disable
    if (script.hasAttribute('data-auto-init')) {
        _scriptConfig.autoInit = script.getAttribute('data-auto-init') !== 'false';
    }

    // Exclusive prefix mode: data-wf-prefix="true"
    if (script.hasAttribute('data-wf-prefix')) {
        _scriptConfig.useWfPrefixOnly = script.getAttribute('data-wf-prefix') === 'true';
    }
}

// Create a global instance for easy access

/**
 * Create and configure the WildflowerJS instance
 * @param {typeof WildflowerJS} WildflowerClass - The WildflowerJS class (with all mixins applied)
 * @returns {WildflowerJS} Configured instance
 */
export function createInstance(WildflowerClass) {
    const instance = new WildflowerClass(document, _scriptConfig);

    // Expose globals for script tag usage
    if (typeof window !== 'undefined') {
        window.WildflowerJS = WildflowerClass;
        window.wildflower = instance;
    }

    return instance;
}
