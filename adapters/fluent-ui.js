/**
 * WildflowerJS Adapter Pack — Microsoft Fluent UI Web Components v2
 * https://learn.microsoft.com/en-us/fluent-ui/web-components/
 *
 * Drop-in CDN usage:
 *   <script src="adapters/fluent-ui.js"></script>
 *
 * Fluent UI v2 (built on FAST) uses native event names (change, input).
 * Events are CustomEvent but value is read from the element, not e.detail.
 */
(function () {
    var w = window.wildflower;
    if (!w || !w.registerAdapter) {
        console.warn('[WF Adapters] wildflower.registerAdapter not available. Load the framework before this script.');
        return;
    }

    // Text inputs
    w.registerAdapter('fluent-text-field',   { prop: 'value',   event: 'input' });
    w.registerAdapter('fluent-text-area',    { prop: 'value',   event: 'change' });
    w.registerAdapter('fluent-number-field', { prop: 'value',   event: 'input' });
    w.registerAdapter('fluent-search',       { prop: 'value',   event: 'input' });

    // Selection
    w.registerAdapter('fluent-select',       { prop: 'value',   event: 'change' });
    w.registerAdapter('fluent-combobox',     { prop: 'value',   event: 'change' });
    w.registerAdapter('fluent-radio-group',  { prop: 'value',   event: 'change' });

    // Boolean
    w.registerAdapter('fluent-checkbox',     { prop: 'checked', event: 'change' });
    w.registerAdapter('fluent-switch',       { prop: 'checked', event: 'change' });

    // Numeric
    w.registerAdapter('fluent-slider',       { prop: 'value',   event: 'change' });
})();
