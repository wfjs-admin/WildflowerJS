/**
 * WildflowerJS Adapter Pack — IBM Carbon Web Components v2
 * https://carbondesignsystem.com
 *
 * Drop-in CDN usage:
 *   <script src="adapters/carbon.js"></script>
 *
 * Carbon uses a mix of native events (text inputs) and custom cds-* events
 * (dropdowns, checkboxes, toggles). Custom events carry data in e.detail.
 */
(function () {
    var w = window.wildflower;
    if (!w || !w.registerAdapter) {
        console.warn('[WF Adapters] wildflower.registerAdapter not available. Load the framework before this script.');
        return;
    }

    // Text inputs — use native events (composed through shadow DOM)
    w.registerAdapter('cds-text-input',     { prop: 'value',   event: 'input' });
    w.registerAdapter('cds-textarea',       { prop: 'value',   event: 'input' });
    w.registerAdapter('cds-password-input', { prop: 'value',   event: 'input' });
    w.registerAdapter('cds-search',         { prop: 'value',   event: 'cds-search-input' });

    // Number — custom event
    w.registerAdapter('cds-number-input',   { prop: 'value',   event: 'cds-number-input' });

    // Selection — custom events
    w.registerAdapter('cds-select',         { prop: 'value',   event: 'cds-select-selected' });
    w.registerAdapter('cds-dropdown',       { prop: 'value',   event: 'cds-dropdown-selected' });
    w.registerAdapter('cds-combo-box',      { prop: 'value',   event: 'cds-combo-box-selected' });

    // Boolean — custom events
    w.registerAdapter('cds-checkbox',       { prop: 'checked', event: 'cds-checkbox-changed' });
    w.registerAdapter('cds-toggle',         { prop: 'checked', event: 'cds-toggle-changed' });

    // Radio group
    w.registerAdapter('cds-radio-button-group', { prop: 'value', event: 'cds-radio-button-group-changed' });

    // Slider
    w.registerAdapter('cds-slider',         { prop: 'value',   event: 'cds-slider-changed' });
})();
