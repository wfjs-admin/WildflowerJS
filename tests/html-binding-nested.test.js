/**
 * HTML Binding Nested Property Tests
 *
 * Tests that data-bind-html works correctly with nested property paths
 * in both regular lists and computed lists.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForCompleteRender() {
    if (window.wildflower?._forceCompleteRender) {
        await window.wildflower._forceCompleteRender()
    }
    await new Promise(resolve => setTimeout(resolve, 50))
}

describe('HTML Binding Nested Properties', () => {
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
        testContainer = null
    })

    describe('Regular Lists - Nested HTML Properties', () => {
        it('should render HTML from nested property path', async () => {
            wildflower.component('html-nested-regular', {
                state: {
                    articles: [
                        {
                            id: 1,
                            title: 'Article 1',
                            content: {
                                body: '<p>First paragraph</p><p>Second paragraph</p>'
                            }
                        },
                        {
                            id: 2,
                            title: 'Article 2',
                            content: {
                                body: '<strong>Bold text</strong> and <em>italic text</em>'
                            }
                        }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="html-nested-regular">
                    <div data-list="articles">
                        <template>
                            <article class="article">
                                <h2 data-bind="title"></h2>
                                <div class="article-body" data-bind-html="content.body"></div>
                            </article>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const articles = testContainer.querySelectorAll('.article')
            expect(articles.length).toBe(2)

            // First article
            const body1 = articles[0].querySelector('.article-body')
            expect(body1.innerHTML).toBe('<p>First paragraph</p><p>Second paragraph</p>')
            expect(body1.querySelectorAll('p').length).toBe(2)

            // Second article
            const body2 = articles[1].querySelector('.article-body')
            expect(body2.querySelector('strong').textContent).toBe('Bold text')
            expect(body2.querySelector('em').textContent).toBe('italic text')
        })

        it('should render HTML from deeply nested property path', async () => {
            wildflower.component('html-deep-nested', {
                state: {
                    posts: [
                        {
                            id: 1,
                            meta: {
                                formatting: {
                                    richText: '<ul><li>Item 1</li><li>Item 2</li></ul>'
                                }
                            }
                        }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="html-deep-nested">
                    <div data-list="posts">
                        <template>
                            <div class="post">
                                <div class="post-content" data-bind-html="meta.formatting.richText"></div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const content = testContainer.querySelector('.post-content')
            expect(content.querySelector('ul')).not.toBeNull()
            expect(content.querySelectorAll('li').length).toBe(2)
        })

        it('should update HTML when nested property changes', async () => {
            wildflower.component('html-nested-update', {
                state: {
                    cards: [
                        {
                            id: 1,
                            display: {
                                htmlContent: '<span class="badge">Original</span>'
                            }
                        }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="html-nested-update">
                    <div data-list="cards">
                        <template>
                            <div class="card">
                                <div class="card-html" data-bind-html="display.htmlContent"></div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="html-nested-update"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            let cardHtml = testContainer.querySelector('.card-html')
            expect(cardHtml.querySelector('.badge').textContent).toBe('Original')

            // Update via array reassignment
            instance.state.cards = [
                {
                    id: 1,
                    display: {
                        htmlContent: '<span class="badge updated">Updated</span>'
                    }
                }
            ]
            await waitForCompleteRender()

            cardHtml = testContainer.querySelector('.card-html')
            const badge = cardHtml.querySelector('.badge')
            expect(badge.textContent).toBe('Updated')
            expect(badge.classList.contains('updated')).toBe(true)
        })
    })

    describe('Computed Lists - Nested HTML Properties', () => {
        it('should render HTML from nested property in computed list', async () => {
            wildflower.component('html-nested-computed', {
                state: {
                    messages: [
                        {
                            id: 1,
                            data: { formattedText: '<b>Important:</b> Read this!' },
                            pinned: true
                        },
                        {
                            id: 2,
                            data: { formattedText: '<i>Note:</i> FYI' },
                            pinned: false
                        },
                        {
                            id: 3,
                            data: { formattedText: '<u>Update:</u> New version' },
                            pinned: true
                        }
                    ]
                },
                computed: {
                    pinnedMessages() {
                        return this.state.messages.filter(m => m.pinned)
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="html-nested-computed">
                    <div data-list="computed:pinnedMessages">
                        <template>
                            <div class="message">
                                <div class="message-text" data-bind-html="data.formattedText"></div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const messages = testContainer.querySelectorAll('.message')
            expect(messages.length).toBe(2) // Only pinned

            // First pinned message
            const text1 = messages[0].querySelector('.message-text')
            expect(text1.querySelector('b').textContent).toBe('Important:')

            // Second pinned message
            const text2 = messages[1].querySelector('.message-text')
            expect(text2.querySelector('u').textContent).toBe('Update:')
        })

        it('should render HTML from deeply nested property in computed list', async () => {
            wildflower.component('html-deep-computed', {
                state: {
                    notifications: [
                        {
                            id: 1,
                            active: true,
                            details: {
                                rendering: {
                                    html: '<div class="alert"><span class="icon">!</span> Alert message</div>'
                                }
                            }
                        },
                        {
                            id: 2,
                            active: false,
                            details: {
                                rendering: {
                                    html: '<div class="info">Info</div>'
                                }
                            }
                        }
                    ]
                },
                computed: {
                    activeNotifications() {
                        return this.state.notifications.filter(n => n.active)
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="html-deep-computed">
                    <div data-list="computed:activeNotifications">
                        <template>
                            <div class="notification">
                                <div class="notification-content" data-bind-html="details.rendering.html"></div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const notifications = testContainer.querySelectorAll('.notification')
            expect(notifications.length).toBe(1) // Only active

            const content = notifications[0].querySelector('.notification-content')
            expect(content.querySelector('.alert')).not.toBeNull()
            expect(content.querySelector('.icon').textContent).toBe('!')
        })

        it('should update nested HTML property in computed list', async () => {
            wildflower.component('html-nested-computed-update', {
                state: {
                    comments: [
                        {
                            id: 1,
                            visible: true,
                            content: {
                                rendered: '<p>Original comment</p>'
                            }
                        }
                    ]
                },
                computed: {
                    visibleComments() {
                        return this.state.comments.filter(c => c.visible)
                    }
                }
            })

            testContainer.innerHTML = `
                <div data-component="html-nested-computed-update">
                    <div data-list="computed:visibleComments">
                        <template>
                            <div class="comment">
                                <div class="comment-body" data-bind-html="content.rendered"></div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const component = testContainer.querySelector('[data-component="html-nested-computed-update"]')
            const instance = wildflower.componentInstances.get(component.dataset.componentId)

            let commentBody = testContainer.querySelector('.comment-body')
            expect(commentBody.querySelector('p').textContent).toBe('Original comment')

            // Update via array reassignment
            instance.state.comments = [
                {
                    id: 1,
                    visible: true,
                    content: {
                        rendered: '<p class="edited">Edited comment</p>'
                    }
                }
            ]
            await waitForCompleteRender()

            commentBody = testContainer.querySelector('.comment-body')
            const p = commentBody.querySelector('p')
            expect(p.textContent).toBe('Edited comment')
            expect(p.classList.contains('edited')).toBe(true)
        })
    })

    describe('Edge Cases', () => {
        it('should handle empty nested HTML property', async () => {
            wildflower.component('html-nested-empty', {
                state: {
                    items: [
                        { id: 1, data: { html: '' } },
                        { id: 2, data: { html: '<span>Has content</span>' } }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="html-nested-empty">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <div class="item-html" data-bind-html="data.html"></div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const htmlDivs = testContainer.querySelectorAll('.item-html')
            expect(htmlDivs[0].innerHTML).toBe('')
            expect(htmlDivs[1].innerHTML).toBe('<span>Has content</span>')
        })

        it('should handle null nested HTML property', async () => {
            wildflower.component('html-nested-null', {
                state: {
                    items: [
                        { id: 1, data: { html: null } },
                        { id: 2, data: { html: '<div>Valid</div>' } }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="html-nested-null">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <div class="item-html" data-bind-html="data.html"></div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const htmlDivs = testContainer.querySelectorAll('.item-html')
            expect(htmlDivs[0].innerHTML).toBe('')
            expect(htmlDivs[1].innerHTML).toBe('<div>Valid</div>')
        })

        it('should handle missing nested property gracefully', async () => {
            wildflower.component('html-nested-missing', {
                state: {
                    items: [
                        { id: 1, data: {} }, // Missing 'html' property
                        { id: 2, data: { html: '<span>Exists</span>' } }
                    ]
                }
            })

            testContainer.innerHTML = `
                <div data-component="html-nested-missing">
                    <div data-list="items">
                        <template>
                            <div class="item">
                                <div class="item-html" data-bind-html="data.html"></div>
                            </div>
                        </template>
                    </div>
                </div>
            `

            wildflower.scan()
            await waitForCompleteRender()

            const htmlDivs = testContainer.querySelectorAll('.item-html')
            expect(htmlDivs[0].innerHTML).toBe('')
            expect(htmlDivs[1].innerHTML).toBe('<span>Exists</span>')
        })
    })
})
