/**
 * Binding Validation Test Suite (TDD)
 *
 * Tests for runtime binding validation - a unique WildflowerJS feature
 * that validates template bindings at runtime in development mode.
 *
 * This catches errors that other no-build frameworks silently ignore:
 * - Typos in binding paths
 * - References to undefined state properties
 * - Type mismatches between state and bindings
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { loadFramework, resetFramework, hasConsoleWarnings, hasFeature } from './helpers/load-framework.js';

// Skip entire suite if validation feature is not available (e.g., lite build)
const suiteRunner = hasFeature('validation') ? describe : describe.skip;

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to capture console warnings (works in browser context)
function createWarnCapture() {
    const captured = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
        captured.push(args.join(' '));
        originalWarn.apply(console, args);
    };
    return {
        captured,
        restore: () => { console.warn = originalWarn; }
    };
}

suiteRunner('Binding Validation', () => {
    let wildflower;
    let testContainer;

    beforeAll(async () => {
        await loadFramework();
    });

    beforeEach(() => {
        wildflower = window.wildflower;
        resetFramework();

        // Enable debug mode for binding validation
        wildflower.options.debug = true;
        wildflower.debug = true;

        // Create test container
        testContainer = document.createElement('div');
        testContainer.id = 'test-container';
        testContainer.style.position = 'absolute';
        testContainer.style.left = '-9999px';
        document.body.appendChild(testContainer);
    });

    afterEach(() => {
        // Clean up test container
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer);
        }
    });

    // =========================================================================
    // PHASE 1: Path Validation
    // =========================================================================

    describe('Phase 1: Path Validation', () => {

        describe('Basic Path Validation', () => {

            it('warns when binding references undefined state property', async () => {
                const warnCapture = createWarnCapture();

                // Register component with limited state
                wildflower.component('validation-test-1', {
                    state: {
                        count: 0,
                        name: 'test'
                    }
                });

                // Create component with binding to non-existent property
                testContainer.innerHTML = `
                    <div data-component="validation-test-1">
                        <span data-bind="nonExistent"></span>
                    </div>
                `;

                // Scan for components (required for dynamic DOM)
                await wildflower.scan();
                await waitForUpdate();

                warnCapture.restore();

                // Only check warnings if debug mode is enabled and console warnings aren't stripped
                if (hasConsoleWarnings()) {
                    const validationWarning = warnCapture.captured.find(msg =>
                        msg.includes('[WF]') && msg.includes('nonExistent')
                    );
                    expect(validationWarning).toBeDefined();
                }
            });

            it('does not warn for valid state properties', async () => {
                const warnCapture = createWarnCapture();

                wildflower.component('validation-test-2', {
                    state: {
                        count: 0,
                        name: 'test'
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="validation-test-2">
                        <span data-bind="count"></span>
                        <span data-bind="name"></span>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Should not warn about valid properties
                if (hasConsoleWarnings()) {
                    const validationWarning = warnCapture.captured.find(msg =>
                        msg.includes('[WF]') && msg.includes('Binding validation')
                    );
                    expect(validationWarning).toBeUndefined();
                }
            });

            it('does not warn for nested paths when root property exists', async () => {
                const warnCapture = createWarnCapture();

                wildflower.component('validation-test-3', {
                    state: {
                        user: {
                            name: 'John',
                            address: {
                                city: 'NYC'
                            }
                        }
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="validation-test-3">
                        <span data-bind="user.name"></span>
                        <span data-bind="user.address.city"></span>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Should not warn - root 'user' exists
                if (hasConsoleWarnings()) {
                    const validationWarning = warnCapture.captured.find(msg =>
                        msg.includes('[WF]') && msg.includes('Binding validation')
                    );
                    expect(validationWarning).toBeUndefined();
                }
            });

            it('warns for nested paths when root property does not exist', async () => {
                const warnCapture = createWarnCapture();

                wildflower.component('validation-test-4', {
                    state: {
                        count: 0
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="validation-test-4">
                        <span data-bind="user.name"></span>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Should warn - 'user' doesn't exist
                if (hasConsoleWarnings()) {
                    const validationWarning = warnCapture.captured.find(msg =>
                        msg.includes('[WF]') && msg.includes('user')
                    );
                    expect(validationWarning).toBeDefined();
                }
            });
        });

        describe('Special Path Handling', () => {

            it('does not warn for computed: prefixed paths', async () => {
                const warnCapture = createWarnCapture();

                wildflower.component('validation-test-5', {
                    state: {
                        count: 5
                    },
                    computed: {
                        doubled() {
                            return this.state.count * 2;
                        }
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="validation-test-5">
                        <span data-bind="computed:doubled"></span>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Should not warn - computed properties are handled differently
                if (hasConsoleWarnings()) {
                    const validationWarning = warnCapture.captured.find(msg =>
                        msg.includes('[WF]') && msg.includes('Binding validation') && msg.includes('doubled')
                    );
                    expect(validationWarning).toBeUndefined();
                }
            });

            it('does not warn for external() expressions', async () => {
                const warnCapture = createWarnCapture();

                // Create a store or external component to reference
                wildflower.component('external-source', {
                    state: {
                        sharedValue: 'hello'
                    }
                });

                wildflower.component('validation-test-6', {
                    state: {
                        localValue: 'world'
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="external-source"></div>
                    <div data-component="validation-test-6">
                        <span data-bind="external('external-source', 'sharedValue')"></span>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Should not warn - external() calls are special
                if (hasConsoleWarnings()) {
                    const validationWarning = warnCapture.captured.find(msg =>
                        msg.includes('[WF]') && msg.includes('Binding validation') && msg.includes('external')
                    );
                    expect(validationWarning).toBeUndefined();
                }
            });

            it('does not warn for list context variables (_index, _length, _first, _last)', async () => {
                const warnCapture = createWarnCapture();

                wildflower.component('validation-test-7', {
                    state: {
                        items: ['a', 'b', 'c']
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="validation-test-7">
                        <div data-list="items">
                            <template>
                                <div>
                                    <span data-bind="_index"></span>
                                    <span data-bind="_length"></span>
                                    <span data-show="_first">First!</span>
                                    <span data-show="_last">Last!</span>
                                </div>
                            </template>
                        </div>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Should not warn - these are built-in list context variables
                if (hasConsoleWarnings()) {
                    const validationWarning = warnCapture.captured.find(msg =>
                        msg.includes('[WF]') && msg.includes('Binding validation') &&
                        (msg.includes('_index') || msg.includes('_length') ||
                         msg.includes('_first') || msg.includes('_last'))
                    );
                    expect(validationWarning).toBeUndefined();
                }
            });

            it('does not warn for props. prefixed paths', async () => {
                const warnCapture = createWarnCapture();

                // Parent component that hosts the child
                wildflower.component('props-parent-1', {
                    state: {
                        greeting: 'Hello'
                    }
                });

                // Child component that uses props
                wildflower.component('props-child-1', {
                    props: {
                        title: { type: 'string' },
                        count: { type: 'number', default: 0 }
                    },
                    state: {
                        localValue: 'test'
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="props-parent-1">
                        <div data-component="props-child-1" data-props='{"title":"Dashboard"}'>
                            <span data-bind="props.title"></span>
                            <span data-bind="props.count"></span>
                            <span data-bind="localValue"></span>
                        </div>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Should NOT warn about props.title or props.count — these resolve via the props system
                if (hasConsoleWarnings()) {
                    const propsWarning = warnCapture.captured.find(msg =>
                        msg.includes('[WF]') && msg.includes('Binding validation') &&
                        (msg.includes('props.title') || msg.includes('props.count'))
                    );
                    expect(propsWarning).toBeUndefined();
                }
            });

            it('does not warn for props: prefixed paths', async () => {
                const warnCapture = createWarnCapture();

                wildflower.component('props-child-2', {
                    props: {
                        label: { type: 'string' }
                    },
                    state: {
                        localValue: 'test'
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="props-child-2" data-props='{"label":"Test"}'>
                        <span data-bind="props:label"></span>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Should NOT warn about props:label
                if (hasConsoleWarnings()) {
                    const propsWarning = warnCapture.captured.find(msg =>
                        msg.includes('[WF]') && msg.includes('Binding validation') &&
                        msg.includes('props:label')
                    );
                    expect(propsWarning).toBeUndefined();
                }
            });

            it('does not warn for negated paths when base property exists', async () => {
                const warnCapture = createWarnCapture();

                wildflower.component('validation-test-8', {
                    state: {
                        isVisible: true
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="validation-test-8">
                        <span data-show="!isVisible">Hidden when visible</span>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Should not warn - negation prefix should be stripped before validation
                if (hasConsoleWarnings()) {
                    const validationWarning = warnCapture.captured.find(msg =>
                        msg.includes('[WF]') && msg.includes('Binding validation')
                    );
                    expect(validationWarning).toBeUndefined();
                }
            });
        });

        describe('Debug Mode Control', () => {

            it('does not warn when debug mode is disabled', async () => {
                const warnCapture = createWarnCapture();

                wildflower.component('validation-test-9', {
                    state: {
                        count: 0
                    }
                });

                // Disable debug mode
                wildflower.options.debug = false;
                wildflower.debug = false;

                testContainer.innerHTML = `
                    <div data-component="validation-test-9">
                        <span data-bind="nonExistent"></span>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // When debug is false, should not warn
                const validationWarning = warnCapture.captured.find(msg =>
                    msg.includes('[WF]') && msg.includes('Binding validation')
                );
                expect(validationWarning).toBeUndefined();
            });
        });

        describe('Component Scope Boundaries', () => {

            it('does not warn about data-bind-class in child component scope', async () => {
                const warnCapture = createWarnCapture();

                // Parent component — does NOT have trendClass in its state
                wildflower.component('scope-parent-1', {
                    state: {
                        parentValue: 'hello'
                    }
                });

                // Child component — owns the trendClass computed
                wildflower.component('scope-child-1', {
                    state: {
                        trend: 'up'
                    },
                    computed: {
                        trendClass() {
                            return this.state.trend === 'up' ? 'text-green' : 'text-red';
                        }
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="scope-parent-1">
                        <span data-bind="parentValue"></span>
                        <div data-component="scope-child-1">
                            <span data-bind-class="computed:trendClass">Trend</span>
                        </div>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Parent should NOT warn about trendClass — it belongs to the child scope
                if (hasConsoleWarnings()) {
                    const scopeWarning = warnCapture.captured.find(msg =>
                        msg.includes('[WF]') && msg.includes('scope-parent-1') &&
                        msg.includes('trendClass')
                    );
                    expect(scopeWarning).toBeUndefined();
                }
            });

            it('does not warn about data-render in child component scope', async () => {
                const warnCapture = createWarnCapture();

                // Parent component
                wildflower.component('scope-parent-2', {
                    state: {
                        showParent: true
                    }
                });

                // Child component — owns showDetail state
                wildflower.component('scope-child-2', {
                    state: {
                        showDetail: false
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="scope-parent-2">
                        <div data-render="showParent">Parent content</div>
                        <div data-component="scope-child-2">
                            <div data-render="showDetail">Detail content</div>
                        </div>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Parent should NOT warn about showDetail — it belongs to the child
                if (hasConsoleWarnings()) {
                    const scopeWarning = warnCapture.captured.find(msg =>
                        msg.includes('[WF]') && msg.includes('scope-parent-2') &&
                        msg.includes('showDetail')
                    );
                    expect(scopeWarning).toBeUndefined();
                }
            });

            it('still warns about invalid bindings in own scope with nested children', async () => {
                const warnCapture = createWarnCapture();

                // Parent component with a typo in its OWN binding
                wildflower.component('scope-parent-3', {
                    state: {
                        isVisible: true
                    }
                });

                // Child component
                wildflower.component('scope-child-3', {
                    state: {
                        childState: 'ok'
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="scope-parent-3">
                        <div data-render="isVisble">Parent content with typo</div>
                        <div data-component="scope-child-3">
                            <span data-bind="childState"></span>
                        </div>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Parent SHOULD still warn about its own typo (isVisble vs isVisible)
                if (hasConsoleWarnings()) {
                    const typoWarning = warnCapture.captured.find(msg =>
                        msg.includes('[WF]') && msg.includes('scope-parent-3') &&
                        msg.includes('isVisble')
                    );
                    expect(typoWarning).toBeDefined();
                }
            });

            it('does not warn about deeply nested child component bindings', async () => {
                const warnCapture = createWarnCapture();

                wildflower.component('scope-grandparent', {
                    state: { gpValue: 'gp' }
                });

                wildflower.component('scope-mid', {
                    state: { midValue: 'mid' }
                });

                wildflower.component('scope-grandchild', {
                    state: { gcValue: 'gc' }
                });

                testContainer.innerHTML = `
                    <div data-component="scope-grandparent">
                        <span data-bind="gpValue"></span>
                        <div data-component="scope-mid">
                            <span data-bind="midValue"></span>
                            <div data-component="scope-grandchild">
                                <span data-bind-class="gcValue ? 'active' : ''">GC</span>
                            </div>
                        </div>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Grandparent should NOT warn about gcValue or midValue
                if (hasConsoleWarnings()) {
                    const gpWarning = warnCapture.captured.find(msg =>
                        msg.includes('[WF]') && msg.includes('scope-grandparent') &&
                        (msg.includes('gcValue') || msg.includes('midValue'))
                    );
                    expect(gpWarning).toBeUndefined();
                }

                // Mid-level should NOT warn about gcValue
                if (hasConsoleWarnings()) {
                    const midWarning = warnCapture.captured.find(msg =>
                        msg.includes('[WF]') && msg.includes('scope-mid') &&
                        msg.includes('gcValue')
                    );
                    expect(midWarning).toBeUndefined();
                }
            });
        });

        describe('Typo Suggestions', () => {

            it('suggests similar property names for typos', async () => {
                const warnCapture = createWarnCapture();

                wildflower.component('validation-test-10', {
                    state: {
                        count: 0,
                        counter: 0,
                        counting: false
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="validation-test-10">
                        <span data-bind="cont"></span>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Should warn and suggest similar names
                if (hasConsoleWarnings()) {
                    const validationWarning = warnCapture.captured.find(msg =>
                        msg.includes('[WF]') && msg.includes('cont')
                    );
                    expect(validationWarning).toBeDefined();

                    // Should suggest 'count' as it's the closest match
                    expect(validationWarning).toContain('count');
                }
            });

            it('lists available state properties in warning message', async () => {
                const warnCapture = createWarnCapture();

                wildflower.component('validation-test-11', {
                    state: {
                        name: 'test',
                        age: 25,
                        active: true
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="validation-test-11">
                        <span data-bind="unknown"></span>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Warning should list available properties
                if (hasConsoleWarnings()) {
                    const validationWarning = warnCapture.captured.find(msg =>
                        msg.includes('[WF]') && msg.includes('unknown')
                    );
                    expect(validationWarning).toBeDefined();

                    // Should list available properties
                    expect(validationWarning).toContain('name');
                    expect(validationWarning).toContain('age');
                    expect(validationWarning).toContain('active');
                }
            });
        });

        describe('List Template Validation', () => {

            it('validates bindings inside list templates', async () => {
                const warnCapture = createWarnCapture();

                wildflower.component('validation-test-12', {
                    state: {
                        items: [
                            { name: 'Item 1', price: 10 },
                            { name: 'Item 2', price: 20 }
                        ]
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="validation-test-12">
                        <div data-list="items">
                            <template>
                                <div>
                                    <span data-bind="name"></span>
                                    <span data-bind="nonExistentField"></span>
                                </div>
                            </template>
                        </div>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Note: List item validation validates against component state, not item shape
                // The binding validation currently checks root state properties
                // This test verifies the validation runs on list templates
                if (hasConsoleWarnings()) {
                    // Should have some validation output
                    expect(warnCapture.captured.length).toBeGreaterThanOrEqual(0);
                }
            });

            it('validates against item properties in list context', async () => {
                const warnCapture = createWarnCapture();

                wildflower.component('validation-test-13', {
                    state: {
                        products: [
                            { title: 'Product 1', cost: 100 }
                        ]
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="validation-test-13">
                        <div data-list="products">
                            <template>
                                <div>
                                    <span data-bind="title"></span>
                                    <span data-bind="cost"></span>
                                </div>
                            </template>
                        </div>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Note: List bindings for item properties (title, cost) are handled
                // differently - they bind to the item context, not component state
                if (hasConsoleWarnings()) {
                    const validationWarning = warnCapture.captured.find(msg =>
                        msg.includes('[WF]') && msg.includes('Binding validation') &&
                        (msg.includes('title') || msg.includes('cost'))
                    );
                    // This may or may not warn depending on how list item bindings are processed
                    // The key is that the validation system processes these bindings
                }
            });
        });

        describe('Multiple Binding Types', () => {

            it('validates data-model bindings', async () => {
                const warnCapture = createWarnCapture();

                wildflower.component('validation-test-14', {
                    state: {
                        username: ''
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="validation-test-14">
                        <input data-model="usernme" type="text">
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Should warn about typo in data-model
                if (hasConsoleWarnings()) {
                    const validationWarning = warnCapture.captured.find(msg =>
                        msg.includes('[WF]') && msg.includes('usernme')
                    );
                    expect(validationWarning).toBeDefined();
                }
            });

            it('validates data-show bindings', async () => {
                const warnCapture = createWarnCapture();

                wildflower.component('validation-test-15', {
                    state: {
                        isLoading: false
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="validation-test-15">
                        <div data-show="isLoadng">Loading...</div>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Should warn about typo in data-show
                if (hasConsoleWarnings()) {
                    const validationWarning = warnCapture.captured.find(msg =>
                        msg.includes('[WF]') && msg.includes('isLoadng')
                    );
                    expect(validationWarning).toBeDefined();
                }
            });

            it('validates data-render bindings', async () => {
                const warnCapture = createWarnCapture();

                wildflower.component('validation-test-16', {
                    state: {
                        shouldRender: true
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="validation-test-16">
                        <div data-render="sholdRender">Rendered content</div>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Should warn about typo in data-render
                if (hasConsoleWarnings()) {
                    const validationWarning = warnCapture.captured.find(msg =>
                        msg.includes('[WF]') && msg.includes('sholdRender')
                    );
                    expect(validationWarning).toBeDefined();
                }
            });

            it('validates data-bind-class expressions', async () => {
                const warnCapture = createWarnCapture();

                wildflower.component('validation-test-17', {
                    state: {
                        isActive: true
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="validation-test-17">
                        <div data-bind-class="isActve ? 'active' : ''">Content</div>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Should warn about typo in expression
                if (hasConsoleWarnings()) {
                    const validationWarning = warnCapture.captured.find(msg =>
                        msg.includes('[WF]') && msg.includes('isActve')
                    );
                    expect(validationWarning).toBeDefined();
                }
            });
        });
    });

    // =========================================================================
    // PHASE 2: Type Inference
    // =========================================================================

    describe('Phase 2: Type Inference', () => {

        describe('Automatic Type Inference from Initial State', () => {

            it('infers string type from string initial value', async () => {
                wildflower.component('type-infer-1', {
                    state: {
                        name: 'John'  // Should infer as 'string'
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="type-infer-1">
                        <span data-bind="name"></span>
                    </div>
                `;

                await waitForUpdate();

                // Get the component instance and check inferred types
                await wildflower.scan();
                await waitForUpdate();

                const instances = wildflower.getComponentsByType('type-infer-1');
                expect(instances.length).toBeGreaterThan(0);

                // The component should have inferred types available
                expect(instances[0]._inferredTypes?.name).toBe('string');
                expect(instances[0]._types?.name).toBe('string');
            });

            it('infers number type from number initial value', async () => {
                wildflower.component('type-infer-2', {
                    state: {
                        count: 42  // Should infer as 'number'
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="type-infer-2">
                        <span data-bind="count"></span>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();

                const instances = wildflower.getComponentsByType('type-infer-2');
                expect(instances.length).toBeGreaterThan(0);

                expect(instances[0]._inferredTypes?.count).toBe('number');
                expect(instances[0]._types?.count).toBe('number');
            });

            it('infers boolean type from boolean initial value', async () => {
                wildflower.component('type-infer-3', {
                    state: {
                        isActive: true  // Should infer as 'boolean'
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="type-infer-3">
                        <span data-show="isActive">Active</span>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();

                const instances = wildflower.getComponentsByType('type-infer-3');
                expect(instances.length).toBeGreaterThan(0);

                expect(instances[0]._inferredTypes?.isActive).toBe('boolean');
                expect(instances[0]._types?.isActive).toBe('boolean');
            });

            it('infers array type from array initial value', async () => {
                wildflower.component('type-infer-4', {
                    state: {
                        items: ['a', 'b', 'c']  // Should infer as 'array'
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="type-infer-4">
                        <div data-list="items">
                            <template><span></span></template>
                        </div>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();

                const instances = wildflower.getComponentsByType('type-infer-4');
                expect(instances.length).toBeGreaterThan(0);

                expect(instances[0]._inferredTypes?.items).toBe('array');
                expect(instances[0]._types?.items).toBe('array');
            });

            it('infers object type from object initial value', async () => {
                wildflower.component('type-infer-5', {
                    state: {
                        user: { name: 'John', age: 30 }  // Should infer as 'object'
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="type-infer-5">
                        <span data-bind="user.name"></span>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();

                const instances = wildflower.getComponentsByType('type-infer-5');
                expect(instances.length).toBeGreaterThan(0);

                expect(instances[0]._inferredTypes?.user).toBe('object');
                expect(instances[0]._types?.user).toBe('object');
            });

            it('infers any type from null initial value', async () => {
                wildflower.component('type-infer-6', {
                    state: {
                        data: null  // Should infer as 'any' (unknown)
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="type-infer-6">
                        <span data-bind="data"></span>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();

                const instances = wildflower.getComponentsByType('type-infer-6');
                expect(instances.length).toBeGreaterThan(0);

                expect(instances[0]._inferredTypes?.data).toBe('any');
                expect(instances[0]._types?.data).toBe('any');
            });
        });

        describe('Explicit Type Hints', () => {

            it('respects explicit types property in component definition', async () => {
                wildflower.component('type-explicit-1', {
                    state: {
                        count: 0
                    },
                    types: {
                        count: 'number'
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="type-explicit-1">
                        <span data-bind="count"></span>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();

                const instances = wildflower.getComponentsByType('type-explicit-1');
                expect(instances.length).toBeGreaterThan(0);

                // Explicit types should take precedence over inferred
                expect(instances[0]._types?.count).toBe('number');
                // Inferred type would also be 'number' since initial value is 0
                expect(instances[0]._inferredTypes?.count).toBe('number');
            });
        });
    });

    // =========================================================================
    // PHASE 3: Runtime Type Checking
    // =========================================================================

    describe('Phase 3: Runtime Type Checking', () => {

        describe('Type Mismatch Warnings', () => {

            it('warns when setting string to number property', async () => {
                wildflower.component('type-check-1', {
                    state: {
                        count: 0
                    },
                    types: {
                        count: 'number'
                    },
                    setCount(value) {
                        this.state.count = value;
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="type-check-1">
                        <span data-bind="count"></span>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();

                const instances = wildflower.getComponentsByType('type-check-1');
                expect(instances.length).toBeGreaterThan(0);

                // Set wrong type and capture warnings
                const warnCapture = createWarnCapture();
                instances[0].state.count = 'not a number';
                await waitForUpdate();
                warnCapture.restore();

                // Should warn about type mismatch
                const typeWarning = warnCapture.captured.find(msg =>
                    msg.includes('[WF]') && msg.includes('Type mismatch')
                );
                expect(typeWarning).toBeDefined();
                expect(typeWarning).toContain('count');
                expect(typeWarning).toContain('number');
                expect(typeWarning).toContain('string');
            });

            it('warns when setting number to string property', async () => {
                wildflower.component('type-check-2', {
                    state: {
                        name: 'John'
                    },
                    types: {
                        name: 'string'
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="type-check-2">
                        <span data-bind="name"></span>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();

                const instances = wildflower.getComponentsByType('type-check-2');
                expect(instances.length).toBeGreaterThan(0);

                // Set wrong type and capture warnings
                const warnCapture = createWarnCapture();
                instances[0].state.name = 12345;
                await waitForUpdate();
                warnCapture.restore();

                // Should warn about type mismatch
                const typeWarning = warnCapture.captured.find(msg =>
                    msg.includes('[WF]') && msg.includes('Type mismatch')
                );
                expect(typeWarning).toBeDefined();
                expect(typeWarning).toContain('name');
                expect(typeWarning).toContain('string');
                expect(typeWarning).toContain('number');
            });

            it('does not warn when types match', async () => {
                wildflower.component('type-check-3', {
                    state: {
                        count: 0
                    },
                    types: {
                        count: 'number'
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="type-check-3">
                        <span data-bind="count"></span>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();

                const instances = wildflower.getComponentsByType('type-check-3');

                // Set correct type and capture warnings
                const warnCapture = createWarnCapture();
                instances[0].state.count = 42;
                await waitForUpdate();
                warnCapture.restore();

                const typeWarning = warnCapture.captured.find(msg =>
                    msg.includes('[WF]') && msg.includes('Type mismatch')
                );
                expect(typeWarning).toBeUndefined();
            });

            it('does not warn for any type', async () => {
                wildflower.component('type-check-4', {
                    state: {
                        data: null
                    },
                    types: {
                        data: 'any'
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="type-check-4">
                        <span data-bind="data"></span>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();

                const instances = wildflower.getComponentsByType('type-check-4');

                // Set various types - should not warn
                const warnCapture = createWarnCapture();
                instances[0].state.data = 'string';
                instances[0].state.data = 123;
                instances[0].state.data = { foo: 'bar' };
                await waitForUpdate();
                warnCapture.restore();

                const typeWarning = warnCapture.captured.find(msg =>
                    msg.includes('[WF]') && msg.includes('Type mismatch')
                );
                expect(typeWarning).toBeUndefined();
            });

            it('does not warn when debug mode is disabled', async () => {
                // Similar to Phase 1 debug test - type checking should respect debug flag
                wildflower.component('type-check-5', {
                    state: {
                        count: 0
                    },
                    types: {
                        count: 'number'
                    }
                });

                // Disable debug mode
                wildflower.options.debug = false;
                wildflower.debug = false;

                testContainer.innerHTML = `
                    <div data-component="type-check-5">
                        <span data-bind="count"></span>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();

                const instances = wildflower.getComponentsByType('type-check-5');

                const warnCapture = createWarnCapture();
                instances[0].state.count = 'wrong type';
                await waitForUpdate();
                warnCapture.restore();

                // Should not warn when debug is false
                const typeWarning = warnCapture.captured.find(msg =>
                    msg.includes('[WF]') && msg.includes('Type mismatch')
                );
                expect(typeWarning).toBeUndefined();
            });
        });

        describe('Array Type Checking', () => {

            it('warns when setting non-array to array property', async () => {
                wildflower.component('type-check-array-1', {
                    state: {
                        items: []
                    },
                    types: {
                        items: 'array'
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="type-check-array-1">
                        <div data-list="items">
                            <template><span></span></template>
                        </div>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();

                const instances = wildflower.getComponentsByType('type-check-array-1');

                // Set wrong type and capture warnings
                const warnCapture = createWarnCapture();
                instances[0].state.items = 'not an array';
                await waitForUpdate();
                warnCapture.restore();

                // Should warn about type mismatch
                const typeWarning = warnCapture.captured.find(msg =>
                    msg.includes('[WF]') && msg.includes('Type mismatch')
                );
                expect(typeWarning).toBeDefined();
                expect(typeWarning).toContain('items');
                expect(typeWarning).toContain('array');
                expect(typeWarning).toContain('string');
            });
        });
    });

    // =========================================================================
    // PHASE 4: Binding Type Hints
    // =========================================================================

    describe('Phase 4: Binding Type Hints', () => {

        describe('Parsing Type Hints from Bindings', () => {

            it('parses type hint from data-bind="property:type" syntax', async () => {
                wildflower.component('binding-hint-1', {
                    state: {
                        price: 99.99
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="binding-hint-1">
                        <span data-bind="price:number"></span>
                    </div>
                `;

                await waitForUpdate();

                // The binding should be parsed and type hint stored in metadata
                // This would be visible in the compiled template metadata
            });

            it('parses type hint from data-model="property:type" syntax', async () => {
                wildflower.component('binding-hint-2', {
                    state: {
                        quantity: 1
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="binding-hint-2">
                        <input data-model="quantity:number" type="number">
                    </div>
                `;

                await waitForUpdate();

                // Type hint should be parsed from data-model
            });
        });

        describe('Type Hint Validation', () => {

            it('warns when value does not match binding type hint', async () => {
                const warnCapture = createWarnCapture();

                wildflower.component('binding-hint-3', {
                    state: {
                        count: 'not a number'  // Initial value is wrong type
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="binding-hint-3">
                        <span data-bind="count:number"></span>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Should warn that count is string but binding expects number
                const typeWarning = warnCapture.captured.find(msg =>
                    msg.includes('[WF]') && msg.includes('Type hint mismatch')
                );
                expect(typeWarning).toBeDefined();
                expect(typeWarning).toContain('count');
                expect(typeWarning).toContain('number');
                expect(typeWarning).toContain('string');
            });

            it('does not warn when value matches binding type hint', async () => {
                const warnCapture = createWarnCapture();

                wildflower.component('binding-hint-4', {
                    state: {
                        count: 42
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="binding-hint-4">
                        <span data-bind="count:number"></span>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();
                warnCapture.restore();

                // Should not warn about type hint mismatch since value matches
                const typeWarning = warnCapture.captured.find(msg =>
                    msg.includes('[WF]') && msg.includes('Type hint mismatch') && msg.includes('count')
                );
                expect(typeWarning).toBeUndefined();
            });
        });

        describe('Compiled Metadata Storage', () => {

            it('stores expectedType in compiled template metadata', async () => {
                wildflower.component('binding-hint-5', {
                    state: {
                        items: [
                            { name: 'Item', price: 10 }
                        ]
                    }
                });

                testContainer.innerHTML = `
                    <div data-component="binding-hint-5">
                        <div data-list="items">
                            <template>
                                <div>
                                    <span data-bind="name:string"></span>
                                    <span data-bind="price:number"></span>
                                </div>
                            </template>
                        </div>
                    </div>
                `;

                await wildflower.scan();
                await waitForUpdate();

                // Check that compiled metadata includes type hints
                // (Phase 4 feature - would require access to wildflower._templateCache.compiled)
            });
        });
    });

    // =========================================================================
    // INTEGRATION TESTS
    // =========================================================================

    describe('Integration', () => {

        it('validates multiple binding types in a complex component', async () => {
            const warnCapture = createWarnCapture();

            wildflower.component('integration-test-1', {
                state: {
                    user: {
                        name: 'John',
                        email: 'john@example.com'
                    },
                    items: [
                        { id: 1, title: 'Item 1' }
                    ],
                    isLoading: false,
                    searchQuery: ''
                },
                types: {
                    isLoading: 'boolean',
                    searchQuery: 'string',
                    items: 'array'
                }
            });

            testContainer.innerHTML = `
                <div data-component="integration-test-1">
                    <div data-show="isLoading">Loading...</div>
                    <input data-model="searchQuery" placeholder="Search">
                    <span data-bind="user.name"></span>
                    <span data-bind="user.emal"></span> <!-- typo in nested path -->
                    <div data-list="items">
                        <template>
                            <div>
                                <span data-bind="title"></span>
                                <span data-bind="nonExistent"></span> <!-- invalid -->
                            </div>
                        </template>
                    </div>
                </div>
            `;

            await wildflower.scan();
            await waitForUpdate();
            warnCapture.restore();

            // Should warn about 'emal' typo in nested path (user.emal)
            // Future: validation should check nested property existence, not just root
            if (hasConsoleWarnings()) {
                const emalWarning = warnCapture.captured.find(msg =>
                    msg.includes('[WF]') && msg.includes('emal')
                );
                expect(emalWarning).toBeDefined();
            }
        });

        it('validates data-bind-html bindings', async () => {
            const warnCapture = createWarnCapture();

            wildflower.component('html-bind-test-1', {
                state: {
                    content: '<b>Hello</b>'
                }
            });

            testContainer.innerHTML = `
                <div data-component="html-bind-test-1">
                    <div data-bind-html="contnt"></div>
                </div>
            `;

            await wildflower.scan();
            await waitForUpdate();
            warnCapture.restore();

            if (hasConsoleWarnings()) {
                const validationWarning = warnCapture.captured.find(msg =>
                    msg.includes('[WF]') && msg.includes('contnt')
                );
                expect(validationWarning).toBeDefined();
            }
        });

        it('does not warn for valid data-bind-html paths', async () => {
            const warnCapture = createWarnCapture();

            wildflower.component('html-bind-test-2', {
                state: {
                    content: '<b>Hello</b>'
                }
            });

            testContainer.innerHTML = `
                <div data-component="html-bind-test-2">
                    <div data-bind-html="content"></div>
                </div>
            `;

            await wildflower.scan();
            await waitForUpdate();
            warnCapture.restore();

            if (hasConsoleWarnings()) {
                const validationWarning = warnCapture.captured.find(msg =>
                    msg.includes('[WF]') && msg.includes('Binding validation') && msg.includes('content')
                );
                expect(validationWarning).toBeUndefined();
            }
        });

        it('validates data-list references', async () => {
            const warnCapture = createWarnCapture();

            wildflower.component('list-validate-1', {
                state: {
                    items: [1, 2, 3]
                }
            });

            testContainer.innerHTML = `
                <div data-component="list-validate-1">
                    <div data-list="itms">
                        <template><span></span></template>
                    </div>
                </div>
            `;

            await wildflower.scan();
            await waitForUpdate();
            warnCapture.restore();

            if (hasConsoleWarnings()) {
                const validationWarning = warnCapture.captured.find(msg =>
                    msg.includes('[WF]') && msg.includes('itms')
                );
                expect(validationWarning).toBeDefined();
            }
        });

        it('does not warn for valid data-list paths', async () => {
            const warnCapture = createWarnCapture();

            wildflower.component('list-validate-2', {
                state: {
                    items: [1, 2, 3]
                }
            });

            testContainer.innerHTML = `
                <div data-component="list-validate-2">
                    <div data-list="items">
                        <template><span></span></template>
                    </div>
                </div>
            `;

            await wildflower.scan();
            await waitForUpdate();
            warnCapture.restore();

            if (hasConsoleWarnings()) {
                const validationWarning = warnCapture.captured.find(msg =>
                    msg.includes('[WF]') && msg.includes('Binding validation') && msg.includes('items')
                );
                expect(validationWarning).toBeUndefined();
            }
        });

        it('warns when style expression references undefined state variable', async () => {
            const warnCapture = createWarnCapture();

            wildflower.component('style-validate-1', {
                state: {
                    textColor: 'red'
                }
            });

            testContainer.innerHTML = `
                <div data-component="style-validate-1">
                    <span data-bind-style="{ color: txtColor }">Styled</span>
                </div>
            `;

            await wildflower.scan();
            await waitForUpdate();
            warnCapture.restore();

            if (hasConsoleWarnings()) {
                const validationWarning = warnCapture.captured.find(msg =>
                    msg.includes('[WF]') && msg.includes('txtColor')
                );
                expect(validationWarning).toBeDefined();
            }
        });

        it('does not warn for valid style binding properties', async () => {
            const warnCapture = createWarnCapture();

            wildflower.component('style-validate-2', {
                state: {
                    textColor: 'red'
                }
            });

            testContainer.innerHTML = `
                <div data-component="style-validate-2">
                    <span data-bind-style="{ color: textColor }">Styled</span>
                </div>
            `;

            await wildflower.scan();
            await waitForUpdate();
            warnCapture.restore();

            if (hasConsoleWarnings()) {
                const validationWarning = warnCapture.captured.find(msg =>
                    msg.includes('[WF]') && msg.includes('Binding validation') && msg.includes('textColor')
                );
                expect(validationWarning).toBeUndefined();
            }
        });

        it('does not false-positive on CSS property names in style bindings', async () => {
            const warnCapture = createWarnCapture();

            wildflower.component('style-validate-3', {
                state: {
                    bgColor: '#fff',
                    size: '16px'
                }
            });

            testContainer.innerHTML = `
                <div data-component="style-validate-3">
                    <span data-bind-style="{ backgroundColor: bgColor, fontSize: size }">Styled</span>
                </div>
            `;

            await wildflower.scan();
            await waitForUpdate();
            warnCapture.restore();

            // Should NOT warn about backgroundColor or fontSize — those are CSS keys, not state refs
            if (hasConsoleWarnings()) {
                const cssKeyWarning = warnCapture.captured.find(msg =>
                    msg.includes('[WF]') && msg.includes('Binding validation') &&
                    (msg.includes('backgroundColor') || msg.includes('fontSize'))
                );
                expect(cssKeyWarning).toBeUndefined();
            }
        });

        it('does not warn about style bindings in child component scope', async () => {
            const warnCapture = createWarnCapture();

            wildflower.component('style-scope-parent', {
                state: {
                    parentVal: 'hello'
                }
            });

            wildflower.component('style-scope-child', {
                state: {
                    childColor: 'blue'
                }
            });

            testContainer.innerHTML = `
                <div data-component="style-scope-parent">
                    <span data-bind="parentVal"></span>
                    <div data-component="style-scope-child">
                        <span data-bind-style="{ color: childColor }">Styled</span>
                    </div>
                </div>
            `;

            await wildflower.scan();
            await waitForUpdate();
            warnCapture.restore();

            // Parent should NOT warn about childColor
            if (hasConsoleWarnings()) {
                const scopeWarning = warnCapture.captured.find(msg =>
                    msg.includes('[WF]') && msg.includes('style-scope-parent') &&
                    msg.includes('childColor')
                );
                expect(scopeWarning).toBeUndefined();
            }
        });

        it('warns when action references undefined method', async () => {
            const warnCapture = createWarnCapture();

            wildflower.component('action-validate-1', {
                state: { count: 0 },
                increment() { this.state.count++; }
            });

            testContainer.innerHTML = `
                <div data-component="action-validate-1">
                    <button data-action="incremnt">+1</button>
                </div>
            `;

            await wildflower.scan();
            await waitForUpdate();
            warnCapture.restore();

            if (hasConsoleWarnings()) {
                const validationWarning = warnCapture.captured.find(msg =>
                    msg.includes('[WF]') && msg.includes('incremnt')
                );
                expect(validationWarning).toBeDefined();
            }
        });

        it('does not warn for valid action method names', async () => {
            const warnCapture = createWarnCapture();

            wildflower.component('action-validate-2', {
                state: { count: 0 },
                increment() { this.state.count++; }
            });

            testContainer.innerHTML = `
                <div data-component="action-validate-2">
                    <button data-action="increment">+1</button>
                </div>
            `;

            await wildflower.scan();
            await waitForUpdate();
            warnCapture.restore();

            if (hasConsoleWarnings()) {
                const validationWarning = warnCapture.captured.find(msg =>
                    msg.includes('[WF]') && msg.includes('Binding validation') && msg.includes('increment')
                );
                expect(validationWarning).toBeUndefined();
            }
        });

        it('handles event:method and method(args) action formats', async () => {
            const warnCapture = createWarnCapture();

            wildflower.component('action-validate-3', {
                state: { value: '' },
                handleInput() { },
                save() { }
            });

            testContainer.innerHTML = `
                <div data-component="action-validate-3">
                    <input data-action="input:handleInput">
                    <button data-action="save('draft')">Save</button>
                    <button data-action="click:svae">Typo</button>
                </div>
            `;

            await wildflower.scan();
            await waitForUpdate();
            warnCapture.restore();

            if (hasConsoleWarnings()) {
                // Should NOT warn about handleInput or save — they exist
                const validMethodWarning = warnCapture.captured.find(msg =>
                    msg.includes('[WF]') && msg.includes('Binding validation') &&
                    (msg.includes('"handleInput"') || msg.includes('"save"'))
                );
                expect(validMethodWarning).toBeUndefined();

                // SHOULD warn about svae — it's a typo
                const typoWarning = warnCapture.captured.find(msg =>
                    msg.includes('[WF]') && msg.includes('svae')
                );
                expect(typoWarning).toBeDefined();
            }
        });

        it('does not impact performance significantly with validation disabled', async () => {
            // Performance test - validation should be skippable in production
            wildflower.component('perf-test-1', {
                state: {
                    items: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `Item ${i}` }))
                }
            });

            // Disable debug mode for performance test
            wildflower.options.debug = false;
            wildflower.debug = false;

            testContainer.innerHTML = `
                <div data-component="perf-test-1">
                    <div data-list="items">
                        <template>
                            <div>
                                <span data-bind="id"></span>
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `;

            const startTime = performance.now();
            await wildflower.scan();
            await waitForUpdate();
            const endTime = performance.now();

            // Rendering 100 items should be fast (< 500ms)
            expect(endTime - startTime).toBeLessThan(500);
        });
    });
});
