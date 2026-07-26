/**
 * WildflowerJS: Nano Package Entry Point (SPIKE — size measurement only)
 *
 * Below mini: core reactive UI + components, NO data-list, NO pools.
 * The interactive-widget / single-file-artifact tier — state, computed,
 * data-bind/show/model, events, forms. No list rendering pipeline.
 *
 * This is a measurement spike to quantify the brotli delta of gating the
 * list-render cluster (ListRenderer + ListItemBinding + ListExpressionEval +
 * ListNestedManager + RowCompiler). Runtime correctness of list-less apps is
 * NOT the goal here — the goal is the tree-shaken size number.
 *
 * @module WildflowerJS/Nano
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

// Rendering system (NO PoolRenderer, NO ListRenderer)
import { TemplateSystemMethods } from './rendering/TemplateSystem.js';
import { RenderingCoreMethods } from './rendering/RenderingCore.js';

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

    // Rendering (no pools, no lists)
    TemplateSystemMethods,
    RenderingCoreMethods,

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
