/**
 * Tests for the this.listItem API
 *
 * Components rendered inside lists can access the list item's data
 * via `this.listItem` in their lifecycle methods.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework } from './helpers/load-framework.js';

describe('this.listItem API', () => {
    let container;
    let wf;

    beforeAll(async () => {
        await loadFramework();
    });

    beforeEach(() => {
        wf = window.wildflower;
        resetFramework();

        if (wf._initContextSystem) {
            wf._contextSystemInitialized = false;
            wf._initContextSystem();
        }

        container = document.createElement('div');
        container.id = 'test-container';
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
    });

    const waitForUpdate = () => new Promise(resolve => setTimeout(resolve, 50));

    describe('Basic functionality', () => {
        it('should be available in beforeInit for components in lists', async () => {
            const capturedListItems = [];

            wf.component('list-item-comp-1', {
                state: {
                    itemId: null,
                    itemName: null
                },
                beforeInit() {
                    capturedListItems.push(this.listItem);
                    if (this.listItem) {
                        this.state.itemId = this.listItem.id;
                        this.state.itemName = this.listItem.name;
                    }
                }
            });

            wf.component('list-parent-1', {
                state: {
                    items: [
                        { id: 1, name: 'First Item' },
                        { id: 2, name: 'Second Item' }
                    ]
                }
            });

            container.innerHTML = `
                <div data-component="list-parent-1">
                    <div data-list="items" data-key="id">
                        <template>
                            <div data-component="list-item-comp-1">
                                <span data-bind="itemName"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            // Verify listItem was captured for both items
            expect(capturedListItems.length).toBe(2);
            expect(capturedListItems[0]).not.toBeNull();
            expect(capturedListItems[0].id).toBe(1);
            expect(capturedListItems[0].name).toBe('First Item');
            expect(capturedListItems[1]).not.toBeNull();
            expect(capturedListItems[1].id).toBe(2);
            expect(capturedListItems[1].name).toBe('Second Item');
        });

        it('should be null for components not in lists', async () => {
            let capturedListItem = 'not-set';

            wf.component('standalone-comp-1', {
                state: {},
                beforeInit() {
                    capturedListItem = this.listItem;
                }
            });

            container.innerHTML = `
                <div data-component="standalone-comp-1">
                    <span>Standalone Component</span>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            expect(capturedListItem).toBeNull();
        });

        it('should be available in init()', async () => {
            let initListItem = 'not-set';

            wf.component('init-test-comp-1', {
                state: {},
                init() {
                    initListItem = this.listItem;
                }
            });

            wf.component('init-test-parent-1', {
                state: {
                    items: [{ id: 42, value: 'test-value' }]
                }
            });

            container.innerHTML = `
                <div data-component="init-test-parent-1">
                    <div data-list="items" data-key="id">
                        <template>
                            <div data-component="init-test-comp-1"></div>
                        </template>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            expect(initListItem).not.toBe('not-set');
            expect(initListItem).not.toBeNull();
            expect(initListItem.id).toBe(42);
            expect(initListItem.value).toBe('test-value');
        });

        it('should reflect the correct item for each list instance', async () => {
            const capturedItems = [];

            wf.component('multi-item-comp-1', {
                state: {},
                beforeInit() {
                    if (this.listItem) {
                        capturedItems.push({ ...this.listItem });
                    }
                }
            });

            wf.component('multi-item-parent-1', {
                state: {
                    items: [
                        { id: 1, name: 'Alpha' },
                        { id: 2, name: 'Beta' },
                        { id: 3, name: 'Gamma' }
                    ]
                }
            });

            container.innerHTML = `
                <div data-component="multi-item-parent-1">
                    <div data-list="items" data-key="id">
                        <template>
                            <div data-component="multi-item-comp-1"></div>
                        </template>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            // Verify each component received the correct item
            expect(capturedItems.length).toBe(3);
            expect(capturedItems[0].id).toBe(1);
            expect(capturedItems[0].name).toBe('Alpha');
            expect(capturedItems[1].id).toBe(2);
            expect(capturedItems[1].name).toBe('Beta');
            expect(capturedItems[2].id).toBe(3);
            expect(capturedItems[2].name).toBe('Gamma');
        });
    });

    describe('Nested components', () => {
        it('should work for component nested inside a wrapper div within list item', async () => {
            let capturedListItem = null;

            wf.component('nested-wrapper-comp-1', {
                state: {},
                beforeInit() {
                    capturedListItem = this.listItem;
                }
            });

            wf.component('nested-wrapper-parent-1', {
                state: {
                    items: [{ id: 100, title: 'Wrapped Item' }]
                }
            });

            container.innerHTML = `
                <div data-component="nested-wrapper-parent-1">
                    <div data-list="items" data-key="id">
                        <template>
                            <div class="wrapper">
                                <div class="inner-wrapper">
                                    <div data-component="nested-wrapper-comp-1"></div>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            // Component should still get the list item data even when nested in wrappers
            expect(capturedListItem).not.toBeNull();
            expect(capturedListItem.id).toBe(100);
            expect(capturedListItem.title).toBe('Wrapped Item');
        });

        it('should be null for component inside another component within list', async () => {
            let outerListItem = 'not-set';
            let innerListItem = 'not-set';

            wf.component('boundary-inner-comp-1', {
                state: {},
                beforeInit() {
                    innerListItem = this.listItem;
                }
            });

            wf.component('boundary-outer-comp-1', {
                state: {},
                beforeInit() {
                    outerListItem = this.listItem;
                }
            });

            wf.component('boundary-parent-1', {
                state: {
                    items: [{ id: 1, name: 'Parent Item' }]
                }
            });

            container.innerHTML = `
                <div data-component="boundary-parent-1">
                    <div data-list="items" data-key="id">
                        <template>
                            <div data-component="boundary-outer-comp-1">
                                <div data-component="boundary-inner-comp-1"></div>
                            </div>
                        </template>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate();
            await waitForUpdate(); // Extra wait for nested components

            // Outer component (which IS the list item root) should get listItem
            expect(outerListItem).not.toBe('not-set');
            expect(outerListItem).not.toBeNull();
            expect(outerListItem.id).toBe(1);

            // Inner component should NOT get listItem (blocked by component boundary)
            expect(innerListItem).toBeNull();
        });
    });

    describe('Nested lists', () => {
        it('should get immediate parent list item, not ancestor list item', async () => {
            const capturedItems = [];

            wf.component('nested-list-item-comp-1', {
                state: {},
                beforeInit() {
                    if (this.listItem) {
                        capturedItems.push({ ...this.listItem });
                    }
                }
            });

            wf.component('nested-list-parent-1', {
                state: {
                    categories: [
                        {
                            id: 'cat-1',
                            name: 'Category 1',
                            items: [
                                { id: 'item-1a', title: 'Item 1A' },
                                { id: 'item-1b', title: 'Item 1B' }
                            ]
                        }
                    ]
                }
            });

            container.innerHTML = `
                <div data-component="nested-list-parent-1">
                    <div data-list="categories" data-key="id">
                        <template>
                            <div class="category">
                                <div data-list="items" data-key="id">
                                    <template>
                                        <div data-component="nested-list-item-comp-1"></div>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate();
            await waitForUpdate(); // Extra wait for nested lists

            // Components should get their immediate parent's list item (the inner items),
            // NOT the category
            expect(capturedItems.length).toBe(2);
            expect(capturedItems[0].id).toBe('item-1a');
            expect(capturedItems[0].title).toBe('Item 1A');
            expect(capturedItems[1].id).toBe('item-1b');
            expect(capturedItems[1].title).toBe('Item 1B');
        });
    });

    describe('Component is list item root', () => {
        it('should work when component element has data-list item directly', async () => {
            let capturedListItem = null;

            wf.component('direct-list-item-1', {
                state: {},
                beforeInit() {
                    capturedListItem = this.listItem;
                }
            });

            wf.component('direct-list-parent-1', {
                state: {
                    items: [{ id: 'direct-1', data: 'Direct Data' }]
                }
            });

            container.innerHTML = `
                <div data-component="direct-list-parent-1">
                    <div data-list="items" data-key="id">
                        <template>
                            <div data-component="direct-list-item-1"></div>
                        </template>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            // Component should get listItem when it IS the list item root
            expect(capturedListItem).not.toBeNull();
            expect(capturedListItem.id).toBe('direct-1');
            expect(capturedListItem.data).toBe('Direct Data');
        });
    });

    describe('Live reference behavior', () => {
        it('should reflect current data (live reference)', async () => {
            let componentInstance = null;

            wf.component('live-ref-item-1', {
                state: {},
                init() {
                    componentInstance = this;
                }
            });

            wf.component('live-ref-parent-1', {
                state: {
                    items: [{ id: 1, counter: 0 }]
                }
            });

            container.innerHTML = `
                <div data-component="live-ref-parent-1">
                    <div data-list="items" data-key="id">
                        <template>
                            <div data-component="live-ref-item-1"></div>
                        </template>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            // Initial value
            expect(componentInstance.listItem.counter).toBe(0);

            // Get parent instance and modify the source data
            const parentEl = container.querySelector('[data-component="live-ref-parent-1"]');
            const parentId = parentEl.dataset.componentId;
            const parentInstance = wf.componentInstances.get(parentId);

            parentInstance.state.items[0].counter = 42;
            await waitForUpdate();

            // listItem should reflect the change (live reference)
            expect(componentInstance.listItem.counter).toBe(42);
        });
    });

    describe('Backward compatibility', () => {
        it('should still allow access via element._itemData (deprecated)', async () => {
            let itemDataValue = null;

            wf.component('compat-test-comp-1', {
                state: {},
                beforeInit() {
                    // Old pattern (still works but deprecated)
                    itemDataValue = this.element._itemData;
                }
            });

            wf.component('compat-test-parent-1', {
                state: {
                    items: [{ id: 'compat', legacy: true }]
                }
            });

            container.innerHTML = `
                <div data-component="compat-test-parent-1">
                    <div data-list="items" data-key="id">
                        <template>
                            <div data-component="compat-test-comp-1"></div>
                        </template>
                    </div>
                </div>
            `;

            wf.scan();
            await waitForUpdate();

            // Old pattern should still work
            expect(itemDataValue).not.toBeNull();
            expect(itemDataValue.id).toBe('compat');
            expect(itemDataValue.legacy).toBe(true);
        });
    });
});
