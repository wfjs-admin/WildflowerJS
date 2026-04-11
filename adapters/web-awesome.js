/**
 * WildflowerJS Adapter Pack — Web Awesome 3.x (Shoelace successor)
 * https://webawesome.com
 *
 * Drop-in CDN usage:
 *   <script src="adapters/web-awesome.js"></script>
 *
 * Web Awesome 3.x uses native event names (input, change) — no prefix.
 * Boolean controls (checkbox, switch) use the 'checked' property.
 */
(function () {
    var w = window.wildflower;
    if (!w || !w.registerAdapter) {
        console.warn('[WF Adapters] wildflower.registerAdapter not available. Load the framework before this script.');
        return;
    }

    // Text inputs — native 'input' event fires on every keystroke
    w.registerAdapter('wa-input',        { prop: 'value',   event: 'input' });
    w.registerAdapter('wa-textarea',     { prop: 'value',   event: 'input' });
    w.registerAdapter('wa-number-input', { prop: 'value',   event: 'input' });

    // Selection
    w.registerAdapter('wa-select',       { prop: 'value',   event: 'change' });
    w.registerAdapter('wa-radio-group',  { prop: 'value',   event: 'change' });

    // Boolean
    w.registerAdapter('wa-checkbox',     { prop: 'checked', event: 'change' });
    w.registerAdapter('wa-switch',       { prop: 'checked', event: 'change' });

    // Numeric / specialty
    w.registerAdapter('wa-slider',       { prop: 'value',   event: 'input' });
    w.registerAdapter('wa-rating',       { prop: 'value',   event: 'change' });
    w.registerAdapter('wa-color-picker', { prop: 'value',   event: 'input' });
})();
