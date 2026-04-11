/**
 * @vitest-environment browser
 *
 * Combinatorial Coverage Tests
 *
 * Systematic tests for all [Binding Type] × [Context] × [Value Source] combinations
 * to catch gaps like the implicit computed issue in list contexts.
 *
 * HIGH Priority Gaps Covered:
 * 1. All binding types × Inside data-render × Computed
 * 2. All binding types × Inside data-show × Computed
 * 3. All binding types × Nested (list+cond) × Computed
 * 4. data-bind-class × List Item × Direct State
 * 5. External references × List contexts
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

describe('HIGH Priority Gap Coverage', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()

        if (wildflower._contextRegistry) {
            wildflower._contextRegistry.contexts?.clear()
            wildflower._contextRegistry.contextsByType?.clear()
            wildflower._contextRegistry.contextsByComponent?.clear()
            wildflower._contextRegistry.dependencies?.clear()
            wildflower._contextRegistry._contextTypeCache?.clear()
            wildflower._contextRegistry._contextModificationCounter = 0
        }

        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
    })

    // ============================================================
    // GAP 1: All binding types × Inside data-render × Computed
    // ============================================================
    describe('Bindings inside data-render with computed', () => {

        it('data-bind with explicit computed inside data-render', async () => {
            wildflower.component('render-text-computed', {
                state: {
                    showContent: true,
                    firstName: 'John',
                    lastName: 'Doe'
                },
                computed: {
                    fullName() {
                        return `${this.state.firstName} ${this.state.lastName}`
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="render-text-computed">
                    <div data-render="showContent">
                        <span id="name" data-bind="computed:fullName"></span>
                    </div>
                </div>
            `
            await waitForUpdate()

            const nameEl = testContainer.querySelector('#name')
            expect(nameEl).not.toBeNull()
            expect(nameEl.textContent).toBe('John Doe')
        })

        it('data-bind with implicit computed inside data-render', async () => {
            wildflower.component('render-text-implicit', {
                state: {
                    showContent: true,
                    prefix: 'Hello'
                },
                computed: {
                    greeting() {
                        return this.state.prefix + ' World'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="render-text-implicit">
                    <div data-render="showContent">
                        <span id="greeting" data-bind="greeting"></span>
                    </div>
                </div>
            `
            await waitForUpdate()

            const greetingEl = testContainer.querySelector('#greeting')
            expect(greetingEl).not.toBeNull()
            expect(greetingEl.textContent).toBe('Hello World')
        })

        it('data-bind-class with explicit computed inside data-render', async () => {
            wildflower.component('render-class-computed', {
                state: {
                    showContent: true,
                    theme: 'dark'
                },
                computed: {
                    themeClass() {
                        return this.state.theme === 'dark' ? 'theme-dark' : 'theme-light'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="render-class-computed">
                    <div data-render="showContent">
                        <div id="box" data-bind-class="computed:themeClass">Box</div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const boxEl = testContainer.querySelector('#box')
            expect(boxEl).not.toBeNull()
            expect(boxEl.classList.contains('theme-dark')).toBe(true)
        })

        it('data-bind-class with implicit computed inside data-render', async () => {
            wildflower.component('render-class-implicit', {
                state: {
                    showContent: true,
                    size: 'large'
                },
                computed: {
                    sizeClass() {
                        return this.state.size === 'large' ? 'size-lg' : 'size-sm'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="render-class-implicit">
                    <div data-render="showContent">
                        <div id="box" data-bind-class="sizeClass">Box</div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const boxEl = testContainer.querySelector('#box')
            expect(boxEl).not.toBeNull()
            expect(boxEl.classList.contains('size-lg')).toBe(true)
        })

        it('data-bind-style with explicit computed inside data-render', async () => {
            wildflower.component('render-style-computed', {
                state: {
                    showContent: true,
                    active: true
                },
                computed: {
                    boxStyle() {
                        return {
                            backgroundColor: this.state.active ? 'green' : 'red'
                        }
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="render-style-computed">
                    <div data-render="showContent">
                        <div id="box" data-bind-style="computed:boxStyle">Box</div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const boxEl = testContainer.querySelector('#box')
            expect(boxEl).not.toBeNull()
            expect(boxEl.style.backgroundColor).toBe('green')
        })

        it('data-bind-style with implicit computed inside data-render', async () => {
            wildflower.component('render-style-implicit', {
                state: {
                    showContent: true,
                    progress: 75
                },
                computed: {
                    progressStyle() {
                        return { width: this.state.progress + '%' }
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="render-style-implicit">
                    <div data-render="showContent">
                        <div id="bar" data-bind-style="progressStyle">Bar</div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const barEl = testContainer.querySelector('#bar')
            expect(barEl).not.toBeNull()
            expect(barEl.style.width).toBe('75%')
        })

        it('data-bind-html with explicit computed inside data-render', async () => {
            wildflower.component('render-html-computed', {
                state: {
                    showContent: true,
                    format: 'bold'
                },
                computed: {
                    formattedContent() {
                        return this.state.format === 'bold'
                            ? '<strong>Bold Text</strong>'
                            : '<em>Italic Text</em>'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="render-html-computed">
                    <div data-render="showContent">
                        <div id="content" data-bind-html="computed:formattedContent"></div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const contentEl = testContainer.querySelector('#content')
            expect(contentEl).not.toBeNull()
            expect(contentEl.innerHTML).toBe('<strong>Bold Text</strong>')
        })

        it('data-bind-html with implicit computed inside data-render', async () => {
            wildflower.component('render-html-implicit', {
                state: {
                    showContent: true,
                    showDetails: true
                },
                computed: {
                    detailsHtml() {
                        return this.state.showDetails
                            ? '<ul><li>Detail 1</li><li>Detail 2</li></ul>'
                            : '<p>No details</p>'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="render-html-implicit">
                    <div data-render="showContent">
                        <div id="details" data-bind-html="detailsHtml"></div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const detailsEl = testContainer.querySelector('#details')
            expect(detailsEl).not.toBeNull()
            expect(detailsEl.innerHTML).toBe('<ul><li>Detail 1</li><li>Detail 2</li></ul>')
        })
    })

    // ============================================================
    // GAP 2: All binding types × Inside data-show × Computed
    // ============================================================
    describe('Bindings inside data-show with computed', () => {

        it('data-bind with explicit computed inside data-show', async () => {
            wildflower.component('show-text-computed', {
                state: {
                    visible: true,
                    count: 5
                },
                computed: {
                    countLabel() {
                        return 'Count: ' + this.state.count
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="show-text-computed">
                    <div data-show="visible">
                        <span id="label" data-bind="computed:countLabel"></span>
                    </div>
                </div>
            `
            await waitForUpdate()

            const labelEl = testContainer.querySelector('#label')
            expect(labelEl).not.toBeNull()
            expect(labelEl.textContent).toBe('Count: 5')
        })

        it('data-bind with implicit computed inside data-show', async () => {
            wildflower.component('show-text-implicit', {
                state: {
                    visible: true,
                    value: 42
                },
                computed: {
                    displayValue() {
                        return 'Value is ' + this.state.value
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="show-text-implicit">
                    <div data-show="visible">
                        <span id="display" data-bind="displayValue"></span>
                    </div>
                </div>
            `
            await waitForUpdate()

            const displayEl = testContainer.querySelector('#display')
            expect(displayEl.textContent).toBe('Value is 42')
        })

        it('data-bind-class with explicit computed inside data-show', async () => {
            wildflower.component('show-class-computed', {
                state: {
                    visible: true,
                    status: 'active'
                },
                computed: {
                    statusClass() {
                        return this.state.status === 'active' ? 'status-active' : 'status-inactive'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="show-class-computed">
                    <div data-show="visible">
                        <div id="badge" data-bind-class="computed:statusClass">Status</div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const badgeEl = testContainer.querySelector('#badge')
            expect(badgeEl.classList.contains('status-active')).toBe(true)
        })

        it('data-bind-class with implicit computed inside data-show', async () => {
            wildflower.component('show-class-implicit', {
                state: {
                    visible: true,
                    priority: 'high'
                },
                computed: {
                    priorityClass() {
                        const classes = { high: 'priority-high', medium: 'priority-medium', low: 'priority-low' }
                        return classes[this.state.priority] || 'priority-none'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="show-class-implicit">
                    <div data-show="visible">
                        <div id="item" data-bind-class="priorityClass">Item</div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const itemEl = testContainer.querySelector('#item')
            expect(itemEl.classList.contains('priority-high')).toBe(true)
        })

        it('data-bind-style with explicit computed inside data-show', async () => {
            wildflower.component('show-style-computed', {
                state: {
                    visible: true,
                    level: 50
                },
                computed: {
                    levelStyle() {
                        return { height: this.state.level + 'px' }
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="show-style-computed">
                    <div data-show="visible">
                        <div id="meter" data-bind-style="computed:levelStyle">Meter</div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const meterEl = testContainer.querySelector('#meter')
            expect(meterEl.style.height).toBe('50px')
        })

        it('data-bind-style with implicit computed inside data-show', async () => {
            wildflower.component('show-style-implicit', {
                state: {
                    visible: true,
                    opacity: 0.8
                },
                computed: {
                    fadeStyle() {
                        return { opacity: String(this.state.opacity) }
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="show-style-implicit">
                    <div data-show="visible">
                        <div id="fader" data-bind-style="fadeStyle">Fader</div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const faderEl = testContainer.querySelector('#fader')
            expect(faderEl.style.opacity).toBe('0.8')
        })

        it('data-bind-html with explicit computed inside data-show', async () => {
            wildflower.component('show-html-computed', {
                state: {
                    visible: true,
                    mode: 'list'
                },
                computed: {
                    contentHtml() {
                        return this.state.mode === 'list'
                            ? '<ol><li>First</li><li>Second</li></ol>'
                            : '<p>Paragraph mode</p>'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="show-html-computed">
                    <div data-show="visible">
                        <div id="content" data-bind-html="computed:contentHtml"></div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const contentEl = testContainer.querySelector('#content')
            expect(contentEl.innerHTML).toBe('<ol><li>First</li><li>Second</li></ol>')
        })

        it('data-bind-html with implicit computed inside data-show', async () => {
            wildflower.component('show-html-implicit', {
                state: {
                    visible: true,
                    useMarkup: true
                },
                computed: {
                    markupContent() {
                        return this.state.useMarkup
                            ? '<span class="highlight">Highlighted</span>'
                            : 'Plain text'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="show-html-implicit">
                    <div data-show="visible">
                        <div id="markup" data-bind-html="markupContent"></div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const markupEl = testContainer.querySelector('#markup')
            expect(markupEl.innerHTML).toBe('<span class="highlight">Highlighted</span>')
        })
    })

    // ============================================================
    // GAP 3: All binding types × Nested (list+cond) × Computed
    // ============================================================
    describe('Nested contexts (list inside conditional) with computed', () => {

        it('data-bind with computed in list inside data-show', async () => {
            wildflower.component('nested-text-computed', {
                state: {
                    visible: true,
                    prefix: 'Item',
                    items: [{ id: 1 }, { id: 2 }, { id: 3 }]
                },
                computed: {
                    labelPrefix() {
                        return this.state.prefix + ': '
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-text-computed">
                    <div data-show="visible">
                        <div data-list="items">
                            <template>
                                <div class="item">
                                    <span class="prefix" data-bind="computed:labelPrefix"></span>
                                    <span class="id" data-bind="id"></span>
                                </div>
                            </template>
                        </div>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            const prefixes = testContainer.querySelectorAll('.prefix')
            expect(prefixes.length).toBe(3)
            expect(prefixes[0].textContent).toBe('Item: ')
            expect(prefixes[1].textContent).toBe('Item: ')
        })

        it('data-bind with implicit computed in list inside data-show', async () => {
            wildflower.component('nested-text-implicit', {
                state: {
                    visible: true,
                    suffix: '!',
                    items: [{ name: 'A' }, { name: 'B' }]
                },
                computed: {
                    nameSuffix() {
                        return this.state.suffix
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-text-implicit">
                    <div data-show="visible">
                        <div data-list="items">
                            <template>
                                <div class="item">
                                    <span class="name" data-bind="name"></span>
                                    <span class="suffix" data-bind="nameSuffix"></span>
                                </div>
                            </template>
                        </div>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            const suffixes = testContainer.querySelectorAll('.suffix')
            expect(suffixes.length).toBe(2)
            expect(suffixes[0].textContent).toBe('!')
        })

        it('data-bind-class with computed in list inside data-show', async () => {
            wildflower.component('nested-class-computed', {
                state: {
                    visible: true,
                    theme: 'dark',
                    items: [{ id: 1 }, { id: 2 }]
                },
                computed: {
                    itemTheme() {
                        return this.state.theme === 'dark' ? 'dark-item' : 'light-item'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-class-computed">
                    <div data-show="visible">
                        <div data-list="items">
                            <template>
                                <div class="item" data-bind-class="computed:itemTheme">
                                    <span data-bind="id"></span>
                                </div>
                            </template>
                        </div>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)
            expect(items[0].classList.contains('dark-item')).toBe(true)
            expect(items[1].classList.contains('dark-item')).toBe(true)
        })

        it('data-bind-class with implicit computed in list inside data-render', async () => {
            wildflower.component('nested-class-render', {
                state: {
                    showList: true,
                    mode: 'compact',
                    items: [{ id: 1 }, { id: 2 }]
                },
                computed: {
                    modeClass() {
                        return this.state.mode === 'compact' ? 'item-compact' : 'item-expanded'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-class-render">
                    <div data-render="showList">
                        <div data-list="items">
                            <template>
                                <div class="item" data-bind-class="modeClass">
                                    <span data-bind="id"></span>
                                </div>
                            </template>
                        </div>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)
            expect(items[0].classList.contains('item-compact')).toBe(true)
        })

        it('data-bind-style with computed in list inside data-show', async () => {
            wildflower.component('nested-style-computed', {
                state: {
                    visible: true,
                    baseWidth: 100,
                    items: [{ factor: 1 }, { factor: 2 }]
                },
                computed: {
                    itemWidth() {
                        return { width: this.state.baseWidth + 'px' }
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-style-computed">
                    <div data-show="visible">
                        <div data-list="items">
                            <template>
                                <div class="item" data-bind-style="computed:itemWidth">
                                    <span data-bind="factor"></span>
                                </div>
                            </template>
                        </div>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)
            expect(items[0].style.width).toBe('100px')
            expect(items[1].style.width).toBe('100px')
        })

        it('data-bind-style with implicit computed in list inside data-render', async () => {
            wildflower.component('nested-style-render', {
                state: {
                    showList: true,
                    bgColor: 'blue',
                    items: [{ id: 1 }, { id: 2 }]
                },
                computed: {
                    itemBg() {
                        return { backgroundColor: this.state.bgColor }
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-style-render">
                    <div data-render="showList">
                        <div data-list="items">
                            <template>
                                <div class="item" data-bind-style="itemBg">
                                    <span data-bind="id"></span>
                                </div>
                            </template>
                        </div>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(2)
            expect(items[0].style.backgroundColor).toBe('blue')
        })

        it('data-bind-html with computed in list inside data-show', async () => {
            wildflower.component('nested-html-computed', {
                state: {
                    visible: true,
                    format: 'strong',
                    items: [{ label: 'A' }, { label: 'B' }]
                },
                computed: {
                    formattedLabel() {
                        return this.state.format === 'strong' ? '<strong>Label</strong>' : '<em>Label</em>'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-html-computed">
                    <div data-show="visible">
                        <div data-list="items">
                            <template>
                                <div class="item">
                                    <span class="label" data-bind-html="computed:formattedLabel"></span>
                                </div>
                            </template>
                        </div>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            const labels = testContainer.querySelectorAll('.label')
            expect(labels.length).toBe(2)
            expect(labels[0].innerHTML).toBe('<strong>Label</strong>')
        })

        it('data-bind-html with implicit computed in list inside data-render', async () => {
            wildflower.component('nested-html-render', {
                state: {
                    showList: true,
                    useIcons: true,
                    items: [{ id: 1 }, { id: 2 }]
                },
                computed: {
                    iconHtml() {
                        return this.state.useIcons ? '<span class="icon">★</span>' : ''
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="nested-html-render">
                    <div data-render="showList">
                        <div data-list="items">
                            <template>
                                <div class="item">
                                    <span class="icon-slot" data-bind-html="iconHtml"></span>
                                    <span data-bind="id"></span>
                                </div>
                            </template>
                        </div>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            const iconSlots = testContainer.querySelectorAll('.icon-slot')
            expect(iconSlots.length).toBe(2)
            expect(iconSlots[0].innerHTML).toBe('<span class="icon">★</span>')
        })
    })

    // ============================================================
    // GAP 4: data-bind-class × List Item × Direct State
    // ============================================================
    describe('data-bind-class with direct state in list', () => {

        it('should bind class from direct item property', async () => {
            wildflower.component('list-class-direct', {
                state: {
                    items: [
                        { name: 'A', className: 'type-a' },
                        { name: 'B', className: 'type-b' },
                        { name: 'C', className: 'type-c' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="list-class-direct">
                    <div data-list="items">
                        <template>
                            <div class="item" data-bind-class="className">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `
            await waitForUpdate()

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(3)
            expect(items[0].classList.contains('type-a')).toBe(true)
            expect(items[1].classList.contains('type-b')).toBe(true)
            expect(items[2].classList.contains('type-c')).toBe(true)
        })

        it('should update class when item property changes', async () => {
            let componentInstance
            wildflower.component('list-class-update', {
                state: {
                    items: [
                        { name: 'A', status: 'pending' },
                        { name: 'B', status: 'done' }
                    ]
                },
                init() {
                    componentInstance = this
                }
            })

            testContainer.innerHTML = `
                <div data-component="list-class-update">
                    <div data-list="items">
                        <template>
                            <div class="item" data-bind-class="status">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `
            await waitForUpdate()

            let items = testContainer.querySelectorAll('.item')
            expect(items[0].classList.contains('pending')).toBe(true)

            // Update the first item's status
            componentInstance.state.items[0].status = 'done'
            await waitForUpdate()

            items = testContainer.querySelectorAll('.item')
            expect(items[0].classList.contains('done')).toBe(true)
            expect(items[0].classList.contains('pending')).toBe(false)
        })
    })

    // ============================================================
    // GAP 5: External references × List contexts
    // ============================================================
    describe('External references in list contexts', () => {

        it('should access external state via external() in list item binding', async () => {
            // Parent component with theme
            wildflower.component('theme-provider', {
                state: {
                    theme: 'dark',
                    accentColor: 'blue'
                }
            })

            // Child component with list
            wildflower.component('themed-list', {
                state: {
                    items: [
                        { id: 1, name: 'Item 1' },
                        { id: 2, name: 'Item 2' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="theme-provider">
                    <div data-component="themed-list">
                        <div data-list="items">
                            <template>
                                <div class="item">
                                    <span class="name" data-bind="name"></span>
                                    <span class="theme" data-bind="external('theme-provider', 'theme')"></span>
                                </div>
                            </template>
                        </div>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            const themes = testContainer.querySelectorAll('.theme')
            expect(themes.length).toBe(2)
            expect(themes[0].textContent).toBe('dark')
            expect(themes[1].textContent).toBe('dark')
        })

        it('should access external computed in list item', async () => {
            wildflower.component('settings-provider', {
                state: {
                    locale: 'en'
                },
                computed: {
                    localeLabel() {
                        return this.state.locale === 'en' ? 'English' : 'Other'
                    }
                }
            })

            wildflower.component('localized-list', {
                state: {
                    messages: [
                        { key: 'hello' },
                        { key: 'goodbye' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="settings-provider">
                    <div data-component="localized-list">
                        <div data-list="messages">
                            <template>
                                <div class="message">
                                    <span class="key" data-bind="key"></span>
                                    <span class="locale" data-bind="external('settings-provider', 'computed:localeLabel')"></span>
                                </div>
                            </template>
                        </div>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            const locales = testContainer.querySelectorAll('.locale')
            expect(locales.length).toBe(2)
            expect(locales[0].textContent).toBe('English')
        })

        it('should update list items when external state changes', async () => {
            let providerInstance
            wildflower.component('counter-provider', {
                state: {
                    count: 0
                },
                init() {
                    providerInstance = this
                },
                increment() {
                    this.state.count++
                }
            })

            wildflower.component('count-display-list', {
                state: {
                    displays: [{ label: 'Display 1' }, { label: 'Display 2' }]
                }
            })

            testContainer.innerHTML = `
                <div data-component="counter-provider">
                    <div data-component="count-display-list">
                        <div data-list="displays">
                            <template>
                                <div class="display">
                                    <span class="label" data-bind="label"></span>
                                    <span class="count" data-bind="external('counter-provider', 'count')"></span>
                                </div>
                            </template>
                        </div>
                    </div>
                </div>
            `
            await waitForUpdate(100)

            let counts = testContainer.querySelectorAll('.count')
            expect(counts[0].textContent).toBe('0')
            expect(counts[1].textContent).toBe('0')

            // Update external state
            providerInstance.state.count = 5
            await waitForUpdate()

            counts = testContainer.querySelectorAll('.count')
            expect(counts[0].textContent).toBe('5')
            expect(counts[1].textContent).toBe('5')
        })
    })
})

// ============================================================
// MEDIUM Priority Gap Coverage
// ============================================================
describe('MEDIUM Priority Gap Coverage', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()

        if (wildflower._contextRegistry) {
            wildflower._contextRegistry.contexts?.clear()
            wildflower._contextRegistry.contextsByType?.clear()
            wildflower._contextRegistry.contextsByComponent?.clear()
            wildflower._contextRegistry.dependencies?.clear()
            wildflower._contextRegistry._contextTypeCache?.clear()
            wildflower._contextRegistry._contextModificationCounter = 0
        }

        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
    })

    // ============================================================
    // Nested property bindings inside data-show/data-render
    // ============================================================
    describe('Nested property bindings in conditional contexts', () => {

        it('data-bind with nested property inside data-show', async () => {
            wildflower.component('show-nested-text', {
                state: {
                    visible: true,
                    user: {
                        profile: {
                            name: 'John Doe'
                        }
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="show-nested-text">
                    <div data-show="visible">
                        <span id="name" data-bind="user.profile.name"></span>
                    </div>
                </div>
            `
            await waitForUpdate()

            const nameEl = testContainer.querySelector('#name')
            expect(nameEl.textContent).toBe('John Doe')
        })

        it('data-bind with nested property inside data-render', async () => {
            wildflower.component('render-nested-text', {
                state: {
                    showContent: true,
                    config: {
                        settings: {
                            title: 'My Title'
                        }
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="render-nested-text">
                    <div data-render="showContent">
                        <h1 id="title" data-bind="config.settings.title"></h1>
                    </div>
                </div>
            `
            await waitForUpdate()

            const titleEl = testContainer.querySelector('#title')
            expect(titleEl).not.toBeNull()
            expect(titleEl.textContent).toBe('My Title')
        })

        it('data-bind-class with nested property inside data-show', async () => {
            wildflower.component('show-nested-class', {
                state: {
                    visible: true,
                    theme: {
                        colors: {
                            primary: 'blue-theme'
                        }
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="show-nested-class">
                    <div data-show="visible">
                        <div id="box" data-bind-class="theme.colors.primary">Box</div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const boxEl = testContainer.querySelector('#box')
            expect(boxEl.classList.contains('blue-theme')).toBe(true)
        })

        it('data-bind-class with nested property inside data-render', async () => {
            wildflower.component('render-nested-class', {
                state: {
                    showContent: true,
                    styles: {
                        card: {
                            variant: 'card-primary'
                        }
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="render-nested-class">
                    <div data-render="showContent">
                        <div id="card" data-bind-class="styles.card.variant">Card</div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const cardEl = testContainer.querySelector('#card')
            expect(cardEl).not.toBeNull()
            expect(cardEl.classList.contains('card-primary')).toBe(true)
        })

        it('data-bind-style with nested property inside data-show', async () => {
            wildflower.component('show-nested-style', {
                state: {
                    visible: true,
                    layout: {
                        dimensions: {
                            width: '200px'
                        }
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="show-nested-style">
                    <div data-show="visible">
                        <div id="box" data-bind-style="layout.dimensions">Box</div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const boxEl = testContainer.querySelector('#box')
            expect(boxEl.style.width).toBe('200px')
        })

        it('data-bind-style with nested property inside data-render', async () => {
            wildflower.component('render-nested-style', {
                state: {
                    showContent: true,
                    appearance: {
                        box: {
                            height: '100px',
                            backgroundColor: 'red'
                        }
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="render-nested-style">
                    <div data-render="showContent">
                        <div id="box" data-bind-style="appearance.box">Box</div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const boxEl = testContainer.querySelector('#box')
            expect(boxEl).not.toBeNull()
            expect(boxEl.style.height).toBe('100px')
            expect(boxEl.style.backgroundColor).toBe('red')
        })

        it('data-bind-html with nested property inside data-show', async () => {
            wildflower.component('show-nested-html', {
                state: {
                    visible: true,
                    content: {
                        sections: {
                            intro: '<p>Welcome!</p>'
                        }
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="show-nested-html">
                    <div data-show="visible">
                        <div id="intro" data-bind-html="content.sections.intro"></div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const introEl = testContainer.querySelector('#intro')
            expect(introEl.innerHTML).toBe('<p>Welcome!</p>')
        })

        it('data-bind-html with nested property inside data-render', async () => {
            wildflower.component('render-nested-html', {
                state: {
                    showContent: true,
                    templates: {
                        footer: {
                            html: '<footer>Copyright 2025</footer>'
                        }
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="render-nested-html">
                    <div data-render="showContent">
                        <div id="footer" data-bind-html="templates.footer.html"></div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const footerEl = testContainer.querySelector('#footer')
            expect(footerEl).not.toBeNull()
            expect(footerEl.innerHTML).toBe('<footer>Copyright 2025</footer>')
        })
    })

    // ============================================================
    // Expression bindings inside data-show/data-render
    // ============================================================
    describe('Expression bindings in conditional contexts', () => {

        it('data-bind with ternary expression inside data-show', async () => {
            wildflower.component('show-expr-text', {
                state: {
                    visible: true,
                    score: 85
                }
            })

            testContainer.innerHTML = `
                <div data-component="show-expr-text">
                    <div data-show="visible">
                        <span id="grade" data-bind="score >= 70 ? 'Pass' : 'Fail'"></span>
                    </div>
                </div>
            `
            await waitForUpdate()

            const gradeEl = testContainer.querySelector('#grade')
            expect(gradeEl.textContent).toBe('Pass')
        })

        it('data-bind with ternary expression inside data-render', async () => {
            wildflower.component('render-expr-text', {
                state: {
                    showContent: true,
                    count: 0
                }
            })

            testContainer.innerHTML = `
                <div data-component="render-expr-text">
                    <div data-render="showContent">
                        <span id="status" data-bind="count > 0 ? 'Has items' : 'Empty'"></span>
                    </div>
                </div>
            `
            await waitForUpdate()

            const statusEl = testContainer.querySelector('#status')
            expect(statusEl).not.toBeNull()
            expect(statusEl.textContent).toBe('Empty')
        })

        it('data-bind with math expression inside data-show', async () => {
            wildflower.component('show-math-text', {
                state: {
                    visible: true,
                    price: 100,
                    quantity: 3
                }
            })

            testContainer.innerHTML = `
                <div data-component="show-math-text">
                    <div data-show="visible">
                        <span id="total" data-bind="price * quantity"></span>
                    </div>
                </div>
            `
            await waitForUpdate()

            const totalEl = testContainer.querySelector('#total')
            expect(totalEl.textContent).toBe('300')
        })

        it('data-bind with string concatenation inside data-render', async () => {
            wildflower.component('render-concat-text', {
                state: {
                    showContent: true,
                    firstName: 'Jane',
                    lastName: 'Smith'
                }
            })

            testContainer.innerHTML = `
                <div data-component="render-concat-text">
                    <div data-render="showContent">
                        <span id="fullname" data-bind="firstName + ' ' + lastName"></span>
                    </div>
                </div>
            `
            await waitForUpdate()

            const fullnameEl = testContainer.querySelector('#fullname')
            expect(fullnameEl).not.toBeNull()
            expect(fullnameEl.textContent).toBe('Jane Smith')
        })

        it('data-bind-class with ternary expression inside data-show', async () => {
            wildflower.component('show-expr-class', {
                state: {
                    visible: true,
                    isActive: true
                }
            })

            testContainer.innerHTML = `
                <div data-component="show-expr-class">
                    <div data-show="visible">
                        <div id="toggle" data-bind-class="isActive ? 'active' : 'inactive'">Toggle</div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const toggleEl = testContainer.querySelector('#toggle')
            expect(toggleEl.classList.contains('active')).toBe(true)
        })

        it('data-bind-class with ternary expression inside data-render', async () => {
            wildflower.component('render-expr-class', {
                state: {
                    showContent: true,
                    status: 'error'
                }
            })

            testContainer.innerHTML = `
                <div data-component="render-expr-class">
                    <div data-render="showContent">
                        <div id="alert" data-bind-class="status === 'error' ? 'alert-danger' : 'alert-info'">Alert</div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const alertEl = testContainer.querySelector('#alert')
            expect(alertEl).not.toBeNull()
            expect(alertEl.classList.contains('alert-danger')).toBe(true)
        })
    })

    // ============================================================
    // Direct state bindings inside conditionals (basic coverage)
    // ============================================================
    describe('Direct state bindings in conditional contexts', () => {

        it('data-bind-style with direct style object inside data-show', async () => {
            wildflower.component('show-direct-style', {
                state: {
                    visible: true,
                    boxStyle: {
                        width: '150px',
                        height: '75px'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="show-direct-style">
                    <div data-show="visible">
                        <div id="box" data-bind-style="boxStyle">Box</div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const boxEl = testContainer.querySelector('#box')
            expect(boxEl.style.width).toBe('150px')
            expect(boxEl.style.height).toBe('75px')
        })

        it('data-bind-style with direct style object inside data-render', async () => {
            wildflower.component('render-direct-style', {
                state: {
                    showContent: true,
                    cardStyle: {
                        padding: '20px',
                        margin: '10px'
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="render-direct-style">
                    <div data-render="showContent">
                        <div id="card" data-bind-style="cardStyle">Card</div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const cardEl = testContainer.querySelector('#card')
            expect(cardEl).not.toBeNull()
            expect(cardEl.style.padding).toBe('20px')
            expect(cardEl.style.margin).toBe('10px')
        })

        it('data-bind-html with direct HTML string inside data-show', async () => {
            wildflower.component('show-direct-html', {
                state: {
                    visible: true,
                    richContent: '<strong>Bold</strong> and <em>italic</em>'
                }
            })

            testContainer.innerHTML = `
                <div data-component="show-direct-html">
                    <div data-show="visible">
                        <div id="content" data-bind-html="richContent"></div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const contentEl = testContainer.querySelector('#content')
            expect(contentEl.innerHTML).toBe('<strong>Bold</strong> and <em>italic</em>')
        })

        it('data-bind-html with direct HTML string inside data-render', async () => {
            wildflower.component('render-direct-html', {
                state: {
                    showContent: true,
                    markup: '<ul><li>One</li><li>Two</li></ul>'
                }
            })

            testContainer.innerHTML = `
                <div data-component="render-direct-html">
                    <div data-render="showContent">
                        <div id="list" data-bind-html="markup"></div>
                    </div>
                </div>
            `
            await waitForUpdate()

            const listEl = testContainer.querySelector('#list')
            expect(listEl).not.toBeNull()
            expect(listEl.innerHTML).toBe('<ul><li>One</li><li>Two</li></ul>')
        })
    })

    // ============================================================
    // Reactivity: bindings update when conditional becomes visible
    // ============================================================
    describe('Reactivity when conditional becomes visible', () => {

        it('data-bind updates when data-show becomes true', async () => {
            let componentInstance
            wildflower.component('show-reactive-text', {
                state: {
                    visible: false,
                    message: 'Initial'
                },
                init() {
                    componentInstance = this
                }
            })

            testContainer.innerHTML = `
                <div data-component="show-reactive-text">
                    <div data-show="visible">
                        <span id="msg" data-bind="message"></span>
                    </div>
                </div>
            `
            await waitForUpdate()

            // Initially hidden
            const section = testContainer.querySelector('[data-show="visible"]')
            expect(section.style.display).toBe('none')

            // Update message while hidden
            componentInstance.state.message = 'Updated'
            await waitForUpdate()

            // Show the section
            componentInstance.state.visible = true
            await waitForUpdate()

            const msgEl = testContainer.querySelector('#msg')
            expect(msgEl.textContent).toBe('Updated')
        })

        it('data-bind-class updates when data-render becomes true', async () => {
            let componentInstance
            wildflower.component('render-reactive-class', {
                state: {
                    showContent: false,
                    statusClass: 'pending'
                },
                init() {
                    componentInstance = this
                }
            })

            testContainer.innerHTML = `
                <div data-component="render-reactive-class">
                    <div data-render="showContent">
                        <div id="status" data-bind-class="statusClass">Status</div>
                    </div>
                </div>
            `
            await waitForUpdate()

            // Initially not rendered
            expect(testContainer.querySelector('#status')).toBeNull()

            // Update class while not rendered
            componentInstance.state.statusClass = 'completed'
            await waitForUpdate()

            // Render the section
            componentInstance.state.showContent = true
            await waitForUpdate()

            const statusEl = testContainer.querySelector('#status')
            expect(statusEl).not.toBeNull()
            expect(statusEl.classList.contains('completed')).toBe(true)
        })

        it('computed updates inside data-show when dependency changes', async () => {
            let componentInstance
            wildflower.component('show-computed-reactive', {
                state: {
                    visible: true,
                    count: 5
                },
                computed: {
                    doubled() {
                        return this.state.count * 2
                    }
                },
                init() {
                    componentInstance = this
                }
            })

            testContainer.innerHTML = `
                <div data-component="show-computed-reactive">
                    <div data-show="visible">
                        <span id="result" data-bind="computed:doubled"></span>
                    </div>
                </div>
            `
            await waitForUpdate()

            let resultEl = testContainer.querySelector('#result')
            expect(resultEl.textContent).toBe('10')

            // Update dependency
            componentInstance.state.count = 7
            await waitForUpdate()

            resultEl = testContainer.querySelector('#result')
            expect(resultEl.textContent).toBe('14')
        })
    })

    // ============================================================
    // List item direct state bindings (gap coverage)
    // ============================================================
    describe('List item direct state bindings', () => {

        it('data-bind-style with direct style object in list item', async () => {
            wildflower.component('list-direct-style', {
                state: {
                    items: [
                        { name: 'A', itemStyle: { backgroundColor: 'red' } },
                        { name: 'B', itemStyle: { backgroundColor: 'blue' } },
                        { name: 'C', itemStyle: { backgroundColor: 'green' } }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="list-direct-style">
                    <div data-list="items">
                        <template>
                            <div class="item" data-bind-style="itemStyle">
                                <span data-bind="name"></span>
                            </div>
                        </template>
                    </div>
                </div>
            `
            await waitForUpdate()

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(3)
            expect(items[0].style.backgroundColor).toBe('red')
            expect(items[1].style.backgroundColor).toBe('blue')
            expect(items[2].style.backgroundColor).toBe('green')
        })

        it('data-bind-html with direct HTML string in list item', async () => {
            wildflower.component('list-direct-html', {
                state: {
                    items: [
                        { content: '<strong>Bold A</strong>' },
                        { content: '<em>Italic B</em>' },
                        { content: '<u>Underline C</u>' }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="list-direct-html">
                    <div data-list="items">
                        <template>
                            <div class="item" data-bind-html="content"></div>
                        </template>
                    </div>
                </div>
            `
            await waitForUpdate()

            const items = testContainer.querySelectorAll('.item')
            expect(items.length).toBe(3)
            expect(items[0].innerHTML).toBe('<strong>Bold A</strong>')
            expect(items[1].innerHTML).toBe('<em>Italic B</em>')
            expect(items[2].innerHTML).toBe('<u>Underline C</u>')
        })
    })
})
