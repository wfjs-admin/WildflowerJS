/**
 * WildflowerJS Adapter Pack — Nord Health Design System
 * https://nordhealth.design
 *
 * Drop-in CDN usage:
 *   <script src="adapters/nord.js"></script>
 *
 * Nord uses native event names (input, change).
 * Toggle component uses 'checked' property (same as checkbox).
 */
(function () {
    var w = window.wildflower;
    if (!w || !w.registerAdapter) {
        console.warn('[WF Adapters] wildflower.registerAdapter not available. Load the framework before this script.');
        return;
    }

    // Text inputs
    w.registerAdapter('nord-input',       { prop: 'value',   event: 'input' });
    w.registerAdapter('nord-textarea',    { prop: 'value',   event: 'input' });

    // Selection
    w.registerAdapter('nord-select',      { prop: 'value',   event: 'input' });

    // Boolean
    w.registerAdapter('nord-checkbox',    { prop: 'checked', event: 'change' });
    w.registerAdapter('nord-toggle',      { prop: 'checked', event: 'change' });
    w.registerAdapter('nord-radio',       { prop: 'checked', event: 'change' });

    // Numeric
    w.registerAdapter('nord-range',       { prop: 'value',   event: 'input' });

    // Date
    w.registerAdapter('nord-date-picker', { prop: 'value',   event: 'input' });
})();
