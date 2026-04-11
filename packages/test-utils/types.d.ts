/**
 * Type definitions for @wildflowerjs/test-utils
 */

/** Distribution modes for loading the framework */
export type DistMode = 'source' | 'core' | 'lite' | 'spa' | 'full';

/** WildflowerJS framework instance */
export interface WildflowerInstance {
  component(name: string, definition: object): void;
  componentDefinitions: Map<string, object>;
  componentInstances: Map<string, ComponentInstance>;
  getComponent(name: string): ComponentInstance | null;
  _scanForDynamicComponents(): void;
  _forceCompleteRender?(): Promise<void>;
  _initContextSystem?(): void;
  _contextSystemInitialized?: boolean;
  [key: string]: any;
}

/** Component instance */
export interface ComponentInstance {
  id: string;
  state: Record<string, any>;
  element: HTMLElement;
  computed?: Record<string, () => any>;
  [key: string]: any;
}

/** Options for loadFramework */
export interface LoadFrameworkOptions {
  /** Distribution mode to load */
  mode?: DistMode;
  /** Custom script paths (overrides mode) */
  scripts?: string[];
}

/** Options for createTestContainer */
export interface CreateTestContainerOptions {
  /** Make container visible for debugging */
  visible?: boolean;
  /** Container ID */
  id?: string;
}

/** Result of createTestContainer */
export interface TestContainerResult {
  /** The test container element */
  container: HTMLElement;
  /** Cleanup function to remove the container */
  cleanup: () => void;
}

/** Options for setupWildflowerTests */
export interface SetupTestsOptions {
  /** Make test container visible for debugging */
  visible?: boolean;
  /** Distribution mode to load */
  mode?: DistMode;
  /** Test container ID */
  containerId?: string;
}

/** Result of setupWildflowerTests */
export interface SetupTestsResult {
  /** Get the test container element */
  getContainer: () => HTMLElement;
  /** Get the WildflowerJS instance */
  getWildflower: () => WildflowerInstance;
}

/** Options for mountComponent */
export interface MountComponentOptions {
  /** Container to mount into */
  container?: HTMLElement;
}

/** Result of mountComponent */
export interface MountComponentResult {
  /** The component instance */
  instance: ComponentInstance;
  /** The component's root element */
  element: HTMLElement;
  /** The container element */
  container: HTMLElement;
  /** Cleanup function */
  cleanup: () => void;
}

/** Test harness for fluent component testing */
export interface TestHarness {
  /** Set initial state */
  withState(state: Record<string, any>): TestHarness;
  /** Add methods to the component */
  withMethods(methods: Record<string, Function>): TestHarness;
  /** Add computed properties */
  withComputed(computed: Record<string, () => any>): TestHarness;
  /** Add lifecycle hooks */
  withLifecycle(hooks: Record<string, Function>): TestHarness;
  /** Set the HTML template */
  withTemplate(html: string): TestHarness;
  /** Mount the component and return test helpers */
  mount(options?: MountComponentOptions): Promise<MountComponentResult>;
}

// ============================================
// Core Utilities (index.js)
// ============================================

/**
 * Get the current distribution mode
 */
export function getDistMode(): DistMode;

/**
 * Get the framework script paths based on distribution mode
 */
export function getFrameworkScripts(mode?: DistMode): string[];

/**
 * Check if a feature is available in the current build
 */
export function hasFeature(feature: string): boolean;

/**
 * Check if we're testing a minified build
 */
export function isMinifiedBuild(): boolean;

/**
 * Check if console warnings are available
 */
export function hasConsoleWarnings(): boolean;

/**
 * Load the WildflowerJS framework
 */
export function loadFramework(options?: LoadFrameworkOptions): Promise<WildflowerInstance>;

/**
 * Reset framework state between tests
 */
export function resetFramework(): void;

/**
 * Wait for framework to process reactive updates
 */
export function waitForUpdate(ms?: number): Promise<void>;

/**
 * Wait for complete render cycle including microtask queue
 */
export function waitForCompleteRender(): Promise<void>;

/**
 * Create a test container element
 */
export function createTestContainer(options?: CreateTestContainerOptions): TestContainerResult;

/**
 * Get a component instance by name or element
 */
export function getComponent(target: string | HTMLElement): ComponentInstance | null;

/**
 * Trigger an action on an element
 */
export function triggerAction(element: HTMLElement, eventType?: string): Promise<void>;

/**
 * Wait for a specific state value
 */
export function waitForState(
  instance: ComponentInstance,
  path: string,
  expected: any,
  timeout?: number
): Promise<void>;

/**
 * Skip test if feature is not available in current build
 */
export function skipIfNoFeature<T extends Function>(feature: string, testFn: T): T | (() => void);

/**
 * Initialize the context system
 */
export function initContextSystem(): void;

// ============================================
// Vitest Integration (vitest.js)
// ============================================

/**
 * Setup WildflowerJS test environment for Vitest
 */
export function setupWildflowerTests(options?: SetupTestsOptions): SetupTestsResult;

/**
 * Mount a component for testing
 */
export function mountComponent(
  name: string,
  definition: object,
  template: string,
  options?: MountComponentOptions
): Promise<MountComponentResult>;

/**
 * Create a test harness for component testing
 */
export function createTestHarness(name: string): TestHarness;
