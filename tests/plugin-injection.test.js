/**
 * Plugin Service Provider Tests - Vitest Browser Mode
 *
 * Tests for the WildflowerJS provide/uses system.
 * Phase 3 of the plugin system implementation.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { loadFramework, resetFramework, hasConsoleWarnings, hasFeature } from './helpers/load-framework.js'

// Skip warning tests in minified builds (console.warn is stripped)
const itIfWarnings = hasConsoleWarnings() ? it : it.skip

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

const describeIfPlugins = hasFeature('plugins') ? describe : describe.skip

describeIfPlugins('Plugin Service Providers', () => {
    let testContainer
    let wildflower

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()

        // Reset plugin system state
        if (wildflower._plugins) wildflower._plugins = []
        if (wildflower._pluginsByName) wildflower._pluginsByName.clear()
        if (wildflower._customDirectives) wildflower._customDirectives.clear()
        if (wildflower._globalMixins) wildflower._globalMixins = {}
        if (wildflower._hooks) wildflower._hooks.clear()
        if (wildflower._providers) wildflower._providers = new Map()

        // Create a fresh test container
        testContainer = document.createElement('div')
        testContainer.id = 'test-container'
        testContainer.style.position = 'absolute'
        testContainer.style.left = '-9999px'
        testContainer.style.opacity = '0'
        document.body.appendChild(testContainer)
    })

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer)
        }
    })

    // Helper to wait for component initialization (including deferred init())
    const waitForComponent = async (selector, timeout = 2000) => {
        const start = Date.now()
        while (Date.now() - start < timeout) {
            const el = document.querySelector(selector)
            if (el && el.dataset.componentId) {
                const instance = wildflower.componentInstances.get(el.dataset.componentId)
                if (instance) {
                    // Wait for deferred init() to complete (runs via setTimeout(0))
                    await new Promise(resolve => setTimeout(resolve, 0))
                    return instance
                }
            }
            await new Promise(resolve => setTimeout(resolve, 10))
        }
        throw new Error(`Component ${selector} failed to initialize within ${timeout}ms`)
    }

    describe('wildflower.provide()', () => {
        it('should register a service provider', () => {
            const httpService = { get: vi.fn() }

            wildflower.provide('http', httpService)

            expect(wildflower._providers.has('http')).toBe(true)
        })

        it('should store the provided value', () => {
            const config = { apiUrl: '/api', timeout: 5000 }

            wildflower.provide('config', config)

            expect(wildflower._providers.get('config')).toBe(config)
        })

        it('should return wildflower instance for chaining', () => {
            const result = wildflower.provide('test', {})

            expect(result).toBe(wildflower)
        })

        it('should allow overwriting existing provider', () => {
            wildflower.provide('service', { version: 1 })
            wildflower.provide('service', { version: 2 })

            expect(wildflower._providers.get('service').version).toBe(2)
        })

        it('should throw for invalid key', () => {
            expect(() => wildflower.provide('', {})).toThrow()
            expect(() => wildflower.provide(null, {})).toThrow()
        })
    })

    describe('Component uses', () => {
        it('should provide services to component via uses', async () => {
            const httpService = { get: vi.fn().mockResolvedValue({ data: 'test' }) }
            wildflower.provide('http', httpService)

            let capturedHttp

            wildflower.component('test', {
                uses: ['http'],
                state: {},
                init() {
                    capturedHttp = this.$http
                }
            })

            testContainer.innerHTML = '<div data-component="test"></div>'
            wildflower.scan()
            await waitForComponent('[data-component="test"]')

            expect(capturedHttp).toBe(httpService)
        })

        it('should provide multiple services', async () => {
            const http = { get: vi.fn() }
            const config = { apiUrl: '/api' }
            const logger = { log: vi.fn() }

            wildflower.provide('http', http)
            wildflower.provide('config', config)
            wildflower.provide('logger', logger)

            let capturedServices = {}

            wildflower.component('test', {
                uses: ['http', 'config', 'logger'],
                state: {},
                init() {
                    capturedServices = {
                        http: this.$http,
                        config: this.$config,
                        logger: this.$logger
                    }
                }
            })

            testContainer.innerHTML = '<div data-component="test"></div>'
            wildflower.scan()
            await waitForComponent('[data-component="test"]')

            expect(capturedServices.http).toBe(http)
            expect(capturedServices.config).toBe(config)
            expect(capturedServices.logger).toBe(logger)
        })

        it('should allow using services in methods', async () => {
            const http = {
                get: vi.fn().mockResolvedValue({ users: ['Alice', 'Bob'] })
            }
            wildflower.provide('http', http)

            wildflower.component('test', {
                uses: ['http'],
                state: { users: [] },
                async loadUsers() {
                    const data = await this.$http.get('/users')
                    this.state.users = data.users
                }
            })

            testContainer.innerHTML = '<div data-component="test"></div>'
            wildflower.scan()
            const component = await waitForComponent('[data-component="test"]')

            // Verify initial state is empty (use length check to avoid framework internal props)
            expect(component.state.users.length).toBe(0)

            await component.loadUsers()

            // Check result using array contents (toContain avoids strict equality issues)
            expect(component.state.users.length).toBe(2)
            expect(component.state.users[0]).toBe('Alice')
            expect(component.state.users[1]).toBe('Bob')
            expect(http.get).toHaveBeenCalledWith('/users')
        })

        itIfWarnings('should warn for missing provider', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

            wildflower.component('test', {
                uses: ['nonexistent'],
                state: {}
            })

            testContainer.innerHTML = '<div data-component="test"></div>'
            wildflower.scan()
            await waitForComponent('[data-component="test"]')

            expect(warnSpy).toHaveBeenCalled()
            warnSpy.mockRestore()
        })

        it('should handle component without uses', async () => {
            wildflower.provide('http', { get: vi.fn() })

            wildflower.component('test', {
                state: {},
                init() {}
            })

            testContainer.innerHTML = '<div data-component="test"></div>'
            wildflower.scan()
            const component = await waitForComponent('[data-component="test"]')

            // Should not have $http since not using it
            expect(component.$http).toBeUndefined()
        })
    })

    describe('Plugin uses', () => {
        it('should provide services to plugin install', () => {
            const http = { get: vi.fn() }
            wildflower.provide('http', http)

            let capturedHttp

            wildflower.plugin({
                name: 'dataSync',
                version: '1.0.0',
                uses: ['http'],
                install(wf, options) {
                    capturedHttp = this.$http
                }
            })

            expect(capturedHttp).toBe(http)
        })

        it('should provide multiple services to plugin', () => {
            const http = { get: vi.fn() }
            const config = { apiUrl: '/api' }

            wildflower.provide('http', http)
            wildflower.provide('config', config)

            let capturedServices = {}

            wildflower.plugin({
                name: 'api',
                version: '1.0.0',
                uses: ['http', 'config'],
                install(wf, options) {
                    capturedServices = {
                        http: this.$http,
                        config: this.$config
                    }
                }
            })

            expect(capturedServices.http).toBe(http)
            expect(capturedServices.config).toBe(config)
        })
    })

    describe('Edge Cases', () => {
        it('should handle providing functions', async () => {
            const formatDate = (date) => date.toISOString()
            wildflower.provide('formatDate', formatDate)

            let result

            wildflower.component('test', {
                uses: ['formatDate'],
                state: {},
                init() {
                    result = this.$formatDate(new Date('2024-01-01'))
                }
            })

            testContainer.innerHTML = '<div data-component="test"></div>'
            wildflower.scan()
            await waitForComponent('[data-component="test"]')

            expect(result).toBe('2024-01-01T00:00:00.000Z')
        })

        it('should handle providing primitive values', async () => {
            wildflower.provide('apiVersion', '2.0')
            wildflower.provide('maxRetries', 3)
            wildflower.provide('isProduction', false)

            let captured = {}

            wildflower.component('test', {
                uses: ['apiVersion', 'maxRetries', 'isProduction'],
                state: {},
                init() {
                    captured = {
                        version: this.$apiVersion,
                        retries: this.$maxRetries,
                        prod: this.$isProduction
                    }
                }
            })

            testContainer.innerHTML = '<div data-component="test"></div>'
            wildflower.scan()
            await waitForComponent('[data-component="test"]')

            expect(captured.version).toBe('2.0')
            expect(captured.retries).toBe(3)
            expect(captured.prod).toBe(false)
        })

        it('should handle providing class instances', async () => {
            class Logger {
                logs = []
                log(msg) { this.logs.push(msg) }
            }
            const logger = new Logger()
            wildflower.provide('logger', logger)

            wildflower.component('test', {
                uses: ['logger'],
                state: {},
                init() {
                    this.$logger.log('initialized')
                }
            })

            testContainer.innerHTML = '<div data-component="test"></div>'
            wildflower.scan()
            await waitForComponent('[data-component="test"]')

            expect(logger.logs).toContain('initialized')
        })

        it('should share same instance across components', async () => {
            const sharedService = { count: 0, increment() { this.count++ } }
            wildflower.provide('shared', sharedService)

            wildflower.component('comp1', {
                uses: ['shared'],
                state: {},
                increment() { this.$shared.increment() }
            })

            wildflower.component('comp2', {
                uses: ['shared'],
                state: {},
                increment() { this.$shared.increment() }
            })

            testContainer.innerHTML = `
                <div data-component="comp1"></div>
                <div data-component="comp2"></div>
            `
            wildflower.scan()

            const comp1 = await waitForComponent('[data-component="comp1"]')
            const comp2 = await waitForComponent('[data-component="comp2"]')

            comp1.increment()
            comp2.increment()

            expect(sharedService.count).toBe(2)
        })

        it('should handle uses as string instead of array', async () => {
            wildflower.provide('http', { get: vi.fn() })

            let captured

            wildflower.component('test', {
                uses: 'http', // String instead of array
                state: {},
                init() {
                    captured = this.$http
                }
            })

            testContainer.innerHTML = '<div data-component="test"></div>'
            wildflower.scan()
            await waitForComponent('[data-component="test"]')

            expect(captured).toBeDefined()
        })
    })

    describe('Utility Methods', () => {
        describe('getService()', () => {
            it('should retrieve a provided service', () => {
                const httpService = { get: vi.fn(), post: vi.fn() }
                wildflower.provide('http', httpService)

                const retrieved = wildflower.getService('http')

                expect(retrieved).toBe(httpService)
            })

            it('should return undefined for non-existent service', () => {
                const result = wildflower.getService('nonexistent')

                expect(result).toBeUndefined()
            })

            it('should retrieve primitive values', () => {
                wildflower.provide('apiVersion', '2.0')
                wildflower.provide('maxRetries', 5)
                wildflower.provide('debug', true)

                expect(wildflower.getService('apiVersion')).toBe('2.0')
                expect(wildflower.getService('maxRetries')).toBe(5)
                expect(wildflower.getService('debug')).toBe(true)
            })

            it('should retrieve functions', () => {
                const formatDate = (d) => d.toISOString()
                wildflower.provide('formatDate', formatDate)

                const retrieved = wildflower.getService('formatDate')

                expect(retrieved).toBe(formatDate)
                expect(retrieved(new Date('2024-01-01'))).toBe('2024-01-01T00:00:00.000Z')
            })

            it('should return same instance on multiple calls', () => {
                const service = { data: [] }
                wildflower.provide('cache', service)

                const first = wildflower.getService('cache')
                const second = wildflower.getService('cache')

                expect(first).toBe(second)
                expect(first).toBe(service)
            })
        })

        describe('hasProvider()', () => {
            it('should return true for registered provider', () => {
                wildflower.provide('http', { get: vi.fn() })

                expect(wildflower.hasProvider('http')).toBe(true)
            })

            it('should return false for unregistered provider', () => {
                expect(wildflower.hasProvider('nonexistent')).toBe(false)
            })

            it('should return true after provider is added', () => {
                expect(wildflower.hasProvider('config')).toBe(false)

                wildflower.provide('config', { apiUrl: '/api' })

                expect(wildflower.hasProvider('config')).toBe(true)
            })

            it('should return true for providers with falsy values', () => {
                wildflower.provide('zero', 0)
                wildflower.provide('empty', '')
                wildflower.provide('nullish', null)

                expect(wildflower.hasProvider('zero')).toBe(true)
                expect(wildflower.hasProvider('empty')).toBe(true)
                expect(wildflower.hasProvider('nullish')).toBe(true)
            })
        })

        describe('listPlugins()', () => {
            it('should return empty array when no plugins registered', () => {
                const plugins = wildflower.listPlugins()

                expect(plugins).toEqual([])
            })

            it('should return registered plugin info', () => {
                wildflower.plugin({
                    name: 'analytics',
                    version: '1.0.0',
                    install() {}
                })

                const plugins = wildflower.listPlugins()

                expect(plugins.length).toBe(1)
                expect(plugins[0].name).toBe('analytics')
                expect(plugins[0].version).toBe('1.0.0')
            })

            it('should return multiple plugins', () => {
                wildflower.plugin({
                    name: 'analytics',
                    version: '1.0.0',
                    install() {}
                })

                wildflower.plugin({
                    name: 'logger',
                    version: '2.0.0',
                    install() {}
                })

                wildflower.plugin({
                    name: 'cache',
                    version: '1.5.0',
                    install() {}
                })

                const plugins = wildflower.listPlugins()

                expect(plugins.length).toBe(3)
                expect(plugins.map(p => p.name)).toContain('analytics')
                expect(plugins.map(p => p.name)).toContain('logger')
                expect(plugins.map(p => p.name)).toContain('cache')
            })

            it('should exclude anonymous function-based plugins', () => {
                // Function-based plugins without a name are excluded from listPlugins
                // since they have no meaningful name to reference
                wildflower.plugin(function(wf) {
                    // Anonymous function plugin
                })

                const plugins = wildflower.listPlugins()

                // Anonymous plugins are filtered out
                expect(plugins.length).toBe(0)
            })

            it('should include named function-based plugins when wrapped in object', () => {
                // To include a function-based plugin in the list, wrap it in an object with name
                wildflower.plugin({
                    name: 'myPlugin',
                    version: '1.0.0',
                    install(wf) {
                        // Plugin logic
                    }
                })

                const plugins = wildflower.listPlugins()

                expect(plugins.length).toBe(1)
                expect(plugins[0].name).toBe('myPlugin')
            })
        })

        describe('getPlugin()', () => {
            it('should return plugin info by name', () => {
                wildflower.plugin({
                    name: 'analytics',
                    version: '1.0.0',
                    state: { events: [] },
                    install() {}
                })

                const plugin = wildflower.getPlugin('analytics')

                expect(plugin).toBeDefined()
                expect(plugin.name).toBe('analytics')
                expect(plugin.version).toBe('1.0.0')
            })

            it('should return undefined for non-existent plugin', () => {
                const plugin = wildflower.getPlugin('nonexistent')

                expect(plugin).toBeUndefined()
            })

            it('should return correct plugin among multiple', () => {
                wildflower.plugin({
                    name: 'first',
                    version: '1.0.0',
                    install() {}
                })

                wildflower.plugin({
                    name: 'second',
                    version: '2.0.0',
                    install() {}
                })

                const first = wildflower.getPlugin('first')
                const second = wildflower.getPlugin('second')

                expect(first.version).toBe('1.0.0')
                expect(second.version).toBe('2.0.0')
            })
        })

        describe('hasPlugin()', () => {
            it('should return true for registered plugin', () => {
                wildflower.plugin({
                    name: 'analytics',
                    version: '1.0.0',
                    install() {}
                })

                expect(wildflower.hasPlugin('analytics')).toBe(true)
            })

            it('should return false for unregistered plugin', () => {
                expect(wildflower.hasPlugin('nonexistent')).toBe(false)
            })

            it('should return true after plugin is added', () => {
                expect(wildflower.hasPlugin('logger')).toBe(false)

                wildflower.plugin({
                    name: 'logger',
                    version: '1.0.0',
                    install() {}
                })

                expect(wildflower.hasPlugin('logger')).toBe(true)
            })
        })

        describe('Plugin computed properties', () => {
            it('should make computed properties accessible on $pluginName', () => {
                wildflower.plugin({
                    name: 'counter',
                    version: '1.0.0',
                    state: {
                        count: 5
                    },
                    computed: {
                        doubled() {
                            return this.state.count * 2
                        },
                        isPositive() {
                            return this.state.count > 0
                        }
                    },
                    install() {}
                })

                expect(wildflower.$counter.doubled).toBe(10)
                expect(wildflower.$counter.isPositive).toBe(true)
            })

            it('should update computed when state changes', () => {
                wildflower.plugin({
                    name: 'items',
                    version: '1.0.0',
                    state: {
                        list: [1, 2, 3]
                    },
                    computed: {
                        count() {
                            return this.state.list.length
                        },
                        isEmpty() {
                            return this.state.list.length === 0
                        }
                    },
                    methods: {
                        add(item) {
                            this.state.list.push(item)
                        },
                        clear() {
                            this.state.list = []
                        }
                    },
                    install() {}
                })

                expect(wildflower.$items.count).toBe(3)
                expect(wildflower.$items.isEmpty).toBe(false)

                wildflower.$items.add(4)
                expect(wildflower.$items.count).toBe(4)

                wildflower.$items.clear()
                expect(wildflower.$items.isEmpty).toBe(true)
            })
        })
    })
})
