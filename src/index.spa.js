/**
 * WildflowerJS - SPA Package Entry Point
 *
 * Includes core framework plus RouteManager for single-page applications.
 *
 * @module WildflowerJS/SPA
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

// Rendering system
import { TemplateSystemMethods } from './rendering/TemplateSystem.js';
import { RenderingCoreMethods } from './rendering/RenderingCore.js';
import { ListRendererMethods } from './rendering/ListRenderer.js';
import { PoolRendererMethods } from './rendering/PoolRenderer.js';

// Event system
import { EventSystemMethods } from './events/EventSystem.js';
import { FormHandlingMethods } from './events/FormHandling.js';

// DOM abstraction (WildQuery)
import { DomAbstractionMethods } from './dom/DomAbstraction.js';

// Features (always included in core)
import { PropsSystemMethods } from './features/PropsSystem.js';
import { ErrorBoundariesMethods } from './features/ErrorBoundaries.js';
import { PluginSystemMethods } from './features/PluginSystem.js';

// Optional features (included in SPA)
import { PortalSystemMethods } from './features/PortalSystem.js';
import { TransitionSystemMethods } from './features/TransitionSystem.js';
// SPA-specific: RouteManager
import { RouteManager } from './routing/RouteManager.js';

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

    // Rendering
    TemplateSystemMethods,
    RenderingCoreMethods,
    ListRendererMethods,
    PoolRendererMethods,

    // Events
    EventSystemMethods,
    FormHandlingMethods,

    // DOM abstraction
    DomAbstractionMethods,

    // Features
    PropsSystemMethods,
    ErrorBoundariesMethods,
    PluginSystemMethods,

    // Optional features
    PortalSystemMethods,
    TransitionSystemMethods
);

// =============================================================================
// Create and export the framework instance
// =============================================================================

const wildflower = createInstance(WildflowerJS);

// Attach RouteManager to wildflower namespace
wildflower.RouteManager = RouteManager;
wildflower.createRouter = RouteManager.create;

export { WildflowerJS, wildflower, RouteManager };
