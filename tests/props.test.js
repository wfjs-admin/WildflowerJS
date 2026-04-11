/**
 * Props System Test Suite
 *
 * Tests the formal props system for parent-to-child data passing.
 * Based on the TDD plan in docs/future/PROPS_SYSTEM_PROPOSAL.md
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { loadFramework, resetFramework, hasConsoleWarnings, isMinifiedBuild} from './helpers/load-framework.js';

// Skip warning tests in minified builds (console.warn is stripped)
const itIfWarnings = hasConsoleWarnings() ? it : it.skip;

describe('Props System', () => {
    let container;
    let wf; // Reference to wildflower

    beforeAll(async () => {
        await loadFramework();
    });

    beforeEach(() => {
        wf = window.wildflower;
        resetFramework();

        // Re-initialize context system
        if (wf._initContextSystem) {
            wf._contextSystemInitialized = false;
            wf._initContextSystem();
        }

        // Create test container
        container = document.createElement('div');
        container.id = 'test-container';
        document.body.appendChild(container);
    });

    afterEach(() => {
        // Clean up
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
    });

    // Helper to wait for framework initialization
    const waitForInit = () => new Promise(resolve => setTimeout(resolve, 50));

    describe('Basic Props', () => {
        it('receives prop from data-prop-* attribute', async () => {
            // Register parent component
            wf.component('parent-component', {
                state: {
                    userName: 'Alice'
                }
            });

            // Register child component with props
            wf.component('child-component', {
                props: {
                    name: { type: String }
                }
            });

            // Create DOM structure
            container.innerHTML = `
                <div data-component="parent-component">
                    <div data-component="child-component" data-prop-name="userName"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            // Get child instance
            const childEl = container.querySelector('[data-component="child-component"]');
            const childId = childEl.dataset.componentId;
            const childInstance = wf.componentInstances.get(childId);

            expect(childInstance.props.name).toBe('Alice');
        });

        it('provides prop via this.props in methods', async () => {
            let capturedProp = null;

            wf.component('parent-with-data', {
                state: { message: 'Hello World' }
            });

            wf.component('child-with-method', {
                props: {
                    greeting: { type: String }
                },
                init() {
                    capturedProp = this.props.greeting;
                }
            });

            container.innerHTML = `
                <div data-component="parent-with-data">
                    <div data-component="child-with-method" data-prop-greeting="message"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            expect(capturedProp).toBe('Hello World');
        });

        it('prop is reactive to parent state changes', async () => {
            wf.component('reactive-parent', {
                state: { count: 1 }
            });

            wf.component('reactive-child', {
                props: {
                    value: { type: Number }
                }
            });

            container.innerHTML = `
                <div data-component="reactive-parent">
                    <div data-component="reactive-child" data-prop-value="count"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            // Get instances
            const parentEl = container.querySelector('[data-component="reactive-parent"]');
            const childEl = container.querySelector('[data-component="reactive-child"]');
            const parentId = parentEl.dataset.componentId;
            const childId = childEl.dataset.componentId;
            const parentInstance = wf.componentInstances.get(parentId);
            const childInstance = wf.componentInstances.get(childId);

            expect(childInstance.props.value).toBe(1);

            // Update parent state
            parentInstance.state.count = 2;

            // Update child props
            wf._updateComponentProps(childInstance);

            expect(childInstance.props.value).toBe(2);
        });

        it('supports multiple props on single component', async () => {
            wf.component('multi-prop-parent', {
                state: {
                    firstName: 'John',
                    lastName: 'Doe',
                    age: 30
                }
            });

            wf.component('multi-prop-child', {
                props: {
                    first: { type: String },
                    last: { type: String },
                    years: { type: Number }
                }
            });

            container.innerHTML = `
                <div data-component="multi-prop-parent">
                    <div data-component="multi-prop-child"
                         data-prop-first="firstName"
                         data-prop-last="lastName"
                         data-prop-years="age">
                    </div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="multi-prop-child"]');
            const childInstance = wf.componentInstances.get(childEl.dataset.componentId);

            expect(childInstance.props.first).toBe('John');
            expect(childInstance.props.last).toBe('Doe');
            expect(childInstance.props.years).toBe(30);
        });

        it('supports literal values in props', async () => {
            wf.component('literal-parent', {
                state: {}
            });

            wf.component('literal-child', {
                props: {
                    label: { type: String },
                    count: { type: Number },
                    enabled: { type: Boolean }
                }
            });

            container.innerHTML = `
                <div data-component="literal-parent">
                    <div data-component="literal-child"
                         data-prop-label="'Hello'"
                         data-prop-count="42"
                         data-prop-enabled="true">
                    </div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="literal-child"]');
            const childInstance = wf.componentInstances.get(childEl.dataset.componentId);

            expect(childInstance.props.label).toBe('Hello');
            expect(childInstance.props.count).toBe(42);
            expect(childInstance.props.enabled).toBe(true);
        });

        it('handles undefined parent path gracefully', async () => {
            wf.component('missing-parent', {
                state: {}
            });

            wf.component('missing-child', {
                props: {
                    data: { type: Object }
                }
            });

            container.innerHTML = `
                <div data-component="missing-parent">
                    <div data-component="missing-child" data-prop-data="nonexistent"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="missing-child"]');
            const childInstance = wf.componentInstances.get(childEl.dataset.componentId);

            expect(childInstance.props.data).toBe(undefined);
        });
    });

    describe('Default Values', () => {
        it('uses default when prop not provided', async () => {
            wf.component('default-parent', {
                state: {}
            });

            wf.component('default-child', {
                props: {
                    label: { type: String, default: 'Default Label' }
                }
            });

            container.innerHTML = `
                <div data-component="default-parent">
                    <div data-component="default-child"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="default-child"]');
            const childInstance = wf.componentInstances.get(childEl.dataset.componentId);

            expect(childInstance.props.label).toBe('Default Label');
        });

        it('primitive defaults are applied directly', async () => {
            wf.component('primitive-parent', {
                state: {}
            });

            wf.component('primitive-child', {
                props: {
                    count: { type: Number, default: 0 },
                    name: { type: String, default: '' },
                    enabled: { type: Boolean, default: false }
                }
            });

            container.innerHTML = `
                <div data-component="primitive-parent">
                    <div data-component="primitive-child"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="primitive-child"]');
            const childInstance = wf.componentInstances.get(childEl.dataset.componentId);

            expect(childInstance.props.count).toBe(0);
            expect(childInstance.props.name).toBe('');
            expect(childInstance.props.enabled).toBe(false);
        });

        it('factory function defaults are called per-instance', async () => {
            let callCount = 0;

            wf.component('factory-parent', {
                state: {}
            });

            wf.component('factory-child', {
                props: {
                    config: {
                        type: Object,
                        default: () => {
                            callCount++;
                            return { theme: 'light' };
                        }
                    }
                }
            });

            container.innerHTML = `
                <div data-component="factory-parent">
                    <div data-component="factory-child" id="child1"></div>
                    <div data-component="factory-child" id="child2"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            expect(callCount).toBe(2);
        });

        it.skipIf(isMinifiedBuild())('each instance gets isolated default objects', async () => {
            wf.component('isolated-parent', {
                state: {}
            });

            wf.component('isolated-child', {
                props: {
                    data: {
                        type: Object,
                        default: () => ({ items: [] })
                    }
                }
            });

            container.innerHTML = `
                <div data-component="isolated-parent">
                    <div data-component="isolated-child" id="child1"></div>
                    <div data-component="isolated-child" id="child2"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const child1El = container.querySelector('#child1');
            const child2El = container.querySelector('#child2');
            const child1 = wf.componentInstances.get(child1El.dataset.componentId);
            const child2 = wf.componentInstances.get(child2El.dataset.componentId);

            // Modify child1's default object
            child1._propsData.data.items.push('test');

            // child2 should NOT be affected
            expect(child2.props.data.items).toEqual([]);
            expect(child1.props.data.items).toEqual(['test']);
        });

        it.skipIf(isMinifiedBuild())('each instance gets isolated default arrays', async () => {
            wf.component('array-parent', {
                state: {}
            });

            wf.component('array-child', {
                props: {
                    items: {
                        type: Array,
                        default: () => []
                    }
                }
            });

            container.innerHTML = `
                <div data-component="array-parent">
                    <div data-component="array-child" id="a1"></div>
                    <div data-component="array-child" id="a2"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const a1El = container.querySelector('#a1');
            const a2El = container.querySelector('#a2');
            const a1 = wf.componentInstances.get(a1El.dataset.componentId);
            const a2 = wf.componentInstances.get(a2El.dataset.componentId);

            // Modify a1's array
            a1._propsData.items.push(1, 2, 3);

            // a2 should be unaffected
            expect(a2.props.items).toEqual([]);
            expect(a1.props.items).toEqual([1, 2, 3]);
        });

        it('provided prop overrides default', async () => {
            wf.component('override-parent', {
                state: { customLabel: 'Custom' }
            });

            wf.component('override-child', {
                props: {
                    label: { type: String, default: 'Default' }
                }
            });

            container.innerHTML = `
                <div data-component="override-parent">
                    <div data-component="override-child" data-prop-label="customLabel"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="override-child"]');
            const childInstance = wf.componentInstances.get(childEl.dataset.componentId);

            expect(childInstance.props.label).toBe('Custom');
        });

        it('null prop does NOT trigger default', async () => {
            wf.component('null-parent', {
                state: {}
            });

            wf.component('null-child', {
                props: {
                    user: {
                        type: Object,
                        default: () => ({ name: 'Guest' })
                    }
                }
            });

            container.innerHTML = `
                <div data-component="null-parent">
                    <div data-component="null-child" data-prop-user="null"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="null-child"]');
            const childInstance = wf.componentInstances.get(childEl.dataset.componentId);

            expect(childInstance.props.user).toBe(null);
        });

        it('undefined prop DOES trigger default', async () => {
            wf.component('undefined-parent', {
                state: {}
            });

            wf.component('undefined-child', {
                props: {
                    user: {
                        type: Object,
                        default: () => ({ name: 'Guest' })
                    }
                }
            });

            container.innerHTML = `
                <div data-component="undefined-parent">
                    <div data-component="undefined-child" data-prop-user="undefined"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="undefined-child"]');
            const childInstance = wf.componentInstances.get(childEl.dataset.componentId);

            expect(childInstance.props.user).toEqual({ name: 'Guest' });
        });
    });

    describe('Validation - Type Checking', () => {
        it('validates String type', async () => {
            wf.component('string-parent', {
                state: { text: 'hello' }
            });

            wf.component('string-child', {
                props: {
                    message: { type: String }
                }
            });

            container.innerHTML = `
                <div data-component="string-parent">
                    <div data-component="string-child" data-prop-message="text"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="string-child"]');
            const childInstance = wf.componentInstances.get(childEl.dataset.componentId);

            expect(childInstance.props.message).toBe('hello');
        });

        it('validates Number type', async () => {
            wf.component('number-parent', {
                state: { value: 42 }
            });

            wf.component('number-child', {
                props: {
                    count: { type: Number }
                }
            });

            container.innerHTML = `
                <div data-component="number-parent">
                    <div data-component="number-child" data-prop-count="value"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="number-child"]');
            const childInstance = wf.componentInstances.get(childEl.dataset.componentId);

            expect(childInstance.props.count).toBe(42);
        });

        it('validates Boolean type', async () => {
            wf.component('bool-parent', {
                state: { active: true }
            });

            wf.component('bool-child', {
                props: {
                    enabled: { type: Boolean }
                }
            });

            container.innerHTML = `
                <div data-component="bool-parent">
                    <div data-component="bool-child" data-prop-enabled="active"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="bool-child"]');
            const childInstance = wf.componentInstances.get(childEl.dataset.componentId);

            expect(childInstance.props.enabled).toBe(true);
        });

        it('validates Array type', async () => {
            wf.component('array-type-parent', {
                state: { list: [1, 2, 3] }
            });

            wf.component('array-type-child', {
                props: {
                    items: { type: Array }
                }
            });

            container.innerHTML = `
                <div data-component="array-type-parent">
                    <div data-component="array-type-child" data-prop-items="list"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="array-type-child"]');
            const childInstance = wf.componentInstances.get(childEl.dataset.componentId);

            // Use spread to create plain array - handles both with/without Symbol properties
            expect([...childInstance.props.items]).toEqual([1, 2, 3]);
        });

        it('validates Array of Objects type (common use case)', async () => {
            wf.component('array-objects-parent', {
                state: {
                    items: [
                        { id: 1, name: 'Apple' },
                        { id: 2, name: 'Banana' },
                        { id: 3, name: 'Cherry' }
                    ]
                }
            });

            wf.component('array-objects-child', {
                props: {
                    items: { type: Array }
                }
            });

            container.innerHTML = `
                <div data-component="array-objects-parent">
                    <div data-component="array-objects-child" data-prop-items="items"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="array-objects-child"]');
            const childInstance = wf.componentInstances.get(childEl.dataset.componentId);

            // Use JSON round-trip to strip Symbol properties for comparison
            expect(JSON.parse(JSON.stringify(childInstance.props.items))).toEqual([
                { id: 1, name: 'Apple' },
                { id: 2, name: 'Banana' },
                { id: 3, name: 'Cherry' }
            ]);
            expect(childInstance.props.items.length).toBe(3);
            expect(childInstance.props.items[0].name).toBe('Apple');
        });

        it('validates Object type', async () => {
            wf.component('obj-type-parent', {
                state: { config: { theme: 'dark' } }
            });

            wf.component('obj-type-child', {
                props: {
                    settings: { type: Object }
                }
            });

            container.innerHTML = `
                <div data-component="obj-type-parent">
                    <div data-component="obj-type-child" data-prop-settings="config"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="obj-type-child"]');
            const childInstance = wf.componentInstances.get(childEl.dataset.componentId);

            // Use JSON round-trip to strip Symbol properties for comparison
            expect(JSON.parse(JSON.stringify(childInstance.props.settings))).toEqual({ theme: 'dark' });
        });

        it('validates Function type', async () => {
            const myCallback = () => 'called';

            wf.component('fn-type-parent', {
                state: { handler: myCallback }
            });

            wf.component('fn-type-child', {
                props: {
                    onClick: { type: Function }
                }
            });

            container.innerHTML = `
                <div data-component="fn-type-parent">
                    <div data-component="fn-type-child" data-prop-on-click="handler"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="fn-type-child"]');
            const childInstance = wf.componentInstances.get(childEl.dataset.componentId);

            expect(typeof childInstance.props.onClick).toBe('function');
            expect(childInstance.props.onClick()).toBe('called');
        });

        it('allows null for any type when not required', async () => {
            wf.component('null-type-parent', {
                state: { data: null }
            });

            wf.component('null-type-child', {
                props: {
                    value: { type: Object }
                }
            });

            container.innerHTML = `
                <div data-component="null-type-parent">
                    <div data-component="null-type-child" data-prop-value="data"></div>
                </div>
            `;

            // Should not throw
            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="null-type-child"]');
            const childInstance = wf.componentInstances.get(childEl.dataset.componentId);

            expect(childInstance.props.value).toBe(null);
        });
    });

    describe('Validation - Required Props', () => {
        it('throws on missing required prop in dev mode', async () => {
            const originalDebug = wf.debug;
            wf.debug = true;

            // Disconnect MutationObserver to prevent async re-scan after our test
            const observer = wf._mutationObserver;
            if (observer) observer.disconnect();

            wf.component('req-parent', {
                state: {}
            });

            wf.component('req-child', {
                props: {
                    id: { type: String, required: true }
                }
            });

            container.innerHTML = `
                <div data-component="req-parent">
                    <div data-component="req-child"></div>
                </div>
            `;

            expect(() => {
                wf.scan();
            }).toThrow(/Missing required prop/);

            // Reconnect MutationObserver
            if (observer && document.body) {
                observer.observe(document.body, { childList: true, subtree: true });
            }

            wf.debug = originalDebug;
        });

        itIfWarnings('warns on missing required prop in prod mode', async () => {
            const originalDebug = wf.debug;
            wf.debug = false;

            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            wf.component('req-prod-parent', {
                state: {}
            });

            wf.component('req-prod-child', {
                props: {
                    id: { type: String, required: true }
                }
            });

            container.innerHTML = `
                <div data-component="req-prod-parent">
                    <div data-component="req-prod-child"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Missing required prop')
            );

            warnSpy.mockRestore();
            wf.debug = originalDebug;
        });

        it('accepts valid required prop', async () => {
            wf.component('valid-req-parent', {
                state: { userId: 'user-123' }
            });

            wf.component('valid-req-child', {
                props: {
                    id: { type: String, required: true }
                }
            });

            container.innerHTML = `
                <div data-component="valid-req-parent">
                    <div data-component="valid-req-child" data-prop-id="userId"></div>
                </div>
            `;

            // Should not throw
            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="valid-req-child"]');
            const childInstance = wf.componentInstances.get(childEl.dataset.componentId);

            expect(childInstance.props.id).toBe('user-123');
        });
    });

    describe('Validation - Custom Validators', () => {
        it('calls custom validator function', async () => {
            const validatorSpy = vi.fn(() => true);

            wf.component('custom-val-parent', {
                state: { status: 'active' }
            });

            wf.component('custom-val-child', {
                props: {
                    status: {
                        type: String,
                        validator: validatorSpy
                    }
                }
            });

            container.innerHTML = `
                <div data-component="custom-val-parent">
                    <div data-component="custom-val-child" data-prop-status="status"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            expect(validatorSpy).toHaveBeenCalledWith('active');
        });

        it('validator failure throws in dev mode', async () => {
            const originalDebug = wf.debug;
            wf.debug = true;

            // Disconnect MutationObserver to prevent async re-scan after our test
            const observer = wf._mutationObserver;
            if (observer) observer.disconnect();

            wf.component('val-fail-parent', {
                state: { value: -5 }
            });

            wf.component('val-fail-child', {
                props: {
                    age: {
                        type: Number,
                        validator: (v) => v >= 0
                    }
                }
            });

            container.innerHTML = `
                <div data-component="val-fail-parent">
                    <div data-component="val-fail-child" data-prop-age="value"></div>
                </div>
            `;

            expect(() => {
                wf.scan();
            }).toThrow(/failed custom validation/);

            // Reconnect MutationObserver
            if (observer && document.body) {
                observer.observe(document.body, { childList: true, subtree: true });
            }

            wf.debug = originalDebug;
        });

        it('validator can implement multiple types', async () => {
            wf.component('multi-type-parent', {
                state: { val1: 'text', val2: 42 }
            });

            wf.component('multi-type-child', {
                props: {
                    value: {
                        validator: (v) => typeof v === 'string' || typeof v === 'number'
                    }
                }
            });

            container.innerHTML = `
                <div data-component="multi-type-parent">
                    <div data-component="multi-type-child" id="c1" data-prop-value="val1"></div>
                    <div data-component="multi-type-child" id="c2" data-prop-value="val2"></div>
                </div>
            `;

            // Should not throw for either string or number
            wf.scan();
            await waitForInit();

            const c1 = wf.componentInstances.get(
                container.querySelector('#c1').dataset.componentId
            );
            const c2 = wf.componentInstances.get(
                container.querySelector('#c2').dataset.componentId
            );

            expect(c1.props.value).toBe('text');
            expect(c2.props.value).toBe(42);
        });
    });

    describe('Reactivity - Shallow', () => {
        it('reacts to prop reference change', async () => {
            wf.component('shallow-parent', {
                state: { user: { name: 'Alice' } }
            });

            wf.component('shallow-child', {
                props: {
                    user: { type: Object }
                }
            });

            container.innerHTML = `
                <div data-component="shallow-parent">
                    <div data-component="shallow-child" data-prop-user="user"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const parentEl = container.querySelector('[data-component="shallow-parent"]');
            const childEl = container.querySelector('[data-component="shallow-child"]');
            const parent = wf.componentInstances.get(parentEl.dataset.componentId);
            const child = wf.componentInstances.get(childEl.dataset.componentId);

            expect(child.props.user.name).toBe('Alice');

            // Replace with new object (reference change)
            parent.state.user = { name: 'Bob' };
            wf._updateComponentProps(child);

            expect(child.props.user.name).toBe('Bob');
        });

        it('primitive prop updates correctly', async () => {
            wf.component('prim-react-parent', {
                state: { count: 10 }
            });

            wf.component('prim-react-child', {
                props: {
                    value: { type: Number }
                }
            });

            container.innerHTML = `
                <div data-component="prim-react-parent">
                    <div data-component="prim-react-child" data-prop-value="count"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const parentEl = container.querySelector('[data-component="prim-react-parent"]');
            const childEl = container.querySelector('[data-component="prim-react-child"]');
            const parent = wf.componentInstances.get(parentEl.dataset.componentId);
            const child = wf.componentInstances.get(childEl.dataset.componentId);

            expect(child.props.value).toBe(10);

            parent.state.count = 20;
            wf._updateComponentProps(child);

            expect(child.props.value).toBe(20);
        });

        it('array prop replacement triggers update', async () => {
            wf.component('arr-react-parent', {
                state: { items: ['a', 'b'] }
            });

            wf.component('arr-react-child', {
                props: {
                    list: { type: Array }
                }
            });

            container.innerHTML = `
                <div data-component="arr-react-parent">
                    <div data-component="arr-react-child" data-prop-list="items"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const parentEl = container.querySelector('[data-component="arr-react-parent"]');
            const childEl = container.querySelector('[data-component="arr-react-child"]');
            const parent = wf.componentInstances.get(parentEl.dataset.componentId);
            const child = wf.componentInstances.get(childEl.dataset.componentId);

            // Use spread to create plain array - handles both with/without Symbol properties
            expect([...child.props.list]).toEqual(['a', 'b']);

            // Replace entire array
            parent.state.items = ['x', 'y', 'z'];
            wf._updateComponentProps(child);

            expect([...child.props.list]).toEqual(['x', 'y', 'z']);
        });
    });

    describe('Read-Only Enforcement', () => {
        it('direct prop assignment throws in dev mode', async () => {
            const originalDebug = wf.debug;
            wf.debug = true;

            wf.component('readonly-parent', {
                state: { value: 5 }
            });

            wf.component('readonly-child', {
                props: {
                    count: { type: Number }
                }
            });

            container.innerHTML = `
                <div data-component="readonly-parent">
                    <div data-component="readonly-child" data-prop-count="value"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="readonly-child"]');
            const child = wf.componentInstances.get(childEl.dataset.componentId);

            expect(() => {
                child.props.count = 10;
            }).toThrow(/Cannot modify prop/);

            wf.debug = originalDebug;
        });

        itIfWarnings('direct prop assignment warns in prod mode', async () => {
            const originalDebug = wf.debug;
            wf.debug = false;

            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            wf.component('readonly-prod-parent', {
                state: { value: 5 }
            });

            wf.component('readonly-prod-child', {
                props: {
                    count: { type: Number }
                }
            });

            container.innerHTML = `
                <div data-component="readonly-prod-parent">
                    <div data-component="readonly-prod-child" data-prop-count="value"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="readonly-prod-child"]');
            const child = wf.componentInstances.get(childEl.dataset.componentId);

            // Should not throw, but should warn
            child.props.count = 10;

            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Cannot modify prop')
            );

            warnSpy.mockRestore();
            wf.debug = originalDebug;
        });
    });

    describe('Integration', () => {
        it('works alongside store subscriptions', async () => {
            // Create a store using storeManager
            wf.storeManager.store('theme-store', {
                state: { darkMode: true }
            });

            wf.component('integrated-parent', {
                state: { userName: 'TestUser' }
            });

            let capturedProps = null;
            let capturedStoreValue = null;

            wf.component('integrated-child', {
                props: {
                    name: { type: String }
                },
                subscribe: { 'theme-store': ['darkMode'] },
                init() {
                    capturedProps = this.props.name;
                    capturedStoreValue = this.stores['theme-store'].darkMode;
                }
            });

            container.innerHTML = `
                <div data-component="integrated-parent">
                    <div data-component="integrated-child" data-prop-name="userName"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            expect(capturedProps).toBe('TestUser');
            expect(capturedStoreValue).toBe(true);
        });

        it('props available in computed properties', async () => {
            wf.component('computed-parent', {
                state: {
                    firstName: 'John',
                    lastName: 'Doe'
                }
            });

            wf.component('computed-child', {
                props: {
                    first: { type: String },
                    last: { type: String }
                },
                computed: {
                    fullName() {
                        return `${this.props.first} ${this.props.last}`;
                    }
                }
            });

            container.innerHTML = `
                <div data-component="computed-parent">
                    <div data-component="computed-child"
                         data-prop-first="firstName"
                         data-prop-last="lastName">
                    </div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="computed-child"]');
            const child = wf.componentInstances.get(childEl.dataset.componentId);

            expect(child.context.computed.fullName).toBe('John Doe');
        });

        it('computed accesses object prop nested properties', async () => {
            wf.component('object-prop-parent', {
                state: {
                    user: { name: 'Alice', role: 'Admin' }
                }
            });

            wf.component('object-prop-child', {
                props: {
                    user: { type: Object, required: true }
                },
                computed: {
                    initials() {
                        return this.props.user.name.split(' ')
                            .map(n => n[0]).join('').toUpperCase();
                    },
                    displayText() {
                        return `${this.props.user.name} (${this.props.user.role})`;
                    }
                }
            });

            container.innerHTML = `
                <div data-component="object-prop-parent">
                    <div data-component="object-prop-child"
                         data-prop-user="user">
                        <span class="initials" data-bind="computed:initials"></span>
                        <span class="display" data-bind="computed:displayText"></span>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="object-prop-child"]');
            const child = wf.componentInstances.get(childEl.dataset.componentId);

            // Check computed property directly
            expect(child.context.computed.initials).toBe('A');
            expect(child.context.computed.displayText).toBe('Alice (Admin)');

            // Check bound elements render correctly
            const initialsEl = childEl.querySelector('.initials');
            const displayEl = childEl.querySelector('.display');
            expect(initialsEl.textContent).toBe('A');
            expect(displayEl.textContent).toBe('Alice (Admin)');
        });

        it('data-bind resolves props.x.y paths', async () => {
            wf.component('bind-props-parent', {
                state: {
                    user: { name: 'Alice', role: 'Admin' }
                }
            });

            wf.component('bind-props-child', {
                props: {
                    user: { type: Object, required: true }
                }
            });

            container.innerHTML = `
                <div data-component="bind-props-parent">
                    <div data-component="bind-props-child"
                         data-prop-user="user">
                        <span class="name" data-bind="props.user.name"></span>
                        <span class="role" data-bind="props.user.role"></span>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="bind-props-child"]');
            const nameEl = childEl.querySelector('.name');
            const roleEl = childEl.querySelector('.role');

            // Verify bindings resolved correctly
            expect(nameEl.textContent).toBe('Alice');
            expect(roleEl.textContent).toBe('Admin');
        });

        it('computed updates when parent object prop changes', async () => {
            wf.component('reactive-object-parent', {
                state: {
                    user: { name: 'Alice', role: 'Admin' }
                },
                changeUser() {
                    this.state.user = { name: 'Bob', role: 'Editor' };
                }
            });

            wf.component('reactive-object-child', {
                props: {
                    user: { type: Object, required: true }
                },
                computed: {
                    displayName() {
                        return this.props.user.name;
                    }
                }
            });

            container.innerHTML = `
                <div data-component="reactive-object-parent">
                    <div data-component="reactive-object-child"
                         data-prop-user="user">
                        <span class="name" data-bind="computed:displayName"></span>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const parentEl = container.querySelector('[data-component="reactive-object-parent"]');
            const parent = wf.componentInstances.get(parentEl.dataset.componentId);
            const childEl = container.querySelector('[data-component="reactive-object-child"]');
            const child = wf.componentInstances.get(childEl.dataset.componentId);
            const nameEl = childEl.querySelector('.name');

            // Initial state
            expect(child.context.computed.displayName).toBe('Alice');
            expect(nameEl.textContent).toBe('Alice');

            // Change parent state
            parent.context.changeUser();
            await waitForInit();  // Wait for reactivity to propagate

            // Verify computed updated
            expect(child.context.computed.displayName).toBe('Bob');
            expect(nameEl.textContent).toBe('Bob');
        });

        it('function prop can be called by child (Gemini addition)', async () => {
            let callbackResult = null;

            wf.component('callback-parent', {
                state: {},
                handleChildClick(value) {
                    callbackResult = value;
                }
            });

            wf.component('callback-child', {
                props: {
                    onAction: { type: Function }
                },
                triggerAction() {
                    if (this.props.onAction) {
                        this.props.onAction('clicked!');
                    }
                }
            });

            container.innerHTML = `
                <div data-component="callback-parent">
                    <div data-component="callback-child" data-prop-on-action="handleChildClick"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="callback-child"]');
            const child = wf.componentInstances.get(childEl.dataset.componentId);

            // Call the method that invokes the prop function
            child.context.triggerAction();

            expect(callbackResult).toBe('clicked!');
        });

        it('function prop passes complex arguments from child to parent', async () => {
            let receivedData = null;

            wf.component('complex-callback-parent', {
                state: { processedCount: 0 },
                handleChildAction(data) {
                    receivedData = data;
                    this.state.processedCount++;
                }
            });

            wf.component('complex-callback-child', {
                props: {
                    onAction: { type: Function }
                },
                emitAction() {
                    if (this.props.onAction) {
                        this.props.onAction({
                            detail: 'some data',
                            timestamp: 12345,
                            items: ['a', 'b', 'c']
                        });
                    }
                }
            });

            container.innerHTML = `
                <div data-component="complex-callback-parent">
                    <div data-component="complex-callback-child" data-prop-on-action="handleChildAction"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const parentEl = container.querySelector('[data-component="complex-callback-parent"]');
            const parent = wf.componentInstances.get(parentEl.dataset.componentId);
            const childEl = container.querySelector('[data-component="complex-callback-child"]');
            const child = wf.componentInstances.get(childEl.dataset.componentId);

            // Initially no data received
            expect(receivedData).toBe(null);
            expect(parent.state.processedCount).toBe(0);

            // Child emits action with complex data
            child.context.emitAction();

            // Verify parent received the exact data object
            expect(receivedData).toEqual({
                detail: 'some data',
                timestamp: 12345,
                items: ['a', 'b', 'c']
            });
            expect(receivedData.detail).toBe('some data');
            expect(receivedData.items).toEqual(['a', 'b', 'c']);
            expect(parent.state.processedCount).toBe(1);

            // Call again to verify repeated calls work
            child.context.emitAction();
            expect(parent.state.processedCount).toBe(2);
        });
    });

    describe('Shorthand Syntax', () => {
        it('type-only shorthand', async () => {
            wf.component('shorthand-parent', {
                state: { message: 'Hello' }
            });

            wf.component('shorthand-child', {
                props: {
                    text: String  // Shorthand: just the type
                }
            });

            container.innerHTML = `
                <div data-component="shorthand-parent">
                    <div data-component="shorthand-child" data-prop-text="message"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="shorthand-child"]');
            const child = wf.componentInstances.get(childEl.dataset.componentId);

            expect(child.props.text).toBe('Hello');
        });
    });

    describe('Edge Cases', () => {
        it('prop name with hyphens converts to camelCase', async () => {
            wf.component('hyphen-parent', {
                state: { fullName: 'Jane Doe' }
            });

            wf.component('hyphen-child', {
                props: {
                    userName: { type: String }  // camelCase in definition
                }
            });

            container.innerHTML = `
                <div data-component="hyphen-parent">
                    <div data-component="hyphen-child" data-prop-user-name="fullName"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="hyphen-child"]');
            const child = wf.componentInstances.get(childEl.dataset.componentId);

            expect(child.props.userName).toBe('Jane Doe');
        });

        it('empty props definition is valid', async () => {
            wf.component('empty-props-parent', {
                state: {}
            });

            wf.component('empty-props-child', {
                props: {}  // Empty but defined
            });

            container.innerHTML = `
                <div data-component="empty-props-parent">
                    <div data-component="empty-props-child"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="empty-props-child"]');
            const child = wf.componentInstances.get(childEl.dataset.componentId);

            expect(child.props).toEqual({});
        });

        it('component without props definition gets empty props', async () => {
            wf.component('no-props-parent', {
                state: {}
            });

            wf.component('no-props-child', {
                state: { local: 'data' }
                // No props definition at all
            });

            container.innerHTML = `
                <div data-component="no-props-parent">
                    <div data-component="no-props-child"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="no-props-child"]');
            const child = wf.componentInstances.get(childEl.dataset.componentId);

            expect(child.props).toEqual({});
        });

        it('deeply nested parent path', async () => {
            wf.component('deep-path-parent', {
                state: {
                    user: {
                        address: {
                            city: 'New York'
                        }
                    }
                }
            });

            wf.component('deep-path-child', {
                props: {
                    location: { type: String }
                }
            });

            container.innerHTML = `
                <div data-component="deep-path-parent">
                    <div data-component="deep-path-child" data-prop-location="user.address.city"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="deep-path-child"]');
            const child = wf.componentInstances.get(childEl.dataset.componentId);

            expect(child.props.location).toBe('New York');
        });

        it('prop from parent computed property', async () => {
            wf.component('computed-prop-parent', {
                state: {
                    firstName: 'John',
                    lastName: 'Smith'
                },
                computed: {
                    fullName() {
                        return `${this.state.firstName} ${this.state.lastName}`;
                    }
                }
            });

            wf.component('computed-prop-child', {
                props: {
                    name: { type: String }
                }
            });

            container.innerHTML = `
                <div data-component="computed-prop-parent">
                    <div data-component="computed-prop-child" data-prop-name="computed:fullName"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const childEl = container.querySelector('[data-component="computed-prop-child"]');
            const child = wf.componentInstances.get(childEl.dataset.componentId);

            expect(child.props.name).toBe('John Smith');
        });

        it('prop name collision with state property - namespacing', async () => {
            // This test verifies that this.props.name and this.state.name are
            // two distinct, independent values when they share the same property name
            wf.component('collision-parent', {
                state: {
                    name: 'Parent Name'
                }
            });

            wf.component('collision-child', {
                state: {
                    name: 'Child Internal Name'  // Same property name as prop
                },
                props: {
                    name: { type: String }  // Same property name as state
                },
                computed: {
                    combinedNames() {
                        // Both should be accessible independently
                        return `Prop: ${this.props.name}, State: ${this.state.name}`;
                    }
                },
                updateInternalName(newName) {
                    this.state.name = newName;
                }
            });

            container.innerHTML = `
                <div data-component="collision-parent">
                    <div data-component="collision-child" data-prop-name="name"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const parentEl = container.querySelector('[data-component="collision-parent"]');
            const parent = wf.componentInstances.get(parentEl.dataset.componentId);
            const childEl = container.querySelector('[data-component="collision-child"]');
            const child = wf.componentInstances.get(childEl.dataset.componentId);

            // Verify initial values are distinct
            expect(child.props.name).toBe('Parent Name');
            expect(child.state.name).toBe('Child Internal Name');
            expect(child.context.computed.combinedNames).toBe('Prop: Parent Name, State: Child Internal Name');

            // Update child's internal state - should NOT affect prop
            child.context.updateInternalName('Updated Child Name');
            expect(child.state.name).toBe('Updated Child Name');
            expect(child.props.name).toBe('Parent Name');  // Unchanged

            // Update parent state - should update prop, NOT child state
            parent.state.name = 'Updated Parent Name';
            wf._updateComponentProps(child);

            expect(child.props.name).toBe('Updated Parent Name');
            expect(child.state.name).toBe('Updated Child Name');  // Still the child's own value
        });
    });

    describe('onPropsChange Lifecycle Hook', () => {
        it('calls onPropsChange when parent state changes prop value', async () => {
            let propsChangeCount = 0;
            let lastChangeInfo = null;

            wf.component('lifecycle-parent', {
                state: { count: 10 }
            });

            wf.component('lifecycle-child', {
                props: {
                    value: { type: Number }
                },
                onPropsChange(changeInfo) {
                    propsChangeCount++;
                    lastChangeInfo = changeInfo;
                }
            });

            container.innerHTML = `
                <div data-component="lifecycle-parent">
                    <div data-component="lifecycle-child" data-prop-value="count"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const parentEl = container.querySelector('[data-component="lifecycle-parent"]');
            const parent = wf.componentInstances.get(parentEl.dataset.componentId);

            expect(propsChangeCount).toBe(0); // Not called on init

            // Change parent state
            parent.state.count = 20;
            await waitForInit();

            expect(propsChangeCount).toBe(1);
            expect(lastChangeInfo.parentPath).toBe('count');
        });

        it('onPropsChange receives changeInfo with parentPath, newValue, oldValue', async () => {
            let capturedInfo = null;

            wf.component('info-parent', {
                state: { message: 'Hello' }
            });

            wf.component('info-child', {
                props: {
                    text: { type: String }
                },
                onPropsChange(changeInfo) {
                    capturedInfo = changeInfo;
                }
            });

            container.innerHTML = `
                <div data-component="info-parent">
                    <div data-component="info-child" data-prop-text="message"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const parentEl = container.querySelector('[data-component="info-parent"]');
            const parent = wf.componentInstances.get(parentEl.dataset.componentId);

            parent.state.message = 'World';
            await waitForInit();

            expect(capturedInfo).not.toBe(null);
            expect(capturedInfo.parentPath).toBe('message');
            expect(capturedInfo.newValue).toBe('World');
            expect(capturedInfo.oldValue).toBe('Hello');
        });

        it('onPropsChange can update DOM manually (style example)', async () => {
            wf.component('style-parent', {
                state: { progress: 25 }
            });

            wf.component('style-child', {
                props: {
                    value: { type: Number }
                },
                onPropsChange() {
                    this.updateWidth();
                },
                updateWidth() {
                    const bar = this.element.querySelector('.bar');
                    if (bar) bar.style.width = this.props.value + '%';
                },
                init() {
                    this.updateWidth();
                }
            });

            container.innerHTML = `
                <div data-component="style-parent">
                    <div data-component="style-child" data-prop-value="progress">
                        <div class="bar" style="width: 0%"></div>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const parentEl = container.querySelector('[data-component="style-parent"]');
            const parent = wf.componentInstances.get(parentEl.dataset.componentId);
            const bar = container.querySelector('.bar');

            // Initial width set by init()
            expect(bar.style.width).toBe('25%');

            // Change parent state
            parent.state.progress = 75;
            await waitForInit();

            // onPropsChange should have updated the width
            expect(bar.style.width).toBe('75%');
        });

        it('onPropsChange is called for each prop that changes', async () => {
            let callCount = 0;

            wf.component('multi-change-parent', {
                state: { a: 1, b: 2 }
            });

            wf.component('multi-change-child', {
                props: {
                    valA: { type: Number },
                    valB: { type: Number }
                },
                onPropsChange() {
                    callCount++;
                }
            });

            container.innerHTML = `
                <div data-component="multi-change-parent">
                    <div data-component="multi-change-child"
                         data-prop-val-a="a"
                         data-prop-val-b="b">
                    </div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const parentEl = container.querySelector('[data-component="multi-change-parent"]');
            const parent = wf.componentInstances.get(parentEl.dataset.componentId);

            // Change first prop
            parent.state.a = 10;
            await waitForInit();
            expect(callCount).toBe(1);

            // Change second prop
            parent.state.b = 20;
            await waitForInit();
            expect(callCount).toBe(2);
        });

        it('onPropsChange is not called when prop value is unchanged', async () => {
            let callCount = 0;

            wf.component('no-change-parent', {
                state: { value: 5 }
            });

            wf.component('no-change-child', {
                props: {
                    num: { type: Number }
                },
                onPropsChange() {
                    callCount++;
                }
            });

            container.innerHTML = `
                <div data-component="no-change-parent">
                    <div data-component="no-change-child" data-prop-num="value"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const parentEl = container.querySelector('[data-component="no-change-parent"]');
            const parent = wf.componentInstances.get(parentEl.dataset.componentId);

            // Set to same value
            parent.state.value = 5;
            await waitForInit();

            // onPropsChange should NOT be called since value didn't change
            expect(callCount).toBe(0);
        });

        it('computed properties are updated before onPropsChange is called', async () => {
            let computedValueDuringHook = null;

            wf.component('computed-timing-parent', {
                state: { count: 10 }
            });

            wf.component('computed-timing-child', {
                props: {
                    value: { type: Number }
                },
                computed: {
                    doubled() {
                        return this.props.value * 2;
                    }
                },
                onPropsChange() {
                    // Access computed during hook - should have updated value
                    // this is the context proxy, so this.computed works directly
                    computedValueDuringHook = this.computed.doubled;
                }
            });

            container.innerHTML = `
                <div data-component="computed-timing-parent">
                    <div data-component="computed-timing-child" data-prop-value="count"></div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const parentEl = container.querySelector('[data-component="computed-timing-parent"]');
            const parent = wf.componentInstances.get(parentEl.dataset.componentId);
            const childEl = container.querySelector('[data-component="computed-timing-child"]');
            const child = wf.componentInstances.get(childEl.dataset.componentId);

            // Initial computed value
            expect(child.context.computed.doubled).toBe(20);

            // Change parent state
            parent.state.count = 50;
            await waitForInit();

            // Computed should have been updated before onPropsChange ran
            expect(computedValueDuringHook).toBe(100);
        });

        it('onPropsChange this context provides state shorthand access', async () => {
            let shorthandWorked = false

            wf.component('ctx-parent', {
                state: { count: 10 }
            });

            wf.component('ctx-child', {
                props: {
                    value: { type: Number }
                },
                state: { label: 'hello' },
                onPropsChange() {
                    // this.label should resolve via context proxy shorthand
                    // If this is the raw instance, this.label will be undefined
                    shorthandWorked = (this.label === 'hello')
                }
            });

            container.innerHTML = `
                <div data-component="ctx-parent">
                    <div data-component="ctx-child" data-prop-value="count">
                        <span data-bind="props.value"></span>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForInit();

            const parentEl = container.querySelector('[data-component="ctx-parent"]');
            const parent = wf.componentInstances.get(parentEl.dataset.componentId);

            parent.state.count = 20;
            await waitForInit();

            expect(shorthandWorked).toBe(true);
        });
    });

    describe('Error Messages', () => {
        it('error message includes prop name for missing required', async () => {
            const originalDebug = wf.debug;
            wf.debug = true;

            // Disconnect MutationObserver to prevent async re-scan after our test
            const observer = wf._mutationObserver;
            if (observer) observer.disconnect();

            wf.component('err-msg-parent', {
                state: {}
            });

            wf.component('err-msg-child', {
                props: {
                    userId: { type: String, required: true }
                }
            });

            container.innerHTML = `
                <div data-component="err-msg-parent">
                    <div data-component="err-msg-child"></div>
                </div>
            `;

            try {
                wf.scan();
            } catch (e) {
                expect(e.message).toContain('userId');
                expect(e.message).toContain('Missing required prop');
            }

            // Reconnect MutationObserver
            if (observer && document.body) {
                observer.observe(document.body, { childList: true, subtree: true });
            }

            wf.debug = originalDebug;
        });
    });

    describe('data-props object expression syntax', () => {
        it('resolves state paths from parent via data-props expression', async () => {
            wf.component('dp-parent', {
                state: { greeting: 'Hello', color: 'blue' }
            });
            wf.component('dp-child', {
                props: {
                    message: { default: '' },
                    color: { default: '' }
                }
            });

            container.innerHTML = `
                <div data-component="dp-parent">
                    <div data-component="dp-child" data-props="{ message: greeting, color: color }">
                        <span id="dp-msg" data-bind="props.message"></span>
                        <span id="dp-color" data-bind="props.color"></span>
                    </div>
                </div>
            `;
            wf.scan();
            await waitForInit();
            await new Promise(r => setTimeout(r, 100));

            expect(document.getElementById('dp-msg').textContent).toBe('Hello');
            expect(document.getElementById('dp-color').textContent).toBe('blue');
        });

        it('data-props values update reactively when parent state changes', async () => {
            wf.component('dp-reactive-parent', {
                state: { title: 'Original' }
            });
            wf.component('dp-reactive-child', {
                props: { title: { default: '' } }
            });

            container.innerHTML = `
                <div data-component="dp-reactive-parent">
                    <div data-component="dp-reactive-child" data-props="{ title: title }">
                        <span id="dp-title" data-bind="props.title"></span>
                    </div>
                </div>
            `;
            wf.scan();
            await waitForInit();
            await new Promise(r => setTimeout(r, 100));

            expect(document.getElementById('dp-title').textContent).toBe('Original');

            // Update parent state
            wf.getComponent('dp-reactive-parent').title = 'Updated';
            await new Promise(r => setTimeout(r, 200));

            expect(document.getElementById('dp-title').textContent).toBe('Updated');
        });

        it('data-props works alongside individual data-prop-* attributes', async () => {
            wf.component('dp-mixed-parent', {
                state: { name: 'Alice', age: 30, role: 'Admin' }
            });
            wf.component('dp-mixed-child', {
                props: {
                    name: { default: '' },
                    age: { default: 0 },
                    role: { default: '' }
                }
            });

            container.innerHTML = `
                <div data-component="dp-mixed-parent">
                    <div data-component="dp-mixed-child"
                         data-props="{ name: name, age: age }"
                         data-prop-role="role">
                        <span id="dp-mixed-name" data-bind="props.name"></span>
                        <span id="dp-mixed-role" data-bind="props.role"></span>
                    </div>
                </div>
            `;
            wf.scan();
            await waitForInit();
            await new Promise(r => setTimeout(r, 100));

            expect(document.getElementById('dp-mixed-name').textContent).toBe('Alice');
            expect(document.getElementById('dp-mixed-role').textContent).toBe('Admin');
        });
    });

    describe('data-props with quoted string values containing commas', () => {
        it('single-quoted value with comma parses correctly', async () => {
            wf.component('dp-comma-parent', {
                state: { color: 'red' }
            });
            wf.component('dp-comma-child', {
                props: {
                    label: { default: '' },
                    color: { default: '' }
                }
            });

            container.innerHTML = `
                <div data-component="dp-comma-parent">
                    <div data-component="dp-comma-child" data-props="{ label: 'hello, world', color: color }">
                        <span id="dp-comma-label" data-bind="props.label"></span>
                        <span id="dp-comma-color" data-bind="props.color"></span>
                    </div>
                </div>
            `;
            wf.scan();
            await waitForInit();
            await new Promise(r => setTimeout(r, 100));

            expect(document.getElementById('dp-comma-label').textContent).toBe('hello, world');
            expect(document.getElementById('dp-comma-color').textContent).toBe('red');
        });

        it('double-quoted value with comma parses correctly', async () => {
            wf.component('dp-dq-parent', {
                state: { size: 'large' }
            });
            wf.component('dp-dq-child', {
                props: {
                    desc: { default: '' },
                    size: { default: '' }
                }
            });

            container.innerHTML = `
                <div data-component="dp-dq-parent">
                    <div data-component="dp-dq-child" data-props='{ desc: "red, green, blue", size: size }'>
                        <span id="dp-dq-desc" data-bind="props.desc"></span>
                        <span id="dp-dq-size" data-bind="props.size"></span>
                    </div>
                </div>
            `;
            wf.scan();
            await waitForInit();
            await new Promise(r => setTimeout(r, 100));

            expect(document.getElementById('dp-dq-desc').textContent).toBe('red, green, blue');
            expect(document.getElementById('dp-dq-size').textContent).toBe('large');
        });

        it('mixed quoted literals and state references parse correctly', async () => {
            wf.component('dp-mix-parent', {
                state: { count: 42 }
            });
            wf.component('dp-mix-child', {
                props: {
                    title: { default: '' },
                    count: { default: 0 }
                }
            });

            container.innerHTML = `
                <div data-component="dp-mix-parent">
                    <div data-component="dp-mix-child" data-props="{ title: 'items: a, b, c', count: count }">
                        <span id="dp-mix-title" data-bind="props.title"></span>
                        <span id="dp-mix-count" data-bind="props.count"></span>
                    </div>
                </div>
            `;
            wf.scan();
            await waitForInit();
            await new Promise(r => setTimeout(r, 100));

            expect(document.getElementById('dp-mix-title').textContent).toBe('items: a, b, c');
            expect(document.getElementById('dp-mix-count').textContent).toBe('42');
        });
    });

    describe('implicit string literals (no quotes needed)', () => {
        it('treats non-identifier values as string literals', async () => {
            wf.component('lit-parent', { state: {} });
            wf.component('lit-child', {
                props: { title: { default: '' } }
            });

            container.innerHTML = `
                <div data-component="lit-parent">
                    <div data-component="lit-child" data-prop-title="Custom Title">
                        <span id="lit-title" data-bind="props.title"></span>
                    </div>
                </div>
            `;
            wf.scan();
            await waitForInit();
            await new Promise(r => setTimeout(r, 100));

            expect(document.getElementById('lit-title').textContent).toBe('Custom Title');
        });

        it('still resolves valid identifiers from parent state', async () => {
            wf.component('id-parent', { state: { greeting: 'Hello World' } });
            wf.component('id-child', {
                props: { message: { default: '' } }
            });

            container.innerHTML = `
                <div data-component="id-parent">
                    <div data-component="id-child" data-prop-message="greeting">
                        <span id="id-msg" data-bind="props.message"></span>
                    </div>
                </div>
            `;
            wf.scan();
            await waitForInit();
            await new Promise(r => setTimeout(r, 100));

            expect(document.getElementById('id-msg').textContent).toBe('Hello World');
        });

        it('quoted strings still work as explicit literals', async () => {
            wf.component('q-parent', { state: { greeting: 'from state' } });
            wf.component('q-child', {
                props: { message: { default: '' } }
            });

            container.innerHTML = `
                <div data-component="q-parent">
                    <div data-component="q-child" data-prop-message="'greeting'">
                        <span id="q-msg" data-bind="props.message"></span>
                    </div>
                </div>
            `;
            wf.scan();
            await waitForInit();
            await new Promise(r => setTimeout(r, 100));

            // Should be the literal string "greeting", NOT the state value "from state"
            expect(document.getElementById('q-msg').textContent).toBe('greeting');
        });

        it('numbers without quotes resolve as numbers', async () => {
            wf.component('num-parent', { state: {} });
            wf.component('num-child', {
                props: { count: { default: 0 } }
            });

            container.innerHTML = `
                <div data-component="num-parent">
                    <div data-component="num-child" data-prop-count="42">
                        <span id="num-count" data-bind="props.count"></span>
                    </div>
                </div>
            `;
            wf.scan();
            await waitForInit();
            await new Promise(r => setTimeout(r, 100));

            expect(document.getElementById('num-count').textContent).toBe('42');
        });
    });
});
