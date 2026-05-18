/**
 * Store Subscription Syntax Test Suite
 *
 * Tests for the new Store Subscription Syntax feature:
 * 1. $store.path template syntax (normalizes to external())
 * 2. subscribe: {} component declaration
 * 3. onStoreUpdate() lifecycle hook
 * 4. WF-501 warning for invalid data-model="$store.path" usage
 *
 * These tests are written BEFORE implementation (TDD approach).
 * All tests should FAIL initially until the feature is implemented.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, waitForUpdate, isMinifiedBuild} from './helpers/load-framework.js'

describe('Store Subscription Syntax', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
    })

    // =========================================================================
    // SECTION 1: $store.path Template Syntax
    // =========================================================================
    describe('$store.path Template Syntax', () => {

        describe('data-bind with $store.path', () => {
            it('should bind text content from store using $store.path syntax', async () => {
                wildflower.store('user', {
                    state: {
                        name: 'John Doe',
                        email: 'john@example.com'
                    }
                })

                testContainer.innerHTML = `
                    <div data-component="user-display">
                        <span class="name" data-bind="$user.name"></span>
                        <span class="email" data-bind="$user.email"></span>
                    </div>
                `

                wildflower.component('user-display', {
                    state: {}
                })

                await waitForUpdate(100)

                const nameEl = testContainer.querySelector('.name')
                const emailEl = testContainer.querySelector('.email')

                expect(nameEl.textContent).toBe('John Doe')
                expect(emailEl.textContent).toBe('john@example.com')
            })

            it('should update data-bind when store value changes', async () => {
                wildflower.store('counter', {
                    state: {
                        count: 0
                    },
                    increment() {
                        this.state.count++
                    }
                })

                testContainer.innerHTML = `
                    <div data-component="counter-display">
                        <span class="count" data-bind="$counter.count"></span>
                    </div>
                `

                wildflower.component('counter-display', {
                    state: {}
                })

                await waitForUpdate(100)

                const countEl = testContainer.querySelector('.count')
                expect(countEl.textContent).toBe('0')

                // Update store
                wildflower.getStore('counter').increment()
                await waitForUpdate(100)

                expect(countEl.textContent).toBe('1')
            })

            it('should handle nested paths like $store.user.profile.name', async () => {
                wildflower.store('app', {
                    state: {
                        user: {
                            profile: {
                                name: 'Nested Name',
                                settings: {
                                    theme: 'dark'
                                }
                            }
                        }
                    }
                })

                testContainer.innerHTML = `
                    <div data-component="nested-display">
                        <span class="name" data-bind="$app.user.profile.name"></span>
                        <span class="theme" data-bind="$app.user.profile.settings.theme"></span>
                    </div>
                `

                wildflower.component('nested-display', {
                    state: {}
                })

                await waitForUpdate(100)

                expect(testContainer.querySelector('.name').textContent).toBe('Nested Name')
                expect(testContainer.querySelector('.theme').textContent).toBe('dark')
            })
        })

        describe('data-list with $store.path', () => {
            it('should render list from store using $store.path syntax', async () => {
                wildflower.store('todos', {
                    state: {
                        items: [
                            { id: 1, text: 'Task 1' },
                            { id: 2, text: 'Task 2' },
                            { id: 3, text: 'Task 3' }
                        ]
                    }
                })

                testContainer.innerHTML = `
                    <div data-component="todo-list">
                        <div data-list="$todos.items" data-key="id">
                            <template>
                                <div class="todo-item" data-bind="text"></div>
                            </template>
                        </div>
                    </div>
                `

                wildflower.component('todo-list', {
                    state: {}
                })

                await waitForUpdate(100)

                const items = testContainer.querySelectorAll('.todo-item')
                expect(items.length).toBe(3)
                expect(items[0].textContent).toBe('Task 1')
                expect(items[1].textContent).toBe('Task 2')
                expect(items[2].textContent).toBe('Task 3')
            })

            it('should update list when store array changes', async () => {
                wildflower.store('dynamic-list', {
                    state: {
                        items: [{ id: 1, name: 'Initial' }]
                    },
                    addItem(name) {
                        this.state.items = [...this.state.items, { id: Date.now(), name }]
                    }
                })

                testContainer.innerHTML = `
                    <div data-component="dynamic-list-display">
                        <div data-list="$dynamic-list.items" data-key="id">
                            <template>
                                <div class="item" data-bind="name"></div>
                            </template>
                        </div>
                    </div>
                `

                wildflower.component('dynamic-list-display', {
                    state: {}
                })

                await waitForUpdate(100)

                expect(testContainer.querySelectorAll('.item').length).toBe(1)

                wildflower.getStore('dynamic-list').addItem('Added Item')
                await waitForUpdate(100)

                const items = testContainer.querySelectorAll('.item')
                expect(items.length).toBe(2)
                expect(items[1].textContent).toBe('Added Item')
            })
        })

        describe('data-show with $store.path', () => {
            it('should show/hide element based on store boolean', async () => {
                wildflower.store('ui', {
                    state: {
                        isLoading: true,
                        showModal: false
                    }
                })

                testContainer.innerHTML = `
                    <div data-component="conditional-display">
                        <div class="loading" data-show="$ui.isLoading">Loading...</div>
                        <div class="modal" data-show="$ui.showModal">Modal Content</div>
                    </div>
                `

                wildflower.component('conditional-display', {
                    state: {}
                })

                await waitForUpdate(100)

                const loadingEl = testContainer.querySelector('.loading')
                const modalEl = testContainer.querySelector('.modal')

                // isLoading is true, should be visible
                expect(loadingEl.style.display).not.toBe('none')
                // showModal is false, should be hidden
                expect(modalEl.style.display).toBe('none')
            })

            it('should update visibility when store value changes', async () => {
                wildflower.store('toggle', {
                    state: {
                        visible: false
                    },
                    show() {
                        this.state.visible = true
                    }
                })

                testContainer.innerHTML = `
                    <div data-component="toggle-display">
                        <div class="content" data-show="$toggle.visible">Now you see me</div>
                    </div>
                `

                wildflower.component('toggle-display', {
                    state: {}
                })

                await waitForUpdate(100)

                const contentEl = testContainer.querySelector('.content')
                expect(contentEl.style.display).toBe('none')

                wildflower.getStore('toggle').show()
                await waitForUpdate(100)

                expect(contentEl.style.display).not.toBe('none')
            })
        })

        describe('data-render with $store.path', () => {
            it('should render/remove element based on store boolean', async () => {
                wildflower.store('render-test', {
                    state: {
                        shouldRender: true
                    }
                })

                testContainer.innerHTML = `
                    <div data-component="render-display">
                        <div class="rendered" data-render="$render-test.shouldRender">Rendered Content</div>
                    </div>
                `

                wildflower.component('render-display', {
                    state: {}
                })

                await waitForUpdate(100)

                expect(testContainer.querySelector('.rendered')).not.toBeNull()

                // Change store to remove element
                wildflower.getStore('render-test').state.shouldRender = false
                await waitForUpdate(100)

                expect(testContainer.querySelector('.rendered')).toBeNull()
            })
        })

        describe('$store.path in expressions', () => {
            it('should work in conditional expressions', async () => {
                wildflower.store('expr', {
                    state: {
                        count: 5
                    }
                })

                testContainer.innerHTML = `
                    <div data-component="expr-display">
                        <div class="high" data-show="$expr.count > 3">High count</div>
                        <div class="low" data-show="$expr.count <= 3">Low count</div>
                    </div>
                `

                wildflower.component('expr-display', {
                    state: {}
                })

                await waitForUpdate(100)

                expect(testContainer.querySelector('.high').style.display).not.toBe('none')
                expect(testContainer.querySelector('.low').style.display).toBe('none')
            })

            it('should work mixed with local state', async () => {
                wildflower.store('mixed', {
                    state: {
                        multiplier: 2
                    }
                })

                testContainer.innerHTML = `
                    <div data-component="mixed-display">
                        <span class="result" data-bind="computed:result"></span>
                    </div>
                `

                wildflower.component('mixed-display', {
                    state: {
                        baseValue: 10
                    },
                    computed: {
                        result() {
                            const store = wildflower.getStore('mixed')
                            return this.state.baseValue * store.state.multiplier
                        }
                    }
                })

                await waitForUpdate(100)

                expect(testContainer.querySelector('.result').textContent).toBe('20')
            })
        })
    })

    // =========================================================================
    // SECTION 2: subscribe: {} Component Declaration
    // =========================================================================
    describe('subscribe: {} Component Declaration', () => {

        it('should auto-subscribe component to declared store paths', async () => {
            let onStoreUpdateCalls = []

            wildflower.store('sub-test', {
                state: {
                    value: 'initial',
                    count: 0
                }
            })

            testContainer.innerHTML = `
                <div data-component="subscriber">
                    <span class="value" data-bind="localValue"></span>
                </div>
            `

            wildflower.component('subscriber', {
                subscribe: {
                    'sub-test': ['value', 'count']
                },
                state: {
                    localValue: ''
                },
                onStoreUpdate(storeName, path, newValue, oldValue) {
                    onStoreUpdateCalls.push({ storeName, path, newValue, oldValue })
                    if (path === 'value') {
                        this.state.localValue = newValue
                    }
                }
            })

            await waitForUpdate(100)

            // Update store value
            wildflower.getStore('sub-test').state.value = 'updated'
            await waitForUpdate(100)

            // onStoreUpdate should have been called
            expect(onStoreUpdateCalls.length).toBeGreaterThan(0)
            expect(onStoreUpdateCalls.some(c => c.path === 'value' && c.newValue === 'updated')).toBe(true)
        })

        it('should support multiple store subscriptions', async () => {
            let calls = []

            wildflower.store('store-a', {
                state: { dataA: 'A' }
            })

            wildflower.store('store-b', {
                state: { dataB: 'B' }
            })

            testContainer.innerHTML = `
                <div data-component="multi-subscriber"></div>
            `

            wildflower.component('multi-subscriber', {
                subscribe: {
                    'store-a': ['dataA'],
                    'store-b': ['dataB']
                },
                state: {},
                onStoreUpdate(storeName, path, newValue, oldValue) {
                    calls.push({ storeName, path, newValue })
                }
            })

            await waitForUpdate(100)

            wildflower.getStore('store-a').state.dataA = 'A-updated'
            await waitForUpdate(100)

            wildflower.getStore('store-b').state.dataB = 'B-updated'
            await waitForUpdate(100)

            expect(calls.some(c => c.storeName === 'store-a' && c.newValue === 'A-updated')).toBe(true)
            expect(calls.some(c => c.storeName === 'store-b' && c.newValue === 'B-updated')).toBe(true)
        })

        it('should cleanup subscriptions on component destroy', async () => {
            let callCount = 0

            wildflower.store('cleanup-store', {
                state: { value: 'test' }
            })

            testContainer.innerHTML = `
                <div data-component="cleanup-subscriber" id="cleanup-comp"></div>
            `

            wildflower.component('cleanup-subscriber', {
                subscribe: {
                    'cleanup-store': ['value']
                },
                state: {},
                onStoreUpdate(storeName, path, newValue, oldValue) {
                    callCount++
                }
            })

            await waitForUpdate(100)

            // Trigger update
            wildflower.getStore('cleanup-store').state.value = 'changed'
            await waitForUpdate(100)
            const countAfterFirstUpdate = callCount

            // Destroy the component
            const compEl = testContainer.querySelector('#cleanup-comp')
            wildflower.destroyComponent(compEl._componentId)
            testContainer.removeChild(compEl)
            await waitForUpdate(100)

            // Trigger another update - should NOT call onStoreUpdate
            wildflower.getStore('cleanup-store').state.value = 'changed-again'
            await waitForUpdate(100)

            expect(callCount).toBe(countAfterFirstUpdate)
        })

        it('should receive old value in onStoreUpdate callback', async () => {
            let receivedOldValue = null

            wildflower.store('oldval-store', {
                state: { value: 'original' }
            })

            testContainer.innerHTML = `
                <div data-component="oldval-subscriber"></div>
            `

            wildflower.component('oldval-subscriber', {
                subscribe: {
                    'oldval-store': ['value']
                },
                state: {},
                onStoreUpdate(storeName, path, newValue, oldValue) {
                    if (path === 'value') {
                        receivedOldValue = oldValue
                    }
                }
            })

            await waitForUpdate(100)

            wildflower.getStore('oldval-store').state.value = 'new-value'
            await waitForUpdate(100)

            expect(receivedOldValue).toBe('original')
        })
    })

    // =========================================================================
    // SECTION 3: onStoreUpdate() Lifecycle Hook
    // =========================================================================
    describe('onStoreUpdate() Lifecycle Hook', () => {

        it('should call onStoreUpdate when subscribed path changes', async () => {
            const calls = []

            wildflower.store('hook-store', {
                state: {
                    name: 'initial',
                    count: 0
                }
            })

            testContainer.innerHTML = `
                <div data-component="hook-test"></div>
            `

            wildflower.component('hook-test', {
                subscribe: {
                    'hook-store': ['name']
                },
                state: {},
                onStoreUpdate(storeName, path, newValue, oldValue) {
                    calls.push({ storeName, path, newValue, oldValue })
                }
            })

            await waitForUpdate(100)

            wildflower.getStore('hook-store').state.name = 'changed'
            await waitForUpdate(100)

            expect(calls.length).toBe(1)
            expect(calls[0]).toEqual({
                storeName: 'hook-store',
                path: 'name',
                newValue: 'changed',
                oldValue: 'initial'
            })
        })

        it('should NOT call onStoreUpdate for non-subscribed paths', async () => {
            let callCount = 0

            wildflower.store('selective-store', {
                state: {
                    subscribed: 'yes',
                    notSubscribed: 'no'
                }
            })

            testContainer.innerHTML = `
                <div data-component="selective-test"></div>
            `

            wildflower.component('selective-test', {
                subscribe: {
                    'selective-store': ['subscribed']  // Only subscribing to 'subscribed'
                },
                state: {},
                onStoreUpdate(storeName, path, newValue, oldValue) {
                    callCount++
                }
            })

            await waitForUpdate(100)

            // Change non-subscribed path
            wildflower.getStore('selective-store').state.notSubscribed = 'changed'
            await waitForUpdate(100)

            expect(callCount).toBe(0)

            // Change subscribed path
            wildflower.getStore('selective-store').state.subscribed = 'changed'
            await waitForUpdate(100)

            expect(callCount).toBe(1)
        })

        it('should allow component to update its state in onStoreUpdate', async () => {
            wildflower.store('sync-store', {
                state: {
                    externalValue: 'external'
                }
            })

            testContainer.innerHTML = `
                <div data-component="sync-test">
                    <span class="local" data-bind="localValue"></span>
                </div>
            `

            wildflower.component('sync-test', {
                subscribe: {
                    'sync-store': ['externalValue']
                },
                state: {
                    localValue: 'initial'
                },
                onStoreUpdate(storeName, path, newValue, oldValue) {
                    if (path === 'externalValue') {
                        this.state.localValue = `Synced: ${newValue}`
                    }
                }
            })

            await waitForUpdate(100)

            expect(testContainer.querySelector('.local').textContent).toBe('initial')

            wildflower.getStore('sync-store').state.externalValue = 'new-external'
            await waitForUpdate(100)

            expect(testContainer.querySelector('.local').textContent).toBe('Synced: new-external')
        })

        it('should work without subscribe declaration (no crash)', async () => {
            testContainer.innerHTML = `
                <div data-component="no-subscribe">
                    <span data-bind="value"></span>
                </div>
            `

            // Component with onStoreUpdate but no subscribe declaration
            wildflower.component('no-subscribe', {
                state: { value: 'test' },
                onStoreUpdate(storeName, path, newValue, oldValue) {
                    // This should never be called
                }
            })

            await waitForUpdate(100)

            // Should not crash
            expect(testContainer.querySelector('span').textContent).toBe('test')
        })
    })

    // =========================================================================
    // SECTION 4: WF-501 Warning for data-model with $store.path
    // =========================================================================
    describe('WF-501 Warning: data-model with $store.path', () => {

        it.skipIf(isMinifiedBuild())('should log warning when using data-model with $store.path', async () => {
            const warnSpy = vi.spyOn(console, 'warn')

            wildflower.store('model-store', {
                state: {
                    inputValue: 'test'
                }
            })

            testContainer.innerHTML = `
                <div data-component="model-test">
                    <input type="text" data-model="$model-store.inputValue">
                </div>
            `

            wildflower.component('model-test', {
                state: {}
            })

            await waitForUpdate(100)

            // Should have logged WF-501 warning. The wfError helper now
            // emits the code with a leading "WF " prefix (e.g. "[WF WF-501]")
            // and the doc URL on a subsequent line, so we match the bare
            // code substring across any of the warnSpy calls.
            const calls = warnSpy.mock.calls.map(c => c.join(' '))
            expect(calls.some(s => s.includes('WF-501'))).toBe(true)

            warnSpy.mockRestore()
        })

        it('should NOT set up two-way binding for $store.path in data-model', async () => {
            wildflower.store('no-bind-store', {
                state: {
                    value: 'original'
                }
            })

            testContainer.innerHTML = `
                <div data-component="no-bind-test">
                    <input type="text" class="store-input" data-model="$no-bind-store.value">
                </div>
            `

            wildflower.component('no-bind-test', {
                state: {}
            })

            await waitForUpdate(100)

            const input = testContainer.querySelector('.store-input')

            // Simulate user typing
            input.value = 'user-typed'
            input.dispatchEvent(new Event('input', { bubbles: true }))
            await waitForUpdate(100)

            // Store should NOT be updated (data-model with $store is invalid)
            expect(wildflower.getStore('no-bind-store').state.value).toBe('original')
        })
    })

    // =========================================================================
    // SECTION 5: Integration Tests
    // =========================================================================
    describe('Integration: Full Workflow', () => {

        it('should support the edit-modal pattern from design doc', async () => {
            wildflower.store('kanban', {
                state: {
                    editingCard: null
                },
                openEditor(card) {
                    this.state.editingCard = card
                },
                closeEditor() {
                    this.state.editingCard = null
                }
            })

            testContainer.innerHTML = `
                <div data-component="edit-modal">
                    <div class="modal" data-show="$kanban.editingCard">
                        <input type="text" class="title-input" data-model="editTitle">
                        <span class="preview" data-bind="editTitle"></span>
                    </div>
                </div>
            `

            wildflower.component('edit-modal', {
                subscribe: {
                    kanban: ['editingCard']
                },
                state: {
                    editTitle: '',
                    editDescription: '',
                    editPriority: 'medium'
                },
                onStoreUpdate(storeName, path, newValue, oldValue) {
                    if (path === 'editingCard' && newValue) {
                        this.state.editTitle = newValue.title || ''
                        this.state.editDescription = newValue.description || ''
                        this.state.editPriority = newValue.priority || 'medium'
                    }
                }
            })

            await waitForUpdate(100)

            // Modal should be hidden initially
            const modal = testContainer.querySelector('.modal')
            expect(modal.style.display).toBe('none')

            // Open editor with a card
            wildflower.getStore('kanban').openEditor({
                id: 'card-1',
                title: 'Test Card',
                description: 'Test Description',
                priority: 'high'
            })
            await waitForUpdate(100)

            // Modal should be visible
            expect(modal.style.display).not.toBe('none')

            // Component state should be synced from store
            const preview = testContainer.querySelector('.preview')
            expect(preview.textContent).toBe('Test Card')
        })

        it('should support display-only binding without subscribe declaration', async () => {
            // Simple display - no JavaScript subscription needed
            wildflower.store('display-only', {
                state: {
                    message: 'Hello World',
                    count: 42
                }
            })

            testContainer.innerHTML = `
                <div data-component="display-comp">
                    <span class="msg" data-bind="$display-only.message"></span>
                    <span class="cnt" data-bind="$display-only.count"></span>
                </div>
            `

            wildflower.component('display-comp', {
                state: {}
                // No subscribe declaration needed for display-only
            })

            await waitForUpdate(100)

            expect(testContainer.querySelector('.msg').textContent).toBe('Hello World')
            expect(testContainer.querySelector('.cnt').textContent).toBe('42')
        })

        it('should handle rapid store updates without missing any', async () => {
            const receivedUpdates = []

            wildflower.store('rapid', {
                state: { value: 0 }
            })

            testContainer.innerHTML = `
                <div data-component="rapid-test">
                    <span class="value" data-bind="$rapid.value"></span>
                </div>
            `

            wildflower.component('rapid-test', {
                subscribe: {
                    rapid: ['value']
                },
                state: {},
                onStoreUpdate(storeName, path, newValue, oldValue) {
                    receivedUpdates.push(newValue)
                }
            })

            await waitForUpdate(100)

            // Rapid updates
            const store = wildflower.getStore('rapid')
            for (let i = 1; i <= 5; i++) {
                store.state.value = i
            }
            await waitForUpdate(200)

            // All updates should be received (though some may be batched)
            expect(receivedUpdates.includes(5)).toBe(true)
            expect(testContainer.querySelector('.value').textContent).toBe('5')
        })
    })

    // =========================================================================
    // SECTION 6: Edge Cases
    // =========================================================================
    describe('Edge Cases', () => {

        it('should handle store that does not exist (graceful failure)', async () => {
            const warnSpy = vi.spyOn(console, 'warn')

            testContainer.innerHTML = `
                <div data-component="missing-store">
                    <span data-bind="$nonexistent.value"></span>
                </div>
            `

            wildflower.component('missing-store', {
                state: {}
            })

            await waitForUpdate(100)

            // Should not crash, may log warning
            expect(testContainer.querySelector('span').textContent).toBe('')

            warnSpy.mockRestore()
        })

        it('should handle subscribe to non-existent store path', async () => {
            wildflower.store('partial', {
                state: {
                    exists: 'yes'
                }
            })

            testContainer.innerHTML = `
                <div data-component="partial-sub"></div>
            `

            let errorOccurred = false

            wildflower.component('partial-sub', {
                subscribe: {
                    partial: ['doesNotExist']
                },
                state: {},
                onStoreUpdate(storeName, path, newValue, oldValue) {
                    // Should not crash
                }
            })

            try {
                await waitForUpdate(100)
            } catch (e) {
                errorOccurred = true
            }

            expect(errorOccurred).toBe(false)
        })

        it('should prevent re-entrant store updates in onStoreUpdate', async () => {
            let updateCount = 0

            wildflower.store('reentrant', {
                state: { value: 0 }
            })

            testContainer.innerHTML = `
                <div data-component="reentrant-test"></div>
            `

            wildflower.component('reentrant-test', {
                subscribe: {
                    reentrant: ['value']
                },
                state: {},
                onStoreUpdate(storeName, path, newValue, oldValue) {
                    updateCount++
                    // Attempt to trigger re-entrant update
                    if (updateCount < 3) {
                        wildflower.getStore('reentrant').state.value = newValue + 1
                    }
                }
            })

            await waitForUpdate(100)

            // Trigger first update
            wildflower.getStore('reentrant').state.value = 1
            await waitForUpdate(200)

            // Should not have infinite loop - re-entrancy guard should prevent it
            expect(updateCount).toBeLessThan(10)
        })

        it('should defer notifications during computed evaluation', async () => {
            wildflower.store('defer-test', {
                state: {
                    base: 10,
                    multiplier: 2
                }
            })

            let onStoreUpdateCalled = false

            testContainer.innerHTML = `
                <div data-component="defer-comp">
                    <span class="result" data-bind="computed:result"></span>
                </div>
            `

            wildflower.component('defer-comp', {
                subscribe: {
                    'defer-test': ['base', 'multiplier']
                },
                state: {},
                computed: {
                    result() {
                        const store = wildflower.getStore('defer-test')
                        return store.state.base * store.state.multiplier
                    }
                },
                onStoreUpdate(storeName, path, newValue, oldValue) {
                    onStoreUpdateCalled = true
                }
            })

            await waitForUpdate(100)

            expect(testContainer.querySelector('.result').textContent).toBe('20')

            // Update should still work
            wildflower.getStore('defer-test').state.base = 20
            await waitForUpdate(100)

            expect(testContainer.querySelector('.result').textContent).toBe('40')
        })
    })

    // =========================================================================
    // SECTION 7: Backwards Compatibility
    // =========================================================================
    describe('Backwards Compatibility', () => {

        it('external() syntax should continue to work', async () => {
            wildflower.store('compat-store', {
                state: {
                    items: [{ id: 1, name: 'Item 1' }]
                }
            })

            testContainer.innerHTML = `
                <div data-component="compat-test">
                    <div data-list="external('compat-store', 'items')" data-key="id">
                        <template>
                            <div class="item" data-bind="name"></div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('compat-test', {
                state: {}
            })

            await waitForUpdate(100)

            expect(testContainer.querySelectorAll('.item').length).toBe(1)
            expect(testContainer.querySelector('.item').textContent).toBe('Item 1')
        })

        it('manual store.subscribe() in init() should continue to work', async () => {
            let subscribeCallCount = 0

            wildflower.store('manual-store', {
                state: {
                    value: 'initial'
                }
            })

            testContainer.innerHTML = `
                <div data-component="manual-sub">
                    <span class="value" data-bind="localValue"></span>
                </div>
            `

            wildflower.component('manual-sub', {
                state: {
                    localValue: ''
                },
                init() {
                    const store = wildflower.getStore('manual-store')
                    this.state.localValue = store.state.value
                    store.subscribe('value', (newVal) => {
                        subscribeCallCount++
                        this.state.localValue = newVal
                    })
                }
            })

            await waitForUpdate(100)

            expect(testContainer.querySelector('.value').textContent).toBe('initial')

            wildflower.getStore('manual-store').state.value = 'changed'
            await waitForUpdate(100)

            expect(subscribeCallCount).toBe(1)
            expect(testContainer.querySelector('.value').textContent).toBe('changed')
        })

        it('both $store.path and external() can coexist in same component', async () => {
            wildflower.store('coexist-a', {
                state: { valueA: 'A' }
            })

            wildflower.store('coexist-b', {
                state: {
                    items: [{ id: 1, name: 'B1' }]
                }
            })

            testContainer.innerHTML = `
                <div data-component="coexist-test">
                    <span class="a" data-bind="$coexist-a.valueA"></span>
                    <div data-list="external('coexist-b', 'items')" data-key="id">
                        <template>
                            <div class="b" data-bind="name"></div>
                        </template>
                    </div>
                </div>
            `

            wildflower.component('coexist-test', {
                state: {}
            })

            await waitForUpdate(100)

            expect(testContainer.querySelector('.a').textContent).toBe('A')
            expect(testContainer.querySelector('.b').textContent).toBe('B1')
        })
    })
})
