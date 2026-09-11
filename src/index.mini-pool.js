/**
 * WildflowerJS: Mini-Pool Package Entry Point
 *
 * Mini's composition with pools in place of lists: core reactive UI +
 * components + entity pools, NO data-list. The lean tier for games,
 * simulations, and per-frame visualization — workloads that render through
 * `data-pool` and never touch the list-render cluster.
 *
 * Excludes:
 *   - ListRenderer cluster (data-list + keyed reconciliation + nested lists)
 *   - Portals, Transitions, Modals (shared with mini/lite)
 *   - Plugin system (shared with mini/lite)
 *
 * Using `data-list` against a mini-pool build throws at scan time, same as
 * `pools: {}` throws against mini. Lite is the next tier up when an app
 * needs both rendering primitives.
 *
 * @module WildflowerJS/MiniPool
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

// Rendering system (PoolRenderer, NO ListRenderer)
import { TemplateSystemMethods } from './rendering/TemplateSystem.js';
import { RenderingCoreMethods } from './rendering/RenderingCore.js';
import { PoolRendererMethods } from './rendering/PoolRenderer.js';

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

    // Rendering (pools, no lists)
    TemplateSystemMethods,
    RenderingCoreMethods,
    PoolRendererMethods,

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
// Create and export the framework instance
// =============================================================================

const wildflower = createInstance(WildflowerJS);

export { WildflowerJS, wildflower };
