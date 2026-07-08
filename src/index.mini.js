/**
 * WildflowerJS: Mini Package Entry Point
 *
 * Smallest possible build: core reactive UI + components + lists, NO pools.
 *
 * For apps that don't need high-frequency entity rendering (forms, dashboards,
 * tables, navigation, standard CRUD UI). Lite is the next tier up when you
 * need `data-pool` for animation or >500-entity collections.
 *
 * Excludes:
 *   - PoolRenderer (data-pool primitive + entity machinery)
 *   - Portals, Transitions, Modals (shared with lite)
 *   - Plugin system (shared with standard)
 *
 * Using `pools: {}` in a component against a mini build throws at
 * component registration time.
 *
 * @module WildflowerJS/Mini
 */

// Core class definition
import { WildflowerJS } from './core/WildflowerCore.js';

// Core functionality (always included)
import { ExpressionEvaluatorMethods } from './core/ExpressionEvaluator.js';
import { BindingResolverMethods } from './core/BindingResolver.js';
import { EntitySystemMethods } from './core/EntitySystem.js';
import { FrameworkInitMethods } from './core/FrameworkInit.js';

// Component system
import { ComponentScanningMethods } from './components/ComponentScanning.js';
import { ComponentRegistryMethods } from './components/ComponentRegistry.js';
import { ComponentLifecycleMethods } from './components/ComponentLifecycle.js';

// Rendering system (NO PoolRenderer)
import { TemplateSystemMethods } from './rendering/TemplateSystem.js';
import { RenderingCoreMethods } from './rendering/RenderingCore.js';
import { ListRendererMethods } from './rendering/ListRenderer.js';

// Event system
import { EventSystemMethods } from './events/EventSystem.js';
import { FormHandlingMethods } from './events/FormHandling.js';

// DOM abstraction (WildQuery)
import { DomAbstractionMethods } from './dom/DomAbstraction.js';

// Features (core only, no plugins, portals, transitions, modals)
import { PropsSystemMethods } from './features/PropsSystem.js';
import { ErrorBoundariesMethods } from './features/ErrorBoundaries.js';
// Extension points (directives + hooks) - shipped in every build
import { DirectiveSystemMethods } from './features/DirectiveSystem.js';
import { HookSystemMethods } from './features/HookSystem.js';

// Bootstrap (creates instance)
import { createInstance } from './core/Bootstrap.js';

// =============================================================================
// Assemble the framework by mixing all methods into WildflowerJS.prototype
// =============================================================================

Object.assign(WildflowerJS.prototype,
    // Core
    ExpressionEvaluatorMethods,
    BindingResolverMethods,
    EntitySystemMethods,
    FrameworkInitMethods,

    // Components
    ComponentScanningMethods,
    ComponentRegistryMethods,
    ComponentLifecycleMethods,

    // Rendering (no pools)
    TemplateSystemMethods,
    RenderingCoreMethods,
    ListRendererMethods,

    // Events
    EventSystemMethods,
    FormHandlingMethods,

    // DOM abstraction
    DomAbstractionMethods,

    // Features (core only)
    PropsSystemMethods,
    ErrorBoundariesMethods,

    // Extension points (directives + hooks)
    DirectiveSystemMethods,
    HookSystemMethods
);

// =============================================================================
// Guard: warn users attempting to define pools against a mini build
// =============================================================================

(function guardPools() {
    const proto = WildflowerJS.prototype;
    const originalComponent = proto.component;
    if (typeof originalComponent !== 'function') return;

    proto.component = function(name, definition) {
        if (definition && definition.pools) {
            throw new Error(
                `[WildflowerJS Mini] Component "${name}" declares \`pools\` but the mini ` +
                `build does not include the data-pool renderer.\n\n` +
                `Fix: change your script tag from wildflower.mini.min.js to wildflower.lite.min.js\n` +
                `(or any higher tier: standard / spa / full).\n\n` +
                `Build ladder: mini → lite → standard → spa → full. ` +
                `See https://wildflowerjs.com/docs/builds`
            );
        }
        return originalComponent.call(this, name, definition);
    };
})();

// =============================================================================
// Create and export the framework instance
// =============================================================================

const wildflower = createInstance(WildflowerJS);

export { WildflowerJS, wildflower };
