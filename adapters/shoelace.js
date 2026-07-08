/**
 * WildflowerJS Adapter Pack — Shoelace 2.x
 * https://shoelace.style
 *
 * Drop-in CDN usage:
 *   <script src="adapters/shoelace.js"></script>
 *
 * Shoelace events use the sl- prefix: sl-input (keystroke), sl-change (commit).
 * Boolean controls (checkbox, switch) use the 'checked' property.
 */
(function () {
    var w = window.wildflower;
    if (!w || !w.registerAdapter) {
        console.warn('[WF Adapters] wildflower.registerAdapter not available. Load the framework before this script.');
        return;
    }

    // Text inputs — sl-input fires on every keystroke
    w.registerAdapter('sl-input',        { prop: 'value',   event: 'sl-input' });
    w.registerAdapter('sl-textarea',     { prop: 'value',   event: 'sl-input' });

    // Selection
    w.registerAdapter('sl-select',       { prop: 'value',   event: 'sl-change' });
    w.registerAdapter('sl-radio-group',  { prop: 'value',   event: 'sl-change' });

    // Boolean
    w.registerAdapter('sl-checkbox',     { prop: 'checked', event: 'sl-change' });
    w.registerAdapter('sl-switch',       { prop: 'checked', event: 'sl-change' });

    // Numeric / specialty
    w.registerAdapter('sl-range',        { prop: 'value',   event: 'sl-input' });
    w.registerAdapter('sl-rating',       { prop: 'value',   event: 'sl-change' });
    w.registerAdapter('sl-color-picker', { prop: 'value',   event: 'sl-input' });
})();
